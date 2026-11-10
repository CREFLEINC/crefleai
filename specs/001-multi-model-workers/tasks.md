---
description: "추론 워커 분리 및 복수 모델 동시 서비스 — 구현 작업 목록"
---

# Tasks: 추론 워커 분리 및 복수 모델 동시 서비스

**Input**: `specs/001-multi-model-workers/`의 설계 문서 — [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: 포함한다. 헌법 V(검증 필수)와 명세 성공 기준(SC-011·012 등)이 자동 테스트를 요구한다. 각 스토리에서 테스트를
먼저 작성해 실패를 확인한 뒤 구현한다.

**Organization**: 사용자 스토리별로 묶는다. 스토리 번호는 spec.md와 같다(US1~US6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 다른 파일을 다루고 미완료 작업에 의존하지 않아 병렬 실행 가능
- **[Story]**: 해당 사용자 스토리(US1~US6)
- 경로는 저장소 루트(워크트리 `.claude/worktrees/multi-model-workers`) 기준

## Path Conventions

- 백엔드: `server/src/crefleai/`, 테스트 `server/tests/`
- 프론트엔드: `web/src/`
- 배포: `deploy/`

---

## Phase 1: Setup

**Purpose**: 규칙 확인과 새 모듈 골격

- [ ] T001 `crefle-agent-skills:coding-rules` 스킬의 Python·TypeScript·React 규칙과 커밋 규칙을 읽고, 이 기능에 적용할 항목을 `specs/001-multi-model-workers/plan.md` 하단 "구현 메모" 절에 5줄 이내로 기록 (헌법 III)
- [ ] T002 `server/src/crefleai/gateway/__init__.py`를 빈 패키지로 만들고, `server/pyproject.toml`의 `[project.scripts]`에 `crefleai-worker = "crefleai.worker.cli:main"` 추가
- [ ] T003 [P] `server/src/crefleai/config.py`의 `Settings`에 `local_worker: bool = True`, `queue_max_depth: int = 32`, `queue_max_wait_seconds: float = 300.0`, `health_interval_seconds: float = 5.0`, `health_timeout_seconds: float = 3.0`, `health_failure_threshold: int = 3`, `registration_token_default_ttl_minutes: int = 60` 추가(환경 변수 `CREFLEAI_` 접두어). `server/tests/test_config.py`에 기본값·환경 변수 덮어쓰기 테스트 추가

---

## Phase 2: Foundational (모든 스토리의 선행 조건)

**Purpose**: 저장소, 카탈로그 사양, GPU 조회, 사양 판정, 키 파생, 오류 코드

**⚠️ CRITICAL**: 이 단계가 끝나기 전에는 스토리 작업을 시작하지 않는다.

- [ ] T004 [P] `server/tests/test_db.py`에 `worker_registration_tokens`·`workers` 테이블 CRUD 테스트 작성 — 토큰 `token_hash` UNIQUE, `use_count` 기본 0, 유효 조건 `revoked_at IS NULL AND now < expires_at`; 워커 `instance_id` PK, `credential_id` UNIQUE, 삭제 시 행 제거
- [ ] T005 `server/src/crefleai/db.py`의 `_SCHEMA`에 data-model.md §1.1·§1.2 테이블을 `CREATE TABLE IF NOT EXISTS`로 추가하고 접근 함수 구현: `insert_registration_token`, `list_registration_tokens`, `get_registration_token_by_hash`, `revoke_registration_token`, `increment_token_use`, `upsert_worker`, `get_worker`, `get_worker_by_credential`, `list_workers`, `delete_worker` (`gpus`는 JSON 문자열로 저장) — T004 통과
- [ ] T006 [P] `server/tests/test_catalog.py`에 테스트 추가 — 모든 카탈로그 항목이 `spec`(`base_bytes`, `kv_bytes_per_token`, `reference_ctx`, `source` ∈ {`measured`,`estimated`}, `measured_on`)을 가져야 하며 누락 시 `load_catalog()` 실패; `min_bytes(ctx) = base_bytes + kv_bytes_per_token × ctx`, `recommended_bytes(ctx, concurrency) = ceil((base_bytes + kv_bytes_per_token × ctx × concurrency) × 1.2)` 계산 검증
- [ ] T007 `server/src/crefleai/models/catalog.py`에 `ModelSpec` 데이터클래스와 `min_bytes()`·`recommended_bytes()` 추가, `CatalogModel.spec` 필수화 — T006 통과
- [ ] T008 `server/src/crefleai/models/catalog.json` 17개 항목에 추정 `spec` 추가: `base_bytes = ceil(size_bytes × 1.10) + 1073741824`, `kv_bytes_per_token`은 GGUF 메타데이터 기준 값(모를 경우 `n_layer × (n_embd_k_gqa + n_embd_v_gqa) × 2`를 모델 카드에서 계산), `reference_ctx = 8192`, `source = "estimated"`, `measured_on = null` (research R7)
- [ ] T009 [P] `server/tests/test_spec_check.py` 작성 — 주입한 GPU 정보로 판정: 여유 메모리 합계 < 최소 → `insufficient`(필요값·실제값 포함), 최소 ≤ 여유 < 권장 → `below_recommended`, 이상 → `ok`, GPU 조회 불가 → `unavailable`, compute capability가 허용 목록 밖 → `unsupported_gpu`, `ctx` 변경 시 필요값 재계산
- [ ] T010 [P] `server/src/crefleai/models/gpu.py` 구현 — `GpuInfo(index, uuid, name, memory_total_bytes, memory_free_bytes, compute_capability)`와 NVML 조회 함수 `query_gpus(indices: list[int] | None)`(PCI 버스 순서, NVML 불가 시 `GpuUnavailableError`), 허용 아키텍처는 환경 변수 `CREFLEAI_CUDA_ARCHS`(쉼표 구분, 예 `120`)에서 읽음
- [ ] T011 `server/src/crefleai/models/spec_check.py` 구현 — `check_model_fits(model, ctx, concurrency, gpus) -> SpecCheckResult(status, required_min_bytes, required_recommended_bytes, free_bytes, message)`; 메시지는 한국어로 필요값·실제값(GiB 소수 1자리) 포함 — T009 통과
- [ ] T012 [P] `server/tests/test_credentials.py` 작성 — 등록 토큰 형식 `crefle_reg_` + 43자 base64url, 해시는 SHA-256 hex, 워커 키 `crefle_wk_` 접두어 + `HMAC-SHA256(jwt_secret, "crefleai-worker:" + credential_id)` 파생이 결정적이고, 시크릿·credential_id가 다르면 불일치, 검증은 상수 시간 비교
- [ ] T013 `server/src/crefleai/gateway/credentials.py` 구현 — `new_registration_token() -> (plain, hash)`, `hash_token(plain)`, `new_credential_id()`(16바이트 hex), `derive_worker_key(secret, credential_id)`, `verify_worker_key(secret, credential_id, presented)` (표준 라이브러리만 사용) — T012 통과
- [ ] T014 [P] `server/src/crefleai/api/errors.py`에 오류 생성 도우미 추가 — `model_not_found`(404), `model_required`(400), `model_not_ready`(503), `server_overloaded`(503), `worker_unreachable`(502)를 contracts/external-api.md 표의 `type`·`code`·한국어 메시지로 반환

**Checkpoint**: 기반 완료 — `cd server && uv run pytest` 통과

---

## Phase 3: User Story 2 — GPU·서버를 나눠 워커 운영 (Priority: P1)

**Goal**: 게이트웨이 없이 단독 실행되는 `crefleai-worker`가 지정 GPU만 쓰고, 사양 판정 후 모델을 로드하며, 게이트웨이용
내부 API(`/internal/status`, 키 검증)를 제공한다.

**Independent Test**: 가짜 Llama 팩토리·가짜 GPU 정보로 워커를 단독 기동해 `/internal/status`가 `ready=true`를 주고,
키 없는 `/completion` 호출은 401, 올바른 키로는 응답하는지 확인. 사양 미달이면 종료 코드 3.

### Tests for User Story 2

- [ ] T015 [P] [US2] `server/tests/test_worker_app.py`에 테스트 추가 — `GET /internal/status` 응답 필드(contracts/worker-internal-api.md), `X-Crefleai-Nonce` 헤더 시 `nonce` 반사, 워커 키 설정 시 `/completion`·`/internal/status`가 `Authorization: Bearer` 없으면 401(nonce 요청은 키 없이 허용), `in_flight` 증감
- [ ] T016 [P] [US2] `server/tests/test_worker_cli.py` 작성 — 인자 검증(카탈로그 외 모델·`--ctx` 초과·`--max-concurrency` > 1 → 종료 코드 2), 모델 파일 없음 → 2, 사양 `insufficient`·`unavailable`·`unsupported_gpu` → 3(필요값·실제값 출력), 로드 예외 → 4, `--gpus 0,1` 지정 시 `llama_cpp` import 전에 `CUDA_DEVICE_ORDER=PCI_BUS_ID`·`CUDA_VISIBLE_DEVICES=0,1` 설정, `--name` 기본값 `<hostname>-gpu0-1`

### Implementation for User Story 2

- [ ] T017 [US2] `server/src/crefleai/worker/app.py` 확장 — `create_app(..., instance_id, worker_key: str | None)`, `GET /internal/status`(instance_id·model_id·ready·in_flight·context_length·worker_version·protocol_version·nonce), `hmac.compare_digest` 기반 Bearer 검증 미들웨어, `in_flight` 카운터; 기존 `/completion`·`/health` 동작 유지 — T015 통과
- [ ] T018 [US2] `server/src/crefleai/worker/cli.py` 구현 — contracts/worker-cli.md의 옵션·환경 변수·실행 순서 1~5단계(인자 검증 → 모델 파일 → `gpu.query_gpus` → `spec_check.check_model_fits` → 모델 로드)와 종료 코드 0/2/3/4, GPU 환경 변수는 `llama_cpp` import 전 설정(research R2), 권장 미만은 경고 출력 후 계속; 등록 단계(6~8)는 US4에서 연결하도록 `on_ready` 훅 자리만 둠 — T016 통과
- [ ] T019 [US2] `server/src/crefleai/worker/cli.py`에 `SIGTERM` 처리 — 처리 중 요청 완료까지 최대 60초 대기 후 종료(contracts/worker-cli.md 8단계)

**Checkpoint**: 워커 단독 실행 가능 — `cd server && uv run pytest tests/test_worker_app.py tests/test_worker_cli.py`

---

## Phase 4: User Story 1 — 여러 모델을 같은 주소로 동시에 호출 (Priority: P1) 🎯 MVP

**Goal**: 게이트웨이가 레지스트리의 여러 워커로 `model` 값에 따라 일반·스트리밍 요청을 전달하고, `/v1/models`에 준비된
모델을 모두 보여준다. 기존 단일 모델 운영(호환 모드)도 같은 경로로 동작한다.

**Independent Test**: 테스트 픽스처로 서로 다른 모델의 가짜 워커 2개를 레지스트리에 넣고, 같은 토큰으로 두 모델에 동시에
일반·스트리밍 요청 → 각 응답의 `model` 일치, `/v1/models`에 둘 다 표시. 모델 미지정 + 모델 2개 → 400 `model_required`.

### Tests for User Story 1

- [ ] T020 [P] [US1] `server/tests/test_registry.py` 작성 — 인스턴스 추가·갱신·제거, 상태 전이(data-model.md §3.1: `ready`↔`not_ready`, 연속 실패 3회 → `offline`, `offline` → 정상 응답 시 `ready`), 라우팅 대상은 `status == ready and not draining`만, `instance_id` `local` 예약
- [ ] T021 [P] [US1] `server/tests/test_health.py` 작성 — 주입한 HTTP 클라이언트로 상태 확인 루프: 실패 3회 → `offline`, 복귀 시 `ready`, `ready=false` 응답 → `not_ready`, 요청에 워커 키 Bearer 포함, 게이트웨이 기동 시 즉시 1회 확인
- [ ] T022 [P] [US1] `server/tests/test_v1_api.py`에 복수 워커 테스트 추가 — 가짜 워커 2개(모델 A·B) 픽스처, 모델별 일반·스트리밍 전달과 응답 `model`, `/v1/models` 2개(+ `context_length`는 해당 모델 ready 인스턴스 중 최솟값), 모델 미지정 + 모델 1개 → 그 모델, 2개 → 400 `model_required`, 없는 모델 404 `model_not_found`, 등록돼 있지만 ready 없음 503 `model_not_ready`, 응답 시작 전 연결 실패 1회 재시도 후 502 `worker_unreachable`, 기존 테스트 전부 유지

### Implementation for User Story 1

- [ ] T023 [US1] `server/src/crefleai/gateway/registry.py` 구현 — `WorkerInstance`(data-model.md §3.1 필드), `WorkerRegistry`(메모리 + `db.workers` 동기화, 기동 시 DB에서 원격 인스턴스 적재, `origin` `remote`/`local`), 상태 변경 콜백 — T020 통과
- [ ] T024 [US1] `server/src/crefleai/gateway/router.py`에 최소 라우터 구현 — 모델별 `ModelPool`, `acquire(model_id) -> Lease`(빈 ready 인스턴스 중 `idle_since`가 가장 오래된 것), 멱등 `Lease.release()`; 대기열은 US3에서 추가하므로 이 단계에서는 빈 인스턴스가 없으면 바로 `server_overloaded`
- [ ] T025 [US1] `server/src/crefleai/gateway/health.py` 구현 — 주기 `health_interval_seconds`, 타임아웃 `health_timeout_seconds`, 실패 임계 `health_failure_threshold`, 워커 키는 `credentials.derive_worker_key`로 계산 — T021 통과
- [ ] T026 [US1] `server/src/crefleai/api/v1.py`를 라우터 경유로 변경 — 모델 결정(미지정 규칙), `Lease` 획득, 일반 응답은 `try/finally` 반납·사용자 연결 끊김 시에도 워커 응답 완료까지 슬롯 유지(shield), 스트리밍은 제너레이터 `finally`에서 반납, 응답 시작 전 연결 실패 시 인스턴스 `not_ready` 처리 후 1회 재시도, 오류는 T014 도우미 사용, 워커 호출에 Bearer 워커 키 추가 — T022 통과
- [ ] T027 [US1] `server/src/crefleai/models/worker_manager.py`·`server/src/crefleai/main.py` 호환 모드 연결 — 로컬 워커 기동 시 게이트웨이가 내부 워커 키를 생성해 서브프로세스 환경 변수로 전달, `running`이 되면 레지스트리에 `local` 인스턴스(주소 `http://127.0.0.1:<worker_port>`) 등록, 정지·교체 시 해제; `local_worker=false`면 로컬 워커를 띄우지 않음; `server/src/crefleai/worker/__main__.py`가 키 환경 변수를 읽어 `create_app`에 전달
- [ ] T028 [US1] `server/src/crefleai/main.py` 수명 주기에 `WorkerRegistry`·라우터·상태 확인 루프 생성·시작·정리 추가, `server/tests/test_startup_restore.py` 회귀 확인
- [ ] T029 [US1] `server/src/crefleai/monitoring/metrics.py`의 요청 지표를 모델·인스턴스 라벨별로 확장하고 `v1.py`에서 기록, 로그는 요청 ID·모델·인스턴스·처리 시간·결과만(본문 금지, FR-026)

**Checkpoint**: MVP — 복수 모델 동시 서비스. `cd server && uv run pytest` 전체 통과

---

## Phase 5: User Story 3 — 같은 모델 복수 인스턴스와 대기열 (Priority: P2)

**Goal**: 같은 모델 워커가 여러 개일 때 빈 워커 우선 분배, 모두 바쁘면 모델별 FIFO 대기열에서 먼저 끝난 워커로 직접
인계(NFR-001~006). 관리자 점검 호출은 지정 인스턴스로만.

**Independent Test**: 완료 시점을 조종하는 가짜 워커 2개 + 동시 요청 5건 → 2건 즉시 배정, 3건 대기, Y 먼저 완료 시 첫
대기 요청이 Y로, 배정 순서 = 도착 순서(SC-011·012).

### Tests for User Story 3

- [ ] T030 [P] [US3] `server/tests/test_router.py` 작성 — (a) 5명 시나리오(US3 시나리오 6·7), (b) X 바쁨·Y 빔 → 새 요청 즉시 Y(시나리오 8), (c) 대기열이 있을 때 새 요청은 뒤에 섬(NFR-004), (d) 대기 중 취소 → 건너뛰고 순서 유지, (e) `queue_max_depth` 초과·`queue_max_wait_seconds` 초과 → `server_overloaded`, (f) 인스턴스 `offline` 시 남은 인스턴스로 순서 유지·전부 이탈 시 대기 요청 `model_not_ready`, (g) 인스턴스 복귀·신규 등록 시 대기열 앞에서 인계, (h) 재시도 요청은 대기열 맨 앞 재삽입, (i) 모델 간 독립(NFR-005), (j) 불변식 `0 ≤ in_flight ≤ capacity`, `Lease` 이중 반납 무해
- [ ] T031 [P] [US3] `server/tests/test_v1_api.py`에 같은 모델 워커 2개 + 동시 스트리밍 요청 5건 통합 테스트 추가(배정 인스턴스와 순서를 가짜 워커 기록으로 확인), 대기 중 사용자 연결 끊김 시 대기열에서 제거 확인

### Implementation for User Story 3

- [ ] T032 [US3] `server/src/crefleai/gateway/router.py`에 대기열 추가 — `Waiter`(요청 ID·도착 시각·Future), 모델별 `deque`, 반납 시 대기열 맨 앞 살아 있는 `Waiter`로 슬롯 직접 인계, 취소 Future 건너뛰기, 상한(`queue_max_depth`·`queue_max_wait_seconds`), 레지스트리 상태 콜백으로 인스턴스 복귀·신규 시 인계·전부 이탈 시 일괄 `model_not_ready`, 재시도 맨 앞 재삽입 — T030 통과
- [ ] T033 [US3] `server/src/crefleai/api/v1.py`가 대기 포함 `acquire`를 쓰도록 수정하고 대기 중 연결 끊김 시 Future 취소 — T031 통과
- [ ] T034 [US3] `server/src/crefleai/gateway/router.py`에 인스턴스 지정 획득 `acquire_pinned(instance_id)` 추가 — 인스턴스 전용 대기 목록, 해당 인스턴스 슬롯이 비면 모델 대기열보다 먼저 인계, 다른 인스턴스로 대체 금지; `server/tests/test_router.py`에 케이스 추가
- [ ] T035 [US3] `server/src/crefleai/monitoring/metrics.py`에 모델별 대기 건수·최근 60초 대기 시간(평균·최대)·과부하 거절 수, 인스턴스별 `busy` 추가하고 `server/src/crefleai/api/admin.py`의 `GET /api/admin/metrics` 응답에 `models[]`·`workers[]` 추가(기존 필드 유지, contracts/admin-api.md) — `server/tests/test_admin_metrics_api.py` 갱신

**Checkpoint**: SC-011·012 자동 테스트 통과

---

## Phase 6: User Story 4 — 워커 자가 등록과 상태 관리 (Priority: P2)

**Goal**: 관리자가 등록 토큰을 발급하면 워커가 스스로 등록·재연결하고, 관리자는 워커 목록·상태 확인과 제거·점검을 한다.

**Independent Test**: 등록 토큰 발급 → 워커 agent로 등록 → 재시작 시 토큰 없이 재연결 → 관리자 제거 후 재연결 401
`worker_removed`. 만료·폐기 토큰 401, 중복 ID 409, 주소 검증 실패 422.

### Tests for User Story 4

- [ ] T036 [P] [US4] `server/tests/test_worker_registration_api.py` 작성 — contracts/worker-registration-api.md의 처리 순서 1~6과 모든 오류 코드(`protocol_mismatch`, `registration_token_invalid`, `invalid_worker_spec`, `instance_id_conflict`, `address_unreachable`, `worker_removed`, `instance_id_mismatch`), `instance_id` 형식 `^[a-z0-9][a-z0-9-]{1,62}$`·`local` 예약, 성공 시 `use_count + 1`, 재연결 시 주소·GPU·컨텍스트·모델 갱신, 응답·로그에 토큰·키·nonce 미포함
- [ ] T037 [P] [US4] `server/tests/test_admin_workers_api.py` 작성 — 등록 토큰 발급(`ttl_minutes` 15~1440 범위 밖 422, 응답에 평문 1회와 실행 예시 명령), 목록(평문 없음, `status` `active`/`expired`/`revoked`), 폐기; 워커 목록 필드, 제거(`draining` 후 삭제·키 무효, `local`은 409), 점검 호출(지정 인스턴스만, `max_tokens` 8)
- [ ] T038 [P] [US4] `server/tests/test_worker_agent.py` 작성 — 상태 파일 없으면 register, 있으면 connect; 상태 파일 권한 `0600`; `worker_removed` 시 `credentials.json.removed`로 이동 후 종료 코드 5; 게이트웨이 접속 불가 10초 간격 30회 재시도 후 종료 코드 5(시간 주입)

### Implementation for User Story 4

- [ ] T039 [US4] `server/src/crefleai/api/workers.py` 구현 — `POST /api/workers/register`, `POST /api/workers/connect`(주소 검증은 `GET {advertise_url}/internal/status` + `X-Crefleai-Nonce`, 타임아웃 5초), 레지스트리·DB 갱신, 감사 로그(인스턴스 ID·모델·주소·토큰 ID·결과) — T036 통과
- [ ] T040 [US4] `server/src/crefleai/api/admin_workers.py` 구현 — `POST/GET/DELETE /api/admin/worker-tokens`, `GET /api/admin/workers`, `DELETE /api/admin/workers/{instance_id}`, `POST /api/admin/workers/{instance_id}/probe`(T034 `acquire_pinned` 사용), `server/src/crefleai/main.py`에 라우터 등록 — T037 통과
- [ ] T041 [US4] `server/src/crefleai/worker/agent.py` 구현 — data-model.md §4 상태 파일 읽기·쓰기(0600), register/connect 호출, 결과별 종료 코드, 재시도 정책 — T038 통과
- [ ] T042 [US4] `server/src/crefleai/worker/cli.py`의 `on_ready`에 agent 연결 — HTTP 서버 기동 후 등록·재연결(contracts/worker-cli.md 6~7단계), `--token`/`--token-file`/`CREFLEAI_REGISTRATION_TOKEN`, `--state-dir`; `server/tests/test_worker_cli.py`에 등록 흐름 케이스 추가
- [ ] T043 [P] [US4] `web/src/types.ts`에 `RegistrationToken`, `CreatedRegistrationToken`, `WorkerInstanceInfo` 타입 추가(contracts/admin-api.md 필드 그대로)
- [ ] T044 [US4] `web/src/admin/WorkersPage.tsx` 구현 — 워커 목록(인스턴스 ID·모델·위치·GPU·상태·바쁨·사양 상태·마지막 연결·최근 오류), 제거 확인 대화상자, 점검 호출 결과 표시, 등록 토큰 발급(만료 시간·메모, 평문과 실행 예시를 한 번만 표시·복사 버튼)·목록·폐기; 기존 `TokensPage.tsx`·`TokenModal.tsx`의 패턴과 `clipboard.ts` 재사용
- [ ] T045 [US4] `web/src/App.tsx`에 `/admin/workers` 라우트, `web/src/admin/AdminLayout.tsx` 메뉴에 "워커" 추가
- [ ] T046 [P] [US4] `web/src/admin/WorkersPage.test.tsx` 작성 — 목록 렌더링, 토큰 발급 후 평문 1회 표시, 폐기·제거 호출, 오류 메시지 표시

**Checkpoint**: 원격 워커 자가 등록 동작 — 백엔드·프론트엔드 테스트 통과

---

## Phase 7: User Story 6 — 모델 사양 확인과 사양 미달 사용 방지 (Priority: P2)

**Goal**: 모델별 최소·권장 사양을 관리자 화면에서 보여주고, 호환 모드에서도 미달 시 서비스 시작을 막으며, 실측으로 사양 값을 확정한다.
(워커 쪽 차단은 Phase 3 T018에서 구현됨)

**Independent Test**: 가짜 GPU 정보로 로컬 여유 메모리가 부족한 모델의 `serve` 호출 → 409 `insufficient_gpu_memory`(필요값·실제값),
`GET /api/admin/models`에 `spec`·`local_check` 표시, 워커 등록 정보의 `spec_status=below_recommended`가 관리자 워커 목록에 경고로 보임.

### Tests for User Story 6

- [ ] T047 [P] [US6] `server/tests/test_admin_models_api.py`에 테스트 추가 — 모델 응답에 `spec`(`reference_ctx`, `min_bytes`, `recommended_bytes`, `source`, `measured_on`, `local_check`), `instances` 필드; 로컬 GPU 미달 시 `serve` 409 `insufficient_gpu_memory`, 다운로드는 허용
- [ ] T048 [P] [US6] `web/src/admin/ModelsPage.test.tsx`에 테스트 추가 — 사양 표시(GiB, `추정` 배지), `local_check.status == insufficient`면 "서비스 시작" 비활성과 사유 표시, `below_recommended` 경고

### Implementation for User Story 6

- [ ] T049 [US6] `server/src/crefleai/api/admin.py`의 `GET /api/admin/models`에 `spec`·`local_check`·`instances` 추가, `POST /api/admin/models/{id}/serve`에 `spec_check` 사전 판정(로컬 모든 GPU 여유 합계) — T047 통과
- [ ] T050 [P] [US6] `web/src/types.ts`에 `ModelSpec`·`LocalCheck` 타입 추가, `web/src/admin/ModelsPage.tsx`에 사양 표시와 서비스 시작 차단 UI 구현 — T048 통과
- [ ] T051 [US6] `web/src/admin/WorkersPage.tsx`에 `spec_status == below_recommended` 워커 "권장 사양 미달" 경고 배지 추가(FR-037)
- [ ] T052 [P] [US6] `server/scripts/measure_model_spec.py` 구현 — 지정 모델을 `reference_ctx`로 로드해 NVML 사용량 증가분(로드 후·기준 길이 프롬프트 처리 후 최고치) 측정, GGUF 메타데이터로 `kv_bytes_per_token` 계산·대조, `catalog.json`에 `source="measured"`·`measured_on`(GPU·드라이버·llama.cpp 버전·날짜) 기록(`--write` 옵션), 사용법은 파일 docstring

**Checkpoint**: 사양 표시·차단 동작 — 실측은 Phase 9 T060에서 doctordoom 실행

---

## Phase 8: User Story 5 — 기존 단일 서버 운영에서 전환 (Priority: P3)

**Goal**: 문서화된 절차로 기존 운영 데이터(토큰·관리자·모델 파일)를 그대로 쓰며 새 구조로 전환·롤백한다.

**Independent Test**: 기존 데이터가 있는 `data_dir`로 새 버전 게이트웨이를 기동 → 기존 토큰·관리자 로그인 동작, 로컬 워커 복원,
`workers` 테이블 자동 생성. 롤백 절차로 이전 이미지 기동 시 새 테이블이 있어도 정상 동작.

- [ ] T053 [P] [US5] `server/tests/test_startup_restore.py`에 기존 스키마만 있는 DB로 기동 시 새 테이블 생성·기존 토큰 유지·로컬 워커 복원 테스트 추가
- [ ] T054 [P] [US5] `deploy/Dockerfile` 런타임 단계에 `ENV CREFLEAI_CUDA_ARCHS=120` 추가(빌드의 `CMAKE_CUDA_ARCHITECTURES`와 같은 값, 주석으로 동기 필요 명시)
- [ ] T055 [P] [US5] `deploy/worker/docker-compose.yml`·`deploy/worker/.env.example` 작성 — 같은 이미지·`command: crefleai-worker`, GPU별 서비스 2개 예시(`device_ids`), 상태 볼륨, `restart: on-failure:3`, 포트, 등록 토큰은 `.env`/secret 파일로 전달, `--advertise-url` 예시
- [ ] T056 [US5] `deploy/README.md`에 절차 추가 — 워커 등록(토큰 발급 → 실행), 같은 GPU 워커 순차 기동, 워커 포트 방화벽 제한(게이트웨이만 접근), 호환 모드 전환·롤백, `CREFLEAI_JWT_SECRET` 교체 시 워커 재등록 필요, 원격 워커 배포는 하네스 범위 밖(수동)
- [ ] T057 [US5] `deploy/docker-compose.yml`에 새 설정 항목(`CREFLEAI_LOCAL_WORKER`, 대기열 상한) 주석 예시 추가, `docker compose config`로 검증

**Checkpoint**: 전환·롤백 문서와 compose 검증 완료

---

## Phase 9: Polish & Cross-Cutting

- [ ] T058 [P] `server/tests/test_inference_integration.py`에 실모델 시나리오 추가 — `CREFLEAI_TEST_GGUF`로 워커 단독 기동(GPU 조회 주입) → 등록 → `/v1/chat/completions` 일반·스트리밍 (`-m inference`)
- [ ] T059 [P] `web/src/admin/MonitoringPage.tsx`(+ `MonitoringPage.test.tsx`)에 모델별 대기 건수·대기 시간·과부하 수, 워커별 상태·바쁨 표시
- [ ] T060 doctordoom에서 `server/scripts/measure_model_spec.py`로 서비스 대상 모델 사양 실측 후 `server/src/crefleai/models/catalog.json` 갱신(미측정 모델은 `estimated` 유지) — 서버 실행은 사용자 승인 또는 직접 실행
- [ ] T061 전체 검증(`server/`·`web/`) — `cd server && uv run pytest`, `uv run ruff check .`, `cd web && npm test && npm run build`, `npx oxlint`, `npx tsc -b`
- [ ] T062 [quickstart.md](quickstart.md) 3~5단계를 doctordoom에서 수행하고 결과(SC-001·003·004·008·011·012)를 표로 정리 — 수행 못한 항목은 "미수행"으로 명시
- [ ] T063 `docs/reports/2026-11-09-crefleai-multi-model-workers/spec.html`을 최신 spec.md로 다시 생성하고, 구현 중 바뀐 결정이 있으면 spec·plan·contracts에 반영
- [ ] T064 PR 생성(`feat/multi-model-workers` → `main`, 근거 문서 `specs/001-multi-model-workers/`) — 본문 `## 요약`·`## 변경 내용`·`## 검증`(T061·T062 결과 표), `Closes #49`, 이슈 라벨 `status:in-review`로 갱신

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → 모든 스토리
- **US2 (Phase 3)**: Foundational 이후. 워커 실행 단위를 만든다.
- **US1 (Phase 4)**: Foundational 이후. 테스트는 가짜 워커로 독립 진행 가능하지만, 실제 워커 연동은 US2의 `/internal/status`·키 검증(T017)이 필요하다.
- **US3 (Phase 5)**: US1의 라우터(T024)·`v1.py`(T026) 위에 대기열을 얹는다.
- **US4 (Phase 6)**: US1 레지스트리(T023)·상태 확인(T025), US2 워커 CLI(T018), US3 `acquire_pinned`(T034, 점검 호출)에 의존.
- **US6 (Phase 7)**: Foundational의 사양 판정(T011). 워커 목록 경고(T051)는 US4의 `WorkersPage`(T044) 이후.
- **US5 (Phase 8)**: US1·US4 완료 후(전환 대상 기능이 있어야 함).
- **Polish (Phase 9)**: 원하는 스토리 완료 후.

### Within Each User Story

- 테스트 작성 → 실패 확인 → 구현 → 통과
- 저장소·모델 → 서비스(레지스트리·라우터) → API → 웹

### Parallel Opportunities

- Phase 2: T004·T006·T009·T012·T014는 서로 다른 파일 — 동시 진행 가능. T010(GPU 조회)도 T009와 병렬.
- Phase 3: T015·T016 병렬
- Phase 4: T020·T021·T022 병렬(테스트), T023·T025는 다른 파일이라 병렬 가능
- Phase 6: 백엔드(T039~T042)와 프론트엔드(T043~T046)는 API 계약이 고정돼 있어 병렬 가능
- Phase 7: T047·T048·T052 병렬
- Phase 8: T053·T054·T055 병렬

---

## Parallel Example: Phase 2 (Foundational)

```bash
Task: "worker_registration_tokens·workers 테이블 CRUD 테스트 in server/tests/test_db.py"
Task: "카탈로그 spec 필수·계산 테스트 in server/tests/test_catalog.py"
Task: "사양 판정 테스트 in server/tests/test_spec_check.py"
Task: "등록 토큰·워커 키 파생 테스트 in server/tests/test_credentials.py"
Task: "오류 생성 도우미 in server/src/crefleai/api/errors.py"
```

## Parallel Example: User Story 4

```bash
Task: "등록 API 테스트 in server/tests/test_worker_registration_api.py"
Task: "관리자 워커 API 테스트 in server/tests/test_admin_workers_api.py"
Task: "워커 agent 테스트 in server/tests/test_worker_agent.py"
Task: "워커 관리 타입 in web/src/types.ts"
```

---

## Implementation Strategy

### MVP (Phase 1~4: Setup → Foundational → US2 → US1)

1. 기반과 워커 단독 실행(US2)을 만든 뒤, 게이트웨이가 여러 워커로 모델별 라우팅(US1)
2. **검증**: 가짜 워커 2개 통합 테스트 + 호환 모드 회귀(기존 테스트 전부 통과)
3. 이 시점에는 원격 워커를 붙이는 공식 방법(자가 등록)이 없으므로 **배포하지 않는다** — 내부 검증용 MVP

### Incremental Delivery

1. MVP(US2+US1) → 대기열(US3) → 자가 등록(US4) → 사양 표시·차단(US6) → 전환 문서(US5)
2. **첫 배포 가능 시점**: US4 완료 후(원격 워커를 실제로 붙일 수 있음). 사양 실측(T060)과 quickstart 검증(T062)을 마친 뒤 하나의 PR로 머지
3. PR이 커지면 스토리 단위로 커밋을 나눠 리뷰 가능하게 유지(하나의 브랜치·하나의 PR, `Closes #49`)

---

## Notes

- [P] = 다른 파일, 미완료 작업 의존 없음
- 각 작업 또는 논리 묶음마다 커밋(Conventional Commits, 한국어 제목, `Refs #49`)
- doctordoom 대상 작업(T060·T062)은 운영 서버 명령이므로 사용자 승인 또는 직접 실행이 필요하다
- 시크릿(등록 토큰·워커 키·`.env`)은 커밋·로그·PR 본문에 넣지 않는다
