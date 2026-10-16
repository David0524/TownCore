CREATE TABLE "town_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"geoid" text NOT NULL,
	"name" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"score" real NOT NULL,
	"rank" integer NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"ranked_at" timestamp with time zone NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "town_candidates_status" CHECK ("town_candidates"."status" in ('proposed', 'approved', 'rejected', 'live'))
);
--> statement-breakpoint
ALTER TABLE "town_candidates" ADD CONSTRAINT "town_candidates_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "town_candidates_geoid_uq" ON "town_candidates" USING btree ("geoid");--> statement-breakpoint
CREATE INDEX "town_candidates_state_rank_idx" ON "town_candidates" USING btree ("state","rank");