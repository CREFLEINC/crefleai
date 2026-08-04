# CrefleAI doctordoom 배포 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MVP(v0.1.0)를 doctordoom GPU 서버에 docker-compose로 기동하고 실모델 서빙까지 검증한다.

**Architecture:** 멀티스테이지 Dockerfile(node 빌드 → CUDA devel에서 llama-cpp-python sm_120 빌드 → CUDA runtime)로 단일 이미지를 doctordoom에서 네이티브 빌드해 hub.crefle.com에 push하고, crefleai 계정의 `~/app/deploy`에서 compose로 기동한다. 데이터(GGUF·SQLite)는 호스트 `/home/crefleai/data` 바인드.

**Tech Stack:** Docker 29 / docker-compose-v2 / nvidia-container-toolkit / nvidia/cuda 베이스 이미지 / uv

**Spec:** `docs/superpowers/specs/2026-08-04-crefleai-deploy-design.md`

## Global Constraints

- 이미지 이름: `hub.crefle.com/crefle-ai/crefleai` — 태그는 `X.Y.Z`(SemVer) + `latest`, 시작 **0.1.0**
- `server/pyproject.toml`의 `version` = git 태그 `vX.Y.Z` = 이미지 태그 (항상 동기)
- 포트 8000:8000, 데이터 볼륨 `/home/crefleai/data:/app/data`, 컨테이너 env `CREFLEAI_DATA_DIR=/app/data`, `CREFLEAI_WEB_DIST=/app/web/dist`
- CUDA 아키텍처 `120`(Blackwell sm_120), 베이스는 12.8+ (기본 `ARG CUDA_VERSION=13.0.1`, 서버에서 태그 확인 후 필요 시 `--build-arg`로 조정)
- `.env`는 서버에만 존재 — 저장소 커밋 금지. `.env.example`만 커밋
- sudo가 필요한 단계는 사용자 담당 (계획에 명령 블록 명시), 나머지는 운영자가 `ssh crefleai@doctordoom`으로 수행
- 커밋: Conventional Commits, 한국어 제목. 배포 파일은 `feat/deploy` 브랜치 → PR → main 병합 후 태그

## 파일 구조

```
deploy/
├── Dockerfile           # Task 1 — 멀티스테이지 (web-build / server-build / runtime)
├── docker-compose.yml   # Task 1 — 단일 서비스, gpus, 볼륨, 헬스체크
├── .env.example         # Task 1 — 환경변수 템플릿
└── README.md            # Task 1 — 배포·롤백 절차
```

---

### Task 1: deploy/ 파일 작성

**Files:**
- Create: `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/.env.example`, `deploy/README.md`

**Interfaces:**
- Consumes: `server/pyproject.toml`(extra `worker`), `web/package.json`(`npm run build`), `crefleai` 엔트리포인트(`[project.scripts]`)
- Produces: 빌드 컨텍스트 = **저장소 루트**에서 `docker build -f deploy/Dockerfile` 가능한 이미지. Task 4·5가 이 파일들을 그대로 사용

- [ ] **Step 1: Dockerfile 작성**

`deploy/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
ARG CUDA_VERSION=13.0.1

FROM node:22 AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu24.04 AS server-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY server/ ./
RUN uv sync --frozen --no-dev
# llama-cpp-python은 Blackwell(sm_120) 대상 CUDA 빌드 — 수십 분 소요
RUN CMAKE_ARGS="-DGGML_CUDA=on -DCMAKE_CUDA_ARCHITECTURES=120" \
    uv pip install --no-cache-dir "llama-cpp-python>=0.3"

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04 AS runtime
COPY --from=server-build /opt/python /opt/python
COPY --from=server-build /opt/venv /opt/venv
COPY --from=server-build /app/server /app/server
COPY --from=web-build /src/web/dist /app/web/dist
ENV PATH="/opt/venv/bin:${PATH}" \
    CREFLEAI_WEB_DIST=/app/web/dist \
    CREFLEAI_DATA_DIR=/app/data
WORKDIR /app/server
EXPOSE 8000
CMD ["crefleai"]
```

- [ ] **Step 2: docker-compose.yml 작성**

`deploy/docker-compose.yml`:

