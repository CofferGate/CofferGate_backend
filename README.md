# CofferGate Backend

CofferGate의 Google Cloud 기반 Control Plane과 Private Executor를 구현합니다.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

## Contract policy

- 외부 API는 프론트엔드 v5 Zod 계약과 동일한 camelCase DTO를 반환합니다.
- 정상 응답은 `{ data, meta }` envelope를 사용합니다.
- BLOCK 응답은 `kmsRequested: false`로 무서명 경로를 증명합니다.
- 브라우저는 Private Executor와 Cloud KMS에 직접 접근하지 않습니다.

## HTTP endpoints

- `GET /health/live`
- `GET /api/v1/system/readiness`
- `GET /api/v1/proposals`
- `GET /api/v1/proposals/:proposalId`
- `GET /api/v1/policy/current`
