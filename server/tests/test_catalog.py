from pathlib import Path

from crefleai.models.catalog import CatalogModel, load_catalog, model_file


def test_카탈로그_로드():
    catalog = load_catalog()
    assert len(catalog) >= 3
    for model_id, m in catalog.items():
        assert m.id == model_id
        assert isinstance(m, CatalogModel)
        assert m.filename.endswith(".gguf")
        assert m.size_bytes > 0
        assert m.context_length > 0


def test_모델_파일_경로():
    m = next(iter(load_catalog().values()))
    assert model_file(Path("/data/models"), m) == Path("/data/models") / m.filename
