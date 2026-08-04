from fastapi.testclient import TestClient

from crefleai.main import create_app


def test_spa_서빙과_폴백(settings, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>CrefleAI</html>")

    spa_settings = settings.model_copy(update={"web_dist": dist})
    with TestClient(create_app(spa_settings)) as client:
        assert "CrefleAI" in client.get("/").text
        # SPA 딥링크는 index.html로 폴백
        assert "CrefleAI" in client.get("/admin/models-page").text
        # API 라우트는 정적 서빙보다 우선
        assert client.get("/admin/models").status_code == 401


def test_dist_없으면_정적_서빙_생략(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get("/admin/models").status_code == 401
