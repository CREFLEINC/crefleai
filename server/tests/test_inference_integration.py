import os

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.inference


def test_실모델_추론():
    gguf = os.environ.get("CREFLEAI_TEST_GGUF")
    if not gguf:
        pytest.skip("CREFLEAI_TEST_GGUF 환경변수가 없습니다")
    pytest.importorskip("llama_cpp")
    from crefleai.worker.app import create_app

    with TestClient(create_app(gguf, "test-model", 2048)) as client:
        res = client.post(
            "/completion",
            json={"messages": [{"role": "user", "content": "1+1은?"}], "max_tokens": 16},
        )
        assert res.status_code == 200
        assert res.json()["choices"][0]["message"]["content"]
