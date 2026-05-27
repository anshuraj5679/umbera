CREATE TABLE IF NOT EXISTS "indexed_chain_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"dex_address" text NOT NULL,
	"event_name" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"transaction_hash" text NOT NULL,
	"transaction_index" integer DEFAULT 0 NOT NULL,
	"log_index" integer NOT NULL,
	"confirmation_status" text DEFAULT 'UNCONFIRMED' NOT NULL,
	"payload" jsonb,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "indexed_chain_logs_unique" ON "indexed_chain_logs" USING btree ("chain_id","dex_address","transaction_hash","log_index");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexed_blocks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"dex_address" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"confirmation_status" text DEFAULT 'CONFIRMED' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "indexed_blocks_unique" ON "indexed_blocks" USING btree ("chain_id","dex_address","block_number");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lease_owner" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relayer_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_commitments" (
	"commitment" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"dex_address" text NOT NULL,
	"order_id" bigint NOT NULL,
	"trader" text NOT NULL,
	"pair_id" integer NOT NULL,
	"batch_id" bigint NOT NULL,
	"salt" text NOT NULL,
	"nullifier" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_commitments_order_unique" ON "order_commitments" USING btree ("chain_id","dex_address","order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_commitments_nullifier_unique" ON "order_commitments" USING btree ("nullifier");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumed_nullifiers" (
	"nullifier" text PRIMARY KEY NOT NULL,
	"commitment" text NOT NULL,
	"consumed_by_match_id" bigint,
	"consumed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "relayer_state_checkpoints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"dex_address" text NOT NULL,
	"confirmed_block" bigint NOT NULL,
	"confirmed_block_hash" text NOT NULL,
	"state_root" text NOT NULL,
	"order_commitment_count" integer DEFAULT 0 NOT NULL,
	"consumed_nullifier_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
