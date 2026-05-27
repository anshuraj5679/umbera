# Run Book

## Boot
1. Verify AWS resources via `ENV=prod ./infra/aws/01-create-secrets.sh` (idempotent)
2. SSH via EC2 Instance Connect (`aws ec2-instance-connect ssh ...`)
3. Pull latest matcher image; `sudo systemctl restart darkpool-matcher`
4. Tail logs: `journalctl -u darkpool-matcher -f`

## Halt
- `sudo systemctl stop darkpool-matcher`
- On-chain pause: any admin → `dex.pause()`

## Key rotation (matcher)
1. Generate new key offline
2. `aws secretsmanager put-secret-value --secret-id darkpool/prod/matcher --secret-string '0x...'`
3. Admin → `dex.setMatcher(newAddr)`
4. Restart matcher; role check refuses on mismatch

## RDS restore
- Point-in-time restore via console (AutomatedBackups window = 7 days)

## S3 access
- Bucket `darkpool-matcher-logs-prod`; private; IAM-only

## Dispute response
1. Trader calls `disputeMatch(matchId)` from UI
2. Admin pulls audit log: `aws s3 cp s3://darkpool-matcher-logs-prod/pair-<p>/batch-<b>/match-<m>.json -`
3. Verifies signature via ecrecover against `dex.matcher()`
4. Calls `resolveDispute(matchId, valid=true|false)`

## Mainnet
- Out of scope for v1. To enable later: set `MAINNET=true` + `ARB_MAINNET_RPC_URL` + new `arbMainnet` deploy.
