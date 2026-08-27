---
name: crefleai-server-deploy
description: "CrefleAI를 doctordoom GPU 서버에 실제로 배포하는 절차 — 원자적 소스 전송, Docker 이미지 빌드/push, docker compose 재기동, 헬스체크·GPU 검증, 디렉터리 스왑 롤백. '서버에 배포해줘', 'doctordoom에 올려줘', 'v0.X.0 배포 진행', '배포 재개', '롤백해줘', '이전 버전으로 되돌려줘' 요청 시 사용. crefleai-deploy-executor 에이전트가 이 절차를 따른다."
---

# CrefleAI 서버 배포 절차 (doctordoom)

`crefleai-release` 스킬로 확정된 git 태그를 사내 GPU 서버에 실제로 올리는 절차. 2026-08-27 `v0.2.0 → v0.3.0` 수동 배포로 검증된 뒤, 리뷰에서 지적된 원자성·판정 정확성 문제를 고쳐 정리했다.

## 버전 표기 규칙 (혼동 주의)

이 문서에서 두 자리표시자는 **다르다**:

| 자리표시자 | 형식 | 예시 | 쓰이는 곳 |
|---|---|---|---|
| `<태그>` | `v` 접두어 있음 | `v0.3.0` | `git archive`, git 명령 |
| `<신규버전>` | `v` 없음 | `0.3.0` | 이미지 태그, `CREFLEAI_IMAGE_TAG`, `pyproject.toml` |

`deploy/.env.example`의 `CREFLEAI_IMAGE_TAG=0.1.0`처럼 이미지 태그는 `v` 없는 형식이 이 저장소의 규약이다(CLAUDE.md "버전 = 태그 = 이미지 태그 동기"). `<태그>`를 이미지 태그 자리에 그대로 넣지 않는다.

## 서버 정보

| 항목 | 값 |
|---|---|
| SSH | `ssh crefleai@doctordoom` (배포 전용 계정) |
| 배포 작업 디렉터리 | `/home/crefleai/app` (배포 중에는 `/home/crefleai/app.new`, 이전 릴리스는 `/home/crefleai/app.prev`) |
| Compose 파일 | `/home/crefleai/app/deploy/docker-compose.yml` |
| `.env` 위치 | `/home/crefleai/app/deploy/.env` (git 미추적 — 소스 전송 스크립트가 직접 이식한다) |
| 데이터 볼륨 | `/home/crefleai/data` → 컨테이너 `/app/data` (이미지 교체·디렉터리 스왑과 무관하게 유지됨) |
| 레지스트리 | `hub.crefle.com/crefle-ai/crefleai` |
| 서비스 확인 | `http://doctordoom:8000/` |

`doctordoom` 별칭은 각자의 로컬 `~/.ssh/config`에 설정되어 있어야 한다(내부망 호스트라 저장소에 IP를 하드코딩하지 않는다) — 별칭이 없으면 사용자에게 물어보거나, 사용자가 대화 중 알려준 주소를 이번 실행에 한해 사용한다.

