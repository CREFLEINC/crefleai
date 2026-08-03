from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CREFLEAI_")

    jwt_secret: str  # 필수 — 미설정 시 기동 실패
    admin_id: str | None = None
    admin_password: str | None = None
    data_dir: Path = Path("data")
    host: str = "0.0.0.0"
    port: int = 8000
    worker_port: int = 8001
    worker_ctx: int = 8192

    @property
    def db_path(self) -> Path:
        return self.data_dir / "crefleai.db"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"


@lru_cache
def get_settings() -> Settings:
    return Settings()
