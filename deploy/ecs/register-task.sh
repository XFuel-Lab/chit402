#!/usr/bin/env bash
# Register an ECS task definition after substituting identifiers from the environment.
# Required: AWS_ACCOUNT_ID, ECS_CLUSTER, ECR_REPOSITORY, AWS_SECRET_ARN
# Optional: AWS_REGION (default us-east-1)
# Untracked local config: services/sp1-prover/aws-env.local.ps1 or the shell environment.
set -euo pipefail

: "${AWS_ACCOUNT_ID:?Set AWS_ACCOUNT_ID}"
: "${ECS_CLUSTER:?Set ECS_CLUSTER}"
: "${ECR_REPOSITORY:?Set ECR_REPOSITORY}"
: "${AWS_SECRET_ARN:?Set AWS_SECRET_ARN}"
: "${AWS_REGION:=us-east-1}"

if [[ ! "$AWS_ACCOUNT_ID" =~ ^[0-9]{12}$ ]]; then
  echo "AWS_ACCOUNT_ID must be a 12-digit account id" >&2
  exit 1
fi

src="${1:-deploy/ecs/sp1-prover-task.json}"
tmp="$(mktemp)"
sed \
  -e "s/<AWS_ACCOUNT_ID>/${AWS_ACCOUNT_ID}/g" \
  -e "s/<ECS_CLUSTER>/${ECS_CLUSTER}/g" \
  -e "s/<ECR_REPOSITORY>/${ECR_REPOSITORY}/g" \
  -e "s|<AWS_SECRET_ARN>|${AWS_SECRET_ARN}|g" \
  "$src" > "$tmp"
aws ecs register-task-definition --cli-input-json "file://${tmp}" --region "$AWS_REGION"
rm -f "$tmp"
