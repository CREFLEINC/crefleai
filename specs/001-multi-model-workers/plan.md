# Implementation Plan: 추론 워커 분리 및 복수 모델 동시 서비스

**Branch**: `feat/multi-model-workers` | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md) | **Issue**: CREFLEINC/crefleai#49

**Input**: Feature specification from `specs/001-multi-model-workers/spec.md`

## Summary

추론 워커를 게이트웨이와 독립 실행되는 `crefleai-worker` 명령으로 분리한다. 워커는 GPU를 지정받아 모델 1개를
로드하기 전에 GPU 여유 메모리를 모델 최소 사양과 비교하고, 통과하면 관리자가 발급한 등록 토큰으로 게이트웨이에
스스로 등록한다(GitHub runner 방식, 이후 파생 워커 키로 재연결). 게이트웨이는 등록된 워커를 5초마다 상태 확인하고,
모델별 `ModelPool`이 "빈 워커 우선 + 모델별 FIFO 대기열 + 슬롯 직접 인계"로 요청을 배정한다. 외부 `/v1` API의
주소·인증·형식은 그대로이며, 기존 단일 컨테이너 방식은 로컬 워커를 레지스트리 인스턴스 하나로 취급하는 호환
모드로 유지한다. 세부 결정은 [research.md](research.md) R1~R13.

## Technical Context

**Language/Version**: Python 3.11+ (백엔드·워커), TypeScript 6 + React 19 (관리자 웹)

**Primary Dependencies**: FastAPI, Uvicorn, httpx, PyJWT, bcrypt, nvidia-ml-py(NVML), llama-cpp-python ≥ 0.3.34
(worker extra), Vite·Vitest. **새 런타임 의존성 없음** — 등록 토큰·키 파생은 표준 라이브러리(`secrets`, `hashlib`,
`hmac`)로 구현한다.

**Storage**: 기존 SQLite(WAL)에 `worker_registration_tokens`, `workers` 테이블 추가. 워커 쪽은 상태 파일
`credentials.json`(0600). 실행 중 상태·대기열은 게이트웨이 메모리.

**Testing**: pytest(+ pytest-asyncio, `-m inference` 실모델), ruff, vitest, `npm run build`

**Target Platform**: Linux + NVIDIA GPU(CUDA 13, Blackwell sm_120 빌드) Docker. 게이트웨이는 GPU 없이도 실행 가능
(`CREFLEAI_LOCAL_WORKER=false`).

**Project Type**: 웹 서비스(백엔드 API + 관리자 SPA) + 독립 실행 워커 CLI

**Performance Goals**: 모델 2개 동시 요청 시 첫 응답 지연 증가 ≤ 20%(SC-001), 라우터 자체 오버헤드는 요청당
수 ms 수준, 장애 감지·복귀 ≤ 30초(설계값 20초, SC-004)

**Constraints**: 외부 API 하위 호환(헌법 IV), 시크릿 비노출(헌법 운영 안전), 워커 엔진 동시 처리 1(R9), 게이트웨이
단일 인스턴스, 사설망 전제(게이트웨이 → 워커 직접 접근)

**Scale/Scope**: 워커 1~10대, 모델 1~5종 동시, 동시 사용자 수십 명, 모델별 대기열 최대 32건

## Constitution Check

*GATE: Phase 0 전 통과 — Phase 1 설계 후 재확인 완료*

| 원칙 | 판정 | 근거 |
|---|---|---|
| I. 작업 격리 | 통과 | 워크트리 `.claude/worktrees/multi-model-workers`, 브랜치 `feat/multi-model-workers`. spec-kit git 확장 미사용 |
| II. PR 기반 변경 | 통과 | 구현은 이 브랜치에서 PR로 올리고 Squash 머지, Conventional Commits, `Closes #49` |
| III. 코딩 규칙 | 조건부 통과 | 구현(`/speckit-implement`) 착수 전 `crefle-agent-skills:coding-rules`의 Python·TypeScript·React 규칙 확인을 첫 작업으로 둔다 |
| IV. OpenAI 호환 API 계약 | 통과 | `/v1` 주소·인증·요청·응답 형식 유지. 기존 오류의 HTTP 상태·`type` 유지, `code`만 채움. 새 상황(모델 미지정 + 모델 2개 이상)은 기존에 없던 상황이라 회귀 없음. 미지원 파라미터 목록은 기존과 같으며 [contracts/external-api.md](contracts/external-api.md)에 명시 |
| V. 검증 필수 | 통과 | 라우터 결정적 단위 테스트(SC-011·012), API·등록·사양 테스트, `-m inference`, doctordoom 시나리오와 부하 시험([quickstart.md](quickstart.md)). 사양 값은 실측 스크립트로 검증(R7) |
| 운영 안전 | 통과 | 등록 토큰은 해시만 저장, 워커 키는 파생(DB에 비밀 없음), 상태 파일 0600, 토큰·키·nonce 로그 금지. 게이트웨이 배포는 기존 하네스, 워커 배포 절차는 `deploy/README.md`에 추가 |
| 명세·문서 워크플로 | 통과 | 산출물 `specs/001-multi-model-workers/` 한국어 |

