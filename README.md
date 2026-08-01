# CofferGate Backend — 실행 가이드

이 문서는 배경지식 없이도 따라 하면서 CofferGate 백엔드를 실제로 실행하고, "AI 제안 → 정책 판정 → KMS Attestation"까지 전체 흐름을 눈으로 확인할 수 있도록 만들었습니다. 아키텍처 설명이나 전체 API 스펙 같은 참고 자료는 맨 아래 **5. 참고 자료**로 몰아 뒀습니다 — 지금은 건너뛰고 바로 실행하면 됩니다.

## 0. 준비물

- (1번을 따라가려면) `gcloud` CLI, `jq`, 프로젝트 접근 권한
- (2번을 따라가려면) Node.js 20+, npm

---

## 1. 가장 빠른 확인 — 이미 배포된 데모 그대로 실행해보기

코드를 내려받지 않고도, 실제 Cloud Run에 떠 있는 서비스를 그대로 호출해서 전체 흐름을 확인하는 방법입니다.

### 1-1. 프록시 열기

터미널 하나를 열어 아래 명령을 실행하고 그대로 둡니다(창을 닫지 마세요).

```bash
gcloud run services proxy coffergate-backend \
  --project=coffergate-devnet \
  --region=asia-northeast3 \
  --port=8085
```

`gcloud`가 자동으로 Google ID Token을 붙여 호출해 주므로, 이후 명령에는 별도 인증 헤더가 필요 없습니다. 이제 **새 터미널 창**을 열어 아래 단계를 이어갑니다.

### 1-2. 시스템이 살아있는지 확인

```bash
curl -s http://localhost:8085/api/v1/system/readiness | jq
```

`overallStatus`가 `"healthy"`이고 `services` 7개가 모두 `"healthy"`면 정상입니다.

### 1-3. 지금까지 쌓인 Proposal 목록 보기

```bash
curl -s http://localhost:8085/api/v1/proposals | jq '.data[] | {proposalId, action, decision, status}'
```

Cloud Scheduler가 5분마다 자동으로 Proposal을 생성하므로 서비스가 켜져 있었다면 이미 몇 건이 쌓여 있습니다. `decision`이 `"AUTO"`면 `status`는 `"SIMULATED"`(KMS 서명 완료), `decision`이 `"BLOCK"`이면 실행이 차단된 것입니다.

### 1-4. Proposal 하나를 자세히 보기 — Attestation 확인

위 목록에서 `proposalId` 하나를 골라 넣습니다.

```bash
curl -s http://localhost:8085/api/v1/proposals/<proposalId> | jq '.data | {decision, status, ruleChecks, execution}'
```

- `decision: "AUTO"`인 건은 `execution.attestationSignature`, `execution.attestedAt`이 채워져 있습니다 — Cloud KMS Ed25519로 실제 서명된 증거입니다.
- `decision: "BLOCK"`인 건은 `execution.kmsRequested: false`입니다 — 서명 자체가 요청되지 않았다는 뜻입니다.
- `ruleChecks` 배열을 보면 15개 규칙 중 어떤 것이 PASS/FAIL했는지 그대로 보입니다.

### 1-5. 지갑 상태(대시보드) 보기

```bash
curl -s http://localhost:8085/api/v1/dashboard | jq
```

여기까지가 "지금 실제로 돌아가고 있는 데모"를 확인하는 전부입니다.

---

## 2. 로컬에서 코드 실행하기 (개발자용)

### 2-1. 설치

```bash
git clone https://github.com/CofferGate/CofferGate_backend.git
cd CofferGate_backend
npm install
```

### 2-2. 가장 빠른 스모크 테스트 (메모리 모드)

```bash
npm run dev
```

다른 터미널에서:

```bash
curl -s http://localhost:8080/health/live
```

`{"status":"ok"}`가 나오면 서버 자체는 정상입니다. **주의**: 기본 모드(`REPOSITORY_MODE=memory`)에서는 Proposal 생성 API(`/internal/v1/*`)가 아예 등록되지 않습니다. AI 제안·정책 판정·Attestation까지 이어지는 실제 데모 흐름을 로컬에서 보려면 아래 2-3 단계가 필요합니다.

### 2-3. 로컬에서 전체 데모 흐름 재현하기 (Firestore 연동)

**1) 런타임 서비스 계정으로 로그인** — 실제 배포와 동일한 IAM 경로를 그대로 씁니다.

