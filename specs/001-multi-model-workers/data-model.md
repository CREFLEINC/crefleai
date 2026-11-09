# Data Model: 추론 워커 분리 및 복수 모델 동시 서비스

**작성일**: 2026-11-09 | **명세**: [spec.md](spec.md) | **조사**: [research.md](research.md)

영속 데이터는 기존 SQLite(`<data_dir>/crefleai.db`)에, 실행 중 상태는 게이트웨이 메모리에 둔다. 기존 테이블
(`tokens`, `admins`, `settings`)은 바꾸지 않는다.

## 1. 영속 엔티티 (SQLite)

### 1.1 `worker_registration_tokens` — 등록 토큰

| 필드 | 타입 | 규칙 |
|---|---|---|
| `id` | TEXT PK | 토큰 식별자(공개값, 목록·폐기에 사용) |
| `token_hash` | TEXT UNIQUE NOT NULL | 토큰 평문의 SHA-256 hex. 평문은 저장하지 않는다 |
| `created_at` | TEXT NOT NULL | ISO-8601 UTC |
| `expires_at` | TEXT NOT NULL | 기본 `created_at + 1시간`, 발급 시 15분~24시간 범위로 지정 가능 |
| `revoked_at` | TEXT NULL | 폐기 시각 |
| `created_by` | TEXT NOT NULL | 발급한 관리자 아이디 |
| `note` | TEXT NULL | 용도 메모(예: "서버 B GPU 증설") |
| `use_count` | INTEGER NOT NULL DEFAULT 0 | 이 토큰으로 등록에 성공한 횟수(감사용) |

- **유효 조건**: `revoked_at IS NULL AND now < expires_at`.
- 토큰 평문 형식: `crefle_reg_<43자 base64url>` (32바이트 난수).

### 1.2 `workers` — 워커 인스턴스 등록 정보

| 필드 | 타입 | 규칙 |
|---|---|---|
| `instance_id` | TEXT PK | `^[a-z0-9][a-z0-9-]{1,62}$`. 워커가 정함(기본 `<hostname>-gpu<번호들>`). `local`은 예약어 |
| `credential_id` | TEXT UNIQUE NOT NULL | 워커 키 파생 입력값(난수 16바이트 hex). 재등록 시 새로 발급 |
| `model_id` | TEXT NOT NULL | 카탈로그 모델 ID. 카탈로그에 없으면 등록 거부 |
| `advertise_url` | TEXT NOT NULL | 게이트웨이가 접근할 워커 주소(`http://host:port`) |
| `gpus` | TEXT NOT NULL | JSON 배열 `[{ "index", "uuid", "name", "memory_total_bytes", "compute_capability" }]` |
| `context_length` | INTEGER NOT NULL | 유효 컨텍스트 길이(1 ~ 모델 최대값) |
| `max_concurrency` | INTEGER NOT NULL | 이번 단계 워커 엔진은 1 고정 |
| `spec_status` | TEXT NOT NULL | `ok` \| `below_recommended` (등록 시점 판정 결과) |
| `free_memory_bytes_at_start` | INTEGER NOT NULL | 판정에 쓴 실제 여유 메모리 |
| `worker_version` | TEXT NOT NULL | 워커 패키지 버전(`0.5.0` 등) |
| `protocol_version` | INTEGER NOT NULL | 등록 프로토콜 버전(이번 단계 `1`) |
| `registered_at` | TEXT NOT NULL | 최초 등록 시각 |
| `updated_at` | TEXT NOT NULL | 재연결로 정보가 갱신된 시각 |
| `registration_token_id` | TEXT NULL | 등록에 쓴 토큰 ID(감사용, 토큰 삭제와 무관) |

- **고유성**: `instance_id` 중복 등록은 거부(409 `instance_id_conflict`). 단, 해당 인스턴스의 유효한 워커 키로
  재연결하는 경우는 갱신으로 처리한다.
- **제거**: 관리자가 제거하면 행을 삭제한다. 이로써 `credential_id`가 사라져 파생 워커 키가 검증되지 않는다.
- **호환 모드 로컬 워커**는 이 테이블에 저장하지 않는다(게이트웨이 기동 시 메모리에서만 등록).

## 2. 카탈로그 확장 (`models/catalog.json`)

기존 항목에 `spec` 객체를 추가한다. `CatalogModel`에 필드가 늘어나며 기존 필드는 그대로다.

| 필드 | 타입 | 규칙 |
|---|---|---|
| `spec.base_bytes` | int | 컨텍스트와 무관한 GPU 메모리(가중치·연산 버퍼·CUDA 컨텍스트) |
| `spec.kv_bytes_per_token` | int | 토큰 1개당 KV 캐시 바이트(f16) |
| `spec.reference_ctx` | int | 측정 기준 컨텍스트 길이 |
| `spec.source` | `measured` \| `estimated` | 실측 여부 |
| `spec.measured_on` | string \| null | 측정 환경(GPU 모델·드라이버·llama.cpp 버전·날짜) |

