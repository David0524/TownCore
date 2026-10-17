CREATE TABLE "adapter_fix_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"source_id" uuid,
	"town_id" uuid,
	"platform" text NOT NULL,
	"failure" text NOT NULL,
	"http_status" integer,
	"error" text NOT NULL,
	"diagnosis" text NOT NULL,
	"fixture" jsonb,
	"platform_request_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"pr_url" text,
	"note" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adapter_fix_requests_scope" CHECK ("adapter_fix_requests"."scope" in ('source', 'platform')),
	CONSTRAINT "adapter_fix_requests_status" CHECK ("adapter_fix_requests"."status" in ('open', 'in_progress', 'fixed', 'dismissed')),
	CONSTRAINT "adapter_fix_requests_source" CHECK (("adapter_fix_requests"."scope" = 'source') = ("adapter_fix_requests"."source_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"town_id" uuid,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_cohort_towns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"launch_id" uuid,
	"stage" text DEFAULT 'names' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"pick" smallint DEFAULT 1 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"todos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launch_cohort_towns_stage" CHECK ("launch_cohort_towns"."stage" in ('names', 'purchase', 'mail', 'dns', 'provision', 'review', 'live')),
	CONSTRAINT "launch_cohort_towns_state" CHECK ("launch_cohort_towns"."state" in ('pending', 'running', 'waiting', 'done', 'failed')),
	CONSTRAINT "launch_cohort_towns_pick" CHECK ("launch_cohort_towns"."pick" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "launch_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'preparing' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"purchase_approval" jsonb,
	"go_live_approval" jsonb,
	"created_by" uuid NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launch_cohorts_name_unique" UNIQUE("name"),
	CONSTRAINT "launch_cohorts_status" CHECK ("launch_cohorts"."status" in ('preparing', 'awaiting_purchase', 'running', 'awaiting_go_live', 'live', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ops_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"items" jsonb NOT NULL,
	"text" text NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ops_digests_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_kind" CHECK ("proposals"."kind" in ('experiment', 'routing', 'cohort_gate', 'pricing')),
	CONSTRAINT "proposals_status" CHECK ("proposals"."status" in ('open', 'approved', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "source_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text NOT NULL,
	"platform" text,
	"config" jsonb,
	"label" text NOT NULL,
	"origin" text NOT NULL,
	"detail" text NOT NULL,
	"estimate_per_day" real,
	"estimate_basis" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_proposals_type" CHECK ("source_proposals"."type" in ('source', 'adapter')),
	CONSTRAINT "source_proposals_status" CHECK ("source_proposals"."status" in ('proposed', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "adapter_fix_requests" ADD CONSTRAINT "adapter_fix_requests_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_fix_requests" ADD CONSTRAINT "adapter_fix_requests_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adapter_fix_requests" ADD CONSTRAINT "adapter_fix_requests_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_cohort_towns" ADD CONSTRAINT "launch_cohort_towns_cohort_id_launch_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."launch_cohorts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_cohort_towns" ADD CONSTRAINT "launch_cohort_towns_candidate_id_town_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."town_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_cohort_towns" ADD CONSTRAINT "launch_cohort_towns_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_cohorts" ADD CONSTRAINT "launch_cohorts_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_proposals" ADD CONSTRAINT "source_proposals_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_proposals" ADD CONSTRAINT "source_proposals_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_proposals" ADD CONSTRAINT "source_proposals_decided_by_staff_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adapter_fix_requests_open_source_uq" ON "adapter_fix_requests" USING btree ("source_id") WHERE "adapter_fix_requests"."scope" = 'source' and "adapter_fix_requests"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE UNIQUE INDEX "adapter_fix_requests_open_platform_uq" ON "adapter_fix_requests" USING btree ("platform","failure") WHERE "adapter_fix_requests"."scope" = 'platform' and "adapter_fix_requests"."status" in ('open', 'in_progress');--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent","town_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_cohort_towns_uq" ON "launch_cohort_towns" USING btree ("cohort_id","candidate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_open_key_uq" ON "proposals" USING btree ("key") WHERE "proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_proposals_town_key_uq" ON "source_proposals" USING btree ("town_id","key");--> statement-breakpoint
CREATE INDEX "source_proposals_status_idx" ON "source_proposals" USING btree ("status","created_at");