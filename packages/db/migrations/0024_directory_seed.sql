ALTER TABLE "businesses" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "license_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "source_record_id" uuid;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "in_city_limits" boolean;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "geocode_status" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "geocoded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_source_record_id_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_town_slug_uq" ON "businesses" USING btree ("town_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_town_license_uq" ON "businesses" USING btree ("town_id","data_source","license_number");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_geocode_status" CHECK ("businesses"."geocode_status" is null or "businesses"."geocode_status" in ('match', 'no_match'));