## Phase 0: 현재 상태 확인

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose ps"
```

- 이미 대상 태그와 같은 버전이 `healthy`로 떠 있으면 재배포가 필요한지 사용자에게 먼저 확인한다.
- 현재 실행 중인 버전 문자열을 기록해둔다 — 롤백 보고에 필요하다.
- `/home/crefleai/app.new`가 이미 존재하면(이전 시도가 중단된 상태) 삭제 후 재시작한다 — Phase 1의 원자적 스크립트가 어차피 정리한다.

## Phase 1: 원자적 소스 전송 + `.env` 이식 + 이미지 태그 갱신

**핵심 설계:** 라이브 `/home/crefleai/app`은 스크립트 마지막 `mv` 한 번에만 바뀐다. 그 전 단계(추출, `.env` 복사, `sed` 치환)가 전부 `/home/crefleai/app.new`라는 임시 디렉터리에서만 일어나므로, 중간에 실패해도 서비스는 이전 버전 그대로 살아있다. 예전 방식(라이브 디렉터리를 `rm -rf`로 먼저 지우고 재추출)은 중간에 끊기면 서비스가 반쯤 지워진 상태로 남는 문제가 있었다 — 이번 구조는 그 문제를 없앤다.

```bash
git archive <태그> | ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom '
  set -e
  rm -rf /home/crefleai/app.new
  mkdir -p /home/crefleai/app.new
  tar -x -C /home/crefleai/app.new
  cp -p /home/crefleai/app/deploy/.env /home/crefleai/app.new/deploy/.env
  sed -i "s/^CREFLEAI_IMAGE_TAG=.*/CREFLEAI_IMAGE_TAG=<신규버전>/" /home/crefleai/app.new/deploy/.env
  rm -rf /home/crefleai/app.prev
  mv /home/crefleai/app /home/crefleai/app.prev
  mv /home/crefleai/app.new /home/crefleai/app
  echo TRANSFER_OK
'
```

`.env` 내용은 절대 `cat`하지 않는다 — `cp`로 이식하고 `sed`로 한 줄만 치환한다.

**이 스크립트의 `rm -rf`/`mv`는 Claude Code 자동 모드 분류기가 차단할 수 있다.** 대상이 라이브 서비스가 아니라 임시(`app.new`)·백업(`app.prev`) 디렉터리라는 점은 사용자에게 설명할 때 근거로 쓸 수 있지만, 그렇다고 우회를 시도하지 않는다 — 에이전트 정의(`crefleai-deploy-executor.md`)의 "권한 경계" 절차를 따라 사용자에게 정확한 명령을 제시하고 직접 실행해달라고 요청한다.

전송 후 반드시 검증한다 — "실행했다"는 말만 믿지 않는다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "grep -m1 version /home/crefleai/app/server/pyproject.toml && \
   grep '^CREFLEAI_IMAGE_TAG' /home/crefleai/app/deploy/.env"
# 기대값: version = "<신규버전>" / CREFLEAI_IMAGE_TAG=<신규버전>
```

## Phase 2: 이미지 빌드 (CUDA 빌드 — 시간이 걸림, 백그라운드로)

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "bash -lc 'set -o pipefail; docker build -f /home/crefleai/app/deploy/Dockerfile \
     -t hub.crefle.com/crefle-ai/crefleai:<신규버전> \
     -t hub.crefle.com/crefle-ai/crefleai:latest \
     /home/crefleai/app 2>&1 | tee /home/crefleai/build-<신규버전>.log; echo BUILD_EXIT:\$?'"
```

Bash `run_in_background: true`로 실행한다(10~30분 이상 걸릴 수 있음). CUDA 베이스 이미지 태그가 안 맞으면 `--build-arg CUDA_VERSION=<사용가능 태그>`가 필요할 수 있다(`deploy/README.md` 참조).

**빌드 성공을 로그 문자열이나 `BUILD_EXIT`만으로 판정하지 않는다.** 파이프라인(`| tee`) 뒤의 `$?`는 `pipefail` 없이는 `tee`의 종료 코드이지, `docker build`의 종료 코드가 아니다(위 명령은 `set -o pipefail`로 이를 고쳤다). 더 결정적인 문제는 **BuildKit(Docker 23+ 기본값)이 `Successfully tagged`를 아예 출력하지 않는다는 것** — 로그 문자열 매칭은 Docker 버전에 따라 항상 실패할 수 있다. 빌드 완료 알림을 받으면 반드시 아래로 이미지 존재 자체를 확인한다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "docker image inspect hub.crefle.com/crefle-ai/crefleai:<신규버전> >/dev/null 2>&1 && echo IMAGE_OK || echo IMAGE_MISSING"
```

`IMAGE_MISSING`이면 빌드 로그(`/home/crefleai/build-<신규버전>.log`) 마지막 부분을 확인해 원인을 보고하고, Phase 3으로 넘어가지 않는다.

