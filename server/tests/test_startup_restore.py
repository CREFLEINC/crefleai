import asyncio
import time

from fastapi.testclient import TestClient

from crefleai.db import Database
from crefleai.main import create_app
from crefleai.models.catalog import load_catalog, model_file
from crefleai.models.worker_manager import WorkerError


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


def test_복원_실패해도_기동은_정상(settings, monkeypatch):
    async def failing_serve(self, model, model_path):
        self.status = "failed"
        self.error = "boom"
        raise WorkerError("boom")

    from crefleai.models.worker_manager import WorkerManager

    monkeypatch.setattr(WorkerManager, "serve", failing_serve)

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")
    _preset_serving_model(settings, model_id)

    with TestClient(create_app(settings)) as client:
        for _ in range(50):
            time.sleep(0.1)
            if client.app.state.worker_manager.status == "failed":
                break
        assert client.app.state.worker_manager.status == "failed"
        assert client.app.state.restore_task is not None
    # with 블록 정상 종료(shutdown 포함)가 곧 검증 — unhandled exception이 없어야 한다


def test_복원_중_종료시_태스크가_취소된다(settings, monkeypatch):
    from crefleai.models.worker_manager import WorkerManager

    async def slow_serve(self, model, model_path):
        await asyncio.sleep(30)

    monkeypatch.setattr(WorkerManager, "serve", slow_serve)

    model_id = next(iter(load_catalog()))
    model = load_catalog()[model_id]
    path = model_file(settings.models_dir, model)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"fake gguf")
    _preset_serving_model(settings, model_id)

    with TestClient(create_app(settings)) as client:
        task = client.app.state.restore_task
        assert task is not None
    assert task.cancelled()  # with 블록이 30초 걸리지 않고 즉시 끝났다는 것 자체가 취소의 증거
