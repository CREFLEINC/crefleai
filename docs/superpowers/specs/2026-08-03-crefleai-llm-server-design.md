# CrefleAI — 로컬 LLM 서비스 서버 설계

- 날짜: 2026-08-03
- 상태: 승인됨 (구현 계획 수립 전)
- 범위: 최소 기능(MVP) — 팀원들이 오픈 소스 모델에 쉽게 프롬프트를 전달하고 응답을 받을 수 있는 구조

## 1. 목적과 배경

오픈 소스 LLM 모델을 사내 로컬 서버(NVIDIA GPU 리눅스)에서 서비스하기 위한 서버 프로그램.
Ollama 같은 기존 오픈 소스를 그대로 쓰지 않고 서버 계층을 직접 개발한다.
단, 추론 커널은 llama.cpp(GGUF)를 라이브러리로 사용한다 — "직접 개발"의 범위는
서버·모델 관리·토큰 관리·API 계층이다.

## 2. 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| 추론 엔진 | llama.cpp — llama-cpp-python 바인딩, CUDA 빌드 |
| 서버 환경 | NVIDIA GPU 리눅스 서버 |
| 백엔드 | Python + FastAPI |
| 프론트엔드 | Vite + React + TypeScript SPA |
| 모델 목록 | 내장 카탈로그 (catalog.json) |
| 동시 서비스 모델 | 1개 (관리자가 선택) |
| 프로세스 구조 | 게이트웨이 + 추론 워커 서브프로세스 |
| 데이터 저장 | SQLite 단일 파일 |
| 사용자 API | OpenAI Chat Completions 표준 호환 |
| 사용자 토큰 | JWT HS256, 만료 없음, allowlist로 폐기 관리 |

## 3. 아키텍처

```
┌───────────────────────────────┐
│  FastAPI 게이트웨이 (:8000)      │  ← 유일한 외부 노출 프로세스
│  · OpenAI 호환 API (/v1/*)     │
│  · 관리자 API (/admin/*)        │
│  · React SPA 정적 서빙          │
│  · 워커 생명주기 관리             │
└──────────────┬────────────────┘
    스폰/헬스체크 │ localhost HTTP
┌──────────────┴────────────────┐
│  추론 워커 (:8001, localhost)   │  ← 게이트웨이가 스폰하는 서브프로세스
│  · llama-cpp-python (CUDA)    │
│  · GGUF 모델 1개 로드           │
│  · 모델 교체 = 프로세스 재시작     │
└───────────────────────────────┘
```

워커를 서브프로세스로 분리하는 이유:
- 모델 교체 시 프로세스 종료로 VRAM을 OS 수준에서 확실히 회수
  (llama-cpp-python 인프로세스 언로드는 VRAM 잔존 문제가 보고됨)
- 추론 장애가 관리자 화면·토큰 관리에 전파되지 않음

## 4. 저장소 구조

```
crefleai/
├── server/                      # Python 백엔드 (uv + pyproject.toml)
│   ├── src/crefleai/
│   │   ├── main.py              # 게이트웨이 앱 엔트리
│   │   ├── config.py            # 환경변수 기반 설정
│   │   ├── db.py                # SQLite
│   │   ├── auth/                # JWT 발급·검증, 관리자 인증
│   │   ├── api/                 # v1(OpenAI 호환) + admin 라우터
│   │   ├── models/              # 카탈로그, 다운로더, 워커 매니저
│   │   └── worker/              # 추론 워커 (python -m crefleai.worker)
│   └── tests/
├── web/                         # React SPA
│   └── src/
│       ├── admin/               # 로그인, 모델 관리, 토큰 관리
│       └── chat/                # chat 테스트 화면
└── docs/
```

런타임 데이터 디렉터리(`CREFLEAI_DATA_DIR`, 기본 `./data`):
- `data/crefleai.db` — SQLite
- `data/models/` — 다운로드된 GGUF 파일

