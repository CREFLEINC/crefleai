import asyncio
from dataclasses import dataclass
from pathlib import Path

import httpx

from crefleai.models.catalog import CatalogModel

HF_BASE = "https://huggingface.co"
_CHUNK = 1024 * 1024


@dataclass
class DownloadState:
    status: str = "idle"  # idle | downloading | ready | failed
    progress: float = 0.0
    error: str | None = None


class DownloadManager:
    def __init__(
        self,
        models_dir: Path,
        catalog: dict[str, CatalogModel],
        client: httpx.AsyncClient | None = None,
    ):
        self._models_dir = models_dir
        self._catalog = catalog
        self._client = client  # None이면 다운로드마다 생성 (운영 기본)
        self._states: dict[str, DownloadState] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    def state_for(self, model_id: str) -> DownloadState:
        state = self._states.get(model_id)
        if state is not None:
            return state
        model = self._catalog[model_id]
        if (self._models_dir / model.filename).exists():
            return DownloadState("ready", 1.0, None)
        return DownloadState("idle", 0.0, None)

    def start(self, model_id: str) -> bool:
        if self.state_for(model_id).status in ("downloading", "ready"):
            return False
        self._states[model_id] = DownloadState("downloading", 0.0, None)
        self._tasks[model_id] = asyncio.create_task(self._download(model_id))
        return True

    async def wait(self, model_id: str) -> None:
        task = self._tasks.get(model_id)
        if task is not None:
            await task

    async def _download(self, model_id: str) -> None:
        client: httpx.AsyncClient | None = None
        owns_client = False
        try:
            model = self._catalog[model_id]
            url = f"{HF_BASE}/{model.hf_repo}/resolve/main/{model.filename}"
            part = self._models_dir / f"{model.filename}.part"
            state = self._states[model_id]
            client = self._client or httpx.AsyncClient(
                follow_redirects=True, timeout=httpx.Timeout(30, read=120)
            )
            owns_client = self._client is None
            self._models_dir.mkdir(parents=True, exist_ok=True)
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                total = int(response.headers.get("content-length") or model.size_bytes)
                written = 0
                with part.open("wb") as f:
                    async for chunk in response.aiter_bytes(_CHUNK):
                        f.write(chunk)
                        written += len(chunk)
                        if total:
                            state.progress = min(written / total, 1.0)
            part.replace(self._models_dir / model.filename)
            state.status, state.progress = "ready", 1.0
        except Exception as e:  # noqa: BLE001 — 상태로 노출하고 삼키지 않는다
            state = self._states[model_id]
            part = self._models_dir / f"{self._catalog[model_id].filename}.part"
            part.unlink(missing_ok=True)
            state.status, state.error = "failed", str(e)
        finally:
            if owns_client and client is not None:
                await client.aclose()
