import datetime as dt

import bcrypt
import jwt

from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import ALGORITHM
from crefleai.config import Settings
from crefleai.db import Database

ADMIN_SESSION_HOURS = 12


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def bootstrap_admin(db: Database, settings: Settings) -> None:
    if db.count_admins() > 0:
        return
    if not settings.admin_id or not settings.admin_password:
        return
    now = dt.datetime.now(dt.timezone.utc)
    db.create_admin(settings.admin_id, hash_password(settings.admin_password), now.isoformat())


def login_admin(db: Database, secret: str, username: str, password: str) -> str | None:
    row = db.get_admin(username)
    if row is None or not check_password(password, row["password_hash"]):
        return None
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": username,
        "scope": "admin",
        "iat": int(now.timestamp()),
        "exp": now + dt.timedelta(hours=ADMIN_SESSION_HOURS),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def verify_admin_token(secret: str, token: str) -> dict:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp"]})
    except jwt.PyJWTError as e:
        raise InvalidTokenError(str(e)) from e
    if payload.get("scope") != "admin":
        raise InvalidTokenError("not an admin token")
    return payload
