ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "enc_remaining_base_deposit_handle" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "enc_remaining_quote_deposit_handle" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "enc_remaining_base_request_handle" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "enc_remaining_quote_request_handle" text;

UPDATE "orders"
SET
  "enc_remaining_base_deposit_handle" = COALESCE("enc_remaining_base_deposit_handle", "remaining_base_deposit", "enc_base_deposit_handle"),
  "enc_remaining_quote_deposit_handle" = COALESCE("enc_remaining_quote_deposit_handle", "remaining_quote_deposit", "enc_quote_deposit_handle"),
  "enc_remaining_base_request_handle" = COALESCE("enc_remaining_base_request_handle", "remaining_base_request", "enc_base_request_handle"),
  "enc_remaining_quote_request_handle" = COALESCE("enc_remaining_quote_request_handle", "remaining_quote_request", "enc_quote_request_handle"),
  "side" = 'PRIVATE';

ALTER TABLE "orders" DROP COLUMN IF EXISTS "plain_deposit";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "plain_request";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_deposit";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_request";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_base_deposit";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_quote_deposit";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_base_request";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "remaining_quote_request";
