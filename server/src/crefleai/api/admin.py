import asyncio
import datetime as dt
from dataclasses import asdict

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from crefleai.api.deps import (
    ADMIN_COOKIE,
    get_app_settings,
    get_catalog,
    get_db,
    get_download_manager,
    require_admin,
)
from crefleai.api.errors import APIError
from crefleai.auth.admin import ADMIN_SESSION_HOURS, login_admin
from crefleai.auth.tokens import create_user_token
from crefleai.config import Settings
from crefleai.db import Database
from crefleai.models.catalog import model_file

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginBody(BaseModel):
    username: str
    password: str


class CreateTokenBody(BaseModel):
    user_name: str
    purpose: str


@router.post("/login")
def login(
    body: LoginBody,
    response: Response,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
):
    token = login_admin(db, settings.jwt_secret, body.username, body.password)
    if token is None:
        raise APIError(401, "아이디 또는 비밀번호가 올바르지 않습니다", "invalid_request_error")
    # secure 미설정은 사내 HTTP 배포 전제 — TLS 도입 시 secure=True 필수
    response.set_cookie(
        ADMIN_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        max_age=ADMIN_SESSION_HOURS * 3600,
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(admin: dict = Depends(require_admin)):
    return {"username": admin["sub"]}


@router.get("/tokens")
def list_tokens(db: Database = Depends(get_db), _admin: dict = Depends(require_admin)):
    return {"tokens": [dict(row) for row in db.list_tokens()]}


@router.post("/tokens")
def create_token(
    body: CreateTokenBody,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
    _admin: dict = Depends(require_admin),
):
    token, payload = create_user_token(db, settings.jwt_secret, body.user_name, body.purpose)
    return {
        "token": token,
        "jti": payload["jti"],
        "user_name": body.user_name,
        "purpose": body.purpose,
        "created_at": db.get_token(payload["jti"])["created_at"],
    }


@router.delete("/tokens/{jti}")
def revoke_token(
    jti: str,
    db: Database = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    revoked = db.revoke_token(jti, dt.datetime.now(dt.UTC).isoformat())
    if not revoked:
        raise APIError(404, "해당 토큰이 없거나 이미 폐기되었습니다", "invalid_request_error")
    return {"ok": True}


@router.get("/models")
def list_models(
    request: Request,
    catalog: dict = Depends(get_catalog),
    _admin: dict = Depends(require_admin),
):
    dm = request.app.state.download_manager
    wm = request.app.state.worker_manager
    models = []
    for m in catalog.values():
        state = dm.state_for(m.id)
        if wm.model_id == m.id and wm.status == "running":
            status = "serving"
        elif state.status == "idle":
            status = "not_downloaded"
        else:
            status = state.status
        models.append(
            {**asdict(m), "status": status, "progress": state.progress, "error": state.error}
        )
    return {
        "models": models,
        "worker": {"status": wm.status, "model_id": wm.model_id, "error": wm.error},
    }


@router.post("/models/{model_id}/download", status_code=202)
async def download_model(
    model_id: str,
    catalog: dict = Depends(get_catalog),
    dm=Depends(get_download_manager),
    _admin: dict = Depends(require_admin),
):
    if model_id not in catalog:
        raise APIError(404, f"카탈로그에 없는 모델입니다: {model_id}", "invalid_request_error")
    if not dm.start(model_id):
        raise APIError(409, "이미 다운로드되었거나 진행 중입니다", "invalid_request_error")
    return {"ok": True}


@router.post("/models/{model_id}/serve", status_code=202)
async def serve_model(
    model_id: str,
    request: Request,
    catalog: dict = Depends(get_catalog),
    dm=Depends(get_download_manager),
    _admin: dict = Depends(require_admin),
):
    model = catalog.get(model_id)
    if model is None:
        raise APIError(404, f"카탈로그에 없는 모델입니다: {model_id}", "invalid_request_error")
    if dm.state_for(model_id).status != "ready":
        raise APIError(409, "모델이 아직 다운로드되지 않았습니다", "invalid_request_error")

    wm = request.app.state.worker_manager
    db = request.app.state.db
    path = model_file(request.app.state.settings.models_dir, model)

    existing = getattr(request.app.state, "serve_task", None)
    if existing is not None and not existing.done():
        raise APIError(409, "이미 모델 교체가 진행 중입니다", "invalid_request_error")

    async def _serve_and_persist():
        try:
            await wm.serve(model, path)
            db.set_setting("serving_model", model_id)
        except Exception:  # noqa: BLE001, S110 — 실패 상태는 wm.status/error로 노출된다
            pass

    request.app.state.serve_task = asyncio.create_task(_serve_and_persist())
    return {"ok": True}
