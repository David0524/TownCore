CREATE TABLE "facebook_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"message" text NOT NULL,
	"link" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"method" text,
	"external_id" text,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facebook_posts_kind" CHECK ("facebook_posts"."kind" in ('daily', 'weekly')),
	CONSTRAINT "facebook_posts_status" CHECK ("facebook_posts"."status" in ('queued', 'posted', 'skipped')),
	CONSTRAINT "facebook_posts_posted" CHECK ("facebook_posts"."status" <> 'posted' or ("facebook_posts"."posted_at" is not null and "facebook_posts"."method" is not null))
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"option" smallint NOT NULL,
	"voter_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_option" CHECK ("poll_votes"."option" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"question" text NOT NULL,
	"options" text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_status" CHECK ("polls"."status" in ('draft', 'approved', 'withdrawn')),
	CONSTRAINT "polls_options" CHECK (cardinality("polls"."options") between 2 and 4),
	CONSTRAINT "polls_window" CHECK ("polls"."ends_at" > "polls"."starts_at"),
	CONSTRAINT "polls_approved" CHECK ("polls"."status" <> 'approved' or "polls"."approved_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "facebook_posts" ADD CONSTRAINT "facebook_posts_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_posts" ADD CONSTRAINT "facebook_posts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facebook_posts" ADD CONSTRAINT "facebook_posts_posted_by_staff_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "facebook_posts_town_article_uq" ON "facebook_posts" USING btree ("town_id","article_id");--> statement-breakpoint
CREATE INDEX "facebook_posts_day_status_idx" ON "facebook_posts" USING btree ("day","status");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_poll_voter_uq" ON "poll_votes" USING btree ("poll_id","voter_hash");--> statement-breakpoint
CREATE INDEX "polls_town_status_idx" ON "polls" USING btree ("town_id","status","starts_at");