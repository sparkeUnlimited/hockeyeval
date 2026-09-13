#!/usr/bin/env bash
# Create a Cognito user in the admin or evaluator group.
#
#   scripts/create-user.sh <email> admin      [--password '<permanent password>']
#   scripts/create-user.sh <email> evaluator  [--label 'Evaluator 3'] [--password '<permanent password>']
#
# Without --password Cognito emails a temporary password and the user sets their own on first sign-in.
# With --password the password is set as permanent (use for the first admin and for test accounts).
# Evaluators created here also get a profile row so they show up in the admin "By evaluator" tab.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS="$ROOT/infra/outputs.json"
REGION="${AWS_REGION:-ca-central-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

EMAIL="${1:-}"; GROUP="${2:-}"; shift 2 || true
PASSWORD=""; LABEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password) PASSWORD="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$EMAIL" && ( "$GROUP" == "admin" || "$GROUP" == "evaluator" ) ]] || {
  echo "usage: $0 <email> <admin|evaluator> [--label 'Evaluator 3'] [--password '<permanent>']" >&2; exit 2; }
[[ -f "$OUTPUTS" ]] || { echo "!! $OUTPUTS not found; deploy first" >&2; exit 1; }

POOL="$(node -p "require('$OUTPUTS').TryoutEvaluator.UserPoolId")"
TABLE="$(node -p "require('$OUTPUTS').TryoutEvaluator.TableName")"
EMAIL="$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]')"

echo ">> creating $EMAIL in pool $POOL"
SUB="$(aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --query "User.Attributes[?Name=='sub'].Value | [0]" --output text)"

aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$GROUP"

if [[ -n "$PASSWORD" ]]; then
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$EMAIL" --password "$PASSWORD" --permanent
  echo ">> permanent password set"
else
  echo ">> temporary password emailed to $EMAIL"
fi

if [[ "$GROUP" == "evaluator" ]]; then
  LABEL="${LABEL:-Evaluator}"
  aws dynamodb put-item --table-name "$TABLE" --item "{
    \"PK\": {\"S\": \"USER#$SUB\"}, \"SK\": {\"S\": \"META\"},
    \"GSI1PK\": {\"S\": \"USERS\"}, \"GSI1SK\": {\"S\": \"USER#$SUB\"},
    \"userId\": {\"S\": \"$SUB\"}, \"displayName\": {\"S\": \"$LABEL\"}, \"role\": {\"S\": \"evaluator\"}
  }"
  echo ">> evaluator profile written ($LABEL)"
fi
echo "done: $GROUP $EMAIL (sub $SUB)"
