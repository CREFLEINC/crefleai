---
name: crefleai-server-deploy
description: "CrefleAI를 doctordoom GPU 서버에 실제로 배포하는 절차 — .env 백업, 소스 전송, Docker 이미지 빌드/push, docker compose 재기동, 헬스체크·GPU 검증, 롤백. '서버에 배포해줘', 'doctordoom에 올려줘', 'v0.X.0 배포 진행', '배포 재개', '롤백해줘', '이전 버전으로 되돌려줘' 요청 시 사용. crefleai-deploy-executor 에이전트가 이 절차를 따른다."
---

# CrefleAI 서버 배포 절차 (doctordoom)

`crefleai-release` 스킬로 확정된 git 태그를 사내 GPU 서버에 실제로 올리는 절차. 이 문서는 2026-08-27 `v0.2.0 → v0.3.0` 배포를 실제로 성공시킨 순서를 그대로 기록한 것이다 — 임의로 순서를 바꾸지 말 것.

## 서버 정보

| 항목 | 값 |
|---|---|
| SSH | `ssh crefleai@doctordoom` (배포 전용 계정) |
| 배포 작업 디렉터리 | `/home/crefleai/app` |
| Compose 파일 | `/home/crefleai/app/deploy/docker-compose.yml` |
| `.env` 위치 | `/home/crefleai/app/deploy/.env` (git 미추적, 소스 전송 시 사라짐) |
| 데이터 볼륨 | `/home/crefleai/data` → 컨테이너 `/app/data` (이미지 교체와 무관하게 유지됨) |
| 레지스트리 | `hub.crefle.com/crefle-ai/crefleai` |
| 서비스 확인 | `http://doctordoom:8000/` |
| 점검용 별도 계정(참고용, 배포엔 안 씀) | `ssh doctordoom` (계정 `doom`, sudo 그룹) |

`crefleai@doctordoom`은 `doom` 계정과 다른 별도 배포 계정이다 — 혼동하지 않는다. `doctordoom` 별칭은 각자의 로컬 `~/.ssh/config`에 설정되어 있어야 한다(내부망 호스트라 저장소에 IP를 하드코딩하지 않는다) — 별칭이 없으면 사용자에게 IP를 물어보거나, 사용자가 대화 중 직접 알려준 주소를 이번 실행에 한해 사용한다.

## Phase 0: 현재 상태 확인

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose ps"
```

- 이미 대상 태그와 같은 버전이 `healthy`로 떠 있으면 재배포가 필요한지 사용자에게 먼저 확인한다.
- 컨테이너가 `unhealthy`거나 없으면(이전 시도가 중단된 상태일 수 있음) 아래를 계속 진행하되, `.env` 백업이 이미 있는지(`ls /home/crefleai/.env.backup.*`) 먼저 확인해 중복 백업으로 이전 백업을 덮어쓰지 않는다.

## Phase 1: `.env` 백업 — 절대 생략 금지

`deploy/.env`는 git에 커밋되지 않는다. Phase 2의 소스 전송이 `/home/crefleai/app`을 통째로 지우기 때문에, 먼저 백업하지 않으면 JWT secret과 관리자 비밀번호가 영구 유실된다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cp -p /home/crefleai/app/deploy/.env /home/crefleai/.env.backup.v<현재버전> && \
   ls -la /home/crefleai/.env.backup.v<현재버전>"
```

내용은 절대 `cat`하지 않는다 — 존재와 크기만 확인한다.

## Phase 2: 소스 전송 — 사용자 승인이 필요할 수 있음

```bash
git archive v<신규버전> | ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "rm -rf /home/crefleai/app && mkdir -p /home/crefleai/app && tar -x -C /home/crefleai/app && echo TRANSFER_OK"
```

