CREATE TABLE "town_basemaps" (
	"town_id" uuid PRIMARY KEY NOT NULL,
	"bbox" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"source_url" text NOT NULL,
	"extracted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "map_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "town_basemaps" ADD CONSTRAINT "town_basemaps_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;