## 5. 인증과 토큰

### 5.1 사용자 토큰 (JWT HS256)

페이로드:

```json
{
  "sub": "홍길동",
  "purpose": "웹앱 프로토타입 테스트",
  "iat": 1754200000,
  "jti": "a1b2c3..."
}
```

- `exp` 없음 — 관리자가 정지시킬 때까지 유효
- **allowlist 방식**: 생성 시 `jti`를 `tokens` 테이블에 기록.
  요청마다 ① HS256 서명 검증 ② `jti`가 DB에 존재하고 미폐기인지 확인.
  관리자가 폐기하면 즉시 무효화된다.
- JWT 원문은 DB에 저장하지 않고 생성 직후 응답에서 한 번만 반환 (API key 관행)
- 서명 시크릿: `CREFLEAI_JWT_SECRET` 환경변수. 미설정 시 기동 실패.

### 5.2 관리자 인증

- `admins` 테이블: 아이디 + bcrypt 해시 비밀번호
- 최초 기동 시 계정이 없으면 `CREFLEAI_ADMIN_ID` / `CREFLEAI_ADMIN_PASSWORD`로 생성
- 로그인 성공 시 만료 12시간의 관리자 세션 JWT를 HTTP-only 쿠키로 발급
- 관리자 세션 JWT는 동일한 `CREFLEAI_JWT_SECRET`으로 서명하되 `scope: "admin"`
  클레임으로 사용자 토큰과 구분한다. `/admin/*` 검증은 `scope: "admin"`을 요구하고,
  `/v1/*` 검증은 allowlist(`jti`가 `tokens` 테이블에 존재)를 요구하므로 두 토큰은
  상호 교차 사용이 불가능하다.
- `/admin/*` API는 이 쿠키로 보호. 사용자 토큰과 완전히 분리된 경로.
- 비밀번호 변경 등 부가 기능은 다음 개발 범위.

### 5.3 DB 스키마 (SQLite)

```sql
tokens  (jti PK, user_name, purpose, created_at, revoked_at NULL)
admins  (id PK, username UNIQUE, password_hash, created_at)
settings(key PK, value)   -- 예: serving_model = "qwen3-8b-q4"
```

## 6. API 설계

### 6.1 사용자 API — OpenAI 호환 (`/v1/*`)

인증: `Authorization: Bearer <JWT>`. `openai` SDK에서 `base_url`만 바꾸면 동작해야 한다.

| 엔드포인트 | 설명 |
|---|---|
| `POST /v1/chat/completions` | 채팅 완성. `stream: true` 시 SSE 스트리밍 |
| `GET /v1/models` | 서비스 중인 모델 목록 (0개 또는 1개) |

- 지원 파라미터: `model`, `messages`, `temperature`, `top_p`, `max_tokens`, `stop`, `stream`
- 응답에 `usage`(prompt/completion/total tokens) 포함
- 에러는 OpenAI 형식 `{"error": {"message", "type", "code"}}`
  - 무효/폐기 토큰: 401
  - 서비스 중인 모델 없음: 503
  - 존재하지 않는 `model` 지정: 404

### 6.2 관리자 API (`/admin/*`, 쿠키 세션 보호)

| 엔드포인트 | 설명 |
|---|---|
| `POST /admin/login`, `POST /admin/logout` | 로그인/로그아웃 |
| `GET /admin/models` | 카탈로그 + 상태(미다운로드/다운로드 중(진행률)/준비됨/서비스 중) |
| `POST /admin/models/{id}/download` | 백그라운드 다운로드 시작 |
| `POST /admin/models/{id}/serve` | 서비스 모델 선택 → 워커 교체 |
| `GET /admin/tokens` | 토큰 목록 (이름·목적·생성일·상태) |
| `POST /admin/tokens` | 토큰 생성. JWT 원문은 이 응답에서 1회만 반환 |
| `DELETE /admin/tokens/{jti}` | 토큰 폐기 (즉시 무효화) |

