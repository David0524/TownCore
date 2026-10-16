CREATE TYPE "public"."business_claim_status" AS ENUM('unverified', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "business_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"town_id" uuid NOT NULL,
	"claimant_name" text NOT NULL,
	"claimant_role" text NOT NULL,
	"email" text NOT NULL,
	"status" "business_claim_status" DEFAULT 'unverified' NOT NULL,
	"verify_token_hash" text,
	"verify_expires_at" timestamp with time zone,
	"verify_sent_at" timestamp with time zone,
	"verify_sends_today" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "hours" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "service_area" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "pending_name" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "owner_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_login_tokens" ADD CONSTRAINT "owner_login_tokens_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_claims_business_status_idx" ON "business_claims" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "business_claims_town_status_idx" ON "business_claims" USING btree ("town_id","status","created_at");--> statement-breakpoint
CREATE INDEX "business_claims_ip_created_idx" ON "business_claims" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_claims_verify_hash_uq" ON "business_claims" USING btree ("verify_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_login_tokens_hash_uq" ON "owner_login_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "owner_login_tokens_email_created_idx" ON "owner_login_tokens" USING btree ("town_id","email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_sessions_hash_uq" ON "owner_sessions" USING btree ("token_hash");