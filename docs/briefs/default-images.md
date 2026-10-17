# Brief: a catalogue of default story images (for a new Claude Code session)

Owner, 2026-10-17, looking at the title card on "Property sales in Boca Raton, Sept. 28–Oct. 4"
(a near-black panel with a big white headline, a gray palm-frond motif and a small house icon):
"This is so ugly." Two asks:

1. Build a catalogue of good default images to use instead of that card.
2. A story whose only visual is a default image is **never the cover story**.

Read `CLAUDE.md` first, in full. Section 2 and §11c (article images) govern this work, and
§14 "build the system, not one paper" means every change must work for every town and show on
Boca, Harbor Point and Pine Hollow in e2e. Write `docs/plans/default-images.md` and get the
owner's OK before building (§13: plan before code).

## How images work today

- **Image router:** `packages/pipeline/src/images.ts` picks the first allowed kind for a story's
  beat from `packages/config/src/images.ts`:
  - news beats use `imageDefaults`;
  - roundups use `roundupImageDefaults` (data graphic, then AI illustration, then card).
  - Every chain ends at `typographic-card`, so every story has a visual.
- **The title card:** drawn in code by `apps/web/src/components/news/TypographicCard.tsx`. It is
  the ugly image above. Lists use `StoryThumb.tsx` and the article page uses `ArticleVisual.tsx`.
- **Covers:** `coverImage()` in `apps/web/src/modules/data.ts` gives a story's cover on the
  homepage and in lists. A chart is never a cover (owner, 2026-10-16): a chart story gets its
  section illustration via `coverIllustration()`, or else the title card. That fallback is why
  a property-sales roundup with no matching illustration showed the card.
- **The lead:** `pickLead()` in the same file (homepage lead, i.e. the cover story) takes the
  highest-ranked Tier 1–2 story. It ignores what the story's visual is.
- **The AI illustration library:**
  - `packages/config/src/illustrations.ts` defines the shot list: id, sections, region, tags and
    scene. The house style is `ILLUSTRATION_STYLE`. `docs/brand/illustration-shot-list.md` is
    generated from it.
  - The files are in `apps/web/public/illustrations/<id>.webp`. 129 of the 150 shots are
    installed; sch-10, wx-16 to wx-20 and gd-01 to gd-15 are missing.
  - The owner makes the images by hand in ChatGPT (no image API, D-M9-4), and they are imported
    with `pnpm illustrations import`, which records each as AI-generated with its approver in
    `images`.
  - Matching is by section and keywords, and an image isn't repeated in a town within 14 days.
  - It never serves public safety.

## What to build

### 1. A default image catalogue

A network-wide set of generic, good-looking images that covers every kind of story we publish
with no picture of its own. Start from the actual output: list every story kind and beat the
pipeline produces, including the code-built roundups. Then find which ones fall through to the
title card today (query a Boca database, or reason from the chains). Typical holes:

- **Roundups:** property sales, permits, new business filings, new licenses, restaurant
  inspections, road work and lane closures, meetings this week.
- **Story kinds:** spotlights (one inspection, one large permit), NWS alerts, city releases on
  topics the library doesn't tag.
- **Beats:** public safety, which has no illustrations at all by rule.

The catalogue should:

- **Shot list:** extend the shot list in `illustrations.ts` (or a sibling catalogue file if that
  reads better), with enough variety per kind that a town publishing the same roundup every week
  doesn't show the same picture each week. Aim for at least 4–6 per recurring roundup kind,
  rotated by the existing 14-day no-repeat rule.
- **Style:** keep one style, `ILLUSTRATION_STYLE`, so the library reads as one set and matches
  what's installed. The owner liked the Boca logo art; look at it
  (`docs/brand/boca-town-square-logo.webp`) and decide whether the style should move toward it.
  Propose that in the plan rather than changing it silently.
- **Regional variants:** any picture with palms, beaches or other Florida-only features is
  `region: 'FL'`. Every kind needs `region: 'any'` options too, since the network is national.
- **Public safety:** keep the rule. No drawings beside crime or fire news, because a drawing
  editorializes. Instead, design one or more *non-pictorial* defaults that aren't ugly:
  - a clean, calm treatment built in code from the town theme;
  - or a neutral, generic image of the kind §11c already allows (a block-level map where there's
    a location).

  Propose options.
- **Rules (§11c, Rule 9):** every image is generic. No real people, no faces, no real events, no
  identifiable real places or landmarks, no text, logos or signs with writing, nothing from
  another site. Each is recorded as AI-generated with its approver. No label is shown on the site
  (owner, 2026-10-16). Alt text describes what the image shows.
- **Prompts for the owner:** write a ready-to-paste ChatGPT prompt for every new shot, as the
  existing shot list does, plus a short checklist for importing them. The owner generates the
  images; you never call an image API (a paid image service needs the owner's OK, §14).
- **Missing shots:** list the 21 shots still missing, so the owner can make them in the same
  batch.

### 2. Make the title card a last resort, and a better-looking one

- Redesign `TypographicCard` so that when it does show, it isn't a heavy dark slab. Options to
  propose:
  - the town's light tint with the beat's category color as a small accent;
  - the town's motif drawn lightly;
  - no oversized repeated headline (the headline is already next to it in every list).

  It must stay token-driven (no hardcoded colors, fonts or radii, §11a), pass the contrast
  checker, and differ by town theme while the locked elements stay the same.
- After the catalogue exists, the router should reach the card only when nothing in the
  catalogue fits. Add a test that fails if any recurring roundup kind or beat (other than public
  safety) can fall through to the card.

### 3. Default images are never the cover story

The owner's rule: a story whose visual is a default (the title card, and, decide in the plan,
possibly a generic catalogue illustration) is never the cover story.

- **Lead:** in `pickLead()`, skip a candidate whose cover would be a default and take the next
  ranked Tier 1–2 story. Ranking itself doesn't change (§6a). Only the lead slot gets the
  visual requirement.
- **Phones:** do the same for the lead on the phone homepage (it opens on the top story's
  picture, 2026-10-16) and the first card of "More top stories".
- **No eligible story:** say what happens when no story qualifies, for example a briefing-led
  front or the Today band first. Never pad and never show a stock picture as the story's scene.
- **Elsewhere:** section-front leads and "Up next" cards follow the same rule.
- **Tests:** add unit tests for the lead rule and e2e on Boca, Harbor Point and Pine Hollow
  showing the lead has a real or catalogue image and never the title card.

### 4. Backfill

Once the new images are imported, `pnpm illustrations assign` should give existing stories that
are still on a title card a catalogue image. Check it does for roundups, and add what's missing.
Run it on Boca locally. The demo database sync (`pnpm demo:sync`) and redeploy wait for the
owner's go and Vercel's deploy limit.

## Done when

- `docs/plans/default-images.md` is approved by the owner, with:
  - the catalogue design;
  - the card redesign options with screenshots on three towns, desktop and phone, in
    `docs/review/default-images/`;
  - the cover rule.
- The catalogue's prompts are in the generated shot list, ready for the owner.
- The card redesign, the cover rule and the fall-through test are merged with lint, typecheck,
  prettier, unit tests and the full e2e green.
- `CLAUDE.md` has a Decisions entry: the §11c table and "Defaults by beat", the cover rule, and
  the public-safety default.

## Don't

- Use images from other sites, stock presented as the story's scene, Street View, or any real
  person (Rule 9, §11c).
- Put an illustration on public safety.
- Change editorial rank to work around a missing picture. Only the lead slot gets the visual
  requirement.
- Call an image API or add a paid service without the owner's OK.
