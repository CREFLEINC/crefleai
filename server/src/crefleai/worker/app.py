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
    factory = llama_factory or _default_llama_factory

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["llama"] = await asyncio.to_thread(factory, model_path, n_ctx)
        state["ready"] = True
        yield

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
            result = await asyncio.to_thread(
                lambda: state["llama"].create_chat_completion(**kwargs)
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
                # 소비자가 끊겨도(취소 포함) 프로듀서를 반드시 세우고 락 독점을 지킨다.
                # sync join은 이벤트 루프를 최대 2초 블로킹하지만, 취소된 스코프에서
                # await는 즉시 재취소되므로 동기 join이 유일하게 확실한 방법이다.
                stop.set()
                while not queue.empty():
                    queue.get_nowait()
                producer.join(timeout=2.0)

    return app
