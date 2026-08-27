---
name: crefleai-deploy-orchestrator
description: "CrefleAI 배포 파이프라인 전체(버전 확정→태그→서버 빌드/배포/검증)를 조율. '배포해줘', 'CrefleAI 배포', '새 버전 배포', '이번 변경분 릴리스', '릴리스 진행해줘', 'doctordoom에 올려줘', 'v0.X.0 배포' 요청 시 사용. 후속 작업(배포 재개/재시도, 배포 상태 확인, 롤백해줘, 이전 버전으로 되돌려줘, 배포만 다시)에도 반드시 이 스킬을 사용."
---

# CrefleAI 배포 오케스트레이터

CrefleAI를 사내 GPU 서버(doctordoom)에 배포하는 전체 과정을 조율한다. 2026-08-27 `v0.2.0 → v0.3.0` 수동 배포를 실제로 성공시킨 뒤, 그 과정을 재사용 가능하게 정리한 것이다.

## 실행 모드: 서브 에이전트 (파이프라인)

버전 확정(로컬 저장소 작업)과 서버 배포(SSH/Docker 작업)는 순차 의존 관계이고, 두 작업 사이에 실시간 토론이나 발견 공유가 필요하지 않다 — 릴리스 매니저가 만든 태그를 배포 실행자가 그대로 받아 쓰는 단방향 흐름이다. 따라서 에이전트 팀이 아닌 서브 에이전트 모드로 구성한다.

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---|---|---|---|---|
| release-manager | `crefleai-release-manager` | 버전 확정, PR, 머지, 태그 | `crefleai-release` | 확정된 태그(`vX.Y.Z`) |
| deploy-executor | `crefleai-deploy-executor` | 서버 빌드/배포/검증/롤백 | `crefleai-server-deploy` | 배포 결과 요약 |

두 에이전트 모두 `Agent` 도구로 호출한다. 모델은 각 에이전트 정의 파일(`crefleai-release-manager.md`, `crefleai-deploy-executor.md`)의 `model: opus`를 따르므로 호출부에서 별도로 지정할 필요는 없다 — 모델을 바꿀 일이 있으면 정의 파일 한 곳만 고치면 되게 하기 위함이다.

## 워크플로우

### Phase 0: 현재 상태 확인 (항상 라이브 조회, 캐시 신뢰 금지)

이 도메인은 콘텐츠 생성이 아니라 인프라 상태이므로, `_workspace/` 같은 로컬 파일이 아니라 **git과 서버를 직접 조회**해 현재 상태를 판단한다.

```bash
git fetch origin -q
git describe --tags --abbrev=0 origin/main
git log <최근태그>..origin/main --oneline
ssh -o BatchMode=yes -o ConnectTimeout=5 crefleai@doctordoom \
  "cd /home/crefleai/app/deploy && docker compose ps"
```

결과에 따라 분기한다:

| 상황 | 실행 모드 |
|---|---|
| 미배포 커밋 있음, 서버 버전 = 최근 태그 | **초기 실행** — Phase 1부터 |
| 서버 버전 = origin/main 최신 태그, 미배포 커밋 없음 | 이미 최신 — 사용자에게 보고하고 종료 (재배포 의사 재확인 후에만 진행) |
| 서버가 `unhealthy`이거나, 태그는 있는데 서버에 반영 안 됨 | **재개(resume)** — Phase 2 건너뛰고 Phase 3(deploy-executor)부터, 해당 태그를 그대로 입력으로 전달 |
| 사용자가 "롤백해줘"라고 요청 | **롤백 모드** — deploy-executor에게 `crefleai-server-deploy`의 롤백 절차만 수행하도록 지시 (release-manager 호출 안 함) |

### Phase 1: 목표 버전 파악

사용자가 이미 버전을 지정했으면 그대로 사용한다. 아니면 release-manager가 Phase 2에서 SemVer 판단 근거를 제시하고 확정받는다 — 오케스트레이터가 미리 임의로 정하지 않는다.

### Phase 2: release-manager 호출

```
Agent({
  subagent_type: "crefleai-release-manager",
  description: "CrefleAI 릴리스 버전 확정",
  prompt: "<목표 버전(지정됐다면), 이번 릴리스에 포함할 변경 범위, PR 머지에 대한 사용자 승인 여부를 명시>"
})
```

