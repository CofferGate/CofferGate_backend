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
VERTEX_AI_LOCATION='us-central1'
VERTEX_AI_MODEL='gemini-2.5-flash'
SOL_MINT='So11111111111111111111111111111111111111112'
USDC_MINT='network-usdc-mint'
USDC_TOKEN_ACCOUNT='operations-wallet-usdc-token-account'
TARGET_USDC_BALANCE='20'
PROPOSAL_TTL_SECONDS='300'
JUPITER_API_KEY='secret-manager-value'
CLOUD_KMS_KEY_VERSION='projects/project/locations/location/keyRings/ring/cryptoKeys/key/cryptoKeyVersions/1'
MAX_PRIORITY_FEE_LAMPORTS='1000000'
SIMULATION_COMPUTE_MARGIN_BPS='2000'
MAX_COMPUTE_UNITS='1400000'
```

Proposal은 `proposals/{proposalId}`, 서명된 실행 Intent는 `executionIntents/{proposalId}`, 현재 Policy는 `policies/current`, 일일 사용량은 `dailyUsage/{YYYY-MM-DD}` 문서에서 조회합니다. 컬렉션명과 현재 Policy 문서 ID는 환경 변수로 변경할 수 있습니다.

확정 실행의 사용량은 `dailyUsageLedger/{executionId}`를 멱등 원장으로 사용해 `dailyUsage/{YYYY-MM-DD}`에 원자적으로 누적합니다.

## Contract policy

- 외부 API는 프론트엔드 v5 Zod 계약과 동일한 camelCase DTO를 반환합니다.
- 정상 응답은 `{ data, meta }` envelope를 사용합니다.
- BLOCK 응답은 `kmsRequested: false`로 무서명 경로를 증명합니다.
- 브라우저는 Private Executor와 Cloud KMS에 직접 접근하지 않습니다.

## Cloud Run deployment

`cloudbuild.yaml`은 컨테이너를 Artifact Registry에 저장하고 Cloud Run에 배포합니다. 저장소와 서비스가 준비된 프로젝트에서 다음 명령을 실행합니다.

```bash
gcloud builds submit \
  --region=asia-northeast3 \
  --substitutions=_REGION=asia-northeast3,_ARTIFACT_REPOSITORY=coffergate,_SERVICE_NAME=coffergate-backend
```

런타임 환경 변수와 Secret Manager 연결은 Cloud Run 서비스 설정에서 관리하며 이미지와 `cloudbuild.yaml`에는 Secret 값을 저장하지 않습니다.

운영 Runtime의 IAM·Secret·KMS·Cloud Tasks Queue와 Cloud Run 설정은 다음 스크립트로 적용합니다. Runtime 및 Tasks 서비스 계정과 두 Secret은 사전에 생성해야 합니다.

```bash
PROJECT_ID='your-project-id' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
IMAGE_URI='asia-northeast3-docker.pkg.dev/your-project-id/coffergate/coffergate-backend:build-id' \
RUNTIME_SERVICE_ACCOUNT='runtime@your-project-id.iam.gserviceaccount.com' \
TASKS_SERVICE_ACCOUNT='tasks@your-project-id.iam.gserviceaccount.com' \
TASKS_QUEUE='execution' \
INTERNAL_TASK_TOKEN_SECRET='coffergate-internal-task-token' \
JUPITER_API_KEY_SECRET='coffergate-jupiter-api-key' \
CLOUD_KMS_KEY_VERSION='projects/your-project-id/locations/asia-northeast3/keyRings/coffergate/cryptoKeys/solana/cryptoKeyVersions/1' \
OPERATIONS_WALLET_ADDRESS='solana-public-key' \
USDC_MINT='network-usdc-mint' \
USDC_TOKEN_ACCOUNT='operations-wallet-usdc-token-account' \
TARGET_USDC_BALANCE='20' \
./scripts/deploy-runtime.sh
```

스크립트는 Runtime 계정에 Firestore·Vertex AI·Cloud Tasks·KMS 서명·Secret 접근 권한을 부여하고, Tasks 계정에는 Cloud Run Invoker 권한만 부여합니다. Cloud Run은 인증 없는 호출을 허용하지 않습니다.

운영 배포는 기본 `LOG_LEVEL=info`로 요청과 Proposal 생성·제출·확인 결과를 구조화 로그로 기록합니다. `x-coffergate-task-token` Header는 로그에서 자동으로 마스킹됩니다.

배포 후 실제 자금 이동 없이 Devnet IAM·Liveness·Readiness를 검증합니다.

```bash
PROJECT_ID='your-project-id' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
./scripts/verify-devnet-runtime.sh
```

승인된 소액 Proposal 하나로 실제 Devnet 제출·확정·정산을 검증할 때만 명시적 실행 확인값과 USD 상한을 설정합니다.

```bash
PROJECT_ID='your-project-id' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
PROPOSAL_ID='approved-proposal-id' \
INTERNAL_TASK_TOKEN_SECRET='coffergate-internal-task-token' \
MAX_E2E_AMOUNT_USD='1' \
CONFIRM_DEVNET_EXECUTION='YES' \
./scripts/verify-devnet-execution.sh
```

### Scheduled proposal generation

Cloud Run 배포와 내부 Token Secret 생성 후 다음 환경 변수를 설정해 Cloud Scheduler Job을 생성하거나 갱신합니다.

```bash
PROJECT_ID='your-project-id' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
SCHEDULER_JOB_NAME='coffergate-proposal-generation' \
SCHEDULER_SERVICE_ACCOUNT='scheduler@your-project-id.iam.gserviceaccount.com' \
INTERNAL_TASK_TOKEN_SECRET='coffergate-internal-task-token' \
SCHEDULER_CRON='*/5 * * * *' \
SCHEDULER_TIME_ZONE='Etc/UTC' \
./scripts/deploy-scheduler.sh
```

스크립트는 Scheduler 서비스 계정에 Cloud Run Invoker 역할을 부여하고 OIDC 대상과 재시도 정책을 설정합니다. 내부 Token은 Secret Manager에서 읽으며 파일이나 Git에 저장하지 않습니다. Scheduler Job 조회 권한이 있는 사용자는 HTTP Header 설정을 볼 수 있으므로 해당 리소스의 IAM 권한도 최소화해야 합니다.

## HTTP endpoints

- `GET /health/live`
- `GET /api/v1/system/readiness`
- `GET /api/v1/proposals`
- `GET /api/v1/proposals/:proposalId`
- `GET /api/v1/policy/current`
- `GET /api/v1/dashboard`
- `POST /internal/v1/executions/:proposalId/submit` (Firestore mode, Cloud Run OIDC + 내부 Token 인증)
- `POST /internal/v1/executions/:proposalId/confirm` (Firestore mode, Cloud Run OIDC + 내부 Token 인증)
- `POST /internal/v1/proposals/generate` (Firestore mode, Cloud Run OIDC + 내부 Token 인증)
- `POST /internal/v1/proposals/generate/scheduled` (Cloud Scheduler 전용, 예약 시각 기반 멱등 ID)
