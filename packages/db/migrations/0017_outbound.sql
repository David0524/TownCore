CREATE TYPE "public"."suppression_reason" AS ENUM('hard_bounce', 'complaint', 'unsubscribe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suppression_scope" AS ENUM('global', 'domain');--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mail_event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"sub_type" text,
	"ses_message_id" text NOT NULL,
	"recipient" text NOT NULL,
	"configuration_set" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid,
	"local_part" text,
	"body_template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signatures_owner_uq" UNIQUE NULLS NOT DISTINCT("staff_id","local_part")
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"scope" "suppression_scope" NOT NULL,
	"domain_id" uuid,
	"reason" "suppression_reason" NOT NULL,
	"source_event_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_email_reason_domain_uq" UNIQUE NULLS NOT DISTINCT("email","reason","domain_id"),
	CONSTRAINT "suppressions_email_lower" CHECK ("suppressions"."email" = lower("suppressions"."email")),
	CONSTRAINT "suppressions_scope_domain" CHECK (("suppressions"."scope" = 'domain') = ("suppressions"."domain_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "alt_message_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_mail_event_id_mail_events_id_fk" FOREIGN KEY ("mail_event_id") REFERENCES "public"."mail_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_source_event_id_mail_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."mail_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_event_recipient_uq" ON "email_events" USING btree ("mail_event_id","recipient");--> statement-breakpoint
CREATE INDEX "email_events_ses_idx" ON "email_events" USING btree ("ses_message_id");--> statement-breakpoint
CREATE INDEX "suppressions_email_idx" ON "suppressions" USING btree ("email");