**이 명령의 `rm -rf`는 Claude Code 자동 모드 분류기가 차단하는 경우가 실제로 있었다.** 차단되면 에이전트 정의(`crefleai-deploy-executor.md`)의 "권한 경계" 절차를 따른다 — 사용자에게 정확한 명령을 제시하고 직접 실행해달라고 요청한 뒤, 아래로 전송 결과를 검증한다.

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "grep -m1 version /home/crefleai/app/server/pyproject.toml"
# 기대값: version = "<신규버전>"
```

## Phase 3: `.env` 복원 및 이미지 태그 갱신

```bash
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cp -p /home/crefleai/.env.backup.v<현재버전> /home/crefleai/app/deploy/.env && \
   sed -i 's/^CREFLEAI_IMAGE_TAG=.*/CREFLEAI_IMAGE_TAG=<신규버전>/' /home/crefleai/app/deploy/.env && \
   grep '^CREFLEAI_IMAGE_TAG' /home/crefleai/app/deploy/.env"
```

`sed`로 해당 줄만 치환한다 — 파일 전체를 다시 쓰거나 `cat`으로 내용을 확인하지 않는다 (JWT secret·관리자 비밀번호 노출 방지).

## Phase 4: 이미지 빌드 (CUDA 빌드 — 시간이 걸림, 백그라운드로)

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker build -f /home/crefleai/app/deploy/Dockerfile \
     -t hub.crefle.com/crefle-ai/crefleai:<신규버전> \
     -t hub.crefle.com/crefle-ai/crefleai:latest \
     /home/crefleai/app 2>&1 | tee /home/crefleai/build-<신규버전>.log; echo BUILD_EXIT:\$?"
```

Bash `run_in_background: true`로 실행한다(10~30분 이상 걸릴 수 있음). 완료 알림을 받으면 로그 끝부분에서 `Successfully tagged`와 `BUILD_EXIT:0`을 확인한다. CUDA 베이스 이미지 태그가 안 맞으면 `--build-arg CUDA_VERSION=<사용가능 태그>`가 필요할 수 있다(`deploy/README.md` 참조).

## Phase 5: Push

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker push hub.crefle.com/crefle-ai/crefleai:<신규버전> && \
   docker push hub.crefle.com/crefle-ai/crefleai:latest && echo PUSH_OK"
```

## Phase 6: 재기동

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps"
```

## Phase 7: 헬스체크 대기 — 수동 sleep 금지

`sleep N && ssh ...` 형태의 명령 체이닝은 하네스 자체가 막는다. `Monitor` 도구로 healthy/unhealthy가 확정될 때까지 폴링한다:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && \
   until s=\$(docker inspect --format='{{.State.Health.Status}}' crefleai-crefleai-1); [ \"\$s\" = healthy ] || [ \"\$s\" = unhealthy ]; do sleep 2; done; \
   echo \"HEALTH_STATUS:\$s\"; docker compose ps; \
   curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:8000/"
```

`unhealthy`로 확정되면 **자동으로 롤백하지 않는다** — `docker compose logs --tail 100`으로 원인을 확인해 보고하고, 사용자에게 롤백 여부를 확인한다.

## Phase 8: GPU 패스스루 검증

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "docker exec crefleai-crefleai-1 nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv"
```

NVML이 노출되지 않으면 관리자 `/admin/monitoring`의 GPU 카드만 "수집 불가"로 표시되고 나머지는 정상 동작한다(장애 아님) — 이 경우 호스트의 NVIDIA Container Toolkit·`gpus: all` 설정을 점검하도록 안내한다.

## 롤백

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 crefleai@doctordoom \
  "sed -i 's/^CREFLEAI_IMAGE_TAG=.*/CREFLEAI_IMAGE_TAG=<직전버전>/' /home/crefleai/app/deploy/.env && \
   cd /home/crefleai/app/deploy && docker compose up -d && docker compose ps"
```

데이터 볼륨(`/home/crefleai/data`)은 이미지 교체와 무관하게 유지되므로 롤백 시 데이터 손실은 없다. 직전 버전의 이미지가 서버에 남아있지 않으면(`docker images`로 확인) 레지스트리에서 pull해야 한다.

## 최종 보고 형식

배포 완료 시 아래 항목을 표로 요약해 보고한다: 버전, `.env` 백업 경로, 빌드/push 결과, 헬스체크 결과, GPU 검증 결과, 롤백 방법. 브리핑 문서(`docs/reports/.../crefleai-release-briefing`) 체크리스트 중 이 스킬이 수행하지 않은 항목(예: 실모델 GGUF 서빙 스모크 테스트)이 있으면 명시적으로 "미수행"이라고 남긴다 — 조용히 생략하지 않는다.
