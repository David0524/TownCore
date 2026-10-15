CREATE TYPE "public"."bulk_status" AS ENUM('not_started', 'warming', 'active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."dns_purpose" AS ENUM('inbound_mx', 'dkim', 'mail_from_mx', 'mail_from_spf', 'spf', 'dmarc');--> statement-breakpoint
CREATE TYPE "public"."dns_record_status" AS ENUM('planned', 'created', 'existing');--> statement-breakpoint
CREATE TYPE "public"."identity_kind" AS ENUM('root', 'news');--> statement-breakpoint
CREATE TYPE "public"."mail_domain_status" AS ENUM('pending', 'onboarding', 'live', 'paused', 'failed');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step_status" AS ENUM('pending', 'running', 'waiting', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "dns_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"purpose" "dns_purpose" NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"priority" integer,
	"ttl" integer,
	"vercel_record_id" text,
	"status" "dns_record_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"kind" "identity_kind" NOT NULL,
	"identity_name" text NOT NULL,
	"verification_status" text,
	"dkim_status" text,
	"dkim_tokens" text[],
	"signing_hosted_zone" text,
	"mail_from_domain" text,
	"mail_from_status" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_identities_identity_name_unique" UNIQUE("identity_name")
);
--> statement-breakpoint
CREATE TABLE "mail_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"town_id" uuid,
	"display_name" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"status" "mail_domain_status" DEFAULT 'pending' NOT NULL,
	"inbound_enabled" boolean DEFAULT false NOT NULL,
	"bulk_status" "bulk_status" DEFAULT 'not_started' NOT NULL,
	"warmup_day" integer DEFAULT 0 NOT NULL,
	"bulk_daily_cap" integer DEFAULT 0 NOT NULL,
	"paused_reason" text,
	"failure_reason" text,
	"postal_address" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_domains_name_unique" UNIQUE("name"),
	CONSTRAINT "mail_domains_name_lower" CHECK ("mail_domains"."name" = lower("mail_domains"."name")),
	CONSTRAINT "mail_domains_failed_reason" CHECK ("mail_domains"."status" <> 'failed' or "mail_domains"."failure_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "onboarding_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" "onboarding_step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_identities" ADD CONSTRAINT "domain_identities_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_domains" ADD CONSTRAINT "mail_domains_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_steps" ADD CONSTRAINT "onboarding_steps_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dns_records_domain_record_uq" ON "dns_records" USING btree ("domain_id","type","name","value");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_identities_domain_kind_uq" ON "domain_identities" USING btree ("domain_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_steps_domain_step_uq" ON "onboarding_steps" USING btree ("domain_id","step");