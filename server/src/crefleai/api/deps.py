import httpx
from fastapi import Request

from crefleai.api.errors import APIError
from crefleai.auth.admin import verify_admin_token
from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import verify_user_token
from crefleai.config import Settings
from crefleai.db import Database

ADMIN_COOKIE = "crefleai_admin"


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_admin(request: Request) -> dict:
    token = request.cookies.get(ADMIN_COOKIE)
    if not token:
        raise APIError(401, "관리자 로그인이 필요합니다", "invalid_request_error")
    try:
        return verify_admin_token(request.app.state.settings.jwt_secret, token)
    except InvalidTokenError as e:
        raise APIError(401, "관리자 세션이 유효하지 않습니다", "invalid_request_error") from e


def get_catalog(request: Request) -> dict:
    return request.app.state.catalog


def get_download_manager(request: Request):
    return request.app.state.download_manager


def get_worker_manager(request: Request):
    return request.app.state.worker_manager


def get_http_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http_client


def require_user_token(request: Request) -> dict:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise APIError(
            401, "Authorization 헤더에 Bearer 토큰이 필요합니다",
            "invalid_request_error", "invalid_api_key",
        )
    try:
        return verify_user_token(
            request.app.state.db, request.app.state.settings.jwt_secret, header[7:]
        )
    except InvalidTokenError as e:
        raise APIError(
            401, "유효하지 않거나 폐기된 토큰입니다", "invalid_request_error", "invalid_api_key"
        ) from e
