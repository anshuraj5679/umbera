ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_match_receipt_root" text;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_transcript_digest_root" text;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_private_input_root" text;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_output_root" text;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_match_count" integer;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_all_salted" boolean;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_anchored_at" timestamp;
ALTER TABLE "batches" ADD COLUMN IF NOT EXISTS "proof_anchor_tx_hash" text;
