CREATE TABLE "dmarc_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_name" text NOT NULL,
	"report_id" text NOT NULL,
	"domain" text NOT NULL,
	"policy" text,
	"begin_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"messages" integer NOT NULL,
	"dkim_pass" integer NOT NULL,
	"spf_pass" integer NOT NULL,
	"dmarc_pass" integer NOT NULL,
	"sources" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dmarc_reports_org_report_uq" UNIQUE("org_name","report_id")
);
--> statement-breakpoint
CREATE INDEX "dmarc_reports_domain_end_idx" ON "dmarc_reports" USING btree ("domain","end_at");