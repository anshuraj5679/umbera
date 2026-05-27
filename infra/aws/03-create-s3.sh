#!/usr/bin/env bash
source "$(dirname "$0")/lib/common.sh"

BUCKET="darkpool-matcher-logs-${ENV}"

aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION" 2>/dev/null || true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "glacier-90d", "Status": "Enabled", "Filter": { "Prefix": "" },
    "Transitions": [{"Days": 90, "StorageClass": "GLACIER"}]
  }]
}'
aws s3api put-bucket-tagging --bucket "$BUCKET" --tagging "{\"TagSet\":[{\"Key\":\"Project\",\"Value\":\"darkpool-dex\"},{\"Key\":\"Env\",\"Value\":\"${ENV}\"}]}"
