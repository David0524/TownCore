CREATE TABLE "business_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"quote" text NOT NULL,
	"attribution" text NOT NULL,
	"permission_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_testimonials_status" CHECK ("business_testimonials"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "directory_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"category" text NOT NULL,
	"product" "placement_product" NOT NULL,
	"rank" smallint,
	"amount_cents" integer NOT NULL,
	"set_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_prices_key_uq" UNIQUE NULLS NOT DISTINCT("town_id","category","product","rank"),
	CONSTRAINT "directory_prices_amount" CHECK ("directory_prices"."amount_cents" >= 100),
	CONSTRAINT "directory_prices_rank" CHECK ("directory_prices"."rank" is null or "directory_prices"."rank" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "directory_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"category" text NOT NULL,
	"business_id" uuid,
	"email" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"notified_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_waitlist_status" CHECK ("directory_waitlist"."status" in ('waiting', 'notified', 'removed')),
	CONSTRAINT "directory_waitlist_source" CHECK ("directory_waitlist"."source" in ('category', 'advertise', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"category" text NOT NULL,
	"product" "placement_product" NOT NULL,
	"rank" smallint,
	"month" text NOT NULL,
	"kind" text NOT NULL,
	"old_cents" integer NOT NULL,
	"new_cents" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_changes_kind" CHECK ("price_changes"."kind" in ('monthly', 'override')),
	CONSTRAINT "price_changes_status" CHECK ("price_changes"."status" in ('applied', 'proposed', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "pricing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"month" text NOT NULL,
	"variant" text NOT NULL,
	"evaluated" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"proposed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_followups" DROP CONSTRAINT "business_followups_kind";--> statement-breakpoint
ALTER TABLE "business_testimonials" ADD CONSTRAINT "business_testimonials_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_testimonials" ADD CONSTRAINT "business_testimonials_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_testimonials" ADD CONSTRAINT "business_testimonials_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_prices" ADD CONSTRAINT "directory_prices_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_waitlist" ADD CONSTRAINT "directory_waitlist_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_waitlist" ADD CONSTRAINT "directory_waitlist_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_runs" ADD CONSTRAINT "pricing_runs_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_testimonials_town_status_idx" ON "business_testimonials" USING btree ("town_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "directory_waitlist_waiting_uq" ON "directory_waitlist" USING btree ("town_id","category",lower("email")) WHERE "directory_waitlist"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "directory_waitlist_ip_idx" ON "directory_waitlist" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_changes_monthly_uq" ON "price_changes" USING btree ("town_id","category","product",coalesce("rank", 0),"month") WHERE "price_changes"."kind" = 'monthly';--> statement-breakpoint
CREATE INDEX "price_changes_town_created_idx" ON "price_changes" USING btree ("town_id","created_at");--> statement-breakpoint
CREATE INDEX "price_changes_status_idx" ON "price_changes" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_runs_town_month_uq" ON "pricing_runs" USING btree ("town_id","month");--> statement-breakpoint
ALTER TABLE "business_followups" ADD CONSTRAINT "business_followups_kind" CHECK ("business_followups"."kind" in ('trial_ending', 'competitor_spot', 'story_mention', 'nearby_claim', 'waitlist_open'));