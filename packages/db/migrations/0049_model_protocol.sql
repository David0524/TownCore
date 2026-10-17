CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"town_id" uuid,
	"task" text NOT NULL,
	"job" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"batch_id" text,
	"request" jsonb,
	"response" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_requests_status" CHECK ("ai_requests"."status" in ('queued', 'submitted', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "task" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "escalated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "batch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_requests_key_idx" ON "ai_requests" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ai_requests_status_idx" ON "ai_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_task_created_idx" ON "ai_usage" USING btree ("task","created_at");