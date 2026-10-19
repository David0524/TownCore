CREATE TABLE "placement_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"seed" text NOT NULL,
	"provider" text NOT NULL,
	"ses_message_id" text,
	"send_error" text,
	"placement" text DEFAULT 'pending' NOT NULL,
	"checked_by" uuid,
	"checked_at" timestamp with time zone,
	CONSTRAINT "placement_results_placement" CHECK ("placement_results"."placement" in ('pending', 'inbox', 'promotions', 'spam', 'missing', 'not_sent'))
);
--> statement-breakpoint
CREATE TABLE "placement_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placement_tests_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "dns_records" ADD COLUMN "policy_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "placement_results" ADD CONSTRAINT "placement_results_test_id_placement_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."placement_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_results" ADD CONSTRAINT "placement_results_checked_by_staff_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_tests" ADD CONSTRAINT "placement_tests_domain_id_mail_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."mail_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_tests" ADD CONSTRAINT "placement_tests_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "placement_results_test_seed_uq" ON "placement_results" USING btree ("test_id","seed");--> statement-breakpoint
CREATE INDEX "placement_tests_domain_idx" ON "placement_tests" USING btree ("domain_id","created_at");