**파생 값**(저장하지 않고 계산):

- `min_bytes(ctx) = base_bytes + kv_bytes_per_token × ctx`
- `recommended_bytes(ctx, concurrency) = ceil((base_bytes + kv_bytes_per_token × ctx × concurrency) × 1.2)`
- 유효 컨텍스트 상한 = 기존 `context_length`(모델 최대값)

**검증 규칙**: 모든 카탈로그 항목은 `spec`을 가져야 한다(누락 시 카탈로그 로드 실패 — 테스트로 강제).

## 3. 실행 중 상태 (게이트웨이 메모리)

### 3.1 `WorkerInstance`

| 필드 | 설명 |
|---|---|
| `instance_id`, `model_id`, `advertise_url`, `capacity` | 등록 정보에서 복사 |
| `origin` | `remote` \| `local` |
| `status` | 아래 상태 전이 참조 |
| `in_flight` | 게이트웨이가 보낸 처리 중 요청 수(0 ~ `capacity`) |
| `idle_since` | 마지막으로 `in_flight`가 0이 된 시각(빈 워커 선택 기준, NFR-001) |
| `consecutive_failures` | 상태 확인 연속 실패 횟수 |
| `last_seen_at`, `last_error` | 마지막 정상 응답 시각, 최근 오류 메시지 |
| `pinned_waiters` | 관리자 점검 호출 대기 목록 |
| `draining` | 제거 요청 후 처리 중 요청만 마무리하는 상태 |

**상태 전이**

```text
            등록·재연결 성공(주소 검증 통과)
                      │
                      ▼
   ┌──────────────► ready ◄──────────────┐
   │                  │                   │ 상태 확인 정상
   │ 상태 확인 정상     │ ready=false 응답    │
   │                  ▼                   │
   │              not_ready ──────────────┘
   │                  │
   │                  │ 상태 확인 3회 연속 실패
   │                  ▼
   └────────────── offline   (등록은 유지, 5초마다 계속 확인)

   어느 상태든 ── 관리자 제거 ──► draining ── in_flight == 0 ──► (메모리·DB에서 삭제)
```

- 라우팅 대상은 `status == ready and not draining`인 인스턴스뿐이다.
- 응답 시작 전 연결 실패(FR-013)는 즉시 `not_ready`로 내리고 다음 상태 확인에서 복귀를 판단한다.

### 3.2 `ModelPool` (모델별 1개)

| 필드 | 설명 |
|---|---|
| `model_id` | 카탈로그 모델 ID |
| `instances` | 이 모델을 서비스하는 `WorkerInstance` 목록 |
| `queue` | 대기 요청 FIFO(`deque[Waiter]`) |
| `max_depth`, `max_wait_seconds` | 설정값(기본 32, 300초) |
| `stats` | 최근 60초 대기 시간·과부하 거절 수 |

### 3.3 `Waiter`, `Lease`

- `Waiter`: 요청 ID, 도착 시각, `asyncio.Future[Lease]`. 취소되면 인계 대상에서 건너뛴다.
- `Lease`: 인스턴스 하나의 슬롯 1개. `release()`는 멱등이며, 호출되면 대기열 맨 앞 `Waiter`에 슬롯을 직접
  인계하고 없으면 `in_flight`를 줄인다.

**불변식**

1. 어떤 시점에도 `0 ≤ in_flight ≤ capacity`.
2. `queue`가 비어 있지 않으면, 그 모델의 `ready` 인스턴스는 모두 `in_flight == capacity`다(빈 워커를 두고 대기 없음 — NFR-001, SC-011).
3. 대기열에서 인계되는 순서는 `Waiter.arrived_at` 순서와 같다(NFR-003, SC-012). 예외는 재시도 요청(맨 앞
   재삽입)뿐이며, 이 역시 원래 도착 순서를 유지하는 조치다.
4. `Lease`는 정확히 한 번 반납된다.

## 4. 워커 쪽 상태 파일

경로: `--state-dir`(기본 `~/.crefleai-worker/`, Docker에서는 볼륨) 아래 `credentials.json`, 권한 `0600`.

| 필드 | 설명 |
|---|---|
| `gateway_url` | 등록한 게이트웨이 주소 |
| `instance_id` | 등록된 인스턴스 ID |
| `worker_key` | 파생 워커 키(비밀) |
| `registered_at` | 등록 시각 |

- 파일이 있으면 재연결, 없으면 등록 토큰이 필요하다.
- 재연결이 `worker_removed`로 거부되면 워커는 파일을 `credentials.json.removed`로 옮기고 종료한다.
