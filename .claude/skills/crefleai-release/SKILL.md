---
name: crefleai-release
description: "CrefleAI 저장소의 릴리스 버전 확정 절차 — 미태그 커밋 분석, SemVer 판단, 워크트리에서 버전 범프, PR 생성/머지, git tag 생성·push. '버전 범프', '릴리스 버전 확정', '태그 만들어줘', 'PR 머지하고 태그 찍어줘' 요청 시 사용. crefleai-release-manager 에이전트가 이 절차를 따른다."
---

# CrefleAI 릴리스 버전 확정 절차

CrefleAI(`server/pyproject.toml`의 버전 = git 태그 `vX.Y.Z` = 배포 이미지 태그, SemVer)의 다음 릴리스 버전을 확정하고 태그를 만드는 절차. 실제 서버 배포는 다루지 않는다 — 그건 `crefleai-server-deploy` 스킬의 영역이다.

## Phase 0: 현재 상태 확인

이 절차는 항상 라이브 상태를 조회하는 것으로 시작한다. 로컬 캐시나 이전 실행 기록을 신뢰하지 않는다 — 저장소는 git 명령으로, 서버는 SSH로 직접 조회한 값만 사실로 취급한다.

```bash
git fetch origin -q
git describe --tags --abbrev=0 origin/main   # 최근 태그
git log <최근태그>..origin/main --oneline    # 태그 이후 미배포 커밋
grep -m1 version server/pyproject.toml       # 로컬(main) 현재 버전 문자열
```

- 미배포 커밋이 없으면: 이미 최신이라고 보고하고 종료 (범프 불필요).
- 이미 해당 브랜치/PR이 열려 있으면(예: `gh pr list --search "chore/bump-version"`), 중복 생성하지 않고 기존 PR 상태를 보고한다.

## Phase 1: SemVer 판단

미배포 커밋들을 Conventional Commits 접두어로 분류해 범프 종류를 제안한다:

| 커밋 패턴 | 범프 종류 |
|---|---|
| `feat:`, `feat(...)`(기능 추가) 포함, breaking 없음 | minor |
| `fix:`만 있고 `feat:` 없음 | patch |
| 커밋 본문에 `BREAKING CHANGE` 또는 제목에 `!` | major |
| `docs:`, `chore:`만 있음 | 배포할 코드 변경이 없다는 뜻 — 사용자에게 정말 배포가 필요한지 먼저 확인 |

제안 근거(포함된 PR 번호와 커밋 요약)를 사용자에게 제시하고 버전을 확정받는다. 이미 사용자가 버전을 지정했다면 이 단계를 건너뛴다.

## Phase 2: 워크트리에서 버전 범프

CLAUDE.md 규칙(워크트리 격리, main 직접 푸시 금지)에 따라 반드시 별도 워크트리에서 작업한다.

```bash
git worktree add ../crefleai-bump-vX.Y.Z -b chore/bump-version-X.Y.Z origin/main
```

`server/pyproject.toml`의 `version = "..."` 줄만 새 버전으로 수정한다. 다른 파일(README 예시 등)은 건드리지 않는다 — 문서 예시일 뿐 실제 버전 참조가 아니다.

```bash
cd ../crefleai-bump-vX.Y.Z
git add server/pyproject.toml
git commit -m "chore: 릴리스 버전 X.Y.Z로 범프

<이번 릴리스에 포함되는 주요 변경 1~2줄 요약, 관련 PR 번호>"
git push -u origin chore/bump-version-X.Y.Z
```

## Phase 3: PR 생성

```bash
gh pr create --title "chore: 릴리스 버전 X.Y.Z로 범프" --body "$(cat <<'EOF'
## Summary
- <이번 릴리스에 포함된 변경 요약 + 관련 PR 번호 나열>

## Test plan
- [x] 버전 문자열만 변경, 동작 영향 없음
EOF
)"
```

## Phase 4: 머지 (사용자 승인 후에만)

이 저장소는 GitHub Actions가 없어 사람의 확인이 유일한 검증 단계다. **사용자가 명시적으로 머지를 승인한 경우에만** 진행한다:

```bash
gh pr merge <PR번호> --squash
```

승인이 없으면 PR URL만 보고하고 멈춘다.

## Phase 5: 태그 생성·push

머지 확인 후 로컬 main을 갱신하고 태그한다.

```bash
git checkout main && git pull origin main
grep -m1 version server/pyproject.toml   # 범프가 실제로 반영됐는지 확인
git tag vX.Y.Z
git push origin vX.Y.Z
```

## Phase 6: 정리

```bash
git worktree remove ../crefleai-bump-vX.Y.Z
git branch -d chore/bump-version-X.Y.Z   # 원격 브랜치는 보통 squash 머지 시 자동 삭제됨
```

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| PR 브랜치가 이미 존재 | 기존 브랜치/PR 상태를 먼저 확인, 재사용하거나 사용자에게 확인 |
| 머지 후 `git pull`이 fast-forward가 아님 | 다른 변경이 먼저 들어온 것 — 강제로 정리하지 않고 사용자에게 보고 |
| 태그가 이미 존재 | 덮어쓰지 않는다 (`git tag -f`는 배포 이력을 혼란스럽게 만든다) — 사용자에게 확인 |
| 미배포 커밋이 `docs:`/`chore:`뿐 | 배포 필요성 자체를 사용자에게 재확인 |

## 다음 단계

태그 push까지 끝나면 `crefleai-server-deploy` 스킬(또는 `crefleai-deploy-executor` 에이전트)로 넘어가 실제 서버 배포를 진행한다. 이 스킬 단독으로는 서버에 아무 영향도 주지 않는다.