```yaml
name: crefleai

services:
  crefleai:
    image: hub.crefle.com/crefle-ai/crefleai:${CREFLEAI_IMAGE_TAG:?CREFLEAI_IMAGE_TAG를 .env에 설정하세요}
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      CREFLEAI_JWT_SECRET: ${CREFLEAI_JWT_SECRET:?}
      CREFLEAI_ADMIN_ID: ${CREFLEAI_ADMIN_ID:?}
      CREFLEAI_ADMIN_PASSWORD: ${CREFLEAI_ADMIN_PASSWORD:?}
      CREFLEAI_DATA_DIR: /app/data
    volumes:
      - /home/crefleai/data:/app/data
    gpus: all
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/', timeout=5)"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

- [ ] **Step 3: .env.example 작성**

`deploy/.env.example`:

```bash
# 서버의 ~/app/deploy/.env 로 복사해 실제 값으로 채운다. 저장소에 커밋 금지.
CREFLEAI_IMAGE_TAG=0.1.0
# openssl rand -hex 32 로 생성
CREFLEAI_JWT_SECRET=CHANGE-ME
CREFLEAI_ADMIN_ID=admin
CREFLEAI_ADMIN_PASSWORD=CHANGE-ME
```

- [ ] **Step 4: deploy/README.md 작성**

`deploy/README.md`:

```markdown
# CrefleAI 배포 (doctordoom)

설계: `docs/superpowers/specs/2026-08-04-crefleai-deploy-design.md`

## 빌드 & push (crefleai@doctordoom, ~/app 에 소스 스냅샷 전제)

    VERSION=0.1.0
    docker build -f deploy/Dockerfile \
      -t hub.crefle.com/crefle-ai/crefleai:${VERSION} \
      -t hub.crefle.com/crefle-ai/crefleai:latest ~/app
    docker push hub.crefle.com/crefle-ai/crefleai:${VERSION}
    docker push hub.crefle.com/crefle-ai/crefleai:latest

CUDA 베이스 태그가 없으면 `--build-arg CUDA_VERSION=<사용 가능 태그>` 로 조정 (12.8 이상).

## 기동 / 중지 / 로그

    cd ~/app/deploy
    docker compose up -d
    docker compose ps          # healthy 확인
    docker compose logs -f
    docker compose down        # 중지 (데이터 볼륨은 유지)

## 릴리스 절차

1. `server/pyproject.toml` version 갱신 → 커밋/병합
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. 로컬에서 소스 전송: `git archive vX.Y.Z | ssh crefleai@doctordoom "rm -rf ~/app && mkdir -p ~/app && tar -x -C ~/app"`
4. 위 빌드 & push → 서버 `.env`의 `CREFLEAI_IMAGE_TAG` 갱신 → `docker compose up -d`

## 롤백

`.env`의 `CREFLEAI_IMAGE_TAG`를 직전 버전으로 되돌리고 `docker compose up -d`.
데이터(`/home/crefleai/data`)는 이미지 교체와 무관하게 유지된다.

## `gpus: all`이 거부될 때

compose 플러그인이 구버전이면 `gpus:` 대신 아래로 대체:

    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

- [ ] **Step 5: 커밋**

```bash
git add deploy/
git commit -m "feat(deploy): doctordoom 배포용 Dockerfile·compose 구성 추가"
```

---

### Task 2: PR 병합 및 v0.1.0 태그

**Files:** 없음 (git 작업)

**Interfaces:**
- Consumes: Task 1 커밋, `server/pyproject.toml` version(0.1.0인지 확인)
- Produces: main의 태그 `v0.1.0` — Task 4의 `git archive` 대상

- [ ] **Step 1: 버전 동기 확인**

Run: `grep '^version' server/pyproject.toml`
Expected: `version = "0.1.0"` (다르면 0.1.0으로 맞추고 커밋)

- [ ] **Step 2: 푸시 + PR 생성**

```bash
git push -u origin feat/deploy
gh pr create --repo CREFLEINC/crefleai --base main --head feat/deploy \
  --title "feat: doctordoom 배포 구성 추가" \
  --body "배포 설계(docs/superpowers/specs/2026-08-04-crefleai-deploy-design.md)에 따른 deploy/ 구성. 병합 후 v0.1.0 태그 예정."
```

- [ ] **Step 3: 체크포인트 — 사용자 병합 대기**

사용자가 PR을 확인·병합할 때까지 대기. (자잘한 배포 구성이므로 사용자가 원하면 즉시 병합 요청)

- [ ] **Step 4: main 갱신 + 태그**

```bash
git checkout main && git pull origin main
git tag v0.1.0 && git push origin v0.1.0
```

---

### Task 3: 서버 준비 (sudo — 사용자 담당) + 검증

**Files:** 없음 (서버 작업)

**Interfaces:**
- Produces: `crefleai` 계정(docker 그룹, SSH 접근), docker compose v2, nvidia 런타임, 레지스트리 접근 — Task 4·5의 전제

- [ ] **Step 1: 사용자에게 sudo 명령 블록 전달**

사용자가 doctordoom(doom 계정)에서 실행:

```bash
# 1) crefleai 사용자 + docker 그룹
sudo useradd -m -s /bin/bash crefleai
sudo usermod -aG docker crefleai

# 2) 운영자 SSH 키 등록 (doom의 authorized_keys 재사용 — 동일 운영자)
sudo mkdir -p /home/crefleai/.ssh
sudo cp ~/.ssh/authorized_keys /home/crefleai/.ssh/authorized_keys
sudo chown -R crefleai:crefleai /home/crefleai/.ssh
sudo chmod 700 /home/crefleai/.ssh
sudo chmod 600 /home/crefleai/.ssh/authorized_keys

# 3) docker compose v2 + nvidia-container-toolkit
sudo apt-get update
sudo apt-get install -y docker-compose-v2 nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

`nvidia-container-toolkit` 패키지를 apt가 찾지 못하면 NVIDIA 저장소 추가 후 재시도:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

- [ ] **Step 2: 운영자 검증 (crefleai 계정으로)**

Run (로컬 Mac):
```bash
ssh -o BatchMode=yes crefleai@doctordoom 'whoami && id | grep -o docker && docker compose version && mkdir -p ~/data'
```
Expected: `crefleai` / `docker` / `Docker Compose version v2.x`

- [ ] **Step 3: GPU 런타임 스모크**

Run:
```bash
ssh crefleai@doctordoom 'docker run --rm --gpus all nvidia/cuda:13.0.1-base-ubuntu24.04 nvidia-smi'
```
Expected: RTX PRO 6000 정보 출력. 이미지 태그가 없으면 `docker search`가 아니라 https://hub.docker.com/r/nvidia/cuda/tags 에서 12.8+ 태그를 골라 재시도하고, 이후 Task 4 빌드에서 같은 태그를 `--build-arg CUDA_VERSION=`으로 사용.

- [ ] **Step 4: 레지스트리 접근 확인**

Run:
```bash
ssh crefleai@doctordoom 'curl -fsS -o /dev/null -w "%{http_code}\n" https://hub.crefle.com/v2/'
```
Expected: `200` (또는 `401`도 도달 자체는 OK — 무인증 정책 확인). TLS 오류가 나면 사설 CA — 사용자에게 `daemon.json`의 `insecure-registries`에 `hub.crefle.com` 추가(sudo) 요청 후 docker 재시작.

---

### Task 4: 소스 전송 + 이미지 빌드 + push

**Files:** 없음 (서버 작업)

**Interfaces:**
- Consumes: 태그 `v0.1.0`(Task 2), 서버 준비 완료(Task 3)
- Produces: `hub.crefle.com/crefle-ai/crefleai:0.1.0` + `:latest` — Task 5가 pull

- [ ] **Step 1: 소스 스냅샷 전송**

Run (로컬, main·태그 체크아웃 상태 무관 — 태그 기준):
```bash
git archive v0.1.0 | ssh crefleai@doctordoom "rm -rf ~/app && mkdir -p ~/app && tar -x -C ~/app"
ssh crefleai@doctordoom 'ls ~/app/deploy/Dockerfile ~/app/server/pyproject.toml ~/app/web/package.json'
```
Expected: 세 파일 모두 존재

- [ ] **Step 2: 빌드 (수십 분 — CUDA 컴파일)**

Run:
```bash
ssh crefleai@doctordoom 'cd ~/app && docker build -f deploy/Dockerfile \
  -t hub.crefle.com/crefle-ai/crefleai:0.1.0 \
  -t hub.crefle.com/crefle-ai/crefleai:latest .'
```
Expected: 성공. CUDA 태그 미존재 시 Task 3 Step 3에서 확정한 태그로 `--build-arg CUDA_VERSION=` 추가.

- [ ] **Step 3: push + 확인**

Run:
```bash
ssh crefleai@doctordoom 'docker push hub.crefle.com/crefle-ai/crefleai:0.1.0 && docker push hub.crefle.com/crefle-ai/crefleai:latest && docker manifest inspect hub.crefle.com/crefle-ai/crefleai:0.1.0 >/dev/null && echo PUSH-OK'
```
Expected: `PUSH-OK`

---

### Task 5: .env 구성 + 기동 + 스모크 테스트

**Files:** 서버의 `~/app/deploy/.env` (저장소 밖)

**Interfaces:**
- Consumes: 이미지 0.1.0(Task 4), `~/data` 디렉터리(Task 3)
- Produces: `http://doctordoom:8000` 가동 서비스

- [ ] **Step 1: 체크포인트 — 관리자 초기 비밀번호 수령**

사용자에게 `CREFLEAI_ADMIN_PASSWORD` 값을 요청 (또는 사용자가 직접 서버에서 `.env` 수정하는 방식 선택 가능).

- [ ] **Step 2: .env 생성**

Run:
```bash
ssh crefleai@doctordoom 'SECRET=$(openssl rand -hex 32) && cat > ~/app/deploy/.env <<EOF
CREFLEAI_IMAGE_TAG=0.1.0
CREFLEAI_JWT_SECRET=${SECRET}
CREFLEAI_ADMIN_ID=admin
CREFLEAI_ADMIN_PASSWORD=<사용자 지정값>
EOF
chmod 600 ~/app/deploy/.env'
```

- [ ] **Step 3: 기동 + 헬스체크**

Run:
```bash
ssh crefleai@doctordoom 'cd ~/app/deploy && docker compose up -d && sleep 40 && docker compose ps'
```
Expected: STATUS에 `healthy`. 아니면 `docker compose logs`로 원인 확인.

- [ ] **Step 4: 스모크 테스트**

Run:
```bash
ssh crefleai@doctordoom '
curl -fsS -o /dev/null -w "root:%{http_code}\n" http://localhost:8000/ &&
curl -fsS -c /tmp/ck -X POST http://localhost:8000/api/admin/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"<사용자 지정값>\"}" &&
curl -fsS -b /tmp/ck http://localhost:8000/api/admin/models | head -c 300 && echo &&
curl -s -o /dev/null -w "v1-no-token:%{http_code}\n" http://localhost:8000/v1/models &&
rm -f /tmp/ck'
```
Expected: `root:200` / 로그인 `{"ok":true}` / models JSON(카탈로그 3종) / `v1-no-token:401`

- [ ] **Step 5: 외부 접속 확인**

Run (로컬 Mac): `curl -fsS -o /dev/null -w "%{http_code}\n" http://doctordoom:8000/`
Expected: `200`. 사용자 브라우저에서 `http://doctordoom:8000/admin` 로그인 화면 확인 요청.

---

### Task 6: 실모델 서빙 검증 (수동 체크리스트)

**Files:** 없음

**Interfaces:**
- Consumes: 가동 서비스(Task 5), 관리자 세션

- [ ] **Step 1: 모델 다운로드 시작 (Qwen3-8B) + 진행률 폴링**

Run:
```bash
ssh crefleai@doctordoom '
curl -fsS -c /tmp/ck -X POST http://localhost:8000/api/admin/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"<사용자 지정값>\"}" >/dev/null &&
curl -fsS -b /tmp/ck -X POST http://localhost:8000/api/admin/models/qwen3-8b-q4km/download'
```
이후 `GET /api/admin/models`를 주기 폴링해 `downloading`→`ready` 확인 (약 5GB).

- [ ] **Step 2: 서비스 시작 + VRAM 확인**

Run: `POST /api/admin/models/qwen3-8b-q4km/serve` (위와 같은 쿠키) → `GET /api/admin/models`에서 worker `running`·모델 `serving` 확인
Run: `ssh doctordoom nvidia-smi --query-gpu=memory.used --format=csv`
Expected: 수 GB 사용 중

- [ ] **Step 3: 토큰 발급 + OpenAI 호환 호출**

Run:
```bash
ssh crefleai@doctordoom '
TOKEN=$(curl -fsS -b /tmp/ck -X POST http://localhost:8000/api/admin/tokens -H "Content-Type: application/json" -d "{\"user_name\":\"배포검증\",\"purpose\":\"smoke\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"token\"])") &&
curl -fsS http://localhost:8000/v1/chat/completions -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"1+1은?\"}],\"max_tokens\":32}"'
```
Expected: `choices[0].message.content`에 응답 텍스트, `usage` 포함

- [ ] **Step 4: 사용자 확인 — 화면·스트리밍**

사용자 브라우저에서: `/admin` 모델 상태 "서비스 중" 확인 → `/chat`에 발급 토큰 입력 → 스트리밍 응답 확인.

- [ ] **Step 5: 재시작 복원 + 토큰 폐기 확인**

Run:
```bash
ssh crefleai@doctordoom 'cd ~/app/deploy && docker compose restart && sleep 90 && curl -fsS -b /tmp/ck http://localhost:8000/api/admin/models | head -c 300'
```
Expected: 재기동 후 자동 복원으로 다시 `serving` (모델 로드 시간만큼 대기).
이후 관리자 API로 스모크용 토큰 `DELETE` → 해당 토큰으로 `/v1/models` 호출 시 401 확인.

- [ ] **Step 6: 마무리**

- 검증 결과를 사용자에게 요약 보고
- 필요 시 `deploy/README.md` 보완 사항 반영 (별도 PR)
