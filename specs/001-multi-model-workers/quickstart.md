# Quickstart: 검증 시나리오

**명세**: [spec.md](spec.md) | **계약**: [contracts/](contracts/) | **데이터 모델**: [data-model.md](data-model.md)

구현이 명세를 만족하는지 확인하는 실행 가이드다. 1~2단계는 개발 PC(GPU 불필요), 3~5단계는 doctordoom 등 GPU
서버에서 진행한다. 구현 코드는 이 문서에 넣지 않는다.

## 0. 사전 조건

- 이 워크트리(`.claude/worktrees/multi-model-workers`, 브랜치 `feat/multi-model-workers`)에서 작업
- 백엔드 `cd server && uv sync`, 프론트엔드 `cd web && npm ci`
- GPU 시나리오: NVIDIA 드라이버·Container Toolkit, 카탈로그 모델 파일 2종 이상(`qwen3-8b-q4km`, `gpt-oss-20b-mxfp4` 권장)

## 1. 자동 테스트 (헌법 V — PR 전 필수)

```bash
cd server && uv run pytest
```

```bash
cd server && uv run ruff check .
```

```bash
cd web && npm test && npm run build
```

기대 결과: 모두 통과. 특히 다음 테스트가 포함되어야 한다.

| 검증 대상 | 기대 |
|---|---|
| 라우터 5명 시나리오(가짜 워커 2개, 완료 시점 조종) | 처음 2건 즉시 배정, 3건 대기, Y 먼저 완료 시 1번째 대기 요청이 Y로 — 전달 순서 = 요청 순서(SC-011·012) |
| 빈 워커 우선 | X 바쁨·Y 빔 상태의 새 요청이 대기 없이 Y로(US3 시나리오 8) |
| 대기 중 취소·시간 초과·대기열 초과 | 취소 요청 제외 후 순서 유지, 초과 시 503 `server_overloaded` |
| 인스턴스 이탈 | 남은 인스턴스로 순서 유지, 전부 이탈 시 대기 요청 503 `model_not_ready` |
| 등록 | 토큰 만료·폐기 401, 중복 ID 409, 주소 검증 실패 422, 제거 후 재연결 401 `worker_removed` |
| 사양 판정 | 미달 종료 코드 3, 권장 미만 경고 후 등록, NVML 불가·세대 불일치 종료 |
| 외부 API 호환 | 기존 `test_v1_api.py` 전부 통과, 모델 2개에서 모델 미지정 400 `model_required` |

## 2. 실모델 통합 테스트 (소형 GGUF, CPU 가능)

```bash
cd server && CREFLEAI_TEST_GGUF=/path/to/tiny.gguf uv run pytest -m inference
```

기대 결과: 워커 단독 기동 → 등록 → `/v1/chat/completions` 일반·스트리밍 응답. GPU가 없는 환경에서는 사양 판정을
테스트용 GPU 조회 주입으로 통과시키는 테스트만 실행된다(제품 코드에는 강제 실행 옵션 없음).

## 3. doctordoom — GPU별 워커 2개 + 호환 모드

1. 게이트웨이 배포(호환 모드 유지): `crefleai-deploy-orchestrator`로 새 버전 배포
2. 관리자 화면 → 워커 → **등록 토큰 발급**(1시간)
3. 워커 2개 기동(같은 PC, GPU 0·1) — `deploy/worker/` compose 예시 사용, 같은 GPU 워커는 하나씩 기동
4. 확인

| 확인 | 기대 |
|---|---|
| 관리자 → 워커 목록 | 두 워커 `ready`, GPU·모델·사양 상태 표시 |
| `GET /v1/models`(사용자 토큰) | 두 모델 모두 표시 |
| 두 모델에 스트리밍 동시 요청 | 둘 다 끝까지 수신, 응답 `model` 일치 |
| 워커 1개 `docker stop` | 20초 안에 `offline`, 다른 모델 요청 계속 성공(SC-003·004) |
| 다시 `docker start` | 토큰 없이 재연결, 20초 안에 `ready` 복귀 |
| 관리자에서 워커 제거 후 재기동 | `worker_removed`로 종료 코드 5 |

## 4. 사양 미달 차단

| 확인 | 기대 |
|---|---|
| GPU 1개에 `llama-3.3-70b-instruct-q4km` 워커 기동(메모리 부족 GPU) | 필요값·실제값 출력, 종료 코드 3, 워커 목록에 없음(SC-008) |
| 관리자 → 모델 화면 | 각 모델 최소·권장 사양 표시, 로컬 GPU 미달 모델의 "서비스 시작" 비활성·사유 표시 |
| 권장 미만·최소 이상 구성 | 등록되고 "권장 사양 미달" 경고 표시 |

## 5. 부하 시험 — 같은 모델 워커 2개, 사용자 5명

같은 모델(`qwen3-8b-q4km`)로 워커 2개(GPU 0·1)를 띄우고, 사용자 5명 동시 요청을 20회 반복한다. 요청마다
요청 ID·도착 시각·배정 인스턴스·배정 시각·완료 시각을 게이트웨이 로그에서 수집한다.

| 지표 | 기준 |
|---|---|
| 빈 워커가 있는 동안 대기한 요청 | 0건(SC-011) |
| 두 워커가 함께 일한 시간 / 전체 처리 시간 | 90% 이상(SC-011) |
| 대기 요청의 배정 순서 = 도착 순서 | 100%(SC-012) |
| 모델 2개 동시 요청 시 첫 응답 지연 증가 | 단독 대비 20% 이하(SC-001) |

결과는 PR 본문 "검증" 절에 표로 남긴다. 수행하지 못한 항목은 "미수행"으로 명시한다(헌법 V).
