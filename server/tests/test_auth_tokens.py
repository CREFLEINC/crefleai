import jwt as pyjwt
import pytest

from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import create_user_token, verify_user_token

SECRET = "test-secret"


def test_발급_후_검증_성공(db):
    token, payload = create_user_token(db, SECRET, "홍길동", "프로토타입 테스트")
    assert payload["sub"] == "홍길동"
    assert payload["purpose"] == "프로토타입 테스트"
    assert "exp" not in payload  # 무만료

    verified = verify_user_token(db, SECRET, token)
    assert verified["jti"] == payload["jti"]
    assert db.get_token(payload["jti"]) is not None  # allowlist 기록됨


def test_폐기된_토큰_거부(db):
    token, payload = create_user_token(db, SECRET, "홍길동", "테스트")
    db.revoke_token(payload["jti"], "2026-08-03T00:00:00+00:00")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, SECRET, token)


def test_서명_불일치_거부(db):
    token, _ = create_user_token(db, SECRET, "홍길동", "테스트")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, "다른-시크릿", token)


def test_jti_없는_토큰_거부(db):
    # 관리자 세션 토큰처럼 jti가 없는 JWT는 /v1 경로에서 거부되어야 한다
    token = pyjwt.encode({"sub": "admin", "scope": "admin"}, SECRET, algorithm="HS256")
    with pytest.raises(InvalidTokenError):
        verify_user_token(db, SECRET, token)
