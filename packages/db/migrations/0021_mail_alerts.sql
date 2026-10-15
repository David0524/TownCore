CREATE TABLE "mail_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_notified_at" timestamp with time zone,
	CONSTRAINT "mail_alerts_severity" CHECK ("mail_alerts"."severity" in ('warning', 'critical'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_alerts_open_key_uq" ON "mail_alerts" USING btree ("key") WHERE "mail_alerts"."resolved_at" is null;