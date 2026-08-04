from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from crefleai.api.deps import ADMIN_COOKIE, get_app_settings, get_db, require_admin
from crefleai.api.errors import APIError
from crefleai.auth.admin import ADMIN_SESSION_HOURS, login_admin
from crefleai.config import Settings
from crefleai.db import Database

router = APIRouter(prefix="/admin", tags=["admin"])


class LoginBody(BaseModel):
    username: str
    password: str


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
