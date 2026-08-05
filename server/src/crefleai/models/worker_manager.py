import asyncio
import sys
from pathlib import Path

import httpx

from crefleai.models.catalog import CatalogModel


class WorkerError(Exception):
    """워커 기동 실패."""


class WorkerManager:
    """추론 워커 서브프로세스를 스폰·감시한다. 워커는 항상 0개 또는 1개."""

    def __init__(
        self,
        port: int,
        ctx: int,
        command_builder=None,
        startup_timeout: float = 600.0,
        max_restarts: int = 3,
        stable_after: float = 300.0,
    ):
        self._port = port
        self._ctx = ctx
        self._command_builder = command_builder or self._default_command
        self._startup_timeout = startup_timeout
        self._max_restarts = max_restarts
        self._stable_after = stable_after
        self._ready_at: float | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._watchdog: asyncio.Task | None = None
        self._model: CatalogModel | None = None
        self._model_path: Path | None = None
        self._restarts = 0
        self.status = "stopped"
        self.error: str | None = None
        self._serve_lock = asyncio.Lock()
        self._stop_requested = asyncio.Event()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

    @property
    def context_length(self) -> int | None:
        """서빙 모델의 유효 컨텍스트 크기 — 모델 한계와 워커 n_ctx 중 작은 값."""
        if self._model is None:
            return None
        return min(self._model.context_length, self._ctx)

    def _default_command(self, model: CatalogModel, model_path: Path) -> list[str]:
        return [
            sys.executable, "-m", "crefleai.worker",
            "--model-path", str(model_path),
            "--model-id", model.id,
            "--port", str(self._port),
            "--ctx", str(self._ctx),
        ]

    async def serve(self, model: CatalogModel, model_path: Path) -> None:
        async with self._serve_lock:
            await self._stop_locked()
            self._model, self._model_path = model, model_path
            self._restarts = 0
            await self._spawn()

    async def _spawn(self) -> None:
        self.status, self.error = "starting", None
        self._proc = await asyncio.create_subprocess_exec(
            *self._command_builder(self._model, self._model_path)
        )
        try:
            await self._wait_ready()
        except WorkerError as e:
            self.status, self.error = "failed", str(e)
            await self._terminate()
            raise
        self.status = "running"
        self._ready_at = asyncio.get_running_loop().time()
        self._watchdog = asyncio.create_task(self._watch())

    async def _wait_ready(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._startup_timeout
        async with httpx.AsyncClient(timeout=5.0) as client:
            while loop.time() < deadline:
                # stop()이 락을 기다리는 동안 startup_timeout까지 붙잡지 않도록 조기 이탈
                if self._stop_requested.is_set():
                    raise WorkerError("셧다운 요청으로 기동을 중단했습니다")
                if self._proc.returncode is not None:
                    raise WorkerError(f"워커가 기동 중 종료됨 (exit code {self._proc.returncode})")
                try:
                    r = await client.get(f"{self.base_url}/health")
                    if r.status_code == 200 and r.json().get("status") == "ready":
                        return
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.5)
        raise WorkerError("워커 기동 시간 초과")

    async def _watch(self) -> None:
        proc = self._proc
        await proc.wait()
        async with self._serve_lock:
            if self.status == "stopping" or proc is not self._proc:
                return
            # stable_after 이상 정상 가동 후의 크래시는 크래시 루프가 아니므로
            # 카운터를 리셋 — 짧은 간격의 반복 크래시만 한도에 걸리게 한다
            uptime = asyncio.get_running_loop().time() - self._ready_at
            if uptime >= self._stable_after:
                self._restarts = 0
            self._restarts += 1
            if self._restarts > self._max_restarts:
                self.status = "failed"
                self.error = "워커가 반복적으로 종료되어 재시작을 중단했습니다"
                return
            try:
                await self._spawn()
            except WorkerError:
                pass  # 상태는 _spawn이 failed로 기록

    async def _terminate(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=10)
            except TimeoutError:
                self._proc.kill()
                await self._proc.wait()

    async def stop(self) -> None:
        self._stop_requested.set()
        try:
            async with self._serve_lock:
                await self._stop_locked()
        finally:
            self._stop_requested.clear()

    async def _stop_locked(self) -> None:
        self.status = "stopping"
        if self._watchdog:
            self._watchdog.cancel()
            try:
                await self._watchdog
            except asyncio.CancelledError:
                pass
            self._watchdog = None
        await self._terminate()
        self._proc = None
        self.status = "stopped"
