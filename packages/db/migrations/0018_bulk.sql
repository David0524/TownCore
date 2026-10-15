CREATE TYPE "public"."campaign_send_status" AS ENUM('queued', 'deferred_cap', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."email_campaign_kind" AS ENUM('campaign', 'newsletter');--> statement-breakpoint
CREATE TYPE "public"."email_campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "domain_health_daily" (
	"domain_id" uuid NOT NULL,
	"date" date NOT NULL,
	"stream" text NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"bounced" integer DEFAULT 0 NOT NULL,
	"complained" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "domain_health_daily_domain_id_date_stream_pk" PRIMARY KEY("domain_id","date","stream")
);
--> statement-breakpoint
CREATE TABLE "email_campaign_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"email" text NOT NULL,
	"priority" timestamp with time zone,
	"status" "campaign_send_status" DEFAULT 'queued' NOT NULL,
	"ses_message_id" text,
	"error" text,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_sends_uq" UNIQUE("campaign_id","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "email_campaign_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"template_id" uuid,
	"kind" "email_campaign_kind" DEFAULT 'campaign' NOT NULL,
	"newsletter_issue_id" uuid,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "email_campaign_status" DEFAULT 'draft' NOT NULL,
	"paused_reason" text,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"expanded_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaigns_approved" CHECK ("email_campaigns"."status" in ('draft', 'cancelled') or "email_campaigns"."kind" = 'newsletter' or "email_campaigns"."approved_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "email_events" ADD COLUMN "stream" text;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "bulk_target_cap" integer DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "warmup_breaches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "warmup_checked_on" date;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "newsletter_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD COLUMN "newsletter_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "consent_source" text;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "consent_ip" text;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "unsubscribed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "last_engaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirm_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirm_sends_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_health_daily" ADD CONSTRAINT "domain_health_daily_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_templates" ADD CONSTRAINT "email_campaign_templates_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_template_id_email_campaign_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_campaign_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_newsletter_issue_id_newsletter_issues_id_fk" FOREIGN KEY ("newsletter_issue_id") REFERENCES "public"."newsletter_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaign_sends_status_idx" ON "email_campaign_sends" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "email_campaign_sends_ses_idx" ON "email_campaign_sends" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns" USING btree ("status","scheduled_at");--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_newsletter_approved_by_staff_id_fk" FOREIGN KEY ("newsletter_approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscribers_town_status_idx" ON "subscribers" USING btree ("town_id","status");--> statement-breakpoint
CREATE INDEX "subscribers_consent_ip_idx" ON "subscribers" USING btree ("consent_ip","created_at");--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_active_confirmed" CHECK ("subscribers"."status" <> 'active' or "subscribers"."confirmed_at" is not null);