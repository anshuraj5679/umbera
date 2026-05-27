#!/bin/bash
set -euxo pipefail

# Install Node 22 via NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs git postgresql16

# Service dir + non-root user
useradd --system --create-home --shell /bin/bash darkpool || true
mkdir -p /opt/darkpool /etc/darkpool /var/log/darkpool
chown -R darkpool:darkpool /opt/darkpool /var/log/darkpool

# Systemd unit
cat > /etc/systemd/system/darkpool-matcher.service <<'UNIT'
[Unit]
Description=Dark Pool matcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=darkpool
EnvironmentFile=/etc/darkpool/matcher.env
WorkingDirectory=/opt/darkpool/matcher
ExecStart=/opt/darkpool/matcher/node_modules/.bin/tsx /opt/darkpool/matcher/src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/darkpool/matcher.log
StandardError=append:/var/log/darkpool/matcher.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
# Don't start yet — matcher code + env not deployed
echo "userdata complete; ssh in and run /opt/darkpool/deploy.sh"