```bash
gcloud auth application-default login \
  --impersonate-service-account=<runtime-sa>@<project-id>.iam.gserviceaccount.com
```

**2) 환경 변수 설정** (실제 값으로 교체)

```bash
export REPOSITORY_MODE=firestore
export GOOGLE_CLOUD_PROJECT=<project-id>
export OPERATIONS_WALLET_ADDRESS=<wallet-address>
export USDC_MINT=<usdc-mint>
export USDC_TOKEN_ACCOUNT=<usdc-token-account>
export TARGET_USDC_BALANCE=20
export JUPITER_API_KEY=<jupiter-api-key>
export CLOUD_KMS_KEY_VERSION=projects/<project-id>/locations/asia-northeast3/keyRings/coffergate/cryptoKeys/demo-attestation/cryptoKeyVersions/1
export INTERNAL_TASK_TOKEN=$(openssl rand -hex 32)
export CLOUD_TASKS_LOCATION=asia-northeast3
export CLOUD_TASKS_QUEUE=demo-attestation
export CLOUD_TASKS_TARGET_BASE_URL=http://localhost:8080
export CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=<tasks-sa>@<project-id>.iam.gserviceaccount.com
```

**3) 정책 시딩** (최초 1회)

```bash
node scripts/seed-policy.mjs
```

**4) 서버 실행**

```bash
npm run dev
```

**5) 새 터미널에서 Proposal 생성을 직접 트리거**

```bash
curl -s -X POST http://localhost:8080/internal/v1/proposals/generate \
  -H "content-type: application/json" \
  -H "x-coffergate-task-token: $INTERNAL_TASK_TOKEN" \
  -d '{"proposalId":"manual-test-001"}' | jq
```

응답의 `decision`(AUTO/BLOCK)과 `ruleChecks`로 어떤 규칙이 통과·실패했는지 바로 보입니다.

**6) AUTO로 판정됐다면 Attestation을 수동으로 트리거** — 로컬 환경은 Cloud Tasks가 콜백할 수 없으므로 직접 호출합니다.

```bash
curl -s -X POST http://localhost:8080/internal/v1/demo-attestations/manual-test-001 \
  -H "x-coffergate-task-token: $INTERNAL_TASK_TOKEN" | jq
```

`attestationSignature`가 채워진 응답이 오면 성공입니다.

### 2-4. 테스트 실행

```bash
npm run typecheck
npm test
```

---

## 3. 새로 배포하기 (인프라를 처음부터 만들 때만)

이미 떠 있는 서비스를 쓸 거라면 이 단계는 건너뛰어도 됩니다.

```bash
# 1) 이미지 빌드
gcloud builds submit \
  --region=asia-northeast3 \
  --substitutions=_REGION=asia-northeast3,_ARTIFACT_REPOSITORY=coffergate,_SERVICE_NAME=coffergate-backend

# 2) Cloud Run 배포 + IAM (Runtime SA·Tasks SA·두 Secret은 사전에 생성돼 있어야 함)
PROJECT_ID='<project-id>' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
IMAGE_URI='asia-northeast3-docker.pkg.dev/<project-id>/coffergate/coffergate-backend:<build-id>' \
RUNTIME_SERVICE_ACCOUNT='<runtime-sa>@<project-id>.iam.gserviceaccount.com' \
TASKS_SERVICE_ACCOUNT='<tasks-sa>@<project-id>.iam.gserviceaccount.com' \
TASKS_QUEUE='demo-attestation' \
INTERNAL_TASK_TOKEN_SECRET='coffergate-internal-task-token' \
JUPITER_API_KEY_SECRET='coffergate-jupiter-api-key' \
CLOUD_KMS_KEY_VERSION='projects/<project-id>/locations/asia-northeast3/keyRings/coffergate/cryptoKeys/demo-attestation/cryptoKeyVersions/1' \
OPERATIONS_WALLET_ADDRESS='<solana-public-key>' \
USDC_MINT='<usdc-mint>' \
USDC_TOKEN_ACCOUNT='<usdc-token-account>' \
TARGET_USDC_BALANCE='20' \
./scripts/deploy-runtime.sh

# 3) 배포 검증 (실제 자금 이동 없이 IAM·Liveness·Readiness 확인)
PROJECT_ID='<project-id>' REGION='asia-northeast3' SERVICE_NAME='coffergate-backend' \
./scripts/verify-devnet-runtime.sh

# 4) 5분 주기 자동 Proposal 생성 스케줄러 등록
PROJECT_ID='<project-id>' \
REGION='asia-northeast3' \
SERVICE_NAME='coffergate-backend' \
SCHEDULER_JOB_NAME='coffergate-proposal-generation' \
SCHEDULER_SERVICE_ACCOUNT='<scheduler-sa>@<project-id>.iam.gserviceaccount.com' \
INTERNAL_TASK_TOKEN_SECRET='coffergate-internal-task-token' \
SCHEDULER_CRON='*/5 * * * *' \
SCHEDULER_TIME_ZONE='Etc/UTC' \
./scripts/deploy-scheduler.sh

# 5) 확인
gcloud scheduler jobs describe coffergate-proposal-generation --location=asia-northeast3
```

