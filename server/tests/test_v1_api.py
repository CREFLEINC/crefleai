import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse


def make_fake_worker_app() -> FastAPI:
    app = FastAPI()

    @app.post("/completion")
    async def completion(body: dict):
        if body.get("stream"):
            async def gen():
                yield b'data: {"choices":[{"delta":{"content":"an"}}],"model":"m"}\n\n'
                yield b'data: {"choices":[{"delta":{"content":"nyeong"}}],"model":"m"}\n\n'
                yield b"data: [DONE]\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")
        return {
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "model": "m",
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": "안녕"}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 3, "completion_tokens": 2, "total_tokens": 5},
        }

    return app


class FakeWorkerManager:
    def __init__(self, status="running", model_id="tiny"):
        self.status = status
        self.model_id = model_id
        self.error = None
        self.base_url = "http://worker"

    async def stop(self):
        pass


@pytest.fixture
def user_token(admin_client):
    return admin_client.post(
        "/admin/tokens", json={"user_name": "홍길동", "purpose": "테스트"}
    ).json()["token"]


@pytest.fixture
def v1_client(admin_client):
    app = admin_client.app
    app.state.worker_manager = FakeWorkerManager()
    app.state.http_client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=make_fake_worker_app()), base_url="http://worker"
    )
    return admin_client


def test_토큰_없으면_401(v1_client):
    res = v1_client.post("/v1/chat/completions", json={"messages": []})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "invalid_api_key"


def test_models_목록(v1_client, user_token):
    res = v1_client.get("/v1/models", headers={"Authorization": f"Bearer {user_token}"})
    assert res.status_code == 200
    assert [m["id"] for m in res.json()["data"]] == ["tiny"]


def test_비스트리밍_프록시(v1_client, user_token):
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert res.status_code == 200
    assert res.json()["choices"][0]["message"]["content"] == "안녕"
    assert res.json()["usage"]["total_tokens"] == 5


def test_스트리밍_프록시(v1_client, user_token):
    with v1_client.stream(
        "POST",
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    ) as res:
        assert res.headers["content-type"].startswith("text/event-stream")
        lines = [l for l in res.iter_lines() if l.startswith("data: ")]
    assert lines[-1] == "data: [DONE]"


def test_워커_미가동시_503(v1_client, user_token):
    v1_client.app.state.worker_manager = FakeWorkerManager(status="stopped", model_id=None)
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": []},
    )
    assert res.status_code == 503


def test_다른_모델_지정시_404(v1_client, user_token):
    res = v1_client.post(
        "/v1/chat/completions",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"messages": [], "model": "없는-모델"},
    )
    assert res.status_code == 404
