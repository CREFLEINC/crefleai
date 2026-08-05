import json
from dataclasses import dataclass, field
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
    # 분할(sharded) GGUF의 추가 파트 파일명. filename이 첫 파트이며 llama.cpp가
    # 나머지 파트를 같은 디렉터리에서 자동 로드한다. size_bytes는 전체 파트 합계.
    shards: list[str] = field(default_factory=list)


def load_catalog() -> dict[str, CatalogModel]:
    raw = json.loads(
        files("crefleai.models").joinpath("catalog.json").read_text(encoding="utf-8")
    )
    models = [CatalogModel(**entry) for entry in raw]
    return {m.id: m for m in models}


def model_file(models_dir: Path, model: CatalogModel) -> Path:
    return models_dir / model.filename
