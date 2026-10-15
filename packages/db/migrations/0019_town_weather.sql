CREATE TABLE "town_weather" (
	"town_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb,
	"fetched_at" timestamp with time zone,
	"last_error" text,
	"last_attempt_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "town_weather" ADD CONSTRAINT "town_weather_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;