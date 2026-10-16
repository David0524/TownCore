ALTER TABLE "businesses" ADD COLUMN "osm_ref" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cuisine" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_town_osm_uq" ON "businesses" USING btree ("town_id","osm_ref");