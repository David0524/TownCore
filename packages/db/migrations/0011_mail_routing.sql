CREATE TABLE "role_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"local_part" text,
	"team_id" uuid NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_addresses_local_part_unique" UNIQUE("local_part"),
	CONSTRAINT "role_addresses_catch_all_shape" CHECK ("role_addresses"."is_catch_all" = ("role_addresses"."local_part" is null)),
	CONSTRAINT "role_addresses_local_part" CHECK ("role_addresses"."local_part" ~ '^[a-z0-9][a-z0-9._-]*$')
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_staff_id_pk" PRIMARY KEY("team_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD COLUMN "target_id" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "role_addresses" ADD CONSTRAINT "role_addresses_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_addresses_one_catch_all_uq" ON "role_addresses" USING btree ("is_catch_all") WHERE "role_addresses"."is_catch_all";--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_target_pair" CHECK (("admin_actions"."target_type" is null) = ("admin_actions"."target_id" is null));