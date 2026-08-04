import time

from crefleai.models.catalog import load_catalog, model_file


class FakeWorkerManager:
    def __init__(self):
        self.status = "stopped"
        self.error = None
        self.model_id = None
        self.base_url = "http://worker"
        self.served = []

    async def serve(self, model, model_path):
        self.served.append((model.id, model_path))
        self.model_id = model.id
        self.status = "running"

    async def stop(self):
        self.status = "stopped"


def test_모델_목록은_카탈로그와_상태를_반환(admin_client):
    body = admin_client.get("/admin/models").json()
    catalog = load_catalog()
    assert {m["id"] for m in body["models"]} == set(catalog)
    assert all(m["status"] == "not_downloaded" for m in body["models"])
    assert body["worker"]["status"] == "stopped"


def test_없는_모델_다운로드는_404(admin_client):
    assert admin_client.post("/admin/models/없는모델/download").status_code == 404


def test_미다운로드_모델_서빙은_409(admin_client):
    model_id = next(iter(load_catalog()))
    assert admin_client.post(f"/admin/models/{model_id}/serve").status_code == 409


def test_서빙_성공_흐름(admin_client):
    app = admin_client.app
    fake_wm = FakeWorkerManager()
    app.state.worker_manager = fake_wm

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(app.state.settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")  # 다운로드 완료 상태로 만든다

    res = admin_client.post(f"/admin/models/{model_id}/serve")
    assert res.status_code == 202

    for _ in range(50):  # 백그라운드 서빙 완료 대기
        time.sleep(0.1)
        if app.state.db.get_setting("serving_model") == model_id:
            break
    assert fake_wm.served == [(model_id, path)]
    assert app.state.db.get_setting("serving_model") == model_id

    body = admin_client.get("/admin/models").json()
    serving = next(m for m in body["models"] if m["id"] == model_id)
    assert serving["status"] == "serving"


def test_모델_API도_로그인_필요(client):
    assert client.get("/admin/models").status_code == 401
