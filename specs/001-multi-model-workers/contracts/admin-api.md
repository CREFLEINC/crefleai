# 관리자 API 계약 (`/api/admin`) — 추가·변경분

인증은 기존 관리자 쿠키. 기존 엔드포인트는 유지하고 응답 필드는 **추가만** 한다(웹 화면 하위 호환).

## 등록 토큰

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/admin/worker-tokens` | 발급. 본문 `{ "ttl_minutes": 60, "note": "..." }`(15~1440). 응답에 평문 `token` 1회 포함 |
| GET | `/api/admin/worker-tokens` | 목록(평문 없음): `id`, `created_at`, `expires_at`, `revoked_at`, `created_by`, `note`, `use_count`, `status`(`active`·`expired`·`revoked`) |
| DELETE | `/api/admin/worker-tokens/{id}` | 폐기. 이미 등록된 워커는 영향 없음 |

발급 응답에는 워커 실행 예시 명령을 함께 넣는다(게이트웨이 주소·토큰 포함, 화면 표시용).

## 워커

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/workers` | 원격·로컬 워커 목록 |
| DELETE | `/api/admin/workers/{instance_id}` | 제거. `draining` 후 삭제, 키 무효화. `local`은 409(모델 화면의 정지 사용) |
| POST | `/api/admin/workers/{instance_id}/probe` | 점검 호출. 지정 인스턴스에만 짧은 요청(`max_tokens` 8)을 보내 응답 시간·결과 반환. 다른 인스턴스로 대체하지 않음 |

`GET /api/admin/workers` 항목:

```json
{
  "instance_id": "gpu-a-gpu0", "origin": "remote", "model_id": "qwen3-8b-q4km",
  "advertise_url": "http://10.0.0.21:9001",
  "gpus": [{ "index": 0, "name": "NVIDIA RTX PRO 6000", "memory_total_bytes": 102000000000 }],
  "context_length": 8192, "max_concurrency": 1,
  "status": "ready", "busy": false, "in_flight": 0,
  "spec_status": "ok", "last_seen_at": "2026-11-09T07:00:00Z", "last_error": null,
  "registered_at": "...", "worker_version": "0.5.0"
}
```

## 모델 (`GET /api/admin/models`) — 필드 추가

각 모델에 `spec`을 추가한다.

```json
"spec": {
  "reference_ctx": 8192,
  "min_bytes": 6800000000,
  "recommended_bytes": 8160000000,
  "source": "measured",
  "measured_on": "RTX PRO 6000 · 2026-11 · llama.cpp b6xxx",
  "local_check": { "status": "ok", "free_bytes": 98000000000 }
}
```

- `local_check`: 호환 모드 로컬 GPU 기준 판정(`ok`·`below_recommended`·`insufficient`·`unavailable`).
- 최상위 `worker` 필드는 유지(로컬 워커 상태). `instances` 필드를 추가해 모델별 인스턴스 수·준비 수를 준다.

## 모델 서비스 시작 (`POST /api/admin/models/{id}/serve`) — 동작 추가

로컬 GPU가 최소 사양에 못 미치면 409 `insufficient_gpu_memory`, 메시지에 필요값·실제값 포함(FR-038). 다운로드
(`/download`)는 사양과 무관하게 허용.

## 모니터링 (`GET /api/admin/metrics`) — 필드 추가

기존 `disk`, `gpus`, `requests`는 유지하고 다음을 추가한다.

```json
"models": [
  { "model_id": "qwen3-8b-q4km", "ready_instances": 2, "busy_instances": 2,
    "queue_depth": 3, "wait_avg_ms": 4200, "wait_max_ms": 9100, "overloaded": 0,
    "rpm": 12, "success": 12, "failure": 0 }
],
"workers": [
  { "instance_id": "gpu-a-gpu0", "model_id": "qwen3-8b-q4km", "status": "ready", "busy": true,
    "rpm": 6, "success": 6, "failure": 0 }
]
```
