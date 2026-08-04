import json
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path


@dataclass(frozen=True)
class CatalogModel:
    id: str
    display_name: str
    hf_repo: str
    filename: str
    quantization: str
    size_bytes: int
    context_length: int
    license: str
    description: str


def load_catalog() -> dict[str, CatalogModel]:
    raw = json.loads(
        files("crefleai.models").joinpath("catalog.json").read_text(encoding="utf-8")
    )
    models = [CatalogModel(**entry) for entry in raw]
    return {m.id: m for m in models}


def model_file(models_dir: Path, model: CatalogModel) -> Path:
    return models_dir / model.filename
