# CrefleAI 배포 설계 — doctordoom (docker-compose)

- 날짜: 2026-08-04
- 상태: 승인됨 (배포 계획 수립 전)
- 범위: MVP(PR #1) 버전을 사내 GPU 서버 doctordoom에 docker-compose로 배포

## 1. 배포 대상 서버 (2026-08-04 점검 결과)

| 항목 | 상태 |
|---|---|
| 접속 | `ssh doctordoom` (점검 계정 doom — sudo·docker 그룹) |
| OS / 아키텍처 | Ubuntu 26.04 LTS, x86_64 |
| GPU | NVIDIA RTX PRO 6000 Blackwell 96GB (sm_120), 드라이버 595.84 |
| Docker | 29.1.3 설치됨. compose 플러그인·nvidia-container-toolkit **미설치** |
| crefleai 사용자 | 미존재 — 신규 생성 |
| 디스크 | /home 1.6TB 여유 |
| 레지스트리 | https://hub.crefle.com/crefle-ai/ — 사내망 무인증 push/pull |

## 2. 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| 빌드 위치 | doctordoom에서 네이티브 빌드 (Mac 크로스 빌드·CI는 비현실적/다음 범위) |
| 운영 계정 | `crefleai` (docker 그룹) — 빌드·배포·운영 일원화 |
| 소스 전달 | `git archive <태그> \| ssh crefleai@doctordoom tar -x` — 서버에 GitHub 인증 불필요, 태그된 커밋만 배포 |
| 이미지 | 단일 이미지 (게이트웨이 + 워커 + SPA — 게이트웨이가 워커를 서브프로세스로 스폰하는 구조 유지) |
| 포트 | 8000 그대로 노출 (`http://doctordoom:8000`). 리버스 프록시/TLS는 다음 범위 |
| 데이터 | 호스트 바인드 `/home/crefleai/data` → 컨테이너 `/app/data` (모델 GGUF·SQLite — 이미지 교체와 무관) |
| 관리자 초기 비밀번호 | 사용자가 지정 (.env에 기록, 저장소에 커밋 금지) |

## 3. 버전 체계

- **SemVer `MAJOR.MINOR.PATCH`**, 시작 **0.1.0**. `server/pyproject.toml`의 `version`과 항상 동기.
- 릴리스 절차: pyproject 버전 갱신 → git tag `vX.Y.Z` → 이미지 태그 `hub.crefle.com/crefle-ai/crefleai:X.Y.Z` + `:latest` 동시 push.
- 증가 규칙: 버그픽스 = patch, 기능 추가 = minor, API 호환 파괴 = major. MVP 동안 0.x 유지.
- compose는 `.env`의 `CREFLEAI_IMAGE_TAG`로 버전 고정 → **롤백 = 태그 변경 후 `docker compose up -d`**.

## 4. 이미지 구성 (멀티스테이지 Dockerfile)

| Stage | Base | 역할 |
|---|---|---|
| web-build | `node:22` | `web/` → `npm ci && npm run build` → `dist/` |
| server-build | `nvidia/cuda:<12.8+>-devel-ubuntu24.04` | uv 설치 → `uv sync` → llama-cpp-python을 `CMAKE_ARGS="-DGGML_CUDA=on"` + `CMAKE_CUDA_ARCHITECTURES=120`(Blackwell)으로 빌드 |
| runtime | `nvidia/cuda:<동일>-runtime-ubuntu24.04` | 가상환경 + `server/src` + `web/dist` 복사. `CREFLEAI_WEB_DIST=/app/web/dist` 명시 |

- CUDA 베이스 태그는 구현 시점에 사용 가능한 12.8+ 태그로 확정 (드라이버 595는 CUDA 13까지 호환).
- 빌드에 GPU 불필요(nvcc만) — 최초 빌드는 CUDA 컴파일로 수십 분 소요 가능.

## 5. 저장소 추가 파일 (`deploy/`)

```
deploy/
├── Dockerfile
├── docker-compose.yml   # gpus 예약, 8000:8000, /home/crefleai/data 볼륨,
│                        # restart unless-stopped, 헬스체크(GET / 200)
├── .env.example         # CREFLEAI_IMAGE_TAG, JWT 시크릿, 관리자 계정 템플릿
└── README.md            # 배포·롤백 절차
```

- 실제 `.env`는 서버(`/home/crefleai/app/deploy/.env`)에만 존재. 저장소 커밋 금지.

## 6. 서버 준비 (sudo — 사용자 담당)

정확한 명령은 배포 계획서에 명시. 항목:

1. `crefleai` 사용자 생성 + docker 그룹 편입
2. 운영자(로컬 Mac)의 SSH 공개키를 `crefleai`의 authorized_keys에 등록 → 이후 `ssh crefleai@doctordoom`으로 배포 수행
3. docker compose 플러그인 설치 (`docker-compose-v2`)
4. nvidia-container-toolkit 설치 + `nvidia-ctk runtime configure --runtime=docker` + docker 재시작
5. 레지스트리 TLS 확인: `curl https://hub.crefle.com/v2/` — 사설 CA/HTTP면 `daemon.json`에 `insecure-registries` 추가 필요 여부 판단

## 7. 배포 절차 (crefleai 계정, 운영자가 ssh로 수행)

1. 소스 전송: `git archive v0.1.0 | ssh crefleai@doctordoom "mkdir -p ~/app && tar -x -C ~/app"`
2. 서버에서 `docker build` → `X.Y.Z`·`latest` 태그 → 레지스트리 push
3. `~/app/deploy/.env` 생성 — JWT 시크릿은 `openssl rand -hex 32`, 관리자 초기 비밀번호는 사용자 지정값
4. `docker compose up -d` → 헬스체크 통과 확인
5. 스모크 테스트: `GET /` 200, 관리자 로그인, 모델 카탈로그 조회
6. 관리자 화면에서 모델 다운로드 → 서비스 시작 → `nvidia-smi` VRAM 확인 → Chat 스트리밍 확인
   (구현 계획서의 수동 검증 체크리스트 8항목 수행)

## 8. 운영·롤백·장애 대응

- 재시작 정책 `unless-stopped` — 서버 재부팅 시 자동 기동, 앱의 서비스 모델 자동 복원과 연계
- 롤백: `.env`의 `CREFLEAI_IMAGE_TAG`를 이전 버전으로 → `docker compose up -d` (데이터 볼륨 유지)
- 로그: `docker compose logs -f`
- 헬스체크 실패 시: 로그 확인 → 컨테이너 재기동 → 직전 태그 롤백 순

## 9. 다음 범위 (이번 제외)

- CI 기반 이미지 빌드·배포 자동화 (셀프호스티드 러너)
- 리버스 프록시 + TLS, 도메인
- 모니터링/알림 (컨테이너·GPU 메트릭)
