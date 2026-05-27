#!/usr/bin/env bash
set -euo pipefail

export AWS_REGION="${AWS_REGION:-ap-south-1}"
export PROJECT_TAG="Project=darkpool-dex"
export OWNER_TAG="Owner=anshuraj"
export ENV_TAG="Env=${ENV:-dev}"

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing $1"; exit 1; }
}

require aws
