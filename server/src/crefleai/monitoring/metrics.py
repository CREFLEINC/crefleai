import asyncio
import shutil
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path


@dataclass(frozen=True)
class GpuMetric:
    index: int
    name: str
    utilization_percent: float
    memory_used_bytes: int
    memory_total_bytes: int
    memory_used_percent: float


@dataclass(frozen=True)
class DiskMetric:
    status: str
    path: str
    total_bytes: int | None
    used_bytes: int | None
    free_bytes: int | None
    used_percent: float | None
    error: str | None


@dataclass(frozen=True)
class RequestMetricsSnapshot:
    window_seconds: int
    rpm: int
    success: int
    failure: int
    in_flight: int


@dataclass(frozen=True)
class SystemMetricsSnapshot:
    sampled_at: datetime | None
    stale: bool
    disk: DiskMetric
    gpus: list[GpuMetric]


class RequestMetricsTracker:
    """Track completed chat requests in a sliding time window."""

    def __init__(
        self,
        window_seconds: int = 60,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._window = timedelta(seconds=window_seconds)
        self._window_seconds = window_seconds
        self._now = now or (lambda: datetime.now(UTC))
        self._events: deque[tuple[datetime, bool]] = deque()
        self._in_flight = 0

    def record_started(self) -> None:
        self._in_flight += 1

    def record_finished(self, *, success: bool) -> None:
        self._in_flight = max(0, self._in_flight - 1)
        self._events.append((self._now(), success))
        self._prune()

    def snapshot(self) -> RequestMetricsSnapshot:
        self._prune()
        success = sum(1 for _, ok in self._events if ok)
        failure = len(self._events) - success
        return RequestMetricsSnapshot(
            window_seconds=self._window_seconds,
            rpm=len(self._events),
            success=success,
            failure=failure,
            in_flight=self._in_flight,
        )

    def _prune(self) -> None:
        cutoff = self._now() - self._window
        while self._events and self._events[0][0] < cutoff:
            self._events.popleft()


def collect_gpu_metrics() -> list[GpuMetric]:
    """Collect GPU metrics through NVML when pynvml is available."""
    try:
        import pynvml
    except ImportError:
        return []

    pynvml.nvmlInit()
    try:
        metrics = []
        for index in range(pynvml.nvmlDeviceGetCount()):
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")
            utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            used_percent = round((memory.used / memory.total) * 100, 1) if memory.total else 0.0
            metrics.append(
                GpuMetric(
                    index=index,
                    name=str(name),
                    utilization_percent=float(utilization.gpu),
                    memory_used_bytes=int(memory.used),
                    memory_total_bytes=int(memory.total),
                    memory_used_percent=used_percent,
                )
            )
        return metrics
    finally:
        pynvml.nvmlShutdown()


class SystemMetricsSampler:
    """Sample host metrics periodically and keep the latest snapshot in memory."""

    def __init__(
        self,
        data_dir: Path,
        gpu_collector: Callable[[], list[GpuMetric]] = collect_gpu_metrics,
        interval_seconds: float = 5.0,
        stale_after_seconds: float = 15.0,
    ) -> None:
        self._data_dir = data_dir
        self._gpu_collector = gpu_collector
        self._interval_seconds = interval_seconds
        self._stale_after = timedelta(seconds=stale_after_seconds)
        self._sampled_at: datetime | None = None
        self._disk = DiskMetric(
            status="unavailable",
            path=str(data_dir),
            total_bytes=None,
            used_bytes=None,
            free_bytes=None,
            used_percent=None,
            error="not sampled yet",
        )
        self._gpus: list[GpuMetric] = []
        self._task: asyncio.Task | None = None

    def sample_once(self) -> None:
        self._disk = self._collect_disk()
        try:
            self._gpus = self._gpu_collector()
        except Exception:  # noqa: BLE001 - GPU telemetry must not break admin API.
            self._gpus = []
        self._sampled_at = datetime.now(UTC)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass

    def snapshot(self) -> SystemMetricsSnapshot:
        now = datetime.now(UTC)
        stale = self._sampled_at is None or now - self._sampled_at > self._stale_after
        return SystemMetricsSnapshot(
            sampled_at=self._sampled_at,
            stale=stale,
            disk=self._disk,
            gpus=self._gpus,
        )

    async def _run(self) -> None:
        while True:
            await asyncio.to_thread(self.sample_once)
            await asyncio.sleep(self._interval_seconds)

    def _collect_disk(self) -> DiskMetric:
        try:
            usage = shutil.disk_usage(self._data_dir)
        except OSError as exc:
            return DiskMetric(
                status="unavailable",
                path=str(self._data_dir),
                total_bytes=None,
                used_bytes=None,
                free_bytes=None,
                used_percent=None,
                error=str(exc),
            )

        used_percent = round((usage.used / usage.total) * 100, 1) if usage.total else 0.0
        return DiskMetric(
            status="ok",
            path=str(self._data_dir),
            total_bytes=usage.total,
            used_bytes=usage.used,
            free_bytes=usage.free,
            used_percent=used_percent,
            error=None,
        )
