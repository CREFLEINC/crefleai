# 워커 등록 API 계약 (워커 → 게이트웨이)

워커가 호출하는 게이트웨이 API. 사용자 토큰·관리자 쿠키와 별개의 인증을 쓴다. 프로토콜 버전 `1`.

## `POST /api/workers/register` — 등록 토큰으로 최초 등록

**인증**: 본문의 `registration_token`

```json
{
  "protocol_version": 1,
  "registration_token": "crefle_reg_…",
  "instance_id": "gpu-a-gpu0",
  "model_id": "qwen3-8b-q4km",
  "advertise_url": "http://10.0.0.21:9001",
  "context_length": 8192,
  "max_concurrency": 1,
  "gpus": [
    { "index": 0, "uuid": "GPU-…", "name": "NVIDIA RTX PRO 6000", "memory_total_bytes": 102000000000,
      "compute_capability": "12.0" }
  ],
  "spec_status": "ok",
  "free_memory_bytes_at_start": 98000000000,
  "worker_version": "0.5.0",
  "nonce": "b64url-32바이트"
}
```

**처리 순서**

1. `protocol_version` 확인 → 다르면 400 `protocol_mismatch`
2. 등록 토큰 검증 → 무효·만료·폐기면 401 `registration_token_invalid`
3. `model_id`가 카탈로그에 있는지, `context_length`가 모델 최대값 이하인지 → 아니면 400 `invalid_worker_spec`
4. `instance_id` 형식·중복 → 409 `instance_id_conflict`
5. 주소 검증: 게이트웨이가 `GET {advertise_url}/internal/status`에 `X-Crefleai-Nonce: <nonce>` 헤더로 호출, 응답의
   `nonce`·`instance_id`·`model_id`가 일치하고 `ready=true`인지 확인(타임아웃 5초) → 실패 시 422 `address_unreachable`
6. `workers` 행 생성, 토큰 `use_count + 1`, 워커 키 파생

**응답 201**

```json
{ "instance_id": "gpu-a-gpu0", "worker_key": "crefle_wk_…", "status": "ready" }
```

워커 키는 이 응답에서만 한 번 전달된다. 워커는 즉시 상태 파일에 저장한다.

## `POST /api/workers/connect` — 저장된 워커 키로 재연결

**인증**: `Authorization: Bearer <worker_key>`

본문은 `register`와 같되 `registration_token`이 없다. `instance_id`는 키에 묶인 값과 같아야 한다.

| 결과 | 응답 |
|---|---|
| 성공(정보 갱신 포함) | 200 `{ "instance_id": "...", "status": "ready" }` |
| 키 무효(제거된 워커) | 401 `worker_removed` — 워커는 "새 등록 토큰 필요"를 출력하고 종료 |
| `instance_id` 불일치 | 400 `instance_id_mismatch` |
| 주소 검증 실패 | 422 `address_unreachable` |

## 공통

- 오류 형식은 외부 API와 같은 `{"error": {...}}`.
- 등록 토큰·워커 키·nonce는 로그에 남기지 않는다(FR-024).
- 게이트웨이는 등록·재연결·거부를 감사 로그(인스턴스 ID, 모델, 주소, 토큰 ID, 결과)로 남긴다.
