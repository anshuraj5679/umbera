#!/usr/bin/env bash
source "$(dirname "$0")/lib/common.sh"

for name in admin matcher rds; do
  full="darkpool/${ENV}/${name}"
  aws secretsmanager describe-secret --secret-id "$full" --region "$AWS_REGION" 2>/dev/null \
    || aws secretsmanager create-secret --name "$full" --region "$AWS_REGION" \
         --tags "[{\"Key\":\"Project\",\"Value\":\"darkpool-dex\"},{\"Key\":\"Env\",\"Value\":\"${ENV}\"}]"
  echo "ensured $full"
done
echo "Now run: aws secretsmanager put-secret-value --secret-id darkpool/${ENV}/matcher --secret-string '0x...'"
