CREATE TABLE "photo_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"business_id" uuid,
	"article_id" uuid,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"caption" text NOT NULL,
	"taken_where" text,
	"taken_when" text,
	"credit" text NOT NULL,
	"submitter_name" text NOT NULL,
	"submitter_email" text NOT NULL,
	"license_version" text NOT NULL,
	"license_text" text NOT NULL,
	"consent_ip" text,
	"consent_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"alt" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_submissions_kind" CHECK ("photo_submissions"."kind" in ('reader', 'business', 'illustration')),
	CONSTRAINT "photo_submissions_status" CHECK ("photo_submissions"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "photo_submissions_business" CHECK (("photo_submissions"."kind" = 'business') = ("photo_submissions"."business_id" is not null)),
	CONSTRAINT "photo_submissions_illustration" CHECK (("photo_submissions"."kind" = 'illustration') = ("photo_submissions"."article_id" is not null)),
	CONSTRAINT "photo_submissions_approved" CHECK ("photo_submissions"."status" <> 'approved' or ("photo_submissions"."alt" is not null and "photo_submissions"."reviewed_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_submissions" ADD CONSTRAINT "photo_submissions_reviewed_by_staff_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_submissions_town_status_idx" ON "photo_submissions" USING btree ("town_id","status","created_at" DESC NULLS LAST);