### 6.3 워커 내부 API (localhost 전용)

| 엔드포인트 | 설명 |
|---|---|
| `POST /completion` | 게이트웨이가 전달한 chat completion 수행 (스트리밍 포함) |
| `GET /health` | 모델 로드 완료 여부 |

### 6.4 동시성 정책

워커는 요청을 큐에 넣고 **한 번에 하나씩** 처리한다. 병렬 배칭은 다음 단계 과제.

## 7. 모델 관리

- **카탈로그**: `catalog.json` 내장. 필드: `id`, `display_name`, `hf_repo`,
  `filename`(GGUF), `quantization`, `size_bytes`, `context_length`, `license`,
  `description`. 초기 목록은 한국어 성능과 GPU 메모리를 고려해 구현 시점에 확정
  (Qwen3, EXAONE, Gemma 3, Llama 3.x 계열 Q4_K_M 후보).
- **다운로드**: `huggingface_hub`로 백그라운드 다운로드. 진행률은 관리자 화면이
  `GET /admin/models` 폴링으로 표시. 실패 시 부분 파일 정리 후 `failed` 상태,
  재시도 가능.
- **서비스 교체**: `serve` 요청 → 기존 워커 graceful 종료 → 새 워커 스폰
  → `/health` 폴링으로 로드 확인 → `settings.serving_model` 갱신.
- **복원**: 게이트웨이 기동 시 `settings.serving_model`을 읽어 워커 자동 시작.
- **장애 복구**: 워커 비정상 종료 감지 시 자동 재시작 (최대 3회, 이후 관리자
  화면에 오류 표시).
- 모델 파일 삭제 기능은 다음 개발 범위.

## 8. 프론트엔드

- **관리자 화면**: 로그인 → 모델 관리 탭(카탈로그 목록, 상태 배지, 다운로드/서비스
  버튼, 진행률 바) + 토큰 관리 탭(목록, 이름·목적 생성 폼, 생성 직후 JWT 1회 표시
  모달 + 복사 버튼, 폐기 버튼)
- **Chat 테스트 화면**: 토큰 입력(localStorage 보관) 후 대화. SSE 스트리밍 표시,
  system prompt·temperature 조절. 접근 제한 없음 (사내망 네트워크단 필터링 전제,
  단 API 호출에는 토큰 필요).
- 빌드 결과물은 게이트웨이가 정적 서빙 — 배포 대상은 서버 하나.

## 9. 에러 처리

| 상황 | 동작 |
|---|---|
| 서비스 모델 없음 | 503 + OpenAI 에러 형식 |
| 워커 다운/타임아웃 | 502, 자동 재시작 시도, 관리자 화면에 상태 표시 |
| 무효/폐기 토큰 | 401 |
| 다운로드 실패 | `failed` 상태 + 메시지, 재시도 가능 |
| 게이트웨이 재시작 | `serving_model` 설정 읽어 워커 자동 복원 |

## 10. 테스트 전략

- 백엔드는 pytest로 TDD 진행:
  - 인증: JWT 발급/검증/폐기, allowlist 동작
  - 관리자 API: 로그인, 토큰 CRUD
  - `/v1` API: 스키마·에러 (워커 mock)
  - 워커 매니저: 스폰/교체/장애 복구 (fake 프로세스)
  - 다운로더: 진행률/실패 처리 (HF mock)
- 실 GPU 추론: 초소형 GGUF로 별도 marker의 통합 테스트 (CI 기본 제외)
- 프론트엔드: 핵심 흐름 스모크 테스트 (vitest + testing-library)

## 11. 다음 개발 범위 (이번 범위 제외)

- 관리자 비밀번호 변경, 다운로드한 모델 파일 삭제
- 복수 모델 동시 서비스, 병렬 배칭
- Hugging Face 실시간 검색
- 사용자 정보/계정 체계
