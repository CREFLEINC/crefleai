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
    ):
        self._port = port
        self._ctx = ctx
        self._command_builder = command_builder or self._default_command
        self._startup_timeout = startup_timeout
        self._max_restarts = max_restarts
        self._proc: asyncio.subprocess.Process | None = None
        self._watchdog: asyncio.Task | None = None
        self._model: CatalogModel | None = None
        self._model_path: Path | None = None
        self._restarts = 0
        self.status = "stopped"
        self.error: str | None = None
        self._serve_lock = asyncio.Lock()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    @property
    def model_id(self) -> str | None:
        return self._model.id if self._model else None

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
        self._watchdog = asyncio.create_task(self._watch())

    async def _wait_ready(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._startup_timeout
        async with httpx.AsyncClient(timeout=5.0) as client:
            while loop.time() < deadline:
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
        async with self._serve_lock:
            await self._stop_locked()

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
