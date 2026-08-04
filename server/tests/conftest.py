import pytest

from crefleai.config import Settings
from crefleai.db import Database


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