---

## 4. 문제가 생기면

**내부 API가 올바른 토큰인데도 `401 UNAUTHORIZED`**
Secret Manager 값에 트레일링 줄바꿈이 들어가면 바이트 길이가 달라져 인증 비교가 실패합니다. `printf '%s' "$TOKEN" | gcloud secrets versions add coffergate-internal-task-token --data-file=-`로 줄바꿈 없이 다시 등록하세요.

**`npm test`가 esbuild 관련 에러로 전부 실패**
`node_modules`를 다른 OS에서 동기화해 온 경우입니다. `npm install --no-save`로 현재 플랫폼용 바이너리를 다시 설치하세요.

**`gcloud run services proxy` 창을 닫았더니 curl이 connection refused**
1-1 단계의 프록시 터미널을 다시 켜세요.

**모든 Proposal이 `BLOCK`으로만 나옴**
`policies/current` 문서가 없으면 `POLICY_CONFIGURED` 규칙이 무조건 FAIL입니다. `node scripts/seed-policy.mjs`를 실행했는지 확인하세요.

**로컬(2-3단계)에서 AUTO 판정 후 `SIMULATED`로 안 바뀜**
로컬은 Cloud Tasks 콜백을 받을 수 없습니다. 2-3단계 6번처럼 `/internal/v1/demo-attestations/:proposalId`를 수동으로 호출해야 합니다.

**`/api/v1/dashboard`의 `balances`가 비어 있음**
`OPERATIONS_WALLET_ADDRESS`/`USDC_MINT`/`USDC_TOKEN_ACCOUNT` 값과 Devnet RPC 연결을 확인하세요. 로그의 `dashboard.wallet_state.failed` 이벤트로 원인을 볼 수 있습니다.

**Proposal의 `dataAsOf`가 전부 오래된 날짜(예: 2024년)로 찍힘**
버그가 아닙니다. `dataAsOf`는 잔고 관찰 시각과 Jupiter 가격 관찰 시각 중 더 이른 쪽을 씁니다(`proposal-generation-context.ts`의 `earliestObservation`). 잔고 관찰 시각은 매번 실제 현재 시각을 쓰지만, Jupiter Price API가 응답에 담아주는 `createdAt` 필드(`jupiter-price.ts`)는 가격 자체와 무관하게 오래된 값일 수 있고, 이게 항상 더 이르기 때문에 `dataAsOf`로 뽑힙니다. 가격 조회와 AI 판단, KMS 서명은 매 사이클 실제로 새로 일어납니다 — `execution.attestationSignature`가 Proposal마다 다르고 `execution.attestedAt`이 Scheduler 주기(5분)와 정확히 맞는지 보면 확인할 수 있습니다.

---

## 5. 참고 자료

실행에는 필요 없고, 구조를 더 깊이 이해하고 싶을 때만 보면 됩니다.

### 5-1. 아키텍처 요약

CofferGate는 Node.js 20 + TypeScript + Fastify로 작성된 **단일 Cloud Run 서비스**입니다. "Control Plane"과 "Private Executor"를 분리했던 초기 설계는 폐기되었고, AI 제안·정책 판정·Attestation 트리거가 모두 같은 프로세스 안에서 이루어집니다.

```
Cloud Scheduler (5분 주기)
   │ OIDC + x-coffergate-task-token
   ▼
Cloud Run: coffergate-backend (단일 Fastify 서비스)
   ├─ Vertex AI (Gemini)         → Proposal 초안 생성
   ├─ Solana RPC (Devnet, 읽기)  → SOL/USDC 잔고 조회
   ├─ Jupiter Price API          → 가격 조회 (견적만, 체결 없음)
   ├─ Policy Gate                → AUTO / BLOCK 판정 (코드, AI 아님)
   ├─ Firestore                  → policies / proposals / dailyUsage
   ├─ Cloud Tasks                → AUTO 승인 시 Attestation 비동기 트리거
   └─ Cloud KMS                  → Ed25519 Attestation 서명
```

