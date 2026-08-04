import pytest

from crefleai.auth.admin import (
    bootstrap_admin,
    check_password,
    hash_password,
    login_admin,
    verify_admin_token,
)
from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import create_user_token

SECRET = "test-secret"


def test_비밀번호_해시(settings):
    h = hash_password("my-pw")
    assert h != "my-pw"
    assert check_password("my-pw", h) is True
    assert check_password("wrong", h) is False


def test_부트스트랩은_한_번만(db, settings):
    bootstrap_admin(db, settings)
    assert db.count_admins() == 1
    bootstrap_admin(db, settings)  # 이미 있으면 아무것도 안 함
    assert db.count_admins() == 1


def test_로그인_성공과_실패(db, settings):
    bootstrap_admin(db, settings)
    assert login_admin(db, SECRET, "admin", "wrong-pw") is None
    assert login_admin(db, SECRET, "없는계정", "admin-pw") is None

    token = login_admin(db, SECRET, "admin", "admin-pw")
    payload = verify_admin_token(SECRET, token)
    assert payload["sub"] == "admin"
    assert payload["scope"] == "admin"
    assert "exp" in payload


def test_사용자_토큰은_관리자_검증에서_거부(db):
    user_token, _ = create_user_token(db, SECRET, "홍길동", "테스트")
    with pytest.raises(InvalidTokenError):
        verify_admin_token(SECRET, user_token)
