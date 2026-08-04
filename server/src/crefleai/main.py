import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from crefleai.api import admin as admin_api
from crefleai.api import v1 as v1_api
from crefleai.api.errors import APIError
from crefleai.auth.admin import bootstrap_admin
from crefleai.config import Settings, get_settings
from crefleai.db import Database
from crefleai.models.catalog import load_catalog, model_file
from crefleai.models.downloads import DownloadManager
from crefleai.models.worker_manager import WorkerManager


class SPAStaticFiles(StaticFiles):
    """SPA 클라이언트 라우트 딥링크를 index.html로 폴백한다."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as e:
            if e.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def _web_dist(settings: Settings) -> Path | None:
    if settings.web_dist is not None:
        return settings.web_dist
    default = Path(__file__).resolve().parents[3] / "web" / "dist"
    return default if default.exists() else None


def _maybe_restore(app: FastAPI) -> asyncio.Task | None:
    db = app.state.db
    catalog = app.state.catalog
    settings = app.state.settings
    model_id = db.get_setting("serving_model")
    model = catalog.get(model_id) if model_id else None
    if model is None:
        return None
    path = model_file(settings.models_dir, model)
    if not path.exists():
        return None

    async def _restore():
        try:
            await app.state.worker_manager.serve(model, path)
        except Exception:  # noqa: BLE001, S110 — 실패 상태는 wm.status/error로 노출된다
            pass

    return asyncio.create_task(_restore())


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    app.state.db = Database(settings.db_path)
    bootstrap_admin(app.state.db, settings)
    app.state.catalog = load_catalog()
    app.state.download_manager = DownloadManager(settings.models_dir, app.state.catalog)
    app.state.worker_manager = WorkerManager(settings.worker_port, settings.worker_ctx)
    app.state.http_client = httpx.AsyncClient(timeout=httpx.Timeout(10, read=None))
    app.state.restore_task = _maybe_restore(app)
    yield
    for task_name in ("serve_task", "restore_task"):
        task = getattr(app.state, task_name, None)
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    await app.state.worker_manager.stop()
    await app.state.http_client.aclose()
    app.state.db.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="CrefleAI", lifespan=_lifespan)
    app.state.settings = settings or get_settings()

    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"message": exc.message, "type": exc.type, "code": exc.code}},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "message": "요청 본문이 유효하지 않습니다",
                    "type": "invalid_request_error",
                    "code": None,
                }
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "message": "내부 서버 오류가 발생했습니다",
                    "type": "server_error",
                    "code": None,
                }
            },
        )

    app.include_router(admin_api.router)
    app.include_router(v1_api.router)

    dist = _web_dist(app.state.settings)
    if dist is not None and dist.exists():
        app.mount("/", SPAStaticFiles(directory=dist, html=True), name="web")

    return app


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
