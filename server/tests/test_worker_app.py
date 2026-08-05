import json
import threading
import time

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
    with client, client.stream(
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


class FailingLlama:
    def create_chat_completion(self, stream=False, **kwargs):
        raise RuntimeError("CUDA out of memory")


def test_비스트리밍_예외는_OpenAI_오류_형식_500으로_반환():
    app = create_app(
        "/fake/path.gguf", "test-model", 2048, llama_factory=lambda p, c: FailingLlama()
    )
    with TestClient(app, raise_server_exceptions=False) as client:
        res = client.post("/completion", json={"messages": [{"role": "user", "content": "hi"}]})
    assert res.status_code == 500
    body = res.json()
    assert body["error"]["type"] == "server_error"
    assert "CUDA out of memory" in body["error"]["message"]
    assert body["error"]["code"] is None


class ConcurrencyTrackingFake:
    """동시 호출 수를 추적하는 fake — 락 독점 보장 검증용."""

    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.stream_closed = False
        self._mu = threading.Lock()

    def _enter(self):
        with self._mu:
            self.active += 1
            self.max_active = max(self.max_active, self.active)

    def _exit(self):
        with self._mu:
            self.active -= 1

    def create_chat_completion(self, stream=False, **kwargs):
        if stream:
            def gen():
                self._enter()
                try:
                    for _ in range(1000):
                        time.sleep(0.005)
                        yield {"choices": [{"delta": {"content": "x"}}]}
                finally:
                    self._exit()
                    self.stream_closed = True
            return gen()
        self._enter()
        try:
            time.sleep(0.05)
            return {
                "id": "chatcmpl-y",
                "object": "chat.completion",
                "model": "local",
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            }
        finally:
            self._exit()


def test_스트리밍_중단시_프로듀서_정리와_락_독점():
    fake = ConcurrencyTrackingFake()
    app = create_app("/fake/path.gguf", "test-model", 2048, llama_factory=lambda p, c: fake)
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/completion",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        ) as res:
            lines = res.iter_lines()
            next(lines)  # 첫 청크만 읽고 연결을 끊는다
        # 끊긴 뒤 후속 요청이 정상 동작해야 하고
        res2 = client.post(
            "/completion", json={"messages": [{"role": "user", "content": "hi"}]}
        )
        assert res2.status_code == 200
    # 프로듀서가 정리되었어야 하며
    for _ in range(50):
        if fake.stream_closed:
            break
        time.sleep(0.1)
    assert fake.stream_closed
    # 어떤 순간에도 llama 동시 호출은 1을 넘지 않아야 한다
    assert fake.max_active == 1
