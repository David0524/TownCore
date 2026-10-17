CREATE TABLE "experiment_assignments" (
	"experiment_key" text NOT NULL,
	"town_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_assignments_experiment_key_town_id_pk" PRIMARY KEY("experiment_key","town_id")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'off' NOT NULL,
	"unit" text DEFAULT 'town' NOT NULL,
	"winner" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_status" CHECK ("experiments"."status" in ('off', 'running', 'decided')),
	CONSTRAINT "experiments_unit" CHECK ("experiments"."unit" in ('town', 'cohort')),
	CONSTRAINT "experiments_winner" CHECK ("experiments"."status" <> 'decided' or "experiments"."winner" is not null)
);
--> statement-breakpoint
CREATE TABLE "referral_stats_daily" (
	"town_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "referral_stats_daily_town_id_day_source_pk" PRIMARY KEY("town_id","day","source")
);
--> statement-breakpoint
ALTER TABLE "towns" ADD COLUMN "households" integer;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_key_experiments_key_fk" FOREIGN KEY ("experiment_key") REFERENCES "public"."experiments"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_stats_daily" ADD CONSTRAINT "referral_stats_daily_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;