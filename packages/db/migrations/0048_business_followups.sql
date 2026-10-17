CREATE TABLE "business_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"lines" jsonb NOT NULL,
	"link_href" text NOT NULL,
	"link_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"sent_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_followups_kind" CHECK ("business_followups"."kind" in ('trial_ending', 'competitor_spot', 'story_mention', 'nearby_claim')),
	CONSTRAINT "business_followups_status" CHECK ("business_followups"."status" in ('draft', 'sent', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "owner_mail_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "towns" ADD COLUMN "business_mail_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "towns" ADD COLUMN "business_mail_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "business_followups" ADD CONSTRAINT "business_followups_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_followups" ADD CONSTRAINT "business_followups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_followups" ADD CONSTRAINT "business_followups_sent_by_staff_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_followups_dedupe_uq" ON "business_followups" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "business_followups_status_idx" ON "business_followups" USING btree ("status","town_id");--> statement-breakpoint
CREATE INDEX "business_followups_business_idx" ON "business_followups" USING btree ("business_id","decided_at");