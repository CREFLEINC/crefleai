# CLAUDE.md

## 프로젝트

CrefleAI — 사내 GPU 서버에서 오픈 소스 LLM(GGUF)을 OpenAI 호환 API로 서비스하는 서버.

- `server/` — FastAPI 게이트웨이 + llama-cpp-python 추론 워커 (Python 3.11+, uv)
- `web/` — 관리자·Chat 화면 (Vite + React + TypeScript)
- `deploy/` — doctordoom 배포 구성 (docker-compose, `hub.crefle.com/crefle-ai/crefleai`)
- 설계·계획 문서: `docs/superpowers/`

## 작업 규칙 (필수)

1. **개발 업무는 반드시 별도의 워크트리에서 진행한다.** 단일 프로젝트 폴더에서 병렬 작업을 하기 위함이다. 작업 시작 시 워크트리를 만들어 격리한 뒤 진행한다.
2. **모든 변경 사항은 반드시 PR로 올린다.** 디폴트 브랜치(main)에 직접 푸시하지 않는다. 머지는 Squash를 기본으로 한다.
3. **개발 규칙은 `crefle-agent-skills:coding-rules` 스킬을 따른다.** 코드 작성·수정·리뷰 전에 해당 언어 규칙을 확인한다. 커밋은 Conventional Commits(한국어 제목 허용), 브랜치는 `<type>/<간단한-설명>`.

## 자주 쓰는 명령

```bash
# 백엔드
cd server && uv run pytest          # 테스트 (inference 마커는 기본 제외)
cd server && uv run ruff check .    # 린트

# 프론트엔드
cd web && npm test                  # vitest
cd web && npm run build             # 프로덕션 빌드
cd web && npm run dev               # 개발 서버 (localhost:8000 프록시)

# 실모델 통합 테스트 (소형 GGUF 필요)
CREFLEAI_TEST_GGUF=/path/to/tiny.gguf uv run pytest -m inference
```

## 배포

`deploy/README.md` 참조. 릴리스는 `server/pyproject.toml` 버전 = git 태그 `vX.Y.Z` = 이미지 태그 동기 (SemVer).

## 하네스: CrefleAI 배포 자동화

**목표:** 버전 확정(PR/태그)부터 doctordoom GPU 서버 실배포(빌드/push/재기동/검증)까지 전 과정을 에이전트가 재현 가능하게 수행.

**트리거:** 배포 관련 요청(배포해줘, 새 버전 배포, 릴리스 진행, doctordoom에 올려줘, 배포 재개, 롤백해줘 등) 시 `crefleai-deploy-orchestrator` 스킬을 사용하라. 버전 확인·서버 상태 확인 같은 단순 질문은 스킬 없이 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-08-27 | 초기 구성 (release-manager/deploy-executor 에이전트 + release/server-deploy/orchestrator 스킬) | 전체 | v0.2.0→v0.3.0 수동 배포 성공 후 재사용 가능하게 하네스화. 프로덕션 서버 대상 파괴적 명령(rm -rf, sudo)이 자동 모드 분류기에 차단되는 것을 전제로 설계 — 해당 단계는 사용자 승인/직접 실행이 필요 |
