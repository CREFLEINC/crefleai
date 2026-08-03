import pytest

from crefleai.config import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        jwt_secret="test-secret",
        admin_id="admin",
        admin_password="admin-pw",
        data_dir=tmp_path,
    )
