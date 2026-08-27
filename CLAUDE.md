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
| 2026-08-27 | PR #43 리뷰 반영: 소스 전송을 임시 디렉터리 경유 원자적 스왑(+`.env` 이식 통합)으로 재설계, 빌드 성공 판정을 `docker image inspect` 기반으로 교체(BuildKit 로그 미출력·`pipefail` 누락 버그 수정), 헬스체크 루프에 `timeout` 추가, 롤백을 디렉터리 스왑 방식으로 변경, 워크트리 경로를 `.claude/worktrees/`로 통일, `git branch -d`→`-D`, PR 본문 헤더 한글화 | crefleai-server-deploy, crefleai-release, crefleai-deploy-executor, crefleai-deploy-orchestrator | 리뷰에서 Major 1건(빌드 성공 오판정)·Minor 6건 발견 — 실배포 전에 절차 자체의 정확성을 먼저 검증 |
| 2026-08-27 | 재리뷰 반영: 추출→빌드→스왑 순서를 재구성해 `.env`가 Docker 빌드 컨텍스트에 아예 들어가지 않게 함, 스왑 실패 시 자동 복구하는 ERR 트랩 추가(+Phase 0 중단 감지), 빌드 판정에서 SSH 종료 코드로 `pipefail` 결과를 전파(재빌드 실패 시 기존 동일 태그 이미지로 오판하던 버그 수정), SemVer 판단이 커밋 본문(`%b`)까지 보게 함, `git checkout main`을 `origin/main` 직접 태그로 대체(워크트리 충돌 회피), `deploy/README.md`가 새 하네스를 가리키도록 갱신. 리뷰가 제기한 "SendMessage는 실험 플래그 필요" 주장은 공식 문서로 반박하고 그대로 유지 | crefleai-server-deploy, crefleai-release, crefleai-deploy-executor, crefleai-deploy-orchestrator, deploy/README.md | Major 4건 중 3건 실검증 후 반영(1건은 사실과 달라 반박), Minor 3건 반영 |
| 2026-08-27 | 3차 리뷰 반영: `.env` 이식을 스왑 직후에서 스왑 직전(`app.new`, 아직 라이브 아님)으로 옮겨 스왑을 순수 `mv` 두 번만 남김(이식 실패가 트랩의 "app 없음" 조건을 못 걸던 구멍 제거), release 스킬의 모든 git 명령에 `git -C <워크트리경로>` 적용 + `gh pr create`에 `--base`/`--head` 명시(Bash 호출 간 cwd 미유지로 PR이 main에서 생성되던 버그 수정), 롤백 스크립트가 `app.rolledback`을 매번 `rm -rf`로 정리하도록 수정(누적 시 "Directory not empty"로 긴급 롤백이 막히던 버그 수정) | crefleai-server-deploy, crefleai-release, crefleai-deploy-orchestrator | Major 3건 모두 실검증(로컬 재현 포함) 후 반영 — 리뷰가 제기했던 SendMessage Major는 공식 문서 재확인 후 철회됨 |
| 2026-08-27 | 4차 리뷰 반영: 태그 생성 기준을 `origin/main` HEAD에서 머지한 PR의 정확한 merge SHA(`gh pr view --json mergeCommit`)로 변경 — 버전 문자열만 확인하고 HEAD를 태깅하면, 머지 직후 `pyproject.toml`을 안 건드리는 다른 PR이 먼저 들어왔을 때 그 커밋까지 릴리스에 포함되는 경합을 문자열 비교로 못 잡던 문제를 해소. 에이전트 정의의 stale `git pull` 에러 처리 문구도 SHA 기반 검사로 교체 | crefleai-release, crefleai-release-manager | Major 1건 실검증 후 반영 |
