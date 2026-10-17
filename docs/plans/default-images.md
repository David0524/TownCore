# Plan: a catalogue of default story images, never the cover story

Brief: `docs/briefs/default-images.md` (owner, 2026-10-17: the title card on "Property sales in Boca
Raton, Sept. 28–Oct. 4" is "so ugly"). Governs: Rule 9, §11c, §11a (token-driven components), §6a
(rank unchanged), §14 (build the system: every change on Boca, Harbor Point and Pine Hollow).

**Status: waiting for the owner's OK.** Nothing below is built yet. Decisions for the owner are
marked **D-DI-n** with a recommendation; "approve as written" takes every recommendation.

---

## 1. What falls through to the title card today

Every story the pipeline publishes, and what its cover is today (`imageOptions()` +
`coverImage()`):

| Story kind (candidate key) | Beat | Chain | Cover today |
| --- | --- | --- | --- |
| `roundup:meetings` | government | chart → illustration → card | chart rule → section illustration, picked with **no keyword match** |
| `roundup:new-businesses` | business | same | as above (biz-19 when the headline says "filings") |
| `roundup:new-licenses` | business | same | as above |
| `roundup:new-places` | business | same | as above |
| `roundup:inspections` | business | same (no chart: record type not counted) | any business illustration |
| `roundup:permits` | development | same (no chart) | any development illustration |
| `roundup:roads` | development | same (no chart) | any development illustration |
| `roundup:sales` | development | same (no chart) | any development illustration, **often the card** (below) |
| `spotlight:inspection` (Tier 3) | business | business chain | any business illustration (a kitchen beside a named failing restaurant) |
| `spotlight:permit` | development | development chain | map, else an illustration |
| `alert:*` (NWS) | community | reader photo → stock → illustration → card | a **community** picture (a park) for a flood warning |
| story (model-written) | any | beat chain | best keyword match, else any section picture |
| guide | — | own art → title match → stock → card | **card** for most (gd-01 to gd-15 not installed) |
| public safety | public-safety | map → card | **card** unless there's a block address |

Why the property-sales roundup showed the card (found reading the code; the demo database isn't
reachable from this session):

1. **Pages that draw a story with no recorded image skip illustrations.** `articleImage()` falls
   back to `chooseArticleImage(..., { photos: false })`, and `ai-illustration` is in
   `PHOTO_OPTIONS`, so it's skipped and the chain lands on the card. Roundups re-rendered or
   copied to the demo without their `images` row hit this. A section illustration has no side
   effect (unlike a reader photo, which is marked used), so the read-only path can safely choose
   one.
2. **Cover illustrations are never recorded.** `coverIllustration()` is computed per request and
   not saved, so the 14-day no-repeat rule doesn't see it: the same few pictures recur, and
   a weekly roundup can get the same one every week.
3. **Matching is by section, not by story kind.** A sales roundup is "development", so it competes
   with cranes and roundabouts, and its headline ("A $4.2 million waterfront home leads…") rarely
   names a tag.

Fixture check (local CI database): 11 of the 16 published fixture stories on Boca, Harbor Point and
Pine Hollow show the card, since fixtures have no approved illustrations.

## 2. The catalogue

### 2.1 Shape (D-DI-1)

Extend the existing shot list in `packages/config/src/illustrations.ts` (one file, one style,
one generated shot list) with two fields:

- `kinds`: story kinds a shot is made for, matched on the candidate key prefix
  (`roundup:sales`, `roundup:permits`, `roundup:new-businesses`, `roundup:new-licenses`,
  `roundup:new-places`, `roundup:inspections`, `roundup:roads`, `roundup:meetings`,
  `spotlight:permit`, `alert`).
- `fallback: true`: a calm, generic picture of the section (a civic building, a quiet main
  street) used when a model-written story's words match no tag, instead of a random scene from
  the section.

Router order for an illustration: the story kind's shots (if it has a kind) → keyword match in the
section (score ≥ 1) → the section's fallback shots → card. The 14-day no-repeat rule applies at
each step; within a kind, a stable hash per story plus no-repeat rotates a weekly roundup through
its set.

**Recommendation:** extend `illustrations.ts` (the router and prompts already read it).

### 2.2 Shots per kind

Existing shots are re-used where they already fit (adding the `kinds` tag); new shots are
numbered by kind. Every kind has at least 6 `region: 'any'` shots; FL extras on top.

| Kind | Re-used | New (any) | New (FL) |
| --- | --- | --- | --- |
| roundup:sales | biz-18, gd-11 | sale-01 to sale-05 | sale-06 |
| roundup:permits | dev-03, dev-05, dev-18, dev-22 | perm-01 to perm-03 | — |
| roundup:new-businesses | biz-01, biz-19, biz-22 | nb-01 to nb-04 | — |
| roundup:new-licenses | biz-13, biz-14, biz-15, biz-20 | lic-01 to lic-03 | — |
| roundup:new-places | biz-02, biz-03, biz-04, biz-05, biz-07 | np-01 to np-02 | (biz-06) |
| roundup:inspections | — | insp-01 to insp-06 | — |
| roundup:roads | dev-07, dev-08, dev-15, dev-16 | road-01 to road-03 | — |
| roundup:meetings | gov-01, gov-02, gov-03, gov-04, gov-11 | mtg-01 to mtg-02 | — |
| spotlight:permit | dev-01, dev-02, dev-04, dev-06, dev-09, dev-11, dev-13 | — | — |
| alert (by event words) | wx-02, wx-03, wx-04, wx-06, wx-07, wx-08, wx-09, wx-13, wx-14, wx-17, wx-20 | alrt-01 to alrt-05 | — |
| fallback, per section | gov-08, dev-02, biz-22, com-01, sch-03 | fb-01 to fb-05 | fb-06 (gov-07 style) |

New scenes (prompts are `ILLUSTRATION_STYLE` + scene, generated into
`docs/brand/illustration-shot-list.md` once approved):

- **sale-01** A tidy single-family house with a front porch, a potted plant and two moving boxes by the door.
- **sale-02** A ring of house keys hanging from the lock of a painted front door.
- **sale-03** A quiet residential street of varied houses and front lawns, seen from the sidewalk.
- **sale-04** A post-and-arm yard sign with a blank panel on a front lawn, the house soft behind it.
- **sale-05** Rooftops of a residential neighborhood from a gentle aerial angle, trees between them.
- **sale-06** (FL) A low white house on a canal with a small dock and one palm tree.
- **perm-01** Rolled blueprints, a hard hat and a tape measure on a plywood work table.
- **perm-02** A two-story house wrapped in scaffolding during renovation, tarps on the lawn.
- **perm-03** A new wood-framed house against a blue sky, stacks of lumber in front.
- **nb-01** A small storefront at morning, a person seen from behind unlocking the glass door; awning blank.
- **nb-02** A row of small storefronts with blank awnings and planters along a sidewalk.
- **nb-03** A small home-office desk with an open laptop showing a blank form, a coffee and a folder.
- **nb-04** A bunch of balloons tied to a blank sandwich board outside a new shop.
- **lic-01** A contractor's white work van with ladders on its roof rack, parked at a curb; no lettering.
- **lic-02** A tool belt, gloves and a hard hat on the tailgate of a pickup.
- **lic-03** Paint cans, rollers and a folded drop cloth on a porch step.
- **np-01** A bar counter with empty stools, glasses on a shelf and warm pendant lights.
- **np-02** A small table set for two by a restaurant window, menus closed (blank covers).
- **insp-01** A spotless stainless-steel restaurant kitchen line, empty, under bright light.
- **insp-02** A probe thermometer resting on a steel prep counter beside a cutting board.
- **insp-03** A hand-washing sink with a soap dispenser and paper towels in a commercial kitchen.
- **insp-04** A clipboard with a blank checklist on a steel counter, a pen clipped to it.
- **insp-05** A walk-in cooler with shelves of lidded containers (blank labels), door open.
- **insp-06** Boxes of disposable gloves and hairnets on a shelf by a kitchen door.
- **road-01** A line of orange cones and barrels narrowing a lane on a suburban road.
- **road-02** A paving machine and roller laying fresh asphalt, steam rising.
- **road-03** Road work at night under work lights, a blank arrow board on a truck.
- **mtg-01** A stack of agenda folders on the end of an empty row of chairs in a meeting room.
- **mtg-02** A meeting room with a projector screen showing a blank slide and rows of chairs.
- **alrt-01** Sandbags stacked across the doorway of a house, rain falling.
- **alrt-02** Ice-coated branches and a frosted fence after a freezing night.
- **alrt-03** A snowplow clearing a residential street at dusk.
- **alrt-04** A large tree limb down on a lawn after wind, the house untouched.
- **alrt-05** Dark storm clouds building over a town's rooftops, the street empty.
- **fb-01** A wide, quiet main street of small shops and trees in morning light.
- **fb-02** A town square with a fountain, benches and trees; no statue or monument.
- **fb-03** A residential street at dusk with porch lights on.
- **fb-04** A row of mailboxes along a country road with fields behind.
- **fb-05** A park bench under a large shade tree beside a path.
- **fb-06** (FL) A quiet street lined with palms and low pastel buildings.

That is 41 new shots. With the 21 still missing below, the owner's next batch is **62 images**.

### 2.3 Inspections and spotlights (D-DI-2)

A Tier 3 inspection **spotlight** names one restaurant with violations. Any kitchen picture beside
it could read as that restaurant's kitchen, which editorializes the same way a drawing beside crime
news does. **Recommendation:** treat `spotlight:inspection` like public safety: no illustration,
the redesigned card (and so never the cover, §3). The weekly inspections **roundup** lists every
place inspected, most passing, so the neutral shots insp-01 to insp-06 (clean, empty, no food
shown badly) are fine there.

### 2.4 NWS alerts (D-DI-3)

Alerts are filed under the community beat, so they get park pictures. **Recommendation:** alerts
match on the `weather` section and the `alert` kind (by the event words: flood, heat, storm, wind,
freeze, winter), keeping their community beat for ranking and sections.

### 2.5 Style (D-DI-4)

The installed 129 images already read close to Boca's logo art: bright, saturated, clean vector
shapes, blue skies, warm light (see `apps/web/public/illustrations/dev-01.webp`, `biz-05.webp`).
**Recommendation: keep `ILLUSTRATION_STYLE` unchanged**, so the new 62 match the 129 already live.
Moving toward the logo (bolder outlines, more saturated palette, framing trees) would make the old
and new sets visibly different; if the owner wants that look, it should be a full re-shoot later,
not a mix.

### 2.6 Missing shots (21)

Make with the same batch: sch-10 (athletics field); wx-16 (rainbow), wx-17 (flooded street), wx-18
(FL, king tide at a seawall), wx-19 (fair-weather sky over a park), wx-20 (hazy sky); gd-01 (water
bill), gd-02 (voter registration), gd-03 (library card), gd-04 (parking meter), gd-05 (pet
license), gd-06 (picnic pavilion), gd-07 (FL, boat ramp), gd-08 (FL, beach parking), gd-09
(emergency alerts on a phone), gd-10 (emergency supplies), gd-11 (house keys and closing folder),
gd-12 (bulk pickup at the curb), gd-13 (pothole and phone), gd-14 (business form on a laptop),
gd-15 (arborist's truck). Prompts are already in `docs/brand/illustration-shot-list.md`.

### 2.7 Import checklist for the owner

1. Open `docs/brand/illustration-shot-list.md`; for each shot, paste its prompt into ChatGPT.
2. Reject any image with lettering, a logo, a face, a real landmark, or (for `any` shots) palms or beaches.
3. Save as `<id>.png` (or webp) in one folder.
4. Run `pnpm illustrations import <folder> --approved-by partners@towncore.net` and write the alt
   text for each from what it shows.
5. Send me the list of any shot you redid with palms, so I set it to `region: 'FL'`.

## 3. The title card becomes a generic label image (D-DI-5)

Owner, 2026-10-17, on the first options (which kept the town's motif): "Stop with the stupid leaf.
My thought was one that is a generic Breaking News headline." So the card no longer draws the
motif, the beat glyph or the story's own headline. It becomes a **generic label slate**: one bold
label for the kind of story ("Property Sales", "Weather Alert", "City Hall"), the beat's category
dot and the site name, like a news channel's slate. Built in code from the town's tokens, so it's
sharp, needs no image model, and every town's looks like its own paper.

Screenshots, today and two label options on the article page of each town, desktop and phone:
`docs/review/default-images/card-options-{boca,harbor,pine}-{desktop,phone}.png`.

- **D1. Brand label (recommended):** the town's brand color (the same deep-to-brand panel as its
  house ads), the label in white display type, the site name below. Reads as a deliberate image.
- **D2. Light label:** the town's light tint, the label in ink, a category-color edge. Quieter;
  better if several cards sit in one list.

Labels (in config, `packages/config/src/images.ts`, one per story kind, then per beat):

| Story | Label |
| --- | --- |
| NWS warning, or an official urgent release (road or bridge closure, boil-water notice) in its first 24 hours | **Breaking News** |
| other NWS alerts | Weather Alert |
| `roundup:sales` | Property Sales |
| `roundup:permits`, `spotlight:permit` | Building Permits |
| `roundup:roads` | Road Work |
| `roundup:new-businesses` | New Businesses |
| `roundup:new-licenses` | New Licenses |
| `roundup:new-places` | New Places to Eat |
| `roundup:inspections`, `spotlight:inspection` | Restaurant Inspections |
| `roundup:meetings`, government beat | City Hall |
| public safety | Public Safety |
| schools / development / business / community / guide | Schools / Development / Business News / Community News / Local Guide |

"Breaking News" is used only where it's true (an alert or urgent official notice, for its first
24 hours, then it shows its normal label), so the slate never oversells a routine story (§6a: no
clickbait). A roundup's figure (e.g. "101 new business filings") can sit under the label.
Token-driven, contrast-checked on every theme (white on `--accent`/`--accent-deep` already passes
for the house ads). Title Case labels, no all caps. In list thumbnails the label shrinks to the
category dot and a short label.

Public safety (D-DI-6): a block-level map when the story has an address, else the "Public Safety"
slate. No drawing (rule kept), and the slate is a label, not a picture of anything.

## 4. Default images are never the cover story (D-DI-7)

**Default** = the title card (any variant). A catalogue illustration counts as a picture.
**Recommendation:** count catalogue illustrations as pictures. Counting them as defaults would
leave Boca with almost no eligible lead (it has few real photos), so the lead slot would usually
be empty.

- **`pickLead()`** gets the stories' cover kinds and skips one whose cover is the card, taking the
  next ranked Tier 1–2 story (or approved Tier 3). Rank itself is unchanged (§6a); only the lead
  slot has the visual rule.
- **Phones:** the phone lead (top-story picture) uses the same `pickLead()`; the first card of
  "More top stories" is the next story with a picture (the rest keep rank order).
- **Section-front leads and "Up next"** use the same rule.
- **No eligible story:** the `lead-story` module hides itself (modules already hide when empty),
  so the front opens with the next module: the Today band on Boca, Briefs on Harbor Point, the
  briefing column on Pine Hollow; on phones, the Today card. Up next falls back to the next
  related story with a picture, else none. Nothing is padded and no stock picture stands in.
- **Tests:** unit tests for `pickLead` with card covers; e2e on all three towns asserting the lead
  is never `[data-visual="typographic-card"]`.

## 5. Build steps (after OK)

1. **Router:** read-only path may pick a section illustration; story kind from the candidate key;
   `kinds` and `fallback` on shots; alerts via the weather section.
2. **Record covers:** a nullable `images.cover_illustration_id` (migration), written by
   `assignArticleImage` when the visual is a chart, and counted by the no-repeat rule, so weekly
   roundups rotate.
3. **Catalogue:** the 41 shots in `illustrations.ts`; regenerate the shot list.
4. **Card:** the label slate (D1) in `TypographicCard`, labels in config; contrast test on all themes.
5. **Cover rule:** `pickLead`, phone row, section fronts, Up next.
6. **Fall-through test:** for every recurring roundup kind, alert and non-public-safety beat, with
   the full shot list as the library, the router never returns the card even after 6 weekly picks
   (no-repeat rule on). Exempt: public safety and `spotlight:inspection`.
7. **Backfill:** `pnpm illustrations assign` uses the story kind (and records covers); run on Boca
   locally. Demo sync and redeploy wait for the owner's go and Vercel's deploy limit.
8. **CLAUDE.md:** a Decisions entry (§11c table and Defaults by beat, the cover rule, the
   public-safety and inspection-spotlight defaults).

Until the owner imports the new shots, roundup kinds without installed shots fall back to the
section (as today) and the fall-through test runs against the full shot list, not the installed
library.

## 6. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D-DI-1 | Where the catalogue lives | Extend `illustrations.ts` with `kinds` and `fallback` |
| D-DI-2 | Inspection spotlights | No illustration; the card; never the cover |
| D-DI-3 | NWS alerts | Weather pictures by event, not community |
| D-DI-4 | Style | Keep `ILLUSTRATION_STYLE` |
| D-DI-5 | Card redesign | D1, brand label slate (no motif) |
| D-DI-6 | Public-safety default | Block map, else the "Public Safety" slate |
| D-DI-8 | Keep the AI catalogue (§2) or use only label slates | Keep both: catalogue picture first, slate as the last resort |
| D-DI-7 | What counts as a default for the cover rule | The title card only |
