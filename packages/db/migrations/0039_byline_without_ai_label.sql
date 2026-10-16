ALTER TABLE "articles" DROP CONSTRAINT "articles_public_byline";--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_public_byline" CHECK ("articles"."status" not in ('published', 'corrected') or "articles"."byline" like '% Newsroom%');--> statement-breakpoint
-- Existing stories and images lose the AI label too (owner, 2026-10-16).
UPDATE "articles" SET "byline" = replace("byline", ' (AI-assisted)', '') WHERE "byline" LIKE '% (AI-assisted)%';--> statement-breakpoint
UPDATE "images" SET "alt" = regexp_replace("alt", '^(Illustration|Image) \(AI-generated\):\s*', '') WHERE "alt" ~ '^(Illustration|Image) \(AI-generated\):';
