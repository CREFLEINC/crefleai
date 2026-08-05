import httpx

from crefleai.models.catalog import CatalogModel
from crefleai.models.downloads import DownloadManager

MODEL = CatalogModel(
    id="tiny",
    display_name="Tiny",
    hf_repo="org/tiny-gguf",
    filename="tiny.gguf",
    quantization="Q4_K_M",
    size_bytes=100,
    context_length=2048,
    license="MIT",
    description="테스트",
)
SHARDED = CatalogModel(
    id="big",
    display_name="Big",
    hf_repo="org/big-gguf",
    filename="Q4/big-00001-of-00003.gguf",
    quantization="Q4_K_M",
    size_bytes=30,
    context_length=2048,
    license="MIT",
    description="분할 테스트",
    shards=["Q4/big-00002-of-00003.gguf", "Q4/big-00003-of-00003.gguf"],
)
CATALOG = {"tiny": MODEL, "big": SHARDED}
CONTENT = b"x" * 100


def make_manager(tmp_path, handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)
    return DownloadManager(tmp_path / "models", CATALOG, client=client)


async def test_다운로드_성공(tmp_path):
    def handler(request):
        return httpx.Response(200, content=CONTENT, headers={"content-length": "100"})

    dm = make_manager(tmp_path, handler)
    assert dm.state_for("tiny").status == "idle"
    assert dm.start("tiny") is True
    await dm.wait("tiny")

    state = dm.state_for("tiny")
    assert state.status == "ready"
    assert state.progress == 1.0
    assert (tmp_path / "models" / "tiny.gguf").read_bytes() == CONTENT
    assert not (tmp_path / "models" / "tiny.gguf.part").exists()


async def test_이미_받은_모델은_start_거부(tmp_path):
    (tmp_path / "models").mkdir(parents=True)
    (tmp_path / "models" / "tiny.gguf").write_bytes(CONTENT)
    dm = make_manager(tmp_path, lambda request: httpx.Response(500))
    assert dm.state_for("tiny").status == "ready"
    assert dm.start("tiny") is False


async def test_실패시_part_정리_후_재시도_가능(tmp_path):
    def handler(request):
        return httpx.Response(404)

    dm = make_manager(tmp_path, handler)
    assert dm.start("tiny") is True
    await dm.wait("tiny")

    state = dm.state_for("tiny")
    assert state.status == "failed"
    assert state.error is not None
    assert not (tmp_path / "models" / "tiny.gguf.part").exists()
    assert dm.start("tiny") is True  # 재시도 허용


async def test_분할_모델은_모든_파트를_받아_저장한다(tmp_path):
    def handler(request):
        assert request.url.path.startswith("/org/big-gguf/resolve/main/Q4/")
        return httpx.Response(200, content=b"x" * 10, headers={"content-length": "10"})

    dm = make_manager(tmp_path, handler)
    assert dm.start("big") is True
    await dm.wait("big")

    state = dm.state_for("big")
    assert state.status == "ready"
    assert state.progress == 1.0
    for name in ("big-00001-of-00003", "big-00002-of-00003", "big-00003-of-00003"):
        assert (tmp_path / "models" / "Q4" / f"{name}.gguf").read_bytes() == b"x" * 10


async def test_분할_모델은_일부_파트만_있으면_ready가_아니다(tmp_path):
    (tmp_path / "models" / "Q4").mkdir(parents=True)
    (tmp_path / "models" / "Q4" / "big-00001-of-00003.gguf").write_bytes(b"x")
    dm = make_manager(tmp_path, lambda request: httpx.Response(500))
    assert dm.state_for("big").status == "idle"


async def test_분할_다운로드_실패시_part_정리_후_재시도_가능(tmp_path):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(200, content=b"x" * 10, headers={"content-length": "10"})
        return httpx.Response(404)

    dm = make_manager(tmp_path, handler)
    assert dm.start("big") is True
    await dm.wait("big")

    state = dm.state_for("big")
    assert state.status == "failed"
    assert state.error is not None
    assert list((tmp_path / "models").rglob("*.part")) == []
    assert dm.start("big") is True  # 재시도 허용


async def test_클라이언트_생성_실패도_failed_상태(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("client construction failed")

    monkeypatch.setattr("crefleai.models.downloads.httpx.AsyncClient", boom)
    dm = DownloadManager(tmp_path / "models", CATALOG, client=None)
    assert dm.start("tiny") is True
    await dm.wait("tiny")

    state = dm.state_for("tiny")
    assert state.status == "failed"
    assert state.error is not None
    assert dm.start("tiny") is True  # 재시도 가능해야 함
