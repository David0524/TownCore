ALTER TABLE "ai_usage" ALTER COLUMN "est_cost_usd" SET DATA TYPE numeric(10, 6);--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "prompt_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "outcome" text DEFAULT 'ok' NOT NULL;