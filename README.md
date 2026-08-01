# CofferGate Backend

CofferGate의 Google Cloud 기반 Control Plane과 Private Executor를 구현합니다.

## Development

```bash
npm install
npm run typecheck
npm test
npm run dev
```

Firestore를 사용할 때는 Application Default Credentials를 구성하고 다음 환경 변수를 설정합니다.

```bash
REPOSITORY_MODE=firestore
GOOGLE_CLOUD_PROJECT=your-project-id
FIRESTORE_DATABASE_ID='(default)'
INTERNAL_TASK_TOKEN='at-least-32-characters-from-secret-manager'
CLOUD_TASKS_LOCATION='asia-northeast3'
CLOUD_TASKS_QUEUE='confirmation'
CLOUD_TASKS_TARGET_BASE_URL='https://your-cloud-run-service.run.app'
CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL='tasks@your-project.iam.gserviceaccount.com'
```

Proposal은 `proposals/{proposalId}`, 현재 Policy는 `policies/current`, 일일 사용량은 `dailyUsage/{YYYY-MM-DD}` 문서에서 조회합니다. 컬렉션명과 현재 Policy 문서 ID는 환경 변수로 변경할 수 있습니다.

확정 실행의 사용량은 `dailyUsageLedger/{executionId}`를 멱등 원장으로 사용해 `dailyUsage/{YYYY-MM-DD}`에 원자적으로 누적합니다.

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
- `GET /api/v1/dashboard`
- `POST /internal/v1/executions/:proposalId/confirm` (Firestore mode, Cloud Run OIDC + 내부 Token 인증)
