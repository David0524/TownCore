CREATE TYPE "public"."article_status" AS ENUM('draft', 'in_review', 'published', 'rejected', 'blocked', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."candidate_status" AS ENUM('pending', 'writing', 'written', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."lead_kind" AS ENUM('call', 'form');--> statement-breakpoint
CREATE TYPE "public"."placement_product" AS ENUM('enhanced', 'sponsored_slot', 'exclusive', 'newsletter', 'spotlight');--> statement-breakpoint
CREATE TYPE "public"."placement_status" AS ENUM('pending', 'active', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."source_health" AS ENUM('ok', 'degraded', 'broken');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('agenda', 'meeting_video', 'permits', 'property_sales', 'business_filings', 'inspections', 'police', 'fire', 'schools', 'weather', 'events', 'other_outlet');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'active', 'unsubscribed', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."town_status" AS ENUM('draft', 'live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."town_tier" AS ENUM('small', 'mid', 'large');--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid,
	"job" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"est_cost_usd" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"headline" text NOT NULL,
	"dek" text,
	"body_md" text NOT NULL,
	"beat" text NOT NULL,
	"tier" smallint NOT NULL,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"byline" text NOT NULL,
	"reviewer_id" uuid,
	"source_record_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"claims" jsonb,
	"factcheck" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_tier_range" CHECK ("articles"."tier" between 1 and 4),
	CONSTRAINT "articles_tier4_never_public" CHECK ("articles"."tier" < 4 or "articles"."status" in ('blocked', 'rejected')),
	CONSTRAINT "articles_public_byline" CHECK ("articles"."status" not in ('published', 'corrected') or "articles"."byline" like '% Newsroom (AI-assisted)%'),
	CONSTRAINT "articles_public_sources" CHECK ("articles"."status" not in ('published', 'corrected') or cardinality("articles"."source_record_ids") > 0),
	CONSTRAINT "articles_public_published_at" CHECK ("articles"."status" not in ('published', 'corrected') or "articles"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"address" text,
	"phone" text,
	"website" text,
	"license_type" text,
	"license_number" text,
	"license_verified" boolean DEFAULT false NOT NULL,
	"data_source" text NOT NULL,
	"claimed_by_email" text,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "lead_kind" NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"date" date NOT NULL,
	"article_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sponsor_placement_id" uuid,
	"sent_at" timestamp with time zone,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"product" "placement_product" NOT NULL,
	"category" text,
	"stripe_subscription_id" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" "placement_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"text" text,
	"url" text,
	"occurred_at" timestamp with time zone,
	"raw" jsonb,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"platform" text NOT NULL,
	"url" text,
	"adapter" text NOT NULL,
	"schedule" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"health" "source_health" DEFAULT 'ok' NOT NULL,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "story_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"record_ids" uuid[] NOT NULL,
	"beat" text NOT NULL,
	"proposed_tier" smallint NOT NULL,
	"newsworthiness" real,
	"status" "candidate_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_candidates_tier_range" CHECK ("story_candidates"."proposed_tier" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" "subscriber_status" DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"census_id" text,
	"county" text NOT NULL,
	"timezone" text NOT NULL,
	"domain" text NOT NULL,
	"extra_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"site_name" text NOT NULL,
	"status" "town_status" DEFAULT 'draft' NOT NULL,
	"tier" "town_tier" NOT NULL,
	"config" jsonb NOT NULL,
	"readiness_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towns_slug_unique" UNIQUE("slug"),
	CONSTRAINT "towns_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_reviewer_id_staff_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_sponsor_placement_id_placements_id_fk" FOREIGN KEY ("sponsor_placement_id") REFERENCES "public"."placements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_candidates" ADD CONSTRAINT "story_candidates_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_town_created_idx" ON "ai_usage" USING btree ("town_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_town_slug_uq" ON "articles" USING btree ("town_id","slug");--> statement-breakpoint
CREATE INDEX "articles_town_status_published_idx" ON "articles" USING btree ("town_id","status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "businesses_town_category_idx" ON "businesses" USING btree ("town_id","category");--> statement-breakpoint
CREATE INDEX "corrections_article_idx" ON "corrections" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "leads_business_created_idx" ON "leads" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_issues_town_date_uq" ON "newsletter_issues" USING btree ("town_id","date");--> statement-breakpoint
CREATE INDEX "placements_town_product_idx" ON "placements" USING btree ("town_id","product","category");--> statement-breakpoint
CREATE UNIQUE INDEX "records_source_external_uq" ON "records" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "records_town_occurred_idx" ON "records" USING btree ("town_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sources_town_idx" ON "sources" USING btree ("town_id");--> statement-breakpoint
CREATE INDEX "story_candidates_town_status_idx" ON "story_candidates" USING btree ("town_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_town_email_uq" ON "subscribers" USING btree ("town_id",lower("email"));