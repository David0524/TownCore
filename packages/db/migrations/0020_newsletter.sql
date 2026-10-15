CREATE TABLE "newsletter_testers" (
	"domain_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_testers_domain_id_staff_id_pk" PRIMARY KEY("domain_id","staff_id")
);
--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "newsletter_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD COLUMN "skipped_reason" text;--> statement-breakpoint
ALTER TABLE "newsletter_testers" ADD CONSTRAINT "newsletter_testers_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_testers" ADD CONSTRAINT "newsletter_testers_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_newsletter_mode" CHECK ("mail_domains"."newsletter_mode" in ('off', 'test', 'live'));--> statement-breakpoint
ALTER TABLE "newsletter_issues" ADD CONSTRAINT "newsletter_issues_mode" CHECK ("newsletter_issues"."mode" is null or "newsletter_issues"."mode" in ('test', 'live'));