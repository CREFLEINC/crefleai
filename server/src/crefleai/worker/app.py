import asyncio
import concurrent.futures
import json
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

_ALLOWED_PARAMS = ("messages", "temperature", "top_p", "max_tokens", "stop")


def _default_llama_factory(model_path: str, n_ctx: int):
    from llama_cpp import Llama  # GPU 서버에서만 설치되는 extra — lazy import

    return Llama(model_path=model_path, n_ctx=n_ctx, n_gpu_layers=-1, verbose=False)


def _to_llama_kwargs(body: dict) -> dict:
    return {k: body[k] for k in _ALLOWED_PARAMS if body.get(k) is not None}


def create_app(model_path: str, model_id: str, n_ctx: int, llama_factory=None) -> FastAPI:
    state: dict = {"llama": None, "ready": False}
    lock = asyncio.Lock()
    llama_mutex = threading.Lock()  # llama 호출 자체의 스레드 수준 독점 — 이벤트 루프와 무관하게 보장
    factory = llama_factory or _default_llama_factory

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["llama"] = await asyncio.to_thread(factory, model_path, n_ctx)
        state["ready"] = True
        yield

    def _call_llama(kwargs: dict) -> dict:
        with llama_mutex:
            return state["llama"].create_chat_completion(**kwargs)

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    async def health():
        return {"status": "ready" if state["ready"] else "loading", "model": model_id}

    @app.post("/completion")
    async def completion(request: Request):
        body = await request.json()
        kwargs = _to_llama_kwargs(body)
        if body.get("stream"):
            return StreamingResponse(_stream(kwargs), media_type="text/event-stream")
        async with lock:
            try:
                result = await asyncio.to_thread(_call_llama, kwargs)
            except Exception as e:  # noqa: BLE001 — 스트리밍 경로와 동일한 OpenAI 오류 형식으로 전달
                return JSONResponse(
                    {"error": {"message": str(e), "type": "server_error", "code": None}},
                    status_code=500,
                )
        result["model"] = model_id
        return JSONResponse(result)

    async def _stream(kwargs: dict):
        async with lock:
            queue: asyncio.Queue = asyncio.Queue(maxsize=32)
            loop = asyncio.get_running_loop()
            stop = threading.Event()

            def _put(item) -> bool:
                """큐에 넣되, 소비자가 사라지면(stop) 포기한다."""
                future = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
                while True:
                    try:
                        future.result(timeout=1.0)
                        return True
                    except concurrent.futures.TimeoutError:
                        if stop.is_set():
                            future.cancel()
                            return False

            def produce():
                try:
                    with llama_mutex:
                        for chunk in state["llama"].create_chat_completion(stream=True, **kwargs):
                            if stop.is_set() or not _put(("chunk", chunk)):
                                return
                    _put(("done", None))
                except Exception as e:  # noqa: BLE001 — 클라이언트에 에러 이벤트로 전달
                    _put(("error", str(e)))

            producer = threading.Thread(target=produce, daemon=True)
            producer.start()
            try:
                while True:
                    kind, item = await queue.get()
                    if kind == "chunk":
                        item["model"] = model_id
                        yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
                    elif kind == "error":
                        payload = {"error": {"message": item, "type": "server_error", "code": None}}
                        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                        break
                    else:
                        yield "data: [DONE]\n\n"
                        break
            finally:
                # 소비자가 끊겨도 프로듀서에 중단 신호를 보내고 큐를 비워
                # 블로킹된 put을 풀어준다. llama 호출 독점은 llama_mutex가
                # 스레드 수준에서 보장하므로 join으로 이벤트 루프를 막지 않는다.
                stop.set()
                while not queue.empty():
                    queue.get_nowait()

    return app
