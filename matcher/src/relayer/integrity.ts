import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { DeploymentScope } from "../orders/lifecycle.js";

export type RelayerIntegrityReport = {
  ok: boolean;
  ordersMissingCommitments: number;
  invalidOrderCommitmentRows: number;
  orderAccountCommitmentMismatchRows: number;
  settledOrdersMissingConsumedNullifiers: number;
};

const BYTES32_REGEX = "^0x[0-9a-f]{64}$";

export async function buildRelayerIntegrityReport(db: Db, scope: DeploymentScope): Promise<RelayerIntegrityReport> {
  const [
    ordersMissingCommitments,
    invalidOrderCommitmentRows,
    orderAccountCommitmentMismatchRows,
    settledOrdersMissingConsumedNullifiers,
  ] = await Promise.all([
    executeCount(db, sql`
      select count(*)::int as value
      from orders o
      left join order_commitments oc
        on oc.chain_id = o.chain_id
        and lower(oc.dex_address) = lower(o.dex_address)
        and oc.order_id = o.id
      where o.chain_id = ${scope.chainId}
        and lower(o.dex_address) = ${scope.dexAddress}
        and oc.commitment is null
    `),
    executeCount(db, sql`
      select count(*)::int as value
      from order_commitments
      where chain_id = ${scope.chainId}
        and lower(dex_address) = ${scope.dexAddress}
        and (
          commitment !~ ${BYTES32_REGEX}
          or nullifier !~ ${BYTES32_REGEX}
          or salt !~ ${BYTES32_REGEX}
          or (account_commitment is not null and account_commitment !~ ${BYTES32_REGEX})
        )
    `),
    executeCount(db, sql`
      select count(*)::int as value
      from orders o
      join order_commitments oc
        on oc.chain_id = o.chain_id
        and lower(oc.dex_address) = lower(o.dex_address)
        and oc.order_id = o.id
      where o.chain_id = ${scope.chainId}
        and lower(o.dex_address) = ${scope.dexAddress}
        and coalesce(lower(o.account_commitment), '') <> coalesce(lower(oc.account_commitment), '')
    `),
    executeCount(db, sql`
      select count(*)::int as value
      from matches m
      join order_commitments oc
        on oc.chain_id = m.chain_id
        and lower(oc.dex_address) = lower(m.dex_address)
        and (oc.order_id = m.buy_order_id or oc.order_id = m.sell_order_id)
      left join consumed_nullifiers cn
        on cn.nullifier = oc.nullifier
      where m.chain_id = ${scope.chainId}
        and lower(m.dex_address) = ${scope.dexAddress}
        and m.status = 'SETTLED'
        and cn.nullifier is null
    `),
  ]);

  return {
    ok: ordersMissingCommitments === 0
      && invalidOrderCommitmentRows === 0
      && orderAccountCommitmentMismatchRows === 0
      && settledOrdersMissingConsumedNullifiers === 0,
    ordersMissingCommitments,
    invalidOrderCommitmentRows,
    orderAccountCommitmentMismatchRows,
    settledOrdersMissingConsumedNullifiers,
  };
}

async function executeCount(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const result = await (db as any).execute(query);
  const rows = Array.isArray(result) ? result : result?.rows;
  return Number(rows?.[0]?.value ?? 0);
}