**Devnet 데모는 실제 온체인 Swap을 제출하지 않습니다.** 심사 중 실자산이 이동하는 위험을 피하기 위한 의도적 선택이며, 같은 구조 위에 Mainnet 실행까지 확장하는 것을 다음 단계 로드맵으로 두고 있습니다.

### 5-2. 환경 변수 전체 목록

`src/config.ts`의 Zod 스키마가 검증합니다. `REPOSITORY_MODE=firestore`이고 `DATA_MODE=live`일 때만 "라이브 필수" 항목이 강제되며, 하나라도 비어 있으면 서버가 기동을 거부합니다.

| 변수 | 기본값 | 라이브 필수 | 설명 |
| --- | --- | --- | --- |
| `PORT` | `8080` | | 리스닝 포트 |
| `HOST` | `0.0.0.0` | | 리스닝 호스트 |
| `LOG_LEVEL` | (fastify 기본) | | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent` |
| `ENVIRONMENT` | `devnet` | | `mock`\|`devnet` |
| `DATA_MODE` | `live` | | `mock`\|`live` |
| `REPOSITORY_MODE` | `memory` | | `memory`\|`firestore` |
| `OPERATIONS_WALLET_ADDRESS` | `unconfigured` | ✅ | 운영 지갑 Solana 주소 |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | | Devnet RPC 엔드포인트 |
| `SOLANA_RPC_TIMEOUT_MS` | `5000` | | RPC 타임아웃(ms) |
| `SOL_MINT` | `So111...112` | | SOL Mint 주소 |
| `USDC_MINT` | — | ✅ | USDC Mint 주소 |
| `USDC_TOKEN_ACCOUNT` | — | ✅ | 운영 지갑의 USDC 토큰 계정 |
| `TARGET_USDC_BALANCE` | — | ✅ | 목표 USDC 잔고(운영자 설정, 숫자 문자열) |
| `PROPOSAL_TTL_SECONDS` | `300` | | Proposal 만료 시간(초) |
| `JUPITER_API_KEY` | — | ✅ | Jupiter Price API 키 |
| `JUPITER_PRICE_API_URL` | `https://api.jup.ag/price/v3` | | Jupiter 가격 조회 엔드포인트 |
| `JUPITER_TIMEOUT_MS` | `5000` | | Jupiter 요청 타임아웃(ms) |
| `CLOUD_KMS_KEY_VERSION` | — | ✅ | `projects/.../cryptoKeyVersions/1` 전체 경로 |
| `INTERNAL_TASK_TOKEN` | — | ✅ | 내부 API 인증 토큰(최소 32자) |
| `CLOUD_TASKS_LOCATION` | — | ✅ | Cloud Tasks 큐 리전 |
| `CLOUD_TASKS_QUEUE` | — | ✅ | Cloud Tasks 큐 이름 |
| `CLOUD_TASKS_TARGET_BASE_URL` | — | ✅ | Cloud Run 서비스 URL |
| `CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL` | — | ✅ | Cloud Tasks가 OIDC로 사용할 서비스 계정 |
| `CLOUD_TASKS_SCHEDULE_DELAY_SECONDS` | `5` | | Attestation 작업 지연 시간(초) |
| `GOOGLE_CLOUD_PROJECT` | — | ✅ | GCP 프로젝트 ID |
| `VERTEX_AI_LOCATION` | `us-central1` | | Vertex AI 리전 |
| `VERTEX_AI_MODEL` | `gemini-2.5-flash` | | 사용 모델 |
| `FIRESTORE_DATABASE_ID` | `(default)` | | Firestore 데이터베이스 ID |
| `FIRESTORE_PROPOSALS_COLLECTION` | `proposals` | | Proposal 컬렉션명 |
| `FIRESTORE_POLICIES_COLLECTION` | `policies` | | Policy 컬렉션명 |
| `FIRESTORE_CURRENT_POLICY_DOCUMENT` | `current` | | 현재 Policy 문서 ID |
| `FIRESTORE_DAILY_USAGE_COLLECTION` | `dailyUsage` | | 일일 사용량 컬렉션명 |

### 5-3. Policy Gate 규칙 (`src/services/policy-gate.ts`)

| 규칙 코드 | 검증 내용 |
| --- | --- |
| `CIRCUIT_BREAKER` | `policy.circuitBreakerStatus === "ACTIVE"` |
| `POLICY_VERSION` | Proposal이 참조한 정책 버전이 현재 버전과 일치 |
| `PROPOSAL_NOT_EXPIRED` | `expiresAt`이 아직 지나지 않음 |
| `DAILY_USAGE_VALID` | 당일 사용량이 유한한 0 이상 숫자 |
| `INPUT_MINT_PRESENT` / `OUTPUT_MINT_PRESENT` | (SWAP만) 입력/출력 Mint 존재 |
| `INPUT_ASSET_PRESENT` / `OUTPUT_ASSET_PRESENT` | (SWAP만) 입력/출력 자산 심볼 존재 |
| `AMOUNT_USD_PRESENT` | (SWAP만) USD 금액이 양수 |
| `INPUT_MINT_ALLOWLIST` / `OUTPUT_MINT_ALLOWLIST` | Mint가 allowlist에 포함 |
| `ASSET_ALLOWLIST_SOL` / `ASSET_ALLOWLIST_USDC` | 자산이 allowlist에 포함 |
| `MAX_TRANSACTION_USD` | 건당 금액이 `maxTransactionUsd` 이하 |
| `DAILY_LIMIT_USD` | 당일 누적 + 이번 금액이 `dailyLimitUsd` 이하 |

`NO_ACTION` Proposal은 상단 4개 공통 규칙만 평가됩니다. Policy 문서가 없으면 `POLICY_CONFIGURED` 규칙 하나만 무조건 FAIL로 채워집니다. 판정 로직(`hasFailure ? "BLOCK" : hasReview ? "ESCALATE" : "AUTO"`)에 `ESCALATE` 분기가 남아 있지만, 모든 규칙이 `PASS`/`FAIL` 이진 결과만 반환해 `hasReview`는 항상 `false`입니다 — 실제로 발생하는 판정은 `AUTO`/`BLOCK` 두 가지뿐입니다. `BLOCK`이면 `execution.kmsRequested`가 무조건 `false`로 고정됩니다.

Policy 문서 스키마(`src/contracts/policy.ts`)에는 `minimumReserve`, `maxSlippageBps`, `maxPriceImpactBps`, `quoteMaxAgeSeconds`, `allowedPrograms`, `allowedSigners`, `simulationRequired` 필드도 있지만, 위 표에 없다는 건 현재 Policy Gate가 아직 평가하지 않는다는 뜻입니다. Mainnet 실 체결을 붙일 때 쓸 필드로 미리 확보해 둔 것입니다.

### 5-4. API 레퍼런스

모든 요청은 Cloud Run이 `--no-allow-unauthenticated`로 배포돼 있어 `Authorization: Bearer <Google ID Token>`이 필요합니다(읽기 전용 GET 포함, `gcloud run services proxy`가 자동 처리). 정상 응답은 `{ data, meta }`, 오류 응답은 `{ code, message, retryable, requestId, proposalId? }` 형태입니다.

