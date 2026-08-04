from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from crefleai.api import admin as admin_api
from crefleai.api.errors import APIError
from crefleai.auth.admin import bootstrap_admin
from crefleai.config import Settings, get_settings
from crefleai.db import Database


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    app.state.db = Database(settings.db_path)
    bootstrap_admin(app.state.db, settings)
    yield
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
    return app


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
