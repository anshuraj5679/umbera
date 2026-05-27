import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { create as createDb } from "../src/db/client.js";
import { loadConfig } from "../src/config.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

async function main() {
  const execute = process.argv.includes("--execute");
  const cfg = await loadConfig();
  const db = createDb(cfg.RDS_URL);

  const dryRunRows = await db.execute(sql`
    select id
    from tasks
    where type = 'AGENT_SUBMIT_ORDER'
      and (
        payload::text ~* '(side|size|limitPrice|clientOrderId|trader)'
        or result::text ~* '(side|depositToken|requestToken|clientOrderId|trader|escrowToken)'
        or idempotency_key !~ '^agent:sha256:[0-9a-f]{64}$'
      )
    limit 100
  `);

  if (!execute) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      matchingRows: dryRunRows.rowCount ?? dryRunRows.rows.length,
      sampleIds: dryRunRows.rows.map((row: any) => row.id),
    }, null, 2));
    return;
  }

  const result = await db.execute(sql`
    update tasks
    set
      payload = jsonb_build_object('requestShape', 'agent_order_scrubbed'),
      result = case
        when result is null then null
        else jsonb_strip_nulls(jsonb_build_object(
          'ok', result->'ok',
          'txHash', result->'txHash',
          'orderId', result->'orderId',
          'batchId', result->'batchId',
          'pairId', result->'pairId',
          'expiry', result->'expiry'
        ))
      end,
      idempotency_key = case
        when idempotency_key ~ '^agent:sha256:[0-9a-f]{64}$' then idempotency_key
        when idempotency_key is null then null
        else 'agent:scrubbed:' || id
      end,
      updated_at = now()
    where type = 'AGENT_SUBMIT_ORDER'
      and (
        payload::text ~* '(side|size|limitPrice|clientOrderId|trader)'
        or result::text ~* '(side|depositToken|requestToken|clientOrderId|trader|escrowToken)'
        or idempotency_key !~ '^agent:sha256:[0-9a-f]{64}$'
      )
  `);

  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    updatedRows: result.rowCount ?? 0,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
