# CrefleAI

사내 로컬 서버에서 오픈 소스 LLM(GGUF)을 OpenAI 호환 API로 서비스하는 서버.

- 설계 문서: `docs/superpowers/specs/2026-08-03-crefleai-llm-server-design.md`

## 요구 사항

- 운영: NVIDIA GPU 리눅스 서버 (CUDA 12+)
- Python 3.11+ / [uv](https://docs.astral.sh/uv/) / Node 20+

## 설치 (GPU 서버)

```bash
cd server
uv sync
# llama-cpp-python CUDA 빌드 (GPU 서버에서만 필요)
CMAKE_ARGS="-DGGML_CUDA=on" uv pip install -e ".[worker]"

cd ../web
npm ci && npm run build
```

## 실행

```bash
export CREFLEAI_JWT_SECRET="$(openssl rand -hex 32)"   # 필수
export CREFLEAI_ADMIN_ID=admin                          # 최초 1회 관리자 계정 생성용
export CREFLEAI_ADMIN_PASSWORD='초기-비밀번호'

cd server && uv run crefleai
```

- 관리자 화면: `http://<서버>:8000/admin` — 모델 다운로드 → 서비스 시작 → 토큰 발급
- Chat 테스트: `http://<서버>:8000/chat`
- API 사용: `openai` SDK에서 `base_url="http://<서버>:8000/v1"`, `api_key=<발급 토큰>`

## 개발

```bash
cd server && uv run pytest          # 백엔드 테스트
cd web && npm run dev               # 프론트 개발 서버 (8000 프록시)
cd web && npm test                  # 프론트 테스트

# 실모델 통합 테스트 (선택, 소형 GGUF 필요)
CREFLEAI_TEST_GGUF=/path/to/tiny.gguf uv run pytest -m inference -v
```
