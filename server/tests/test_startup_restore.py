import time

from fastapi.testclient import TestClient

from crefleai.db import Database
from crefleai.main import create_app
from crefleai.models.catalog import load_catalog, model_file


def _preset_serving_model(settings, model_id: str):
    db = Database(settings.db_path)
    db.set_setting("serving_model", model_id)
    db.close()


def test_파일_없으면_복원하지_않고_정상_기동(settings):
    _preset_serving_model(settings, next(iter(load_catalog())))
    with TestClient(create_app(settings)) as client:
        assert client.app.state.worker_manager.status == "stopped"
        assert client.app.state.restore_task is None


def test_조건_충족시_복원_시도(settings, monkeypatch):
    served = []

    async def fake_serve(self, model, model_path):
        served.append(model.id)
        self.status = "running"

    from crefleai.models.worker_manager import WorkerManager

    monkeypatch.setattr(WorkerManager, "serve", fake_serve)

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")
    _preset_serving_model(settings, model_id)

    with TestClient(create_app(settings)):
        for _ in range(50):
            time.sleep(0.1)
            if served:
                break
        assert served == [model_id]