**설계 후 재확인**: Phase 1 산출물(데이터 모델·계약)에서 원칙 위반 없음. 단 아래 두 가지를 추적한다.

- `CREFLEAI_JWT_SECRET` 교체 시 워커 키가 모두 무효가 된다(R3). 배포 문서와 하네스 안내에 반영한다.
- 배포 하네스(`crefleai-deploy-orchestrator`)는 게이트웨이만 다룬다. 원격 워커 배포 자동화는 이번 범위 밖이며,
  수동 절차를 문서화한다.

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-model-workers/
├── spec.md
├── plan.md              # 이 문서
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── external-api.md
│   ├── worker-registration-api.md
│   ├── worker-internal-api.md
│   ├── admin-api.md
│   └── worker-cli.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
server/
├── pyproject.toml                    # [project.scripts] crefleai-worker 추가
├── scripts/
│   └── measure_model_spec.py         # 신규: 모델 사양 실측(R7)
├── src/crefleai/
│   ├── config.py                     # 대기열 상한·상태 확인 주기·LOCAL_WORKER 설정 추가
│   ├── db.py                         # worker_registration_tokens, workers 테이블·접근 함수
│   ├── main.py                       # 레지스트리·라우터·상태 확인기 수명 주기 연결
│   ├── api/
│   │   ├── v1.py                     # 라우터 경유로 변경, 오류 code 채움
│   │   ├── admin.py                  # 모델 spec·serve 사전 판정·metrics 확장
│   │   ├── admin_workers.py          # 신규: 등록 토큰·워커 목록·제거·점검
│   │   └── workers.py                # 신규: /api/workers/register, /connect
│   ├── gateway/                      # 신규 패키지
│   │   ├── registry.py               # WorkerInstance, 등록·갱신·제거, DB 동기화
│   │   ├── router.py                 # ModelPool, Waiter, Lease, 직접 인계
│   │   ├── health.py                 # 상태 확인 루프
│   │   └── credentials.py            # 등록 토큰 생성·검증, 워커 키 파생·검증
│   ├── models/
│   │   ├── catalog.json              # 각 모델에 spec 추가
│   │   ├── catalog.py                # ModelSpec, min/recommended 계산
│   │   ├── gpu.py                    # 신규: NVML 조회(여유 메모리·세대), 주입 가능
│   │   ├── spec_check.py             # 신규: 사양 판정(워커·호환 모드 공용)
│   │   └── worker_manager.py         # 호환 모드: 사전 판정, 레지스트리에 local 등록
│   ├── monitoring/metrics.py         # 모델·인스턴스별 지표, 대기열 지표
│   └── worker/
│       ├── __main__.py               # 기존 서브프로세스 진입점 유지(호환 모드)
│       ├── app.py                    # /internal/status, 키 검증 추가
│       ├── agent.py                  # 신규: 등록·재연결 클라이언트, 상태 파일
│       └── cli.py                    # 신규: crefleai-worker 진입점(R2 GPU 환경 설정 포함)
└── tests/
    ├── test_router.py                # 신규: 대기열·인계·5명 시나리오
    ├── test_registry.py              # 신규
    ├── test_health.py                # 신규
    ├── test_worker_registration_api.py  # 신규
    ├── test_admin_workers_api.py     # 신규
    ├── test_spec_check.py            # 신규
    ├── test_worker_agent.py          # 신규
    ├── test_worker_cli.py            # 신규
    ├── test_v1_api.py                # 복수 워커·오류 code 케이스 추가
    └── test_catalog.py               # spec 필수 검증 추가

