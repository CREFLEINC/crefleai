# 워커 내부 API 계약 (게이트웨이 → 워커)

워커가 제공하고 게이트웨이만 호출하는 API. 외부 사용자에게 노출하지 않는다(FR-025).

**인증**: `Authorization: Bearer <worker_key>`. 워커는 상태 파일의 키와 상수 시간 비교로 검증하고, 불일치 시 401.
예외: 등록 직전 주소 검증 호출(`X-Crefleai-Nonce`)은 키 없이 허용하되 응답에 상태 외 정보를 담지 않는다.
호환 모드 로컬 워커는 게이트웨이가 기동 시 생성한 내부 키를 환경 변수로 받는다.

## `GET /internal/status`

```json
{
  "instance_id": "gpu-a-gpu0",
  "model_id": "qwen3-8b-q4km",
  "ready": true,
  "in_flight": 0,
  "context_length": 8192,
  "worker_version": "0.5.0",
  "protocol_version": 1,
  "nonce": "요청 헤더 X-Crefleai-Nonce가 있을 때만 그대로 반환"
}
```

- `ready=false`: 모델 로드 중이거나 로드 실패 후 대기 중.
- 게이트웨이 상태 확인 주기 5초, 타임아웃 3초.

## `POST /completion`

기존 워커 API를 그대로 유지한다(호환 모드와 공유). 요청 본문은 게이트웨이가 받은 OpenAI 요청 그대로이며, 워커는
허용 파라미터(`messages`, `temperature`, `top_p`, `max_tokens`, `stop`)만 사용한다.

- `stream=false`: OpenAI `chat.completion` JSON, 오류 시 500 `{"error": {...}}`
- `stream=true`: SSE `data: {...}` … `data: [DONE]`, 오류 시 `data: {"error": {...}}`로 종료
- 응답의 `model`은 워커의 `model_id`로 덮어쓴다(기존 동작).
- 연결이 끊기면 스트리밍은 다음 토큰 경계에서 생성을 멈춘다(기존 동작). 비스트리밍은 완료까지 계산한다.

## 워커 동시성

워커는 기존처럼 한 번에 1건만 처리한다(`max_concurrency=1`, research R9). 게이트웨이 라우터가 이를 지키므로 워커
내부 잠금에서 대기가 생기지 않아야 한다. 대기가 생기면(게이트웨이 카운터 불일치) 워커는 `in_flight`로 드러내고
게이트웨이는 경고 로그를 남긴다.