## Phase 3: Push

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker push hub.crefle.com/crefle-ai/crefleai:<신규버전> && \
   docker push hub.crefle.com/crefle-ai/crefleai:latest && echo PUSH_OK"
```

## Phase 4: 재기동

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps"
```

## Phase 5: 헬스체크 대기

로컬에서 이 SSH 호출 자체는 Bash `run_in_background: true` 또는 `Monitor` 도구로 감싸 완료 알림을 받는다(수동 `sleep N && ssh ...` 체이닝은 하네스가 막는다). 원격 셸의 `until` 루프에는 **반드시 `timeout`을 씌운다** — 컨테이너가 없거나 이미 죽은 상태면 `docker inspect`가 계속 실패해 `$s`가 빈 문자열로 남고, 루프가 끝나지 않아 SSH가 무한 대기하게 된다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && \
   timeout 300 bash -c 'until s=\$(docker inspect --format=\"{{.State.Health.Status}}\" crefleai-crefleai-1 2>/dev/null); [ \"\$s\" = healthy ] || [ \"\$s\" = unhealthy ]; do sleep 2; done; echo HEALTH_STATUS:\$s' || echo HEALTH_TIMEOUT; \
   docker compose ps; \
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8000/"
```

`HEALTH_TIMEOUT`이나 `unhealthy`가 나오면 **자동으로 롤백하지 않는다** — `docker compose logs --tail 100`으로 원인을 확인해 보고하고, 사용자에게 롤백 여부를 확인한다.

## Phase 6: GPU 패스스루 검증

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker exec crefleai-crefleai-1 nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv"
```

NVML이 노출되지 않으면 관리자 `/admin/monitoring`의 GPU 카드만 "수집 불가"로 표시되고 나머지는 정상 동작한다(장애 아님) — 이 경우 호스트의 NVIDIA Container Toolkit·`gpus: all` 설정을 점검하도록 안내한다.

## 롤백 — 디렉터리 스왑 (compose 설정까지 함께 되돌림)

Phase 1에서 만들어진 `/home/crefleai/app.prev`는 **이전 릴리스의 소스 트리 전체**(당시의 `docker-compose.yml`, 당시의 `.env` 포함)다. 이미지 태그만 `.env`에서 되돌리면 "구버전 이미지 + 신버전 compose 설정"이 섞일 수 있으므로, 롤백은 디렉터리째 교체한다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom '
  set -e
  test -d /home/crefleai/app.prev || { echo NO_PREV_BUILD; exit 1; }
  mv /home/crefleai/app /home/crefleai/app.rolledback
  mv /home/crefleai/app.prev /home/crefleai/app
  cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps
'
```

- `/home/crefleai/app.prev`는 다음 배포의 Phase 1에서 덮어써지므로, **직전 릴리스 1단계까지만** 롤백 가능하다. 그보다 이전으로 돌아가려면 `git archive <이전 태그>`로 Phase 1부터 다시 실행한다.
- 데이터 볼륨(`/home/crefleai/data`)은 디렉터리 스왑과 무관하게 유지되므로 롤백 시 데이터 손실은 없다.
- `NO_PREV_BUILD`가 나오면(아직 한 번도 배포 안 했거나 이미 롤백해서 `app.prev`가 없음) 사용자에게 상황을 보고하고, 필요하면 `<이전 태그>`로 Phase 1부터 재실행하도록 안내한다.

## 최종 보고 형식

배포 완료 시 아래 항목을 표로 요약해 보고한다: 버전, 이미지 빌드 검증 결과(`IMAGE_OK`), push 결과, 헬스체크 결과, GPU 검증 결과, 롤백 방법(`app.prev` 존재 여부 포함). 브리핑 문서(`docs/reports/.../crefleai-release-briefing`) 체크리스트 중 이 스킬이 수행하지 않은 항목(예: 실모델 GGUF 서빙 스모크 테스트)이 있으면 명시적으로 "미수행"이라고 남긴다 — 조용히 생략하지 않는다.
