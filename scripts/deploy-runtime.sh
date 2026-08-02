#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  PROJECT_ID REGION SERVICE_NAME IMAGE_URI RUNTIME_SERVICE_ACCOUNT
  TASKS_SERVICE_ACCOUNT TASKS_QUEUE INTERNAL_TASK_TOKEN_SECRET
  JUPITER_API_KEY_SECRET CLOUD_KMS_KEY_VERSION OPERATIONS_WALLET_ADDRESS
  USDC_MINT USDC_TOKEN_ACCOUNT TARGET_USDC_BALANCE
  DEVNET_PAYMENT_DESTINATION_TOKEN_ACCOUNT DEVNET_PAYMENT_AMOUNT_ATOMIC
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
done

if [[ ! "${CLOUD_KMS_KEY_VERSION}" =~ ^projects/[^/]+/locations/([^/]+)/keyRings/([^/]+)/cryptoKeys/([^/]+)/cryptoKeyVersions/[^/]+$ ]]; then
  echo "CLOUD_KMS_KEY_VERSION must be a CryptoKeyVersion resource name." >&2
  exit 1
fi
kms_location="${BASH_REMATCH[1]}"
kms_key_ring="${BASH_REMATCH[2]}"
kms_key="${BASH_REMATCH[3]}"
runtime_member="serviceAccount:${RUNTIME_SERVICE_ACCOUNT}"
tasks_member="serviceAccount:${TASKS_SERVICE_ACCOUNT}"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${runtime_member}" --role='roles/datastore.user' --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${runtime_member}" --role='roles/aiplatform.user' --quiet >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${runtime_member}" --role='roles/cloudtasks.enqueuer' --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${TASKS_SERVICE_ACCOUNT}" \
  --project="${PROJECT_ID}" --member="${runtime_member}" \
  --role='roles/iam.serviceAccountUser' --quiet >/dev/null
gcloud kms keys add-iam-policy-binding "${kms_key}" \
  --project="${PROJECT_ID}" --location="${kms_location}" --keyring="${kms_key_ring}" \
  --member="${runtime_member}" --role='roles/cloudkms.signerVerifier' --quiet >/dev/null
gcloud kms keys add-iam-policy-binding "${kms_key}" \
  --project="${PROJECT_ID}" --location="${kms_location}" --keyring="${kms_key_ring}" \
  --member="${runtime_member}" --role='roles/cloudkms.publicKeyViewer' --quiet >/dev/null
for secret_name in "${INTERNAL_TASK_TOKEN_SECRET}" "${JUPITER_API_KEY_SECRET}"; do
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project="${PROJECT_ID}" --member="${runtime_member}" \
    --role='roles/secretmanager.secretAccessor' --quiet >/dev/null
done

if ! gcloud tasks queues describe "${TASKS_QUEUE}" \
  --project="${PROJECT_ID}" --location="${REGION}" >/dev/null 2>&1; then
  gcloud tasks queues create "${TASKS_QUEUE}" \
    --project="${PROJECT_ID}" --location="${REGION}" --quiet >/dev/null
fi

environment_variables="REPOSITORY_MODE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},ENVIRONMENT=${ENVIRONMENT:-devnet},DATA_MODE=live,LOG_LEVEL=${LOG_LEVEL:-info},OPERATIONS_WALLET_ADDRESS=${OPERATIONS_WALLET_ADDRESS},USDC_MINT=${USDC_MINT},USDC_TOKEN_ACCOUNT=${USDC_TOKEN_ACCOUNT},TARGET_USDC_BALANCE=${TARGET_USDC_BALANCE},DEVNET_PAYMENT_DESTINATION_TOKEN_ACCOUNT=${DEVNET_PAYMENT_DESTINATION_TOKEN_ACCOUNT},DEVNET_PAYMENT_AMOUNT_ATOMIC=${DEVNET_PAYMENT_AMOUNT_ATOMIC},DEVNET_PAYMENT_DECIMALS=${DEVNET_PAYMENT_DECIMALS:-6},CLOUD_KMS_KEY_VERSION=${CLOUD_KMS_KEY_VERSION},CLOUD_TASKS_LOCATION=${REGION},CLOUD_TASKS_QUEUE=${TASKS_QUEUE},CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL=${TASKS_SERVICE_ACCOUNT},CLOUD_TASKS_TARGET_BASE_URL=https://placeholder.invalid"

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --platform=managed \
  --image="${IMAGE_URI}" --service-account="${RUNTIME_SERVICE_ACCOUNT}" \
  --set-env-vars="${environment_variables}" \
  --set-secrets="INTERNAL_TASK_TOKEN=${INTERNAL_TASK_TOKEN_SECRET}:latest,JUPITER_API_KEY=${JUPITER_API_KEY_SECRET}:latest" \
  --no-allow-unauthenticated --quiet

service_url="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
if [[ -z "${service_url}" ]]; then
  echo "Cloud Run service URL was not found." >&2
  exit 1
fi
gcloud run services update "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" \
  --update-env-vars="CLOUD_TASKS_TARGET_BASE_URL=${service_url}" --quiet >/dev/null
gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" \
  --member="${tasks_member}" --role='roles/run.invoker' --quiet >/dev/null

echo "Cloud Run runtime ${SERVICE_NAME} deployed at ${service_url}."
