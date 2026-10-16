CREATE TABLE "article_entities" (
	"article_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"mention" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_entities_article_id_entity_id_pk" PRIMARY KEY("article_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"town_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_kind" CHECK ("entities"."kind" in ('business', 'street', 'neighborhood', 'school', 'official', 'project', 'agency'))
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "entities_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "article_entities" ADD CONSTRAINT "article_entities_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_entities" ADD CONSTRAINT "article_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_town_id_towns_id_fk" FOREIGN KEY ("town_id") REFERENCES "public"."towns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_entities_entity_idx" ON "article_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_town_kind_key_uq" ON "entities" USING btree ("town_id","kind","key");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_town_slug_uq" ON "entities" USING btree ("town_id","slug");