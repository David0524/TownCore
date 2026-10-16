CREATE TABLE "business_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"address" text,
	"zip" text,
	"phone" text,
	"website" text,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"business_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_requests_status" CHECK ("business_requests"."status" in ('pending', 'added', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "business_requests" ADD CONSTRAINT "business_requests_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_requests" ADD CONSTRAINT "business_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_requests" ADD CONSTRAINT "business_requests_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_requests_town_status_idx" ON "business_requests" USING btree ("town_id","status","created_at");--> statement-breakpoint
CREATE INDEX "business_requests_ip_created_idx" ON "business_requests" USING btree ("ip","created_at");