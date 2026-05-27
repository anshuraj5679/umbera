#!/usr/bin/env bash
source "$(dirname "$0")/lib/common.sh"

echo "tearing down darkpool-dex ${ENV} in ${AWS_REGION}"
read -p "type 'yes' to confirm: " ok; [ "$ok" = "yes" ] || exit 1

IDS=$(aws ec2 describe-instances --filters "Name=tag:Project,Values=darkpool-dex" "Name=tag:Env,Values=${ENV}" --query "Reservations[].Instances[].InstanceId" --output text --region "$AWS_REGION")
[ -n "$IDS" ] && aws ec2 terminate-instances --instance-ids $IDS --region "$AWS_REGION"

aws rds delete-db-instance --db-instance-identifier "darkpool-${ENV}" --skip-final-snapshot --region "$AWS_REGION" || true
aws s3 rb "s3://darkpool-matcher-logs-${ENV}" --force --region "$AWS_REGION" || true
for n in admin matcher rds; do
  aws secretsmanager delete-secret --secret-id "darkpool/${ENV}/${n}" --force-delete-without-recovery --region "$AWS_REGION" || true
done
echo "done"
