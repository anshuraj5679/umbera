#!/usr/bin/env bash
source "$(dirname "$0")/lib/common.sh"

DB_ID="darkpool-${ENV}"
SG_NAME="darkpool-${ENV}-rds-sg"
PASS=$(openssl rand -hex 16)

VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text --region "$AWS_REGION")
SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" --description "darkpool rds" --vpc-id "$VPC_ID" --region "$AWS_REGION" --output text || \
        aws ec2 describe-security-groups --group-names "$SG_NAME" --region "$AWS_REGION" --query "SecurityGroups[0].GroupId" --output text)

aws rds create-db-instance \
  --db-instance-identifier "$DB_ID" \
  --db-instance-class db.t3.micro \
  --engine postgres --engine-version 16.3 \
  --allocated-storage 20 \
  --master-username darkpool --master-user-password "$PASS" \
  --vpc-security-group-ids "$SG_ID" \
  --publicly-accessible \
  --tags "Key=Project,Value=darkpool-dex" "Key=Env,Value=${ENV}" \
  --region "$AWS_REGION"

aws secretsmanager put-secret-value --secret-id "darkpool/${ENV}/rds" --secret-string "postgres://darkpool:${PASS}@<endpoint>/darkpool" --region "$AWS_REGION" || true
echo "RDS provisioning started; update the URL once endpoint is available."
