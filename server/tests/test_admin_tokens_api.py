from crefleai.auth.errors import InvalidTokenError
from crefleai.auth.tokens import verify_user_token


def test_토큰_생성과_목록(admin_client):
    res = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "프로토타입"}
    )
    assert res.status_code == 200
    created = res.json()
    assert created["user_name"] == "홍길동"
    assert created["token"].count(".") == 2  # JWT 형태

    listed = admin_client.get("/admin/tokens").json()["tokens"]
    assert len(listed) == 1
    assert listed[0]["jti"] == created["jti"]
    assert "token" not in listed[0]  # 원문은 목록에 없음


def test_생성된_토큰은_실제로_유효(admin_client):
    created = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()
    app = admin_client.app
    payload = verify_user_token(app.state.db, app.state.settings.jwt_secret, created["token"])
    assert payload["jti"] == created["jti"]


def test_폐기하면_검증_실패(admin_client):
    import pytest

    created = admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()
    res = admin_client.delete(f"/admin/tokens/{created['jti']}")
    assert res.status_code == 200

    app = admin_client.app
    with pytest.raises(InvalidTokenError):
        verify_user_token(app.state.db, app.state.settings.jwt_secret, created["token"])


def test_없는_토큰_폐기는_404(admin_client):
    assert admin_client.delete("/admin/tokens/없는-jti").status_code == 404


def test_로그인_없이_토큰_API_접근은_401(client):
    assert client.get("/admin/tokens").status_code == 401
    assert client.post("/admin/tokens", json={"user_name": "a", "purpose": "b"}).status_code == 401
