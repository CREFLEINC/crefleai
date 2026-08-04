import pytest
from pydantic import ValidationError

from crefleai.config import Settings


def test_jwt_secret_없으면_기동_실패(monkeypatch):
    monkeypatch.delenv("CREFLEAI_JWT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings()


def test_파생_경로(tmp_path):
    s = Settings(jwt_secret="x", data_dir=tmp_path)
    assert s.db_path == tmp_path / "crefleai.db"
    assert s.models_dir == tmp_path / "models"
    assert s.port == 8000
    assert s.worker_port == 8001
