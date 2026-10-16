ALTER TYPE "public"."candidate_kind" ADD VALUE 'guide';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'reference' BEFORE 'other_outlet';--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "guide_topic" text;--> statement-breakpoint
CREATE UNIQUE INDEX "articles_town_guide_topic_uq" ON "articles" USING btree ("town_id","guide_topic") WHERE "articles"."guide_topic" is not null;