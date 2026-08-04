import asyncio
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

            def produce():
                try:
                    for chunk in state["llama"].create_chat_completion(stream=True, **kwargs):
                        asyncio.run_coroutine_threadsafe(queue.put(("chunk", chunk)), loop).result()
                    asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop).result()
                except Exception as e:  # noqa: BLE001 — 클라이언트에 에러 이벤트로 전달
                    asyncio.run_coroutine_threadsafe(queue.put(("error", str(e))), loop).result()

            threading.Thread(target=produce, daemon=True).start()
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

    return app
