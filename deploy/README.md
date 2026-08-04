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
