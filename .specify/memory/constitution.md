# CrefleAI Constitution

## Core Principles

### I. 작업 격리

- spec-kit 준비·도구 설정처럼 제품 코드를 바꾸지 않는 비개발 설정은 메인 체크아웃에서
  진행할 수 있다.
- 이슈 해결(명세 → 계획 → 작업 분해 → 구현 → 검증)은 MUST `.claude/worktrees/` 아래
  별도 워크트리에서 진행한다. 브랜치 이름은 `<type>/<간단한-설명>` 형식을 따른다.
- `/speckit-specify`는 MUST 해당 워크트리 안에서 실행해, 기능 상태(`.specify/feature.json`)가
  워크트리별로 분리되게 한다.
- spec-kit git 확장(`001-xxx` 자동 브랜치 생성)은 MUST NOT 설치한다 — 팀 브랜치 규칙과 충돌한다.

근거: 한 프로젝트 폴더에서 여러 작업을 병렬로 진행하고, 미완성 작업이 메인 체크아웃을
오염시키지 않게 하기 위함이다.

### II. PR 기반 변경

- 모든 변경은 MUST PR로 올린다. `main`에 직접 푸시하지 않는다.
- 머지는 Squash를 기본으로 한다.
- 커밋 메시지는 MUST Conventional Commits를 따른다(한국어 제목 허용).

근거: 저장소에 CI가 없어 PR 리뷰가 사람이 개입하는 유일한 검증 지점이다.

### III. 코딩 규칙 준수

- 코드 작성·수정·리뷰 전에 MUST `crefle-agent-skills:coding-rules` 스킬에서 해당 언어
  규칙을 확인하고 따른다.
- 주변 코드의 명명·주석 밀도·관용구와 일관되게 작성한다.

근거: 팀 표준을 한 곳에서 관리해 에이전트와 사람이 같은 기준으로 작성·리뷰하게 한다.

### IV. OpenAI 호환 API 계약 유지

- `/v1` 아래 외부 API(`GET /v1/models`, `POST /v1/chat/completions`)의 요청·응답 형식은
  MUST NOT 하위 호환을 깨는 방식으로 바꾼다.
- 오류 응답은 MUST `{"error": {"message", "type", "code"}}` 형식을 유지한다.
- 지원하지 않는 OpenAI 파라미터·엔드포인트는 MUST 명세(spec.md)에 명시한다. 조용히 무시되는
  동작을 새로 추가할 때도 마찬가지다.

근거: 사내 클라이언트가 `openai` SDK로 그대로 접속하는 것이 이 서비스의 핵심 가치다.

### V. 검증 필수 (NON-NEGOTIABLE)

- PR 전에 MUST 로컬에서 다음을 통과시킨다.
  - 백엔드: `cd server && uv run pytest`, `uv run ruff check .`
  - 프론트엔드: `cd web && npm test`, `npm run build`
- 근사치·임계값·휴리스틱 상수는 MUST 실측으로 검증하고, 안전 지표는 보수적인 쪽으로 잡는다.
- 실모델 추론에 영향을 주는 변경은 `CREFLEAI_TEST_GGUF=<경로> uv run pytest -m inference`를
  실행하거나, 실행하지 못했다면 PR에 "미수행"으로 명시한다.
- 기능이 PR 설명대로 동작하는지뿐 아니라, 이슈의 목적을 실제로 달성하는지까지 확인한다.

근거: CI가 없으므로 `mergeStateStatus: CLEAN`은 테스트 통과를 뜻하지 않는다.

## 운영 안전

- 시크릿(`.env`, `CREFLEAI_JWT_SECRET`, 관리자 비밀번호, 사용자 토큰)은 MUST NOT 저장소,
  Docker 빌드 컨텍스트, 로그, 명세 문서에 포함한다.
- doctordoom 배포는 MUST `crefleai-deploy-orchestrator` 하네스로 수행한다. 수동 절차는 하네스를
  쓸 수 없을 때의 대안으로만 쓴다.
- 릴리스 버전은 `server/pyproject.toml` 버전 = git 태그 `vX.Y.Z` = 이미지 태그로 동기화한다(SemVer).
- 운영 서버 대상 파괴적 명령은 사용자 승인 또는 사용자 직접 실행을 거친다.

## 명세·문서 워크플로

- 새 기능 명세는 `specs/NNN-이름/`(spec.md, plan.md, tasks.md)에 둔다.
- 기존 `docs/superpowers/` 설계·계획 문서는 참고 자료로 유지하며, 새 명세에서 필요한 내용을
  인용·참조한다.
- spec·plan·tasks 등 산출물은 MUST 한국어로 작성한다. 코드 식별자·명령어·경로는 원문을 유지한다.
- 기본 순서: `/speckit-specify` → (`/speckit-clarify`) → `/speckit-plan` → (`/speckit-checklist`)
  → `/speckit-tasks` → (`/speckit-analyze`) → `/speckit-implement` → `/speckit-converge` → 검증 → PR.

## Governance

- 이 헌법은 spec-kit 산출물 작성 시 다른 관행보다 우선한다. 저장소 운영 규칙의 원본은
  `CLAUDE.md`이며, 둘이 어긋나면 같은 PR에서 함께 고친다.
- 개정은 PR로 제안하고 사용자 승인 후 머지한다. 개정 PR에는 변경 이유와 영향 범위를 적는다.
- 버전 정책(SemVer): 원칙 삭제·재정의는 MAJOR, 원칙·섹션 추가나 실질적 확장은 MINOR,
  문구 정리는 PATCH.
- PR 리뷰는 이 헌법 준수 여부를 확인하며, 원칙을 벗어나는 복잡도는 plan.md에 근거를 남긴다.

**Version**: 0.1.0 | **Ratified**: 2026-11-09 | **Last Amended**: 2026-11-09
