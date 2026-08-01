#!/usr/bin/env bash
set -euo pipefail

required_variables=(PROJECT_ID REGION SERVICE_NAME PROPOSAL_ID INTERNAL_TASK_TOKEN_SECRET)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
done
if [[ "${CONFIRM_DEVNET_EXECUTION:-}" != "YES" ]]; then
  echo "Set CONFIRM_DEVNET_EXECUTION=YES to authorize one Devnet transaction." >&2
  exit 1
fi

MAX_E2E_AMOUNT_USD="${MAX_E2E_AMOUNT_USD:-1}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-30}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

service_url="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
identity_token="$(gcloud auth print-identity-token --audiences="${service_url}")"
internal_token="$(gcloud secrets versions access latest \
  --project="${PROJECT_ID}" --secret="${INTERNAL_TASK_TOKEN_SECRET}")"
if [[ -z "${service_url}" || -z "${identity_token}" || ${#internal_token} -lt 32 ]]; then
  echo "Devnet execution credentials are incomplete." >&2
  exit 1
fi

proposal_url="${service_url}/api/v1/proposals/${PROPOSAL_ID}"
curl --fail --silent --show-error \
  --header="authorization: Bearer ${identity_token}" \
  "${proposal_url}" >"${temporary_directory}/proposal.json"
node -e '
const response = require(process.argv[1]);
const proposal = response.data;
const maximum = Number(process.argv[2]);
if (response.meta?.environment !== "devnet") throw new Error("Runtime is not Devnet.");
if (proposal?.status !== "POLICY_APPROVED" || proposal?.decision !== "AUTO" || proposal?.action !== "SWAP") {
  throw new Error("Proposal is not an AUTO-approved swap.");
}
if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isFinite(proposal.amountUsd) || proposal.amountUsd > maximum) {
  throw new Error("Proposal exceeds the Devnet E2E amount limit.");
}
' "${temporary_directory}/proposal.json" "${MAX_E2E_AMOUNT_USD}"

curl --fail --silent --show-error --request=POST \
  --header="authorization: Bearer ${identity_token}" \
  --header="x-coffergate-task-token: ${internal_token}" \
  "${service_url}/internal/v1/executions/${PROPOSAL_ID}/submit" \
  >"${temporary_directory}/submission.json"
node -e '
const response = require(process.argv[1]);
if (response.status !== "SUBMITTED" || !response.signature) {
  throw new Error(`Execution was not submitted: ${JSON.stringify(response)}`);
}
' "${temporary_directory}/submission.json"

for ((attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1)); do
  curl --fail --silent --show-error \
    --header="authorization: Bearer ${identity_token}" \
    "${proposal_url}" >"${temporary_directory}/result.json"
  result="$(node -e '
const proposal = require(process.argv[1]).data;
if (proposal.status === "RECONCILED" && proposal.execution?.reconciliation?.status === "MATCHED" && proposal.execution?.transactionSignature) {
  process.stdout.write(`SUCCESS:${proposal.execution.transactionSignature}`);
} else if (["FAILED", "BLOCKED", "EXPIRED"].includes(proposal.status)) {
  process.stdout.write(`FAILED:${proposal.status}`);
} else {
  process.stdout.write(`WAIT:${proposal.status}`);
}
' "${temporary_directory}/result.json")"
  if [[ "${result}" == SUCCESS:* ]]; then
    unset identity_token internal_token
    echo "Devnet execution ${PROPOSAL_ID} reconciled with signature ${result#SUCCESS:}."
    exit 0
  fi
  if [[ "${result}" == FAILED:* ]]; then
    echo "Devnet execution reached terminal state ${result#FAILED:}." >&2
    exit 1
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
done

echo "Devnet execution did not reconcile within the polling deadline." >&2
exit 1
