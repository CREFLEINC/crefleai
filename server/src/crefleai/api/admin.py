import datetime as dt

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from crefleai.api.deps import ADMIN_COOKIE, get_app_settings, get_db, require_admin
from crefleai.api.errors import APIError
from crefleai.auth.admin import ADMIN_SESSION_HOURS, login_admin
from crefleai.auth.tokens import create_user_token
from crefleai.config import Settings
from crefleai.db import Database

router = APIRouter(prefix="/admin", tags=["admin"])


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
    revoked = db.revoke_token(jti, dt.datetime.now(dt.timezone.utc).isoformat())
    if not revoked:
        raise APIError(404, "해당 토큰이 없거나 이미 폐기되었습니다", "invalid_request_error")
    return {"ok": True}
