CREATE TABLE IF NOT EXISTS "batches" (
	"id" bigint PRIMARY KEY NOT NULL,
	"opened_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"settled_at" timestamp,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"close_tx_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "errors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"component" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_cursor" (
	"component" text PRIMARY KEY NOT NULL,
	"last_block" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matches" (
	"id" bigint PRIMARY KEY NOT NULL,
	"batch_id" bigint NOT NULL,
	"pair_id" integer NOT NULL,
	"buy_order_id" bigint NOT NULL,
	"sell_order_id" bigint NOT NULL,
	"clearing_price_num" text,
	"clearing_price_den" text,
	"base_filled" text,
	"quote_filled" text,
	"fee_base" text,
	"fee_quote" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"published_at" timestamp,
	"settled_at" timestamp,
	"audit_s3_key" text,
	"publish_tx_hash" text,
	"settle_tx_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" bigint PRIMARY KEY NOT NULL,
	"pair_id" integer NOT NULL,
	"batch_id" bigint NOT NULL,
	"trader" text NOT NULL,
	"side" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"enc_deposit_handle" text,
	"enc_request_handle" text,
	"plain_deposit" text,
	"plain_request" text,
	"remaining_deposit" text,
	"remaining_request" text,
	"created_at" timestamp NOT NULL,
	"expiry" bigint DEFAULT 0 NOT NULL,
	"submit_tx_hash" text
);
