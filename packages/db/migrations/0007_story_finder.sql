CREATE TYPE "public"."candidate_kind" AS ENUM('story', 'roundup', 'template', 'update');--> statement-breakpoint
CREATE TYPE "public"."skip_reason" AS ENUM('below_threshold', 'budget_full', 'public_safety_cap', 'duplicate', 'wrong_town', 'thin_source', 'tier4', 'other_outlet', 'model_error');--> statement-breakpoint
ALTER TYPE "public"."candidate_status" ADD VALUE 'accepted' BEFORE 'writing';--> statement-breakpoint
ALTER TYPE "public"."candidate_status" ADD VALUE 'skipped' BEFORE 'writing';--> statement-breakpoint
CREATE TABLE "article_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"article_id" uuid,
	"newsworthiness" real NOT NULL,
	"components" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skipped_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reason" "skip_reason" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "kind" "candidate_kind" DEFAULT 'story' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "classification" jsonb;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "tier_reasons" text[];--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_scores" ADD CONSTRAINT "article_scores_candidate_id_story_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."story_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skipped_candidates" ADD CONSTRAINT "skipped_candidates_candidate_id_story_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."story_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_scores_candidate_idx" ON "article_scores" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skipped_candidates_candidate_uq" ON "skipped_candidates" USING btree ("candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_candidates_town_key_uq" ON "story_candidates" USING btree ("town_id","key");