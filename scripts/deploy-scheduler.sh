#!/usr/bin/env bash
set -euo pipefail

required_variables=(
  PROJECT_ID
  REGION
  SERVICE_NAME
  SCHEDULER_JOB_NAME
  SCHEDULER_SERVICE_ACCOUNT
  INTERNAL_TASK_TOKEN_SECRET
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
done

SCHEDULER_LOCATION="${SCHEDULER_LOCATION:-${REGION}}"
SCHEDULER_CRON="${SCHEDULER_CRON:-*/5 * * * *}"
SCHEDULER_TIME_ZONE="${SCHEDULER_TIME_ZONE:-Etc/UTC}"

service_url="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)')"

if [[ -z "${service_url}" ]]; then
  echo "Cloud Run service URL was not found." >&2
  exit 1
fi

gcloud run services add-iam-policy-binding "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SCHEDULER_SERVICE_ACCOUNT}" \
  --role='roles/run.invoker' \
  --quiet >/dev/null

internal_task_token="$(gcloud secrets versions access latest \
  --project="${PROJECT_ID}" \
  --secret="${INTERNAL_TASK_TOKEN_SECRET}")"

if [[ ${#internal_task_token} -lt 32 ]]; then
  echo "Internal task token must contain at least 32 characters." >&2
  exit 1
fi

scheduler_arguments=(
  "${SCHEDULER_JOB_NAME}"
  "--project=${PROJECT_ID}"
  "--location=${SCHEDULER_LOCATION}"
  "--schedule=${SCHEDULER_CRON}"
  "--time-zone=${SCHEDULER_TIME_ZONE}"
  "--uri=${service_url}/internal/v1/proposals/generate/scheduled"
  "--http-method=POST"
  "--oidc-service-account-email=${SCHEDULER_SERVICE_ACCOUNT}"
  "--oidc-token-audience=${service_url}"
  "--headers=x-coffergate-task-token=${internal_task_token}"
  "--attempt-deadline=300s"
  "--max-retry-attempts=5"
  "--min-backoff=5s"
  "--max-backoff=60s"
  "--max-doublings=3"
  "--quiet"
)

if gcloud scheduler jobs describe "${SCHEDULER_JOB_NAME}" \
  --project="${PROJECT_ID}" \
  --location="${SCHEDULER_LOCATION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${scheduler_arguments[@]}"
else
  gcloud scheduler jobs create http "${scheduler_arguments[@]}"
fi

unset internal_task_token
echo "Cloud Scheduler job ${SCHEDULER_JOB_NAME} targets ${service_url}."
