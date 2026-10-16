ALTER TABLE "placements" ADD COLUMN "rank" smallint;--> statement-breakpoint
ALTER TABLE "stripe_prices" ADD COLUMN "rank" smallint;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_rank" CHECK ("placements"."rank" is null or "placements"."rank" between 1 and 3);