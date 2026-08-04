import json

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from crefleai.api.deps import get_http_client, get_worker_manager, require_user_token
from crefleai.api.errors import APIError

router = APIRouter(prefix="/v1", tags=["v1"])


@router.get("/models")
async def list_models(
    wm=Depends(get_worker_manager),
    _token: dict = Depends(require_user_token),
):
    data = []
    if wm.status == "running" and wm.model_id:
        data.append({"id": wm.model_id, "object": "model", "created": 0, "owned_by": "crefleai"})
    return {"object": "list", "data": data}


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    wm=Depends(get_worker_manager),
    client: httpx.AsyncClient = Depends(get_http_client),
    _token: dict = Depends(require_user_token),
):
    body = await request.json()
    if wm.status != "running":
        raise APIError(503, "현재 서비스 중인 모델이 없습니다", "service_unavailable")
    requested = body.get("model")
    if requested not in (None, wm.model_id):
        raise APIError(404, f"모델을 찾을 수 없습니다: {requested}", "invalid_request_error")

    url = f"{wm.base_url}/completion"
    if body.get("stream"):
        async def relay():
            try:
                async with client.stream("POST", url, json=body) as response:
                    async for chunk in response.aiter_raw():
                        yield chunk
            except httpx.TransportError:
                payload = {"error": {"message": "추론 워커에 연결할 수 없습니다", "type": "server_error"}}
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()

        return StreamingResponse(relay(), media_type="text/event-stream")

    try:
        response = await client.post(url, json=body)
    except httpx.TransportError as e:
        raise APIError(502, "추론 워커에 연결할 수 없습니다", "server_error") from e
    return JSONResponse(response.json(), status_code=response.status_code)
