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
