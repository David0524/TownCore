CREATE TABLE "tropics" (
	"basin" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb,
	"fetched_at" timestamp with time zone,
	"last_error" text,
	"last_attempt_at" timestamp with time zone NOT NULL
);
