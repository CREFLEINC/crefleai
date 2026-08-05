# CrefleAI Web

CrefleAI 관리자·Chat 화면 (Vite + React + TypeScript).

- `/admin` — 관리자: 모델 다운로드·서비스 관리, API 토큰 발급·폐기
- `/chat` — Chat 테스트: 발급받은 토큰으로 서비스 중인 모델과 스트리밍 대화

## 개발

```bash
npm install
npm run dev     # 개발 서버 — /api·/v1 요청은 localhost:8000(백엔드)으로 프록시
```

## 테스트 · 린트 · 빌드

```bash
npm test        # vitest (jsdom + testing-library)
npm run lint    # oxlint
npm run build   # 프로덕션 빌드 → dist/
```

빌드 결과물(`dist/`)은 서버가 `CREFLEAI_WEB_DIST` 경로로 정적 서빙하며, 배포 이미지에 포함된다. 배포는 저장소 루트의 `deploy/README.md` 참조.
