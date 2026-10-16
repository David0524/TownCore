CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"spec" jsonb NOT NULL,
	"alt" text NOT NULL,
	"source_url" text,
	"license" text NOT NULL,
	"attribution" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_kind" CHECK ("images"."kind" in ('map', 'data-graphic', 'typographic-card', 'business-photo', 'reader-photo', 'government-image', 'stock', 'ai-illustration')),
	CONSTRAINT "images_ai_approved" CHECK (not "images"."ai_generated" or "images"."approved_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "images_article_uq" ON "images" USING btree ("article_id");