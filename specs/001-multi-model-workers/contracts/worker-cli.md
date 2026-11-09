# 워커 실행 명령 계약 (`crefleai-worker`)

```bash
crefleai-worker \
  --gateway-url http://doctordoom:8000 \
  --token-file /run/secrets/crefle_reg \
  --model qwen3-8b-q4km \
  --gpus 0 \
  --ctx 8192 \
  --name gpu-a-gpu0 \
  --listen 0.0.0.0:9001 \
  --advertise-url http://10.0.0.21:9001 \
  --models-dir /data/models \
  --state-dir /data/worker-state
```

| 옵션 | 필수 | 설명 |
|---|---|---|
| `--gateway-url` | 예 | 게이트웨이 주소 |
| `--token` / `--token-file` | 최초 등록만 | 등록 토큰. 상태 파일이 있으면 무시 |
| `--model` | 예 | 카탈로그 모델 ID |
| `--gpus` | 아니요 | 사용할 GPU 번호(PCI 순서, 쉼표 구분). Docker에서 `device_ids`로 넘기면 생략 |
| `--ctx` | 아니요 | 유효 컨텍스트 길이(기본 8192, 모델 최대값 이하) |
| `--max-concurrency` | 아니요 | 동시 처리 수(기본 1, 이번 엔진은 1만 허용 — research R9) |
| `--name` | 아니요 | 인스턴스 ID(기본 `<hostname>-gpu<번호들>`) |
| `--listen` | 아니요 | 워커 HTTP 수신 주소(기본 `0.0.0.0:9001`) |
| `--advertise-url` | 예 | 게이트웨이가 접근할 워커 주소 |
| `--models-dir` | 아니요 | 모델 파일 위치(기본 `./data/models`) |
| `--state-dir` | 아니요 | 자격 증명 저장 위치(기본 `~/.crefleai-worker`) |

환경 변수로도 줄 수 있다: `CREFLEAI_GATEWAY_URL`, `CREFLEAI_REGISTRATION_TOKEN`, `CREFLEAI_WORKER_MODEL`, … (CLI가 우선).
등록 토큰은 셸 기록에 남지 않도록 환경 변수 또는 `--token-file` 사용을 권장한다.

## 실행 순서

1. 인자 검증 — 카탈로그에 없는 모델, `--ctx` 초과, `--max-concurrency` 1 초과 → 종료 코드 2
2. 모델 파일 확인 — 없으면 경로와 함께 종료 코드 2
3. GPU 조회(NVML) — 불가하거나 GPU 세대 미지원이면 종료 코드 3
4. 사양 판정 — 최소 미달이면 필요값·실제값 출력 후 종료 코드 3. 권장 미만이면 경고 출력 후 계속
5. 모델 로드 — 실패하면 원인 출력 후 종료 코드 4
6. HTTP 서버 기동 → 상태 파일 있으면 재연결, 없으면 등록
7. 등록 실패 — 토큰 무효(`registration_token_invalid`)·제거됨(`worker_removed`)·충돌·주소 검증 실패 → 사유 출력 후
   종료 코드 5. 게이트웨이 접속 불가는 10초 간격으로 최대 30회 재시도 후 종료 코드 5
8. 서비스 — `SIGTERM` 수신 시 처리 중 요청을 마치고 종료(최대 60초)

## 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 정상 종료 |
| 2 | 설정 오류(인자·모델 파일) |
| 3 | GPU 사양 미달·GPU 조회 불가·세대 미지원 |
| 4 | 모델 로드 실패 |
| 5 | 등록·재연결 실패 |

Docker `restart: unless-stopped`와 함께 쓸 때 코드 2·3·5는 재시작해도 해결되지 않으므로, 배포 문서는
`restart: on-failure:3`를 권장한다.
