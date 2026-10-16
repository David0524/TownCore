ALTER TYPE "public"."placement_status" ADD VALUE 'held';--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "stripe_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"product" "placement_product" NOT NULL,
	"stripe_product_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_prices_stripe_price_id_unique" UNIQUE("stripe_price_id")
);
--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "stripe_price_id" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "buyer_email" text;--> statement-breakpoint
ALTER TABLE "stripe_prices" ADD CONSTRAINT "stripe_prices_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_prices_town_product_idx" ON "stripe_prices" USING btree ("town_id","product","active");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_checkout_session_uq" ON "placements" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_subscription_uq" ON "placements" USING btree ("stripe_subscription_id");