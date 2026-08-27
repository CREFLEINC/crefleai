---
name: crefleai-server-deploy
description: "CrefleAI를 doctordoom GPU 서버에 실제로 배포하는 절차 — 추출/빌드/스왑 분리, `.env`를 빌드 컨텍스트에서 배제, Docker 이미지 빌드/push, docker compose 재기동, 헬스체크·GPU 검증, 디렉터리 스왑 롤백(자동 복구 포함). '서버에 배포해줘', 'doctordoom에 올려줘', 'v0.X.0 배포 진행', '배포 재개', '롤백해줘', '이전 버전으로 되돌려줘' 요청 시 사용. crefleai-deploy-executor 에이전트가 이 절차를 따른다."
---

# CrefleAI 서버 배포 절차 (doctordoom)

`crefleai-release` 스킬로 확정된 git 태그를 사내 GPU 서버에 실제로 올리는 절차. 2026-08-27 `v0.2.0 → v0.3.0` 수동 배포로 검증된 뒤, 두 차례 리뷰에서 지적된 원자성·판정 정확성·시크릿 격리 문제를 고쳐 정리했다.

## 버전 표기 규칙 (혼동 주의)

이 문서에서 두 자리표시자는 **다르다**:

| 자리표시자 | 형식 | 예시 | 쓰이는 곳 |
|---|---|---|---|
| `<태그>` | `v` 접두어 있음 | `v0.3.0` | `git archive`, git 명령 |
| `<신규버전>` | `v` 없음 | `0.3.0` | 이미지 태그, `CREFLEAI_IMAGE_TAG`, `pyproject.toml` |

`deploy/.env.example`의 `CREFLEAI_IMAGE_TAG=0.1.0`처럼 이미지 태그는 `v` 없는 형식이 이 저장소의 규약이다(CLAUDE.md "버전 = 태그 = 이미지 태그 동기"). `<태그>`를 이미지 태그 자리에 그대로 넣지 않는다.

## 설계 원칙: 빌드는 `.env` 없이, 스왑은 빌드 성공 후에만

이전 버전은 `.env`를 `app.new`에 먼저 이식한 뒤 그 디렉터리로 이미지를 빌드했다 — 이러면 `docker build`가 `app.new` 전체를 빌드 컨텍스트로 데몬에 전송하는 과정에서, 최종 이미지에 `COPY`되지 않더라도 JWT secret·관리자 비밀번호가 담긴 `.env`가 빌드 컨텍스트·캐시에 노출된다(저장소에 루트 `.dockerignore`가 없다). 이번 구조는 순서를 바꿔 이 노출 자체를 없앤다:

1. **추출** (Phase 1) — `git archive` 내용만 `app.new`에 푼다. `.env`는 아직 등장하지 않는다.
2. **빌드·push** (Phase 2~3) — `app.new`를 빌드 컨텍스트로 쓴다. `.env`가 존재하지 않으므로 컨텍스트에 포함될 수가 없다. 빌드가 실패해도 라이브 `/home/crefleai/app`은 전혀 건드리지 않는다.
3. **`.env` 이식** (Phase 4) — 빌드·push가 끝난 뒤, **아직 스왑 전인 `app.new`**에 `.env`를 옮기고 태그를 치환·검증한다. 실패해도 `app.new`는 아직 라이브가 아니므로 서비스는 영향받지 않는다.
4. **스왑** (Phase 5) — 준비가 전부 끝난 뒤 `mv` 두 번으로만 라이브 디렉터리를 교체한다. 실패 가능한 작업(추출·빌드·`.env` 이식)을 스왑 앞에 전부 끝내 놓았으므로, 스왑 자체는 실패할 거리가 두 `mv` 사이의 순간적인 창(트랩으로 복구)뿐이다.

(이전 버전은 `.env` 이식을 스왑 **뒤**에 했다 — `cp`/`sed`가 실패하면 라이브 `app`이 이미 새 디렉터리로 바뀐 뒤라 복구 트랩의 "app이 없을 때만 복구" 조건이 걸리지 않아, `.env`가 없는 반쯤 배포된 상태로 남는 문제가 있었다. 로컬에서 재현 후 순서를 바꿔 고쳤다.)

## 서버 정보

| 항목 | 값 |
|---|---|
| SSH | `ssh crefleai@doctordoom` (배포 전용 계정) |
| 배포 작업 디렉터리 | `/home/crefleai/app` (배포 중에는 `/home/crefleai/app.new`, 이전 릴리스는 `/home/crefleai/app.prev`) |
| Compose 파일 | `/home/crefleai/app/deploy/docker-compose.yml` |
| `.env` 위치 | `/home/crefleai/app/deploy/.env` (git 미추적 — Phase 4에서 `app.new`로 이식 후 Phase 5 스왑으로 라이브 반영) |
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
- `/home/crefleai/app.new`가 이미 존재하면(이전 시도가 중단된 상태) 삭제 후 재시작한다 — Phase 1이 어차피 정리한다.
- **`/home/crefleai/app`이 없고 `/home/crefleai/app.prev`만 있으면, 직전 배포의 Phase 5 스왑이 중간에 끊긴 것이다.** 이 경우 먼저 복구한다:
  ```bash
  ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
    "mv /home/crefleai/app.prev /home/crefleai/app"
  ```
  복구 후 사용자에게 이전 시도가 중단됐음을 보고하고, Phase 1부터 다시 시작한다.

## Phase 1: 소스 추출 (`.env` 미포함)

```bash
git archive <태그> | ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom '
  set -e
  rm -rf /home/crefleai/app.new
  mkdir -p /home/crefleai/app.new
  tar -x -C /home/crefleai/app.new
  echo EXTRACT_OK
'
```

**이 스크립트의 `rm -rf`는 Claude Code 자동 모드 분류기가 차단할 수 있다.** 대상이 라이브 서비스가 아니라 임시 디렉터리(`app.new`)라는 점은 사용자에게 설명할 때 근거로 쓸 수 있지만, 그렇다고 우회를 시도하지 않는다 — 에이전트 정의(`crefleai-deploy-executor.md`)의 "권한 경계" 절차를 따라 사용자에게 정확한 명령을 제시하고 직접 실행해달라고 요청한다.

추출 후 반드시 검증한다 — "실행했다"는 말만 믿지 않는다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "grep -m1 version /home/crefleai/app.new/server/pyproject.toml"
# 기대값: version = "<신규버전>"
```

## Phase 2: 이미지 빌드 (`app.new` 컨텍스트 — `.env` 없음, CUDA 빌드라 시간이 걸림, 백그라운드로)

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "bash -lc 'set -o pipefail; docker build -f /home/crefleai/app.new/deploy/Dockerfile \
     -t hub.crefle.com/crefle-ai/crefleai:<신규버전> \
     -t hub.crefle.com/crefle-ai/crefleai:latest \
     /home/crefleai/app.new 2>&1 | tee /home/crefleai/build-<신규버전>.log; \
     ec=\$?; echo BUILD_EXIT:\$ec; exit \$ec'"
```

Bash `run_in_background: true`로 실행한다(10~30분 이상 걸릴 수 있음). CUDA 베이스 이미지 태그가 안 맞으면 `--build-arg CUDA_VERSION=<사용가능 태그>`가 필요할 수 있다(`deploy/README.md` 참조).

**빌드 성공 판정은 두 단계로 나눈다 — 어느 한쪽만 보지 않는다:**

1. **이 SSH 호출 자체의 종료 코드를 먼저 본다.** `ec=$?; echo BUILD_EXIT:$ec; exit $ec`로 파이프라인(`docker build | tee`)의 실제 종료 코드를 캡처해 로그에 남긴 **뒤에도** 그 코드로 `bash -lc`를 종료시킨다 — 그냥 `set -eo pipefail`만 쓰면 실패 시 `echo`가 아예 실행되지 않아 로그에 완료 표시가 안 남고, 반대로 `echo`로 끝내기만 하면(이전 버전의 버그) `echo`가 마지막 명령이 되어 SSH 호출 자체는 항상 0으로 끝나버린다. 이 SSH 호출의 종료 코드가 0이 아니면 **빌드는 실패한 것이다.**
2. 종료 코드가 0일 때만 아래로 이미지 존재를 재확인한다. **종료 코드가 0이 아니면 아래 확인을 생략하고 곧바로 실패로 처리한다** — 재빌드 실패 시 동일 태그의 예전 이미지가 레지스트리/로컬에 이미 남아 있으면 `docker image inspect`가 `IMAGE_OK`를 반환할 수 있기 때문이다(오래된 이미지를 새 빌드로 착각하는 함정).

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "docker image inspect hub.crefle.com/crefle-ai/crefleai:<신규버전> >/dev/null 2>&1 && echo IMAGE_OK || echo IMAGE_MISSING"
```

빌드가 실패했으면(1번 기준) 빌드 로그(`/home/crefleai/build-<신규버전>.log`) 마지막 부분을 확인해 원인을 보고하고, Phase 3으로 넘어가지 않는다. 이 시점까지 라이브 `/home/crefleai/app`은 전혀 바뀌지 않았으므로 서비스에는 영향이 없다.

## Phase 3: Push

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker push hub.crefle.com/crefle-ai/crefleai:<신규버전> && \
   docker push hub.crefle.com/crefle-ai/crefleai:latest && echo PUSH_OK"
```

## Phase 4: `.env` 이식 + 이미지 태그 갱신 (아직 `app.new` — 라이브 아님)

**스왑 전에 실패 가능성이 있는 작업을 전부 끝낸다.** `.env` 이식·치환은 여전히 임시 디렉터리(`app.new`)에서 하므로, 여기서 실패해도 라이브 `/home/crefleai/app`은 손대지 않은 채 그대로 남는다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cp -p /home/crefleai/app/deploy/.env /home/crefleai/app.new/deploy/.env && \
   sed -i 's/^CREFLEAI_IMAGE_TAG=.*/CREFLEAI_IMAGE_TAG=<신규버전>/' /home/crefleai/app.new/deploy/.env && \
   grep '^CREFLEAI_IMAGE_TAG' /home/crefleai/app.new/deploy/.env"
# 기대값: CREFLEAI_IMAGE_TAG=<신규버전>
```

`.env` 내용은 절대 `cat`하지 않는다 — `cp`로 이식하고 `sed`로 한 줄만 치환한다. 원본(`/home/crefleai/app/deploy/.env`)은 이 시점에도 여전히 라이브 서비스가 쓰고 있는 파일이므로 읽기만 하고 건드리지 않는다.

## Phase 5: 스왑

이제 남은 건 `mv` 두 번뿐이다 — 실패 가능한 준비 작업을 전부 앞에서 끝냈으므로, 스왑 자체가 실패할 수 있는 구간은 두 `mv` 사이의 짧은 창뿐이고 `ERR` 트랩으로 그 창을 자동 복구한다. 다만 SSH 강제 종료·프로세스 kill처럼 트랩 자체가 실행될 기회가 없는 중단은 막을 수 없다는 점은 그대로 남는다 — 그런 경우를 위해 Phase 0에 복구 절차를 넣어뒀다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom '
  set -e
  trap "if [ ! -d /home/crefleai/app ] && [ -d /home/crefleai/app.prev ]; then mv /home/crefleai/app.prev /home/crefleai/app; echo SWAP_RECOVERED >&2; fi" ERR
  rm -rf /home/crefleai/app.prev
  mv /home/crefleai/app /home/crefleai/app.prev
  mv /home/crefleai/app.new /home/crefleai/app
  echo SWAP_OK
'
```

이 스크립트의 `rm -rf`/`mv`도 분류기가 차단할 수 있다 — Phase 1과 같은 방식으로 대응한다.

스왑 후 검증한다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "grep -m1 version /home/crefleai/app/server/pyproject.toml && \
   grep '^CREFLEAI_IMAGE_TAG' /home/crefleai/app/deploy/.env"
# 기대값: version = "<신규버전>" / CREFLEAI_IMAGE_TAG=<신규버전>
```

## Phase 6: 재기동

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps"
```

## Phase 7: 헬스체크 대기

로컬에서 이 SSH 호출 자체는 Bash `run_in_background: true` 또는 `Monitor` 도구로 감싸 완료 알림을 받는다(수동 `sleep N && ssh ...` 체이닝은 하네스가 막는다). 원격 셸의 `until` 루프에는 **반드시 `timeout`을 씌운다** — 컨테이너가 없거나 이미 죽은 상태면 `docker inspect`가 계속 실패해 `$s`가 빈 문자열로 남고, 루프가 끝나지 않아 SSH가 무한 대기하게 된다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && \
   timeout 300 bash -c 'until s=\$(docker inspect --format=\"{{.State.Health.Status}}\" crefleai-crefleai-1 2>/dev/null); [ \"\$s\" = healthy ] || [ \"\$s\" = unhealthy ]; do sleep 2; done; echo HEALTH_STATUS:\$s' || echo HEALTH_TIMEOUT; \
   docker compose ps; \
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8000/"
```

`HEALTH_TIMEOUT`이나 `unhealthy`가 나오면 **자동으로 롤백하지 않는다** — `docker compose logs --tail 100`으로 원인을 확인해 보고하고, 사용자에게 롤백 여부를 확인한다.

## Phase 8: GPU 패스스루 검증

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker exec crefleai-crefleai-1 nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv"
```

NVML이 노출되지 않으면 관리자 `/admin/monitoring`의 GPU 카드만 "수집 불가"로 표시되고 나머지는 정상 동작한다(장애 아님) — 이 경우 호스트의 NVIDIA Container Toolkit·`gpus: all` 설정을 점검하도록 안내한다.

## 롤백 — 디렉터리 스왑 (compose 설정까지 함께 되돌림)

Phase 5에서 만들어진 `/home/crefleai/app.prev`는 **이전 릴리스의 소스 트리 전체**(당시의 `docker-compose.yml`, 당시의 `.env` 포함)다. 이미지 태그만 `.env`에서 되돌리면 "구버전 이미지 + 신버전 compose 설정"이 섞일 수 있으므로, 롤백은 디렉터리째 교체한다. **롤백 전에 `app.rolledback`이 이전 롤백에서 남아있지 않은지 먼저 정리한다** — 그대로 두면 `mv app app.rolledback`이 기존 디렉터리 안으로 중첩되고(`app.rolledback/app`), 다음 롤백 때 같은 경로가 이미 차 있어 `mv`가 "Directory not empty"로 실패해 긴급 롤백 자체가 막힌다(로컬 재현 확인):

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom '
  set -e
  test -d /home/crefleai/app.prev || { echo NO_PREV_BUILD; exit 1; }
  rm -rf /home/crefleai/app.rolledback
  trap "if [ ! -d /home/crefleai/app ] && [ -d /home/crefleai/app.rolledback ]; then mv /home/crefleai/app.rolledback /home/crefleai/app; echo ROLLBACK_RECOVERED >&2; fi" ERR
  mv /home/crefleai/app /home/crefleai/app.rolledback
  mv /home/crefleai/app.prev /home/crefleai/app
  cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps
'
```

`app.rolledback`도 스왑의 `app.prev`와 같은 이유로 매번 `rm -rf`부터 한다 — 대신 이 디렉터리는 다음 배포 전까지 "롤백 직전 상태" 백업으로 남아있으므로, 롤백을 취소하고 롤백 이전 버전으로 다시 돌아가고 싶으면 `app.rolledback`을 확인한다.

- `/home/crefleai/app.prev`는 다음 배포의 Phase 5에서 덮어써지므로, **직전 릴리스 1단계까지만** 롤백 가능하다. 그보다 이전으로 돌아가려면 `git archive <이전 태그>`로 Phase 1부터 다시 실행한다.
- 데이터 볼륨(`/home/crefleai/data`)은 디렉터리 스왑과 무관하게 유지되므로 롤백 시 데이터 손실은 없다.
- `NO_PREV_BUILD`가 나오면(아직 한 번도 배포 안 했거나 이미 롤백해서 `app.prev`가 없음) 사용자에게 상황을 보고하고, 필요하면 `<이전 태그>`로 Phase 1부터 재실행하도록 안내한다.

## 최종 보고 형식

배포 완료 시 아래 항목을 표로 요약해 보고한다: 버전, 이미지 빌드 검증 결과(SSH 종료 코드 + `IMAGE_OK`), push 결과, 헬스체크 결과, GPU 검증 결과, 롤백 방법(`app.prev` 존재 여부 포함). 브리핑 문서(`docs/reports/.../crefleai-release-briefing`) 체크리스트 중 이 스킬이 수행하지 않은 항목(예: 실모델 GGUF 서빙 스모크 테스트)이 있으면 명시적으로 "미수행"이라고 남긴다 — 조용히 생략하지 않는다.