**공개 API**

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health/live` | 프로세스 생존 확인. 의존성 점검 없음 |
| GET | `/api/v1/system/readiness` | `control-plane`, `vertex-ai`, `firestore`, `private-executor`, `cloud-kms`, `jupiter-api`, `solana-rpc` 7개 서비스 상태 |
| GET | `/api/v1/proposals` | Proposal 목록(최신순) |
| GET | `/api/v1/proposals/:proposalId` | Proposal 상세(Policy 평가 결과 + Attestation 포함) |
| GET | `/api/v1/policy/current` | 현재 Policy 전체 |
| GET | `/api/v1/dashboard` | 지갑 잔고(SOL/USDC), 목표 잔고, 당일 사용량, Policy 요약 |

`control-plane`/`private-executor`는 별도 프로세스가 아니라 동일한 단일 서비스 상태를 가리키는 논리적 구분입니다.

**내부 API** (`x-coffergate-task-token` 헤더 추가 필요, `REPOSITORY_MODE=firestore` + `INTERNAL_TASK_TOKEN` 설정 시에만 라우트 등록)

| Method | Path | 호출 주체 | 설명 |
| --- | --- | --- | --- |
| POST | `/internal/v1/proposals/generate` | 운영자/수동 | Body `{ "proposalId": string }` — Observe→Propose→Decide 1회 실행 |
| POST | `/internal/v1/proposals/generate/scheduled` | Cloud Scheduler | `x-cloudscheduler-jobname`/`x-cloudscheduler-scheduletime` 헤더로 결정론적 Proposal ID 생성(중복 방지) |
| POST | `/internal/v1/demo-attestations/:proposalId` | Cloud Tasks(AUTO 시 자동 큐잉) | 해당 Proposal에 Cloud KMS Attestation 생성 |

응답 상태 코드: `200`(성공), `401 UNAUTHORIZED`, `400 INVALID_REQUEST`/`INVALID_SCHEDULER_REQUEST`, `409 POLICY_NOT_CONFIGURED`/`CONFLICT`/`ID_CONFLICT`, `503 PERSISTENCE_INCONSISTENCY`(재시도 가능, `Retry-After: 5`).

`execution` 스키마에는 `transactionSignature`, `reconciliation`, `simulation` 등 실 체결용 필드도 정의돼 있지만, 현재 Devnet 데모 흐름에서는 채워지지 않습니다. Mainnet 실행을 붙일 때 쓸 필드로 스키마에 미리 확보해 둔 상태입니다.

### 5-5. IAM 요약

| 서비스 계정 | 용도 | 권한 |
| --- | --- | --- |
| 런타임 SA(`coffergate-backend`) | Cloud Run 서비스 자체 | Firestore 읽기/쓰기, Vertex AI 호출, Cloud Tasks 큐잉, Cloud KMS 서명, Secret Manager 접근 |
| Cloud Tasks SA | Attestation 트리거 | 대상 Cloud Run `run.invoker`만 |
| Cloud Scheduler SA | 5분 주기 Proposal 생성 트리거 | 대상 Cloud Run `run.invoker`만 |
| 프론트엔드 런타임 SA | 프론트엔드 ID Token 발급 | 대상 Cloud Run `run.invoker`, 내부 Task Token Secret `secretAccessor`(로컬 개발용) |

### 5-6. 테스트 커버리지

`node:test` 기반 35개 파일, 104개 테스트(`npm test`). 주요 커버리지: `services/policy-gate.test.ts`(15개 규칙 전체 분기), `contracts/*.test.ts`(Zod 스키마), `providers/cloud-kms-attestation.test.ts`(Attestation 서명 흐름), `security/task-request-authorizer.test.ts`(내부 인증), `api/*.test.ts`(엔드포인트별 계약), `deployment/*.test.ts`(배포 스크립트 회귀 방지). CI(GitHub Actions)는 모든 PR/`main` Push에서 의존성 설치 → typecheck → test → 빌드 → 의존성 보안 검사 → Docker 이미지 빌드를 강제합니다.

### 5-7. 프로젝트 구조

```
src/
  app.ts                 라우트 및 의존성 조립
  server.ts               부트스트랩(config/repositories/services 조립 후 listen)
  config.ts               환경 변수 스키마
  contracts/               Zod 계약(api, console, enums, policy, proposal, system-readiness)
  services/                Policy Gate, Proposal 생성/평가, Attestation, Dashboard, Readiness
  providers/                Vertex AI, Solana RPC, Jupiter, Cloud KMS, Cloud Tasks 연동
  repositories/             Firestore/메모리 리포지토리
  security/                 내부 Task Token 인증
  errors/                   HTTP 오류 응답 매핑
scripts/
  deploy-runtime.sh          Cloud Run 배포 + IAM
  deploy-scheduler.sh        Cloud Scheduler 배포
  verify-devnet-runtime.sh   배포 후 IAM/Liveness/Readiness 검증
  seed-policy.mjs            초기 Policy Firestore 시딩
test/                     35개 테스트 파일(node:test)
```

### 5-8. Contract policy

- 외부 API는 camelCase DTO를 반환하며 `{ data, meta }` envelope를 사용합니다.
- `BLOCK` 응답은 `kmsRequested: false`로 서명되지 않은 경로를 증명합니다.
- 승인된 `AUTO` Proposal은 `SIMULATED` 상태와 Cloud KMS Attestation을 기록합니다.
- 브라우저는 내부 API와 Cloud KMS에 직접 접근하지 않습니다.
- Devnet 데모는 실제 Swap이나 자산 이동을 수행하지 않습니다.
