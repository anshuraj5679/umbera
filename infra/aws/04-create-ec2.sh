#!/usr/bin/env bash
source "$(dirname "$0")/lib/common.sh"

AMI_ID=$(aws ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-*-x86_64" "Name=state,Values=available" --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text --region "$AWS_REGION")
SG_ID=$(aws ec2 describe-security-groups --group-names "darkpool-${ENV}-rds-sg" --query "SecurityGroups[0].GroupId" --output text --region "$AWS_REGION")

aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type t3.micro \
  --security-group-ids "$SG_ID" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=darkpool-dex},{Key=Env,Value=${ENV}},{Key=Name,Value=darkpool-matcher-${ENV}}]" \
  --region "$AWS_REGION"
