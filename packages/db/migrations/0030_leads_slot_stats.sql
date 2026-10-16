CREATE TABLE "proof_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"month" text NOT NULL,
	"email" text NOT NULL,
	"totals" jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_stats_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"day" date NOT NULL,
	"slot" text NOT NULL,
	"campaign_id" uuid,
	"business_id" uuid,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "slot_stats_daily_key_uq" UNIQUE NULLS NOT DISTINCT("town_id","day","slot","campaign_id","business_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "town_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "slot" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "proof_reports" ADD CONSTRAINT "proof_reports_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_stats_daily" ADD CONSTRAINT "slot_stats_daily_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_stats_daily" ADD CONSTRAINT "slot_stats_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_stats_daily" ADD CONSTRAINT "slot_stats_daily_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proof_reports_business_month_uq" ON "proof_reports" USING btree ("business_id","month");--> statement-breakpoint
CREATE INDEX "slot_stats_daily_business_day_idx" ON "slot_stats_daily" USING btree ("business_id","day");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_ip_created_idx" ON "leads" USING btree ("ip","created_at");