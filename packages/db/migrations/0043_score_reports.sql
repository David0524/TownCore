CREATE TABLE "score_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"sport" text NOT NULL,
	"level" text NOT NULL,
	"home" text NOT NULL,
	"away" text NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"played_on" date NOT NULL,
	"venue" text,
	"local_side" text NOT NULL,
	"reporter_name" text NOT NULL,
	"reporter_email" text NOT NULL,
	"consent_ip" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_reports_status" CHECK ("score_reports"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "score_reports_side" CHECK ("score_reports"."local_side" in ('home', 'away', 'both')),
	CONSTRAINT "score_reports_scores" CHECK ("score_reports"."home_score" >= 0 and "score_reports"."away_score" >= 0),
	CONSTRAINT "score_reports_approved" CHECK ("score_reports"."status" <> 'approved' or ("score_reports"."reviewed_by" is not null and "score_reports"."record_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "score_reports" ADD CONSTRAINT "score_reports_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_reports" ADD CONSTRAINT "score_reports_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_reports" ADD CONSTRAINT "score_reports_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_reports_town_status_idx" ON "score_reports" USING btree ("town_id","status","created_at" DESC NULLS LAST);