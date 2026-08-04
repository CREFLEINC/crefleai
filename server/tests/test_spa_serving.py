from fastapi.testclient import TestClient

from crefleai.main import create_app


def test_spa_서빙과_폴백(settings, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>CrefleAI</html>")

    spa_settings = settings.model_copy(update={"web_dist": dist})
    with TestClient(create_app(spa_settings)) as client:
        assert "CrefleAI" in client.get("/").text
        # SPA 딥링크는 index.html로 폴백 (실제 충돌 라우트)
        assert "CrefleAI" in client.get("/admin/models").text
        # API 라우트는 정적 서빙보다 우선
        assert client.get("/api/admin/models").status_code == 401


def test_dist_없으면_정적_서빙_생략(settings, tmp_path):
    no_dist = settings.model_copy(update={"web_dist": tmp_path / "no-such-dist"})
    with TestClient(create_app(no_dist)) as client:
        assert client.get("/").status_code == 404  # 정적 마운트 없음
        assert client.get("/api/admin/models").status_code == 401  # API는 정상
