CREATE TABLE IF NOT EXISTS "agent_access_tokens" (
  "token_hash" text PRIMARY KEY,
  "chain_id" integer NOT NULL,
  "dex_address" text NOT NULL,
  "scope" text NOT NULL,
  "subject_hash" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "max_uses" integer NOT NULL DEFAULT 1,
  "used_count" integer NOT NULL DEFAULT 0,
  "issued_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "last_used_at" timestamp
);
