import datetime as dt
import uuid

import jwt

from crefleai.auth.errors import InvalidTokenError
from crefleai.db import Database

ALGORITHM = "HS256"


def create_user_token(db: Database, secret: str, user_name: str, purpose: str) -> tuple[str, dict]:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user_name,
        "purpose": purpose,
        "iat": int(now.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, secret, algorithm=ALGORITHM)
    db.insert_token(payload["jti"], user_name, purpose, now.isoformat())
    return token, payload


def verify_user_token(db: Database, secret: str, token: str) -> dict:
    try:
        payload = jwt.decode(
            token, secret, algorithms=[ALGORITHM], options={"require": ["jti", "sub"]}
        )
    except jwt.PyJWTError as e:
        raise InvalidTokenError(str(e)) from e
    row = db.get_token(payload["jti"])
    if row is None or row["revoked_at"] is not None:
        raise InvalidTokenError("token is not in allowlist or has been revoked")
    return payload
