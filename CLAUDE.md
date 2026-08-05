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
