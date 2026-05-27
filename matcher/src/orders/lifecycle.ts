import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export type DeploymentScope = {
  chainId: number;
  dexAddress: string;
};

export async function markOrdersMatched(db: Db, orderIds: bigint[], scope?: DeploymentScope) {
  if (orderIds.length === 0) return;
  await db.execute(sql`
    update orders
    set status = 'MATCHED'
    where id in (${orderIdList(orderIds)})
      ${scopeClause("orders", scope)}
      and status not in ('SETTLED', 'CANCELLED')
  `);
}

export async function markOrdersSettled(db: Db, orderIds: bigint[], scope?: DeploymentScope) {
  if (orderIds.length === 0) return;
  await db.execute(sql`
    update orders
    set status = 'SETTLED'
    where id in (${orderIdList(orderIds)})
      ${scopeClause("orders", scope)}
      and status != 'CANCELLED'
  `);
}

export async function reconcileOrderStatusesFromMatches(db: Db, scope?: DeploymentScope) {
  await db.execute(sql`
    update orders o
    set status = 'MATCHED'
    where o.status not in ('SETTLED', 'CANCELLED')
      ${scopeClause("o", scope)}
      and exists (
        select 1
        from matches m
        where (m.buy_order_id = o.id or m.sell_order_id = o.id)
          ${scopeJoinClause("m", "o", scope)}
          and m.status in ('PENDING', 'DISPUTED')
      )
  `);

  await db.execute(sql`
    update orders o
    set status = 'SETTLED'
    where o.status != 'CANCELLED'
      ${scopeClause("o", scope)}
      and exists (
        select 1
        from matches m
        where (m.buy_order_id = o.id or m.sell_order_id = o.id)
          ${scopeJoinClause("m", "o", scope)}
          and m.status = 'SETTLED'
      )
      and not exists (
        select 1
        from matches m
        where (m.buy_order_id = o.id or m.sell_order_id = o.id)
          ${scopeJoinClause("m", "o", scope)}
          and m.status in ('PENDING', 'DISPUTED')
      )
  `);
}

function orderIdList(orderIds: bigint[]) {
  return sql.join(orderIds.map((id) => sql`${id}`), sql`, `);
}

function scopeClause(alias: string, scope?: DeploymentScope) {
  if (!scope) return sql``;
  return sql`and ${sql.raw(alias)}.chain_id = ${scope.chainId} and ${sql.raw(alias)}.dex_address = ${normalizeDexAddress(scope.dexAddress)}`;
}

function scopeJoinClause(matchAlias: string, orderAlias: string, scope?: DeploymentScope) {
  if (!scope) return sql``;
  return sql`
    and ${sql.raw(matchAlias)}.chain_id = ${sql.raw(orderAlias)}.chain_id
    and ${sql.raw(matchAlias)}.dex_address = ${sql.raw(orderAlias)}.dex_address
  `;
}

export function normalizeDexAddress(value: string) {
  return value.toLowerCase();
}
