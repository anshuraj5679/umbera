ALTER TABLE "orders" ADD COLUMN "enc_base_deposit_handle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "enc_quote_deposit_handle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "enc_base_request_handle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "enc_quote_request_handle" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "remaining_base_deposit" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "remaining_quote_deposit" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "remaining_base_request" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "remaining_quote_request" text;