# 외부 API 계약 (`/v1`) — 변경분

인증·주소·요청 형식은 **변경 없음**(헌법 IV, FR-017). 아래는 복수 모델 서비스로 생기는 동작 차이만 적는다.

## `GET /v1/models`

준비된(`ready`) 인스턴스가 하나 이상인 모델을 모두 반환한다. 같은 모델의 인스턴스가 여러 개여도 항목은 하나다.

```json
{
  "object": "list",
  "data": [
    { "id": "qwen3-8b-q4km", "object": "model", "created": 0, "owned_by": "crefleai", "context_length": 8192 },
    { "id": "gpt-oss-20b-mxfp4", "object": "model", "created": 0, "owned_by": "crefleai", "context_length": 16384 }
  ]
}
```

- `context_length`: 그 모델의 `ready` 인스턴스 중 **가장 작은** 유효 컨텍스트 길이(어느 인스턴스로 가도 보장되는 값).
- 인스턴스 ID·주소·GPU 등 내부 배치 정보는 노출하지 않는다(명세 Q3).

## `POST /v1/chat/completions`

| 요청 조건 | 동작 |
|---|---|
| `model`이 준비된 모델 | 라우터가 빈 인스턴스로 즉시 전달하거나, 모두 바쁘면 모델 대기열에서 순서대로 대기 후 전달 |
| `model` 생략 + 준비된 모델 1개 | 그 모델로 처리(기존 동작) |
| `model` 생략 + 준비된 모델 2개 이상 | 400 `model_required` |
| 요청 본문의 알 수 없는 필드(인스턴스 지정 포함) | 라우팅에 쓰지 않음. 워커로 전달되는 파라미터는 기존과 같다(`messages`, `temperature`, `top_p`, `max_tokens`, `stop`, `stream`) |

대기 중에는 아무 신호도 보내지 않는다. 스트리밍 요청도 워커가 배정된 뒤에 첫 SSE 이벤트가 나간다.

## 오류

형식: `{"error": {"message": "<한국어 메시지>", "type": "...", "code": "..."}}`

| HTTP | type | code | 상황 |
|---|---|---|---|
| 401 | `invalid_request_error` | `invalid_api_key` | 토큰 없음·무효(기존) |
| 404 | `invalid_request_error` | `model_not_found` | 카탈로그에 없거나 등록된 인스턴스가 없는 모델 |
| 400 | `invalid_request_error` | `model_required` | 모델 미지정 + 서비스 모델 2개 이상 |
| 503 | `server_error` | `model_not_ready` | 등록된 인스턴스는 있지만 준비된 것이 없음, 또는 대기 중 준비된 인스턴스가 모두 사라짐 |
| 503 | `server_error` | `server_overloaded` | 모델 대기열이 가득 참(기본 32건) 또는 대기 시간 초과(기본 300초) |
| 502 | `server_error` | `worker_unreachable` | 응답 시작 전 연결 실패가 재시도(1회) 후에도 계속됨 |

- 스트리밍이 시작된 뒤의 실패는 기존처럼 `data: {"error": {...}}` 이벤트로 스트림을 끝낸다(재시도 없음).
- 기존에 `code: null`이던 404·503·502 응답에 `code`가 채워진다. HTTP 상태 코드와 `type`은 기존과 같다.
