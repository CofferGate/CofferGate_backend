#!/usr/bin/env bash
set -euo pipefail

required_variables=(PROJECT_ID REGION SERVICE_NAME)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
done

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

service_url="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
if [[ -z "${service_url}" ]]; then
  echo "Cloud Run service URL was not found." >&2
  exit 1
fi
if identity_token="$(gcloud auth print-identity-token --audiences="${service_url}" 2>/dev/null)"; then
  :
else
  identity_token="$(gcloud auth print-identity-token)"
fi
if [[ -z "${identity_token}" ]]; then
  echo "An identity token could not be created." >&2
  exit 1
fi

gcloud run services get-iam-policy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format=json \
  >"${temporary_directory}/iam.json"
node -e '
const policy = require(process.argv[1]);
const publicMembers = new Set(["allUsers", "allAuthenticatedUsers"]);
if ((policy.bindings ?? []).some((binding) =>
  (binding.members ?? []).some((member) => publicMembers.has(member)))) {
  throw new Error("Cloud Run service allows public invocation.");
}
' "${temporary_directory}/iam.json"

curl --fail --silent --show-error \
  --header "authorization: Bearer ${identity_token}" \
  "${service_url}/health/live" >"${temporary_directory}/liveness.json"
node -e '
const response = require(process.argv[1]);
if (response.status !== "ok") throw new Error("Liveness response is invalid.");
' "${temporary_directory}/liveness.json"

curl --fail --silent --show-error \
  --header "authorization: Bearer ${identity_token}" \
  "${service_url}/api/v1/system/readiness" >"${temporary_directory}/readiness.json"
node -e '
const response = require(process.argv[1]);
const readiness = response.data;
const required = ["control-plane", "vertex-ai", "firestore", "private-executor", "cloud-kms", "jupiter-api", "solana-rpc"];
if (readiness?.network !== "devnet" || readiness?.dataMode !== "live") {
  throw new Error("Runtime is not configured for live Devnet data.");
}
if (readiness.overallStatus !== "healthy") {
  const failures = (readiness.services ?? []).filter((service) => service.status !== "healthy");
  throw new Error(`Runtime readiness is ${readiness.overallStatus}: ${JSON.stringify(failures)}`);
}
const ids = new Set((readiness.services ?? []).map((service) => service.serviceId));
if (required.some((serviceId) => !ids.has(serviceId)) || ids.size !== required.length) {
  throw new Error("Readiness response does not contain every required service.");
}
' "${temporary_directory}/readiness.json"

unset identity_token
echo "Devnet runtime ${SERVICE_NAME} passed IAM, liveness, and readiness checks."
