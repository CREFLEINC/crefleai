import pytest
from fastapi.testclient import TestClient

from crefleai.config import Settings
from crefleai.db import Database
from crefleai.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(
        jwt_secret="test-secret",
        admin_id="admin",
        admin_password="admin-pw",
        data_dir=tmp_path,
    )


@pytest.fixture
def db(settings):
    database = Database(settings.db_path)
    yield database
    database.close()


@pytest.fixture
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_client(client):
    res = client.post("/api/admin/login", json={"username": "admin", "password": "admin-pw"})
    assert res.status_code == 200
    return client
