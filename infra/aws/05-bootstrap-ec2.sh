#!/usr/bin/env bash
set -euxo pipefail

sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

sudo tee /etc/systemd/system/darkpool-matcher.service <<'UNIT'
[Unit]
Description=Dark Pool matcher
After=docker.service
Requires=docker.service

[Service]
EnvironmentFile=/etc/darkpool/matcher.env
ExecStartPre=-/usr/bin/docker stop darkpool-matcher
ExecStartPre=-/usr/bin/docker rm  darkpool-matcher
ExecStart=/usr/bin/docker run --name darkpool-matcher --rm --env-file /etc/darkpool/matcher.env -p 8080:8080 ghcr.io/anshuraj5679/obsidian-matcher:latest
ExecStop=/usr/bin/docker stop darkpool-matcher
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

sudo mkdir -p /etc/darkpool
sudo systemctl daemon-reload
echo "place /etc/darkpool/matcher.env then: sudo systemctl enable --now darkpool-matcher"
