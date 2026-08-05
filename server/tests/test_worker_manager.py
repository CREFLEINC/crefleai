import asyncio
import sys
from pathlib import Path

import pytest

from crefleai.models.catalog import CatalogModel
from crefleai.models.worker_manager import WorkerError, WorkerManager

FAKE_WORKER = Path(__file__).parent / "fake_worker.py"
MODEL = CatalogModel(
    id="tiny", display_name="Tiny", hf_repo="org/tiny", filename="tiny.gguf",
    quantization="Q4_K_M", size_bytes=1, context_length=2048, license="MIT", description="",
)
PORT = 18801


def fake_command(model, model_path):
    return [sys.executable, str(FAKE_WORKER), "--port", str(PORT)]


async def test_서빙_시작과_중지():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.status == "running"
    assert wm.model_id == "tiny"

    await wm.stop()
    assert wm.status == "stopped"


async def test_context_length는_모델과_ctx_중_작은_값():
    wm = WorkerManager(PORT, 1024, command_builder=fake_command, startup_timeout=15)
    assert wm.context_length is None  # 서빙 전에는 알 수 없음

    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.context_length == 1024  # min(모델 2048, ctx 1024)
    await wm.stop()


async def test_context_length는_모델_한계를_넘지_않는다():
    wm = WorkerManager(PORT, 8192, command_builder=fake_command, startup_timeout=15)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.context_length == 2048  # min(모델 2048, ctx 8192)
    await wm.stop()


async def test_기동_실패시_WorkerError():
    def broken_command(model, model_path):
        return [sys.executable, "-c", "import time; time.sleep(60)"]  # health 응답 없음

    wm = WorkerManager(PORT, 2048, command_builder=broken_command, startup_timeout=2)
    with pytest.raises(WorkerError):
        await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.status == "failed"
    await wm.stop()


async def test_비정상_종료시_자동_재시작():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    first_pid = wm._proc.pid

    wm._proc.terminate()  # 비정상 종료 시뮬레이션
    for _ in range(100):
        await asyncio.sleep(0.2)
        if wm.status == "running" and wm._proc.pid != first_pid:
            break
    assert wm.status == "running"
    assert wm._proc.pid != first_pid
    await wm.stop()


async def test_기동_중_조기_종료시_WorkerError():
    def exiting_command(model, model_path):
        return [sys.executable, "-c", "import sys; sys.exit(3)"]

    wm = WorkerManager(PORT, 2048, command_builder=exiting_command, startup_timeout=15)
    with pytest.raises(WorkerError):
        await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    assert wm.status == "failed"
    await wm.stop()


async def test_재시작_한도_초과시_failed():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15, max_restarts=0)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))
    wm._proc.terminate()  # 비정상 종료 — max_restarts=0이므로 재시작 없이 failed
    for _ in range(100):
        await asyncio.sleep(0.2)
        if wm.status == "failed":
            break
    assert wm.status == "failed"
    assert wm.error is not None
    await wm.stop()


async def test_정상_가동_후_크래시는_재시작_카운터를_리셋한다():
    wm = WorkerManager(
        PORT, 2048, command_builder=fake_command, startup_timeout=15,
        max_restarts=1, stable_after=0.5,
    )
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))

    # max_restarts=1을 넘는 총 3회의 산발 크래시 — 각 크래시 전 stable_after 이상 정상 가동.
    # 카운터가 리셋되지 않으면 2번째 크래시에서 failed가 된다.
    for _ in range(3):
        await asyncio.sleep(0.7)
        pid = wm._proc.pid
        wm._proc.terminate()
        for _ in range(100):
            await asyncio.sleep(0.2)
            if wm.status == "running" and wm._proc.pid != pid:
                break
        assert wm.status == "running"
        assert wm._proc.pid != pid
    await wm.stop()


async def test_셧다운시_재스폰_대기를_조기_중단한다():
    calls = {"n": 0}

    def flaky_then_slow(model, model_path):
        calls["n"] += 1
        if calls["n"] == 1:
            return [sys.executable, str(FAKE_WORKER), "--port", str(PORT)]
        return [sys.executable, "-c", "import time; time.sleep(60)"]  # health 응답 없음

    wm = WorkerManager(PORT, 2048, command_builder=flaky_then_slow, startup_timeout=30)
    await wm.serve(MODEL, Path("/fake/tiny.gguf"))

    wm._proc.terminate()  # 크래시 → watchdog이 ready 없는 프로세스로 재스폰 시작
    for _ in range(100):
        await asyncio.sleep(0.1)
        if calls["n"] >= 2:
            break
    assert calls["n"] >= 2

    # 재스폰이 startup_timeout(30초)을 기다리는 동안에도 stop()은 빠르게 끝나야 한다
    loop = asyncio.get_running_loop()
    start = loop.time()
    await asyncio.wait_for(wm.stop(), timeout=10)
    assert loop.time() - start < 5
    assert wm.status == "stopped"

async def test_동시_serve_호출은_직렬화된다():
    wm = WorkerManager(PORT, 2048, command_builder=fake_command, startup_timeout=15)
    results = await asyncio.gather(
        wm.serve(MODEL, Path("/fake/tiny.gguf")),
        wm.serve(MODEL, Path("/fake/tiny.gguf")),
        return_exceptions=True,
    )
    assert [r for r in results if isinstance(r, BaseException)] == []
    assert wm.status == "running"
    await wm.stop()
