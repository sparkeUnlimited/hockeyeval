#!/usr/bin/env bash
# Create a Cognito user in the admin or evaluator group.
#
#   scripts/create-user.sh <email> admin      [--password '<permanent password>'] [--invite]
#   scripts/create-user.sh <email> evaluator  [--label 'Evaluator 3'] [--password '<permanent password>'] [--invite]
#
# Default: passwordless. No email is sent; the user opens the app and signs in with their email + the
# one-time code Cognito emails them at that moment.
# --password sets a permanent password too (needed for scripts and the automated dry run).
# --invite   sends Cognito's invitation email with a temporary password instead (old-style first login).
# Evaluators created here also get a profile row so they show up in the admin "By evaluator" tab.
# Remember to add evaluators to the tryout on the Setup tab ("Add to tryout") before they can score.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUTS="$ROOT/infra/outputs.json"
REGION="${AWS_REGION:-ca-central-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

EMAIL="${1:-}"; GROUP="${2:-}"; shift 2 || true
PASSWORD=""; LABEL=""; INVITE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --password) PASSWORD="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --invite) INVITE=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$EMAIL" && ( "$GROUP" == "admin" || "$GROUP" == "evaluator" ) ]] || {
  echo "usage: $0 <email> <admin|evaluator> [--label 'Evaluator 3'] [--password '<permanent>'] [--invite]" >&2; exit 2; }
[[ -f "$OUTPUTS" ]] || { echo "!! $OUTPUTS not found; deploy first" >&2; exit 1; }

POOL="$(node -p "require('$OUTPUTS').TryoutEvaluator.UserPoolId")"
TABLE="$(node -p "require('$OUTPUTS').TryoutEvaluator.TableName")"
EMAIL="$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]')"

echo ">> creating $EMAIL in pool $POOL"
MSG_ARGS=(--message-action SUPPRESS)
[[ "$INVITE" -eq 1 ]] && MSG_ARGS=(--desired-delivery-mediums EMAIL)
SUB="$(aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
  "${MSG_ARGS[@]}" \
  --query "User.Attributes[?Name=='sub'].Value | [0]" --output text)"

aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name "$GROUP"

if [[ -n "$PASSWORD" ]]; then
  aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$EMAIL" --password "$PASSWORD" --permanent
  echo ">> permanent password set (they can also sign in with an emailed code)"
elif [[ "$INVITE" -eq 1 ]]; then
  echo ">> invitation with a temporary password emailed to $EMAIL"
else
  echo ">> passwordless: send them the app link; they sign in with $EMAIL and a one-time code"
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
