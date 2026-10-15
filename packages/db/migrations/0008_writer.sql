ALTER TABLE "articles" ADD COLUMN "candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "prompt_versions" text[];--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "tier_reasons" text[];--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "placeholder" boolean DEFAULT false NOT NULL;