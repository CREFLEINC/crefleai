def test_로그인_성공시_쿠키로_me_접근(client):
    res = client.post("/admin/login", json={"username": "admin", "password": "admin-pw"})
    assert res.status_code == 200
    assert "crefleai_admin" in res.cookies

    me = client.get("/admin/me")
    assert me.status_code == 200
    assert me.json() == {"username": "admin"}


def test_잘못된_비밀번호는_401_OpenAI_에러형식(client):
    res = client.post("/admin/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401
    body = res.json()
    assert "message" in body["error"]
    assert body["error"]["type"] == "invalid_request_error"


def test_쿠키_없으면_401(client):
    assert client.get("/admin/me").status_code == 401


def test_로그아웃하면_me가_401(admin_client):
    admin_client.post("/admin/logout")
    assert admin_client.get("/admin/me").status_code == 401


def test_검증_실패도_OpenAI_에러형식(client):
    res = client.post("/admin/login", json={"username": "admin"})  # password 누락
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["type"] == "invalid_request_error"
    assert "message" in body["error"]
