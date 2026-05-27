# Infra (AWS)

Region: ap-south-1. All resources tagged `Project=darkpool-dex,Env=<env>,Owner=anshuraj`.

## Run order

    ENV=dev ./aws/01-create-secrets.sh
    ENV=dev ./aws/02-create-rds.sh
    ENV=dev ./aws/03-create-s3.sh
    ENV=dev ./aws/04-create-ec2.sh
    ENV=dev ssh-to-ec2  # via EC2 Instance Connect
    ENV=dev ./aws/05-bootstrap-ec2.sh   # runs on EC2

Teardown: ENV=dev ./aws/99-teardown.sh
