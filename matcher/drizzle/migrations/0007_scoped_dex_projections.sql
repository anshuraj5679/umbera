ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "chain_id" integer;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "dex_address" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "chain_id" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dex_address" text;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "chain_id" integer;
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "dex_address" text;

UPDATE "batches"
SET
  "chain_id" = COALESCE("chain_id", 421614),
  "dex_address" = COALESCE("dex_address", '0x3640fbfaa5fd8e0adff88f755953a91332b3e390');
UPDATE "orders"
SET
  "chain_id" = COALESCE("chain_id", 421614),
  "dex_address" = COALESCE("dex_address", '0x3640fbfaa5fd8e0adff88f755953a91332b3e390');
UPDATE "matches"
SET
  "chain_id" = COALESCE("chain_id", 421614),
  "dex_address" = COALESCE("dex_address", '0x3640fbfaa5fd8e0adff88f755953a91332b3e390');

UPDATE "orders"
SET "dex_address" = '0x08d59a1f305ed0107040f9b83615518310b292f4'
WHERE "chain_id" = 421614
  AND "submit_tx_hash" IN (
    '0x9f09de095a9584a87031f1fcbc75de7a0363c38fe0a373e09eff992ac2f2304e',
    '0x89797ad1521784df5cec0d8e93aa57fc369b965ddf96c6778fc89dfdbd705f10'
  );

UPDATE "matches"
SET "dex_address" = '0x08d59a1f305ed0107040f9b83615518310b292f4'
WHERE "chain_id" = 421614
  AND (
    "publish_tx_hash" = '0x082e9709b185dcec9570e7713e16c45fe0e2f0d56d32b8cd6f91d6b81174064c'
    OR "settle_tx_hash" = '0x8bb8014830a03d586f6b587282af024164a991ad4859151788c6081fcd06705c'
  );

UPDATE "batches"
SET "dex_address" = '0x08d59a1f305ed0107040f9b83615518310b292f4'
WHERE "chain_id" = 421614
  AND "closed_at" >= '2026-05-27T18:40:00Z';

ALTER TABLE "batches" ALTER COLUMN "chain_id" SET NOT NULL;
ALTER TABLE "batches" ALTER COLUMN "dex_address" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "chain_id" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "dex_address" SET NOT NULL;
ALTER TABLE "matches" ALTER COLUMN "chain_id" SET NOT NULL;
ALTER TABLE "matches" ALTER COLUMN "dex_address" SET NOT NULL;

ALTER TABLE "batches" DROP CONSTRAINT IF EXISTS "batches_pkey";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_pkey";
ALTER TABLE "matches" DROP CONSTRAINT IF EXISTS "matches_pkey";

CREATE UNIQUE INDEX IF NOT EXISTS "batches_scope_id_unique" ON "batches" ("chain_id", "dex_address", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "orders_scope_id_unique" ON "orders" ("chain_id", "dex_address", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "matches_scope_id_unique" ON "matches" ("chain_id", "dex_address", "id");
