import json

from fastapi.testclient import TestClient

from crefleai.worker.app import create_app


class FakeLlama:
    def __init__(self):
        self.calls: list[dict] = []

    def create_chat_completion(self, stream=False, **kwargs):
        self.calls.append(kwargs)
        if stream:
            def gen():
                yield {"choices": [{"delta": {"content": "안"}}]}
                yield {"choices": [{"delta": {"content": "녕"}}]}
            return gen()
        return {
            "id": "chatcmpl-x",
            "object": "chat.completion",
            "model": "local",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "안녕"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        }


def make_client():
    fake = FakeLlama()
    app = create_app("/fake/path.gguf", "test-model", 2048, llama_factory=lambda p, c: fake)
    return TestClient(app), fake


def test_health_ready():
    client, _ = make_client()
    with client:
        res = client.get("/health")
        assert res.json() == {"status": "ready", "model": "test-model"}


def test_비스트리밍_completion():
    client, fake = make_client()
    with client:
        res = client.post(
            "/completion",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "temperature": 0.2,
                "stream": False,
                "ignored_param": 123,
            },
        )
    body = res.json()
    assert body["model"] == "test-model"  # 워커가 model 필드를 자기 id로 교체
    assert body["choices"][0]["message"]["content"] == "안녕"
    assert body["usage"]["total_tokens"] == 3
    assert fake.calls[0] == {
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.2,
    }  # 허용 목록 외 파라미터는 전달되지 않음


def test_스트리밍_completion():
    client, _ = make_client()
    with client:
        with client.stream(
            "POST",
            "/completion",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        ) as res:
            assert res.headers["content-type"].startswith("text/event-stream")
            lines = [l for l in res.iter_lines() if l.startswith("data: ")]

    assert lines[-1] == "data: [DONE]"
    chunks = [json.loads(l[6:]) for l in lines[:-1]]
    contents = [c["choices"][0]["delta"].get("content", "") for c in chunks]
    assert "".join(contents) == "안녕"
    assert all(c["model"] == "test-model" for c in chunks)
