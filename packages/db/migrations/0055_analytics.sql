CREATE TABLE "page_stats_daily" (
	"town_id" uuid NOT NULL,
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"engaged_seconds" bigint DEFAULT 0 NOT NULL,
	"engaged_samples" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_stats_daily_town_id_day_kind_pk" PRIMARY KEY("town_id","day","kind")
);
--> statement-breakpoint
CREATE TABLE "site_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"ok" boolean NOT NULL,
	"status_code" integer,
	"ms" integer,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "article_stats_daily" ADD COLUMN "engaged_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "article_stats_daily" ADD COLUMN "engaged_samples" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "towns" ADD COLUMN "live_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "page_stats_daily" ADD CONSTRAINT "page_stats_daily_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_checks" ADD CONSTRAINT "site_checks_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_checks_town_checked_idx" ON "site_checks" USING btree ("town_id","checked_at");--> statement-breakpoint
-- Towns already live: the day their launch was approved, else the day they were set up.
UPDATE "towns" SET "live_at" = coalesce(
  (SELECT max(l."updated_at") FROM "launches" l WHERE l."slug" = "towns"."slug" AND l."status" = 'approved'),
  "towns"."created_at"
) WHERE "status" = 'live' AND "live_at" IS NULL;
