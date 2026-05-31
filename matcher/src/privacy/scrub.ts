import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export type PrivacyResidueCounts = {
  agentSubmitOrderTaskRows: number;
  taskEventRows: number;
  workerErrorRows: number;
};

export type PrivacyScrubResult = PrivacyResidueCounts & {
  updatedTaskRows: number;
  updatedTaskEventRows: number;
  updatedWorkerErrorRows: number;
};

const TASK_RESIDUE_REGEX = '"(side|size|limitPrice|clientOrderId|trader|depositToken|requestToken|escrowToken)"\\s*:';
const EVENT_RESIDUE_REGEX = '"(side|size|limitPrice|clientOrderId|trader|depositToken|requestToken|escrowToken)"\\s*:';
const ERROR_RESIDUE_REGEX = '"(side|size|limitPrice|clientOrderId|trader|baseAmount|remainingBase)"\\s*:';

export async function countPrivateTaskResidue(db: Db): Promise<PrivacyResidueCounts> {
  const [taskRows, eventRows, errorRows] = await Promise.all([
    executeCount(db, sql`
      select count(*)::int as value
      from tasks
      where type = 'AGENT_SUBMIT_ORDER'
        and (
          coalesce(payload::text, '') ~* ${TASK_RESIDUE_REGEX}
          or coalesce(result::text, '') ~* ${TASK_RESIDUE_REGEX}
          or coalesce(idempotency_key, '') !~ '^agent:sha256:[0-9a-f]{64}$'
        )
    `),
    executeCount(db, sql`
      select count(*)::int as value
      from task_events
      where coalesce(payload::text, '') ~* ${EVENT_RESIDUE_REGEX}
    `),
    executeCount(db, sql`
      select count(*)::int as value
      from errors
      where coalesce(payload::text, '') ~* ${ERROR_RESIDUE_REGEX}
    `),
  ]);

  return {
    agentSubmitOrderTaskRows: taskRows,
    taskEventRows: eventRows,
    workerErrorRows: errorRows,
  };
}

export async function scrubPrivateTaskResidue(db: Db): Promise<PrivacyScrubResult> {
  const before = await countPrivateTaskResidue(db);
  const taskUpdate = await executeMutation(db, sql`
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
        coalesce(payload::text, '') ~* ${TASK_RESIDUE_REGEX}
        or coalesce(result::text, '') ~* ${TASK_RESIDUE_REGEX}
        or coalesce(idempotency_key, '') !~ '^agent:sha256:[0-9a-f]{64}$'
      )
  `);
  const eventUpdate = await executeMutation(db, sql`
    update task_events
    set payload = null
    where coalesce(payload::text, '') ~* ${EVENT_RESIDUE_REGEX}
  `);
  const errorUpdate = await executeMutation(db, sql`
    update errors
    set payload = jsonb_build_object('redacted', true, 'reason', 'privacy_residue_scrubbed')
    where coalesce(payload::text, '') ~* ${ERROR_RESIDUE_REGEX}
  `);

  return {
    ...before,
    updatedTaskRows: taskUpdate,
    updatedTaskEventRows: eventUpdate,
    updatedWorkerErrorRows: errorUpdate,
  };
}

async function executeCount(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await executeRows<{ value?: number | string }>(db, query);
  return Number(rows[0]?.value ?? 0);
}

async function executeMutation(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const result = await (db as any).execute(query);
  return Number(result?.rowCount ?? result?.rowsAffected ?? 0);
}

async function executeRows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = await (db as any).execute(query);
  if (Array.isArray(result)) return result as T[];
  if (Array.isArray(result?.rows)) return result.rows as T[];
  return [];
}
