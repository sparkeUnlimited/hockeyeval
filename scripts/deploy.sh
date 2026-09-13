#!/usr/bin/env bash
# Deploy everything:
#   1. cdk deploy (bootstraps ca-central-1 first if needed)
#   2. write web/js/config.js from the stack outputs
#   3. sync web/ to the web bucket
#   4. invalidate CloudFront
#
# Usage:
#   scripts/deploy.sh              full deploy with CDK
#   scripts/deploy.sh --sam        full deploy with AWS SAM (infra/template.yaml + infra/samconfig.toml) instead of CDK
#   scripts/deploy.sh --web-only   skip the backend; just re-upload web/ (needs a previous deploy)
#
# Pick CDK or SAM for an account and stick with it: both create the same fixed table/pool names.
# Requires: AWS credentials in the environment (or AWS_PROFILE), Node 20+, AWS CLI v2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="TryoutEvaluator"
REGION="${AWS_REGION:-ca-central-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
OUTPUTS="$ROOT/infra/outputs.json"
WEB_ONLY=0
USE_SAM=0
for arg in "$@"; do
  [[ "$arg" == "--web-only" ]] && WEB_ONLY=1
  [[ "$arg" == "--sam" ]] && USE_SAM=1
done
[[ -f "$ROOT/infra/.deploy-mode" ]] && [[ "$(cat "$ROOT/infra/.deploy-mode")" == "sam" ]] && USE_SAM=1

cd "$ROOT/infra"
if [[ ! -d node_modules ]]; then
  echo ">> installing infra dependencies"
  npm install --no-audit --no-fund
fi

if [[ "$WEB_ONLY" -eq 0 && "$USE_SAM" -eq 1 ]]; then
  command -v sam >/dev/null || { echo "!! AWS SAM CLI not found (brew install aws-sam-cli)" >&2; exit 1; }
  SAM_STACK="$(sed -n 's/^stack_name = "\(.*\)"/\1/p' samconfig.toml | head -1)"
  echo ">> bundling resolvers, sam build, sam deploy ($SAM_STACK)"
  npm run bundle
  sam build
  sam deploy
  echo ">> reading stack outputs"
  aws cloudformation describe-stacks --stack-name "$SAM_STACK" --query 'Stacks[0].Outputs' --output json \
    | node -e '
      const outs = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const o = {}; for (const x of outs) o[x.OutputKey] = x.OutputValue;
      require("fs").writeFileSync(process.argv[1], JSON.stringify({ TryoutEvaluator: o }, null, 2));
    ' "$OUTPUTS"
  echo sam > "$ROOT/infra/.deploy-mode"
elif [[ "$WEB_ONLY" -eq 0 ]]; then
  ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
  if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
    echo ">> bootstrapping CDK in $ACCOUNT/$REGION (one-time)"
    npx cdk bootstrap "aws://$ACCOUNT/$REGION"
  fi
  echo ">> cdk deploy $STACK"
  npx cdk deploy "$STACK" --require-approval never --outputs-file "$OUTPUTS"
  echo cdk > "$ROOT/infra/.deploy-mode"
fi

[[ -f "$OUTPUTS" ]] || { echo "!! $OUTPUTS not found; run a full deploy first" >&2; exit 1; }

echo ">> writing web/js/config.js"
node "$ROOT/scripts/write-config.js" "$OUTPUTS" "$ROOT/web/js/config.js"

out() { node -p "require('$OUTPUTS')['$STACK']['$1']"; }
BUCKET="$(out WebBucketName)"
DIST_ID="$(out DistributionId)"
URL="$(out CloudFrontUrl)"

echo ">> uploading web/ to s3://$BUCKET"
# Static assets: short cache (no build hashing), HTML: always revalidate.
aws s3 sync "$ROOT/web" "s3://$BUCKET" --delete \
  --exclude ".DS_Store" --exclude "*/.DS_Store" --exclude "js/config.example.js" \
  --cache-control "public, max-age=300"
aws s3 cp "$ROOT/web" "s3://$BUCKET" --recursive --exclude "*" --include "*.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8" --metadata-directive REPLACE >/dev/null
aws s3 cp "$ROOT/web/js/config.js" "s3://$BUCKET/js/config.js" \
  --cache-control "no-cache" --content-type "text/javascript; charset=utf-8" >/dev/null

echo ">> invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --query 'Invalidation.Id' --output text

echo
echo "Deployed. Open: $URL"
echo "User pool: $(out UserPoolId)   Client: $(out UserPoolClientId)"
echo "Create the first admin with: scripts/create-user.sh <email> admin --password '<permanent password>'"
