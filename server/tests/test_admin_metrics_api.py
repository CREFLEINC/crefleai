import asyncio
import shutil
import time
from datetime import UTC, datetime, timedelta

import pytest

from crefleai.monitoring.metrics import (
    RequestMetricsTracker,
    SystemMetricsSampler,
)


def test_metrics_api_requires_admin_auth(client):
    res = client.get("/api/admin/metrics")

    assert res.status_code == 401


def test_metrics_api_returns_disk_and_request_metrics(admin_client, monkeypatch):
    usage = shutil._ntuple_diskusage(total=1000, used=250, free=750)
    monkeypatch.setattr("crefleai.monitoring.metrics.shutil.disk_usage", lambda path: usage)

    admin_client.app.state.request_metrics.record_started()
    admin_client.app.state.request_metrics.record_finished(success=True)
    admin_client.app.state.system_metrics.sample_once()

    res = admin_client.get("/api/admin/metrics")

    assert res.status_code == 200
    body = res.json()
    assert body["disk"] == {
        "status": "ok",
        "path": str(admin_client.app.state.settings.data_dir),
        "total_bytes": 1000,
        "used_bytes": 250,
        "free_bytes": 750,
        "used_percent": 25.0,
        "error": None,
    }
    assert body["requests"] == {
        "window_seconds": 60,
        "rpm": 1,
        "success": 1,
        "failure": 0,
        "in_flight": 0,
    }
    assert body["stale"] is False
    assert body["sampled_at"] is not None


def test_request_metrics_sliding_window_and_in_flight_are_tracked():
    now = datetime(2026, 8, 18, 0, 0, tzinfo=UTC)
    tracker = RequestMetricsTracker(window_seconds=60, now=lambda: now)

    tracker.record_started()
    tracker.record_finished(success=True)

    now = now + timedelta(seconds=30)
    tracker.record_started()
    tracker.record_finished(success=False)
    tracker.record_started()

    snapshot = tracker.snapshot()
    assert snapshot.rpm == 2
    assert snapshot.success == 1
    assert snapshot.failure == 1
    assert snapshot.in_flight == 1

    now = now + timedelta(seconds=31)
    snapshot = tracker.snapshot()
    assert snapshot.rpm == 1
    assert snapshot.success == 0
    assert snapshot.failure == 1
    assert snapshot.in_flight == 1


def test_disk_collection_failure_does_not_fail_sampler(tmp_path, monkeypatch):
    def broken_disk_usage(path):
        raise OSError("disk unavailable")

    monkeypatch.setattr("crefleai.monitoring.metrics.shutil.disk_usage", broken_disk_usage)

    sampler = SystemMetricsSampler(data_dir=tmp_path, gpu_collector=list)
    sampler.sample_once()
    snapshot = sampler.snapshot()

    assert snapshot.disk.status == "unavailable"
    assert snapshot.disk.error == "disk unavailable"
    assert snapshot.gpus == []


@pytest.mark.asyncio
async def test_sampler_start_and_stop(tmp_path):
    samples = 0

    def gpu_collector():
        nonlocal samples
        samples += 1
        return []

    sampler = SystemMetricsSampler(
        data_dir=tmp_path,
        gpu_collector=gpu_collector,
        interval_seconds=0.01,
    )

    sampler.start()
    await asyncio.sleep(0.03)
    await sampler.stop()

    assert samples > 0


@pytest.mark.asyncio
async def test_sampler_does_not_block_event_loop_during_collection(tmp_path):
    def slow_gpu_collector():
        time.sleep(0.05)
        return []

    sampler = SystemMetricsSampler(
        data_dir=tmp_path,
        gpu_collector=slow_gpu_collector,
        interval_seconds=60,
    )

    started_at = time.monotonic()
    sampler.start()
    await asyncio.sleep(0.001)
    elapsed = time.monotonic() - started_at
    await sampler.stop()

    assert elapsed < 0.03