- PR 머지 승인이 사용자로부터 아직 없다면, release-manager가 PR URL만 보고하고 멈추도록 지시한다 — 이 경우 오케스트레이터는 사용자에게 머지 승인을 묻고, 승인 시 release-manager를 이어서 호출(SendMessage로 재개하거나 새로 호출)한다.
- 완료되면 확정된 태그(`vX.Y.Z`)를 받는다. 이게 없으면 Phase 3로 넘어가지 않는다.

### Phase 3: deploy-executor 호출

```
Agent({
  subagent_type: "crefleai-deploy-executor",
  description: "CrefleAI 서버 배포",
  prompt: "<Phase 2에서 확정된 태그, 서버 배포 목적, 롤백 모드 여부>"
})
```

**권한 차단에 대한 대응이 이 파이프라인의 핵심이다.** deploy-executor가 프로덕션 서버 대상 파괴적 명령(원격 `rm -rf`, `sudo` 등)에서 자동 모드 분류기에 막히는 것은 정상적인 예상 동작이다 — 오케스트레이터는 이를 실패로 취급하지 않는다:

1. deploy-executor가 차단된 명령과 이유를 보고하면, 그 내용을 그대로 사용자에게 전달한다.
2. 사용자가 명령을 직접 실행했다고 확인하면, deploy-executor를 `SendMessage`로 재개시켜 검증부터 이어가게 한다(같은 에이전트 인스턴스를 재사용 — 새로 스폰하지 않는다).
3. 사용자가 대신 권한을 승인하면, deploy-executor에게 이어서 진행하라고 알린다.

### Phase 4: 결과 종합 및 보고

1. deploy-executor의 최종 보고(버전, 이미지 빌드 검증, 헬스체크, GPU 검증, 롤백 방법)를 수집한다.
2. release-manager의 PR/태그 정보와 합쳐 하나의 요약으로 사용자에게 제시한다.
3. `docs/reports/**/crefleai-release-briefing*` 문서의 배포 전 체크리스트 중 이 파이프라인이 다루지 않는 항목(예: 실모델 GGUF 서빙 스모크 테스트)이 있으면 "미수행"으로 명시한다 — 조용히 생략하지 않는다.

## 에러 핸들링

| 상황 | 전략 |
|---|---|
| release-manager 실패(PR 충돌 등) | deploy-executor를 호출하지 않고 사용자에게 보고, 지시 대기 |
| deploy-executor가 이미지 빌드 실패 | 빌드 로그 마지막 부분을 보여주고 재시도 여부를 사용자에게 확인 |
| deploy-executor가 헬스체크에서 `unhealthy` 확정 | 자동 롤백 금지 — 로그 원인과 함께 사용자에게 롤백 여부 확인 |
| 두 에이전트 모두 응답 없음(타임아웃) | 서버 상태(Phase 0 명령)를 직접 재조회해 실제로 어디까지 진행됐는지 확인 후 사용자에게 보고 |

## 테스트 시나리오

### 정상 흐름
1. 사용자가 "이번 변경분 배포해줘"라고 요청
2. Phase 0에서 미배포 커밋 3개(#38~#41) 확인, 서버는 이전 버전으로 healthy
3. Phase 2: release-manager가 minor 범프(0.2.0→0.3.0) 제안, 사용자 승인, PR 머지, 태그 push
4. Phase 3: deploy-executor가 소스 추출(사용자 직접 실행 필요) → `.env` 없이 이미지 빌드 → 이미지 존재 검증 → push → `.env` 이식(아직 임시 디렉터리) → 스왑 → 재기동 → healthy 확인 → GPU 검증
5. Phase 4: 배포 완료 요약 보고

### 에러 흐름 — 권한 차단 후 재개
1. Phase 3에서 소스 추출 스크립트(`rm -rf`로 임시 디렉터리 정리)가 분류기에 차단됨
2. deploy-executor가 정확한 명령과 "대상은 임시 디렉터리이고 라이브 서비스는 마지막 mv 전까지 그대로다" 근거를 제시하고 대기 상태로 보고 종료
3. 오케스트레이터가 사용자에게 전달, 사용자가 직접 실행 후 "실행했어" 응답
4. 오케스트레이터가 deploy-executor를 SendMessage로 재개 → 서버의 `pyproject.toml` 버전을 조회해 전송 결과 검증 후 Phase 3 나머지 단계 계속
5. 최종 배포 완료 보고