web/src/
├── types.ts                          # WorkerInfo 확장, RegistrationToken, ModelSpec, 지표 타입
├── App.tsx                           # /admin/workers 라우트
└── admin/
    ├── WorkersPage.tsx (+ test)      # 신규: 워커 목록·상태·제거·점검, 등록 토큰 발급·폐기
    ├── ModelsPage.tsx (+ test)       # 사양 표시, 로컬 미달 시 서비스 시작 차단
    ├── MonitoringPage.tsx (+ test)   # 모델별 대기열·워커별 지표
    └── AdminLayout.tsx               # 메뉴에 "워커" 추가

deploy/
├── Dockerfile                        # CREFLEAI_CUDA_ARCHS 환경 변수 추가
├── docker-compose.yml                # 게이트웨이(호환 모드 기본) — 설정 항목 추가
├── worker/
│   ├── docker-compose.yml            # 신규: GPU별 워커 예시(device_ids, state 볼륨, on-failure:3)
│   └── .env.example                  # 신규
└── README.md                         # 워커 등록·전환·롤백·JWT 교체 영향 절차
```

**Structure Decision**: 기존 `server/`·`web/`·`deploy/` 구조를 유지한다. 게이트웨이의 새 책임(레지스트리·라우터·
상태 확인·자격 증명)은 `crefleai.gateway` 패키지로 모으고, 워커 쪽 새 책임(등록 클라이언트·CLI)은 기존
`crefleai.worker` 아래에 둔다. 사양 판정은 워커와 호환 모드가 함께 쓰므로 `crefleai.models`에 둔다.

## 구현 순서 (tasks.md 입력)

명세 우선순위에 맞춰, 각 단계가 끝날 때마다 테스트가 통과하는 상태를 유지한다.

1. **기반** — 설정 항목, DB 테이블, 카탈로그 `spec` 필드(추정값으로 우선 채움), GPU 조회·사양 판정 모듈
2. **US2 워커 독립 실행 + US6 사양 판정** — `crefleai-worker` CLI(GPU 지정·사양 판정·로드), 워커 `/internal/status`·키 검증
3. **US4 자가 등록** — 등록 토큰 API, `/api/workers/register·connect`, 주소 검증, 워커 agent·상태 파일, 상태 확인 루프
4. **US1·US3 라우팅** — `ModelPool`·대기열·직접 인계, `/v1` 라우터 경유, 오류 code, 호환 모드 local 인스턴스 등록
5. **관리자 화면** — 워커 화면, 모델 사양 표시·차단, 모니터링 확장
6. **US5 전환** — 배포 문서·워커 compose·롤백 절차, 실측 스크립트로 카탈로그 사양 실측값 반영
7. **검증** — quickstart 1~5단계, PR 본문에 결과 표

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 슬롯 반납 누락으로 워커가 영원히 "바쁨" | `Lease` 멱등 반납 + 모든 경로 `finally`, 상태 확인 시 워커 `in_flight`와 대조해 불일치 경고 로그, 단위 테스트로 취소·예외 경로 커버 |
| 비스트리밍 요청 취소 불가로 슬롯 점유가 길어짐 | 실제 워커 완료까지 슬롯 유지(R5). 대기 상한으로 사용자 대기 한정 |
| 같은 GPU 동시 기동 시 사양 판정 경합 | 운영 문서에 순차 기동 명시, 로드 실패는 등록 없이 종료(FR-039) |
| 사양 추정값 부정확 | 실측 스크립트로 17종 실측, 미측정은 `estimated` 표시·보수적 추정 |
| JWT 시크릿 교체 시 워커 전부 무효 | 문서화, 재등록 절차 안내 |
| 이미지의 CUDA 아키텍처(sm_120) 외 GPU 서버 | 워커가 세대 확인 후 실행 거부(명확한 메시지). 다중 아키텍처 빌드는 후속 과제 |

## Complexity Tracking

| 추가 복잡도 | 필요한 이유 | 더 단순한 대안을 택하지 않은 이유 |
|---|---|---|
| 호환 모드(로컬 워커)와 원격 워커 두 기동 경로 | 명세 Q2·FR-030: 기존 운영 방식 유지 | 일원화하면 전환 시 관리자 화면 모델 교체 기능을 잃음 |
| 등록 토큰 + 파생 워커 키 2단계 자격 증명 | 명세 Q1(runner식 자가 등록)·FR-021a~e·FR-024 | 공용 비밀 하나는 유출 시 교체 비용과 피해 범위가 큼(명세 결정) |
