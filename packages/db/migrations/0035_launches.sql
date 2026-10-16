CREATE TABLE "launch_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"step" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "launch_steps_status" CHECK ("launch_steps"."status" in ('pending', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"geoid" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" text,
	"stopped_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launches_status" CHECK ("launches"."status" in ('running', 'stopped', 'failed', 'ready', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "launch_steps" ADD CONSTRAINT "launch_steps_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_candidate_id_town_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."town_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "launch_steps_launch_step_uq" ON "launch_steps" USING btree ("launch_id","step");--> statement-breakpoint
CREATE INDEX "launches_geoid_idx" ON "launches" USING btree ("geoid");