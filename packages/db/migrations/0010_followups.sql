CREATE TYPE "public"."update_status" AS ENUM('in_review', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE "article_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_article_id" uuid NOT NULL,
	"to_article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"candidate_id" uuid,
	"note_md" text NOT NULL,
	"record_ids" uuid[] NOT NULL,
	"tier" smallint NOT NULL,
	"status" "update_status" NOT NULL,
	"review_reason" text,
	"factcheck" jsonb,
	"reviewer_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "target_article_id" uuid;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD COLUMN "must_write" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_from_article_id_articles_id_fk" FOREIGN KEY ("from_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_links" ADD CONSTRAINT "article_links_to_article_id_articles_id_fk" FOREIGN KEY ("to_article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_updates" ADD CONSTRAINT "article_updates_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_updates" ADD CONSTRAINT "article_updates_reviewer_id_staff_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_links_uq" ON "article_links" USING btree ("from_article_id","to_article_id","kind");--> statement-breakpoint
CREATE INDEX "article_updates_article_idx" ON "article_updates" USING btree ("article_id");