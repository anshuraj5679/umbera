import { sql } from "drizzle-orm";
import { pgTable, bigserial, bigint, text, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const batches = pgTable("batches", {
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  id: bigint("id", { mode: "bigint" }).notNull(),
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
  settledAt: timestamp("settled_at"),
  status: text("status").notNull().default("OPEN"),
  closeTxHash: text("close_tx_hash"),
}, (table) => ({
  scopedIdUnique: uniqueIndex("batches_scope_id_unique").on(table.chainId, table.dexAddress, table.id),
}));

export const orders = pgTable("orders", {
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  id: bigint("id", { mode: "bigint" }).notNull(),
  pairId: integer("pair_id").notNull(),
  batchId: bigint("batch_id", { mode: "bigint" }).notNull(),
  trader: text("trader").notNull(),
  side: text("side").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  encDepositHandle: text("enc_deposit_handle"),
  encRequestHandle: text("enc_request_handle"),
  encBaseDepositHandle: text("enc_base_deposit_handle"),
  encQuoteDepositHandle: text("enc_quote_deposit_handle"),
  encBaseRequestHandle: text("enc_base_request_handle"),
  encQuoteRequestHandle: text("enc_quote_request_handle"),
  plainDeposit: text("plain_deposit"),
  plainRequest: text("plain_request"),
  remainingDeposit: text("remaining_deposit"),
  remainingRequest: text("remaining_request"),
  remainingBaseDeposit: text("remaining_base_deposit"),
  remainingQuoteDeposit: text("remaining_quote_deposit"),
  remainingBaseRequest: text("remaining_base_request"),
  remainingQuoteRequest: text("remaining_quote_request"),
  createdAt: timestamp("created_at").notNull(),
  expiry: bigint("expiry", { mode: "bigint" }).notNull().default(sql`0`),
  submitTxHash: text("submit_tx_hash"),
  accountId: text("account_id"),
  accountCommitment: text("account_commitment"),
}, (table) => ({
  scopedIdUnique: uniqueIndex("orders_scope_id_unique").on(table.chainId, table.dexAddress, table.id),
}));

export const matches = pgTable("matches", {
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  id: bigint("id", { mode: "bigint" }).notNull(),
  batchId: bigint("batch_id", { mode: "bigint" }).notNull(),
  pairId: integer("pair_id").notNull(),
  buyOrderId: bigint("buy_order_id", { mode: "bigint" }).notNull(),
  sellOrderId: bigint("sell_order_id", { mode: "bigint" }).notNull(),
  clearingPriceNum: text("clearing_price_num"),
  clearingPriceDen: text("clearing_price_den"),
  baseFilled: text("base_filled"),
  quoteFilled: text("quote_filled"),
  feeBase: text("fee_base"),
  feeQuote: text("fee_quote"),
  status: text("status").notNull().default("PENDING"),
  publishedAt: timestamp("published_at"),
  settledAt: timestamp("settled_at"),
  auditS3Key: text("audit_s3_key"),
  publishTxHash: text("publish_tx_hash"),
  settleTxHash: text("settle_tx_hash"),
}, (table) => ({
  scopedIdUnique: uniqueIndex("matches_scope_id_unique").on(table.chainId, table.dexAddress, table.id),
}));

export const eventCursor = pgTable("event_cursor", {
  component: text("component").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull().default(sql`0`),
});

export const indexedChainLogs = pgTable("indexed_chain_logs", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  eventName: text("event_name").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: text("block_hash").notNull(),
  transactionHash: text("transaction_hash").notNull(),
  transactionIndex: integer("transaction_index").notNull().default(0),
  logIndex: integer("log_index").notNull(),
  confirmationStatus: text("confirmation_status").notNull().default("UNCONFIRMED"),
  payload: jsonb("payload"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  logUnique: uniqueIndex("indexed_chain_logs_unique").on(
    table.chainId,
    table.dexAddress,
    table.transactionHash,
    table.logIndex,
  ),
}));

export const indexedBlocks = pgTable("indexed_blocks", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: text("block_hash").notNull(),
  confirmationStatus: text("confirmation_status").notNull().default("CONFIRMED"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  blockUnique: uniqueIndex("indexed_blocks_unique").on(table.chainId, table.dexAddress, table.blockNumber),
}));

export const errors = pgTable("errors", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  component: text("component").notNull(),
  payload: jsonb("payload"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("QUEUED"),
  scope: text("scope").notNull().default("SYSTEM"),
  accountId: text("account_id"),
  trader: text("trader"),
  idempotencyKey: text("idempotency_key"),
  batchId: bigint("batch_id", { mode: "bigint" }),
  orderId: bigint("order_id", { mode: "bigint" }),
  matchId: bigint("match_id", { mode: "bigint" }),
  payload: jsonb("payload"),
  result: jsonb("result"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextRunAt: timestamp("next_run_at"),
  heartbeatAt: timestamp("heartbeat_at"),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  idempotencyKeyUnique: uniqueIndex("tasks_idempotency_key_unique").on(table.idempotencyKey),
}));

export const taskEvents = pgTable("task_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  taskId: text("task_id").notNull(),
  type: text("type").notNull(),
  status: text("status"),
  message: text("message"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const relayerAccounts = pgTable("relayer_accounts", {
  id: text("id").primaryKey(),
  address: text("address").notNull(),
  chainId: integer("chain_id"),
  dexAddress: text("dex_address"),
  ownerCommitment: text("owner_commitment"),
  sessionPublicKey: text("session_public_key"),
  accountCommitment: text("account_commitment"),
  accountNullifier: text("account_nullifier"),
  labelHash: text("label_hash"),
  createdTxHash: text("created_tx_hash"),
  lastSeenAt: timestamp("last_seen_at"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  accountCommitmentUnique: uniqueIndex("relayer_accounts_account_commitment_unique").on(table.accountCommitment),
  accountNullifierUnique: uniqueIndex("relayer_accounts_account_nullifier_unique").on(table.accountNullifier),
}));

export const orderCommitments = pgTable("order_commitments", {
  commitment: text("commitment").primaryKey(),
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  orderId: bigint("order_id", { mode: "bigint" }).notNull(),
  accountId: text("account_id"),
  accountCommitment: text("account_commitment"),
  trader: text("trader").notNull(),
  pairId: integer("pair_id").notNull(),
  batchId: bigint("batch_id", { mode: "bigint" }).notNull(),
  salt: text("salt").notNull(),
  nullifier: text("nullifier").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orderUnique: uniqueIndex("order_commitments_order_unique").on(table.chainId, table.dexAddress, table.orderId),
  nullifierUnique: uniqueIndex("order_commitments_nullifier_unique").on(table.nullifier),
}));

export const consumedNullifiers = pgTable("consumed_nullifiers", {
  nullifier: text("nullifier").primaryKey(),
  commitment: text("commitment").notNull(),
  consumedByMatchId: bigint("consumed_by_match_id", { mode: "bigint" }),
  consumedAt: timestamp("consumed_at").notNull().defaultNow(),
});

export const relayerStateCheckpoints = pgTable("relayer_state_checkpoints", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  chainId: integer("chain_id").notNull(),
  dexAddress: text("dex_address").notNull(),
  confirmedBlock: bigint("confirmed_block", { mode: "bigint" }).notNull(),
  confirmedBlockHash: text("confirmed_block_hash").notNull(),
  stateRoot: text("state_root").notNull(),
  orderCommitmentCount: integer("order_commitment_count").notNull().default(0),
  consumedNullifierCount: integer("consumed_nullifier_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
