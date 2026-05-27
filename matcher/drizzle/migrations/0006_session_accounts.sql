ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "account_commitment" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "chain_id" integer;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "dex_address" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "owner_commitment" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "session_public_key" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "account_commitment" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "account_nullifier" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "label_hash" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "created_tx_hash" text;
--> statement-breakpoint
ALTER TABLE "relayer_accounts" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "relayer_accounts_account_commitment_unique" ON "relayer_accounts" USING btree ("account_commitment");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "relayer_accounts_account_nullifier_unique" ON "relayer_accounts" USING btree ("account_nullifier");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relayer_accounts_session_public_key_idx" ON "relayer_accounts" USING btree ("chain_id","dex_address","session_public_key");
--> statement-breakpoint
ALTER TABLE "order_commitments" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "order_commitments" ADD COLUMN IF NOT EXISTS "account_commitment" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_commitments_account_id_idx" ON "order_commitments" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_commitments_account_commitment_idx" ON "order_commitments" USING btree ("account_commitment");
