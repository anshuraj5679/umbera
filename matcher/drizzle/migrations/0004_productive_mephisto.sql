ALTER TABLE "tasks" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "heartbeat_at" timestamp;