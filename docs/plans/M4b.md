# M4b — Town-site redesign: from "literature" to front page

Status: **incorporated 2026-10-15** (owner: "Incorporate this"), revision 6. Part of M4; the decisions below are open.
Canvas (desktop + phone mockups of home, article, beat front, About): https://claude.ai/artifact/6889axn6oaYJu7ABgyrNHs
Scope: the shared design system and page templates. Every rule in CLAUDE.md sections 2, 11a, 11a-2, 11b and 11c still applies.

## How this fits the repo (added on incorporation)

- **Reading order.** Revisions are newest first. Where they conflict, the later revision wins: 6 over 5 over 4 over 3 over 2 over revision 1 (sections 1–7 at the end). So the sponsored style is revision 4's mono label on a sand tile, not revision 2's gold border; and phones use revision 5's Apple-native chrome.
- **CLAUDE.md is updated** (§11a, §11a-2, §11b, §13 M4, Decisions) with the rules here; this file keeps the detail.
- **Rules unchanged.** Rule 1 (publisher line only on About and Privacy), Rule 2 (bylines), Rule 4 (source links), Rule 6 (sponsored labels), Rule 8 (scraping), Rule 9 and §11c (no images from other sites) all still apply.
- **Fonts.** Every face named here is on `@fontsource` (checked 2026-10-15: Instrument Serif, Geist, Geist Mono, Libre Caslon Display, Bricolage Grotesque, Figtree, Young Serif, Instrument Sans), so we keep self-hosting with no Google requests at run time. Apple's fonts are never embedded; phones use system font stacks.
- **What Boca can show today.** Boca has about 3 stories so far, no photos, no event, dining or homes data, and no meeting minutes (they're on Granicus, which robots.txt blocks for us). So: briefing-led front, typographic cards instead of photos, designed empty states, and modules that hide when they have no data.
- **Overlap with M4 PR C.** The typographic card here is the same component PR C needs as the image router's fallback, so it's built once here and reused.

### Build order inside M4

1. **M4b-1: tokens and components.** Family field in the theme schema, role-based fonts, color and type tokens (with dark-mode tokens), `StoryBlock`, `SectionHeader`, `RelativeTime`, `TypographicCard`, `SlotFrame` with designed house ads at exact sizes, Today tile with NWS data, `essentials`.
2. **M4b-2: Boca on `coastal-modern`.** Home, article, beat front and About on desktop; filled beat fronts (`coming-up`, `documents-posted`).
3. **M4b-3: phone chrome.** System font stacks, iOS type scale, bottom tab bar, large titles, grouped lists, sheets, "Your Boca" sheet (localStorage), web app manifest.
4. **M4b-4: `heritage` for Harbor Point** and a third fictional `community` town, proving three families render with the locked elements identical.
5. Then M4 PRs C–F (image router, entities, maps, guides) slot into these components.

Later, with the milestones that bring their data: `quick-poll` (M5, results go in the email), `photo-of-the-week` and "Send a photo" (M9 uploads), Dining, Homes and directory modules (M6), `civic-classic` and `magazine` (before Phase 3).

### Decisions needed

| # | Question | My recommendation |
| --- | --- | --- |
| D-M4b-1 | **Vote extraction** (open question 1). | Hide `recent-votes` and `VoteBars` for now. Boca's minutes are on Granicus, which we can't fetch, so there's nothing to extract from. Build extraction when a town has a fetchable minutes source, alongside data graphics. |
| D-M4b-2 | **Reviewer names** (open question 2). | **Decided by the owner:** bylines say "Reviewed by an editor"; Rule 2 is updated and the reviewer is recorded internally. |
| D-M4b-3 | **Extra data for the Today tiles:** tides and water temperature (NOAA CO-OPS), UV index (EPA), rip-current risk (NWS surf zone forecast). | **Agreed by the owner:** the weather tile ships on NWS data first; each extra source is added only after a terms and robots.txt check and the owner's OK. |
| D-M4b-4 | **Categories vs beats.** Readers see News, Events, Dining, Things to do, Businesses, Homes and Schools; the pipeline uses beats. | Beats stay the editorial unit (tiers, freshness, budget). Categories are a reader-facing grouping: News covers government, development, public safety and business news. A category appears only once it has content or a directory behind it, so no empty fronts. |
| D-M4b-5 | **All-caps text.** iOS grouped lists use all-caps section headers; §11a bans all-caps eyebrows. | Allow all-caps only as grouped-list section headers on phones, never over headlines. |

## Revision 6: style families, so no two towns look alike (extends CLAUDE.md 11a / 11a-2)

Canvas: Town variety system, Harbor Point Ledger (desktop), Pine Hollow Daily (desktop), Three towns on iPhone, plus every Boca page in the final style.

### Theme = family + town values
Add `family` to the theme schema. A family sets the structural and stylistic defaults; the town fills in its own values inside those limits.

| Family | Header | Front layout | Shape | Type roles (display / text / metadata) | Good fit |
| --- | --- | --- | --- | --- | --- |
| `coastal-modern` | Slim, left wordmark | Lead (8 cols) + Today bento (4) | 6px corners, hairlines, airy | Instrument Serif / Geist / Geist Mono | Beach, resort, fast-growing suburbs |
| `heritage` | Centered nameplate between double rules | Three columns: Today, lead, briefs | Square corners, column rules, denser | Libre Caslon Display / Public Sans + Libre Caslon Text / italic serif and caps kickers | Historic towns, places that lost a long-running paper |
| `community` | Compact tinted bar | Briefing-led + conditions tile + community mosaic | 16px corners, tiles, warm | Bricolage Grotesque / Figtree / small sans | Small, rural and mountain towns, low news volume |
| `civic-classic` (to design) | Stacked masthead with dateline | Lead + secondary grid | 4px corners, rules | Newsreader / Public Sans | Larger cities, heavy council coverage |
| `magazine` (to design) | Slim, centered | Big photo lead, editorial picks | 0–8px corners, large images | High-contrast display serif / grotesk | Affluent suburbs, arts towns |

### Town values (inside the family)
- **Palette:** `brand` from the town's identity (water, forest, brick, desert, prairie, granite) and `accent` from its complement or split-complement. Tints are derived. Contrast is auto-checked.
- **Display font:** chosen from the family shortlist. Wordmark, motif and tagline are per town.
- **Local panels in the Today area,** from the town's data sources: beach and tides, marine and ferry, trails and air quality, pass roads, snow, farmers market.
- **Local category swaps.** One or two categories can be renamed or replaced ("Harbor", "Outdoors", "Eat & drink") as long as each keeps its category color.
- **Module order** follows local priorities and news volume.

### Generator rules
1. Pick the family from the town's identity notes, size and news volume. Fewer than 5 items a day means the `community` family or a briefing-led front.
2. Within 50 miles, no two towns share family + palette, and they share at most two layout parts.
3. Run the screenshot review against both the family spec and the shared rules. The launch report shows the town next to its two nearest neighbors, side by side.

### Never varies
- Category color meanings, alert amber, and the sponsored label and tile.
- The slot contract.
- Byline and disclosure.
- Weather and sign-up above the fold.
- Phone chrome: Apple system fonts, tab bar, grouped lists, sheets. On phones, families differ by tint, wordmark, header treatment, widgets, the first module and one local tab.
- Accessibility and performance budgets.

### Build order
1. Ship `coastal-modern` for Boca.
2. Ship `heritage` and `community` before the Phase 1 neighbor towns launch.
3. Design `civic-classic` and `magazine` before Phase 3.

## Revision 5: Apple-native mobile (applies at phone widths; desktop keeps revision 4)

Canvas: Homepage phone, Article phone, Your Boca sheet.

### Fonts on mobile: Apple system fonts
Use system font stacks, never self-hosted SF or New York files. Apple's license doesn't allow embedding them on websites, and on Apple devices the stacks render the real fonts natively.

```css
--sf:   -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif;
--sfd:  -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif;
--ny:   ui-serif, "New York", "Iowan Old Style", Georgia, serif;
--mono: ui-monospace, "SF Mono", Menlo, monospace;
```

| Role | Font | Notes |
| --- | --- | --- |
| Everything in the interface, body text, lists, buttons | San Francisco (`--sf`) | |
| Large titles and section titles | San Francisco Display (`--sfd`), bold | |
| Story headlines, wordmark and ad headlines | New York (`--ny`) | Apple's serif keeps the "local paper" feel |
| Timestamps | San Francisco | No mono on phones; the desktop mono detail is dropped at phone widths |

- On Android and other devices the stacks fall back to Roboto and Noto Serif. That's acceptable, but iPhone is the design target.
- Desktop keeps the town's own fonts (revision 4). Below 600px, every town uses the Apple stack for the interface and New York for headlines, and the town's identity comes from the wordmark, tint color and motif.

### iOS type scale (Dynamic Type sizes, in px at default text size; set in rem so the reader's text-size setting scales them)
| Style | Size / weight | Use |
| --- | --- | --- |
| Large Title | 34 / bold | Screen titles |
| Title 2 | 22 / bold | Section headers |
| Title 3 | 20 / semibold | |
| Headline | 17 / semibold | |
| Body | 17 / regular | Article text at line-height 1.55 |
| Callout | 16 | |
| Subheadline | 15 | |
| Footnote | 13 | Metadata, captions, list section headers (all caps, as in iOS) |
| Caption | 12 / 11 | |
| Tab bar labels | 10 / medium | |

Section titles use Title Case ("This Weekend", "Find a Local Pro") and buttons use Apple's Title Case labels ("Sign Up", "Add to Calendar", "See All"). Story headlines stay in sentence case.

### iOS system colors and materials
| Token | Value | Use |
| --- | --- | --- |
| Label | #000 | Primary text |
| Secondary label | #6E6E73 | Secondary text. Darker than iOS's default so it passes AA on the web |
| Separator | 0.5px #C6C6C8 | List separators, inset 16px from the left |
| Fill | rgba(118,118,128,0.12) | Search field, category capsules |
| Grouped background | #F2F2F7 | Grouped lists and cards |
| Chrome | rgba(249,249,249,0.94) plus a 0.5px top or bottom hairline | Nav bar and tab bar (add a backdrop blur where supported) |
| Tint | The town's `brand` color | Links, selected tab, primary buttons, plain text buttons ("See All") |
| Destructive | #FF3B30 | "Report an Error" |
| Toggles | #34C759 | |
| Status colors | iOS orange #FF9500 for alerts; red, orange and green for icon tiles | |

### iOS patterns (and Android patterns to avoid)
| Use (iOS) | Avoid (Android/Material) |
| --- | --- |
| Large-title screen with a buttons-only nav row; title collapses into the nav bar on scroll | Top app bar with elevation and a hamburger |
| Search field under the large title (rounded rect, gray fill, magnifier) | Floating search bar with a shadow |
| Filled gray capsules with a small colored glyph for categories | Outlined Material chips |
| Bottom tab bar, 5 tabs (Today, Sections, Events, Places, Search), filled glyph plus tint when selected, gray otherwise | Navigation drawer, bottom nav with pill indicator |
| Inset grouped lists like Settings: colored rounded-square icon tiles, chevrons, all-caps footnote section headers | Cards with drop shadows, ripple effects |
| Weather as Apple-style widgets: one medium tile in the tint color with white text, two small grouped tiles | |
| Filled (tint) and tinted (tint at 14% opacity) buttons, 50pt tall, 12pt radius; plain text buttons in tint | Floating action buttons, all-caps Material buttons |
| Sheets with grabber, centered title and a bold "Done" | Full-screen dialogs, snackbars |
| Back button shows chevron + previous title ("‹ Today"); right side holds text size (AA), bookmark, and share using the iOS share glyph | Back arrow, overflow (three-dot) menus |
| Alerts as a grouped banner with a filled warning glyph and chevron | Material banners with action buttons |

### Icons
Draw icons as SF Symbols look-alikes in SVG (rounded caps, consistent stroke, filled variants for selected tabs), or use a licensed open set that closely matches. Do not embed SF Symbols image files on the web; Apple's license doesn't allow it.

### Behaviors
Momentum scrolling, back-swipe through normal navigation, no custom scroll physics, haptics not applicable, and respect for the "reduce motion" and "reduce transparency" settings (solid chrome instead of blur).

## Revision 4: modern editorial direction (supersedes revisions 2–3 on visual style; their color roles, retention modules, slots, photo system and iOS UX still apply)

Canvas: Homepage desktop and phone. Other boards follow next.

### What changes
| Dated (remove) | Modern (use) |
| --- | --- |
| Thick colored header band, circle logo badge, utility strip | Slim 68px white header: small line-motif mark + wordmark, text nav, weather, one dark "Subscribe free" button. Amber alert bar only when an alert is active |
| Content in bordered, tinted boxes | Content on the page. Sections open with a large serif title over a 1px dark rule; items separated by hairlines |
| Pills and rounded buttons everywhere | 8px-radius rectangles; text links with arrows for secondary actions |
| Filled category tiles, colored pills | Hairline category buttons with a small color dot and a live count in mono ("[6] new"). Color as dots only |
| Dark footer band | Light footer with an oversized wordmark |
| Weather as a widget among boxes | **Bento "Today" tiles** beside the lead: weather (large light-weight numerals, hourly row), beach, sunset/tides. The only tinted surfaces on the page besides sponsored |
| Uniform card grid | 12-column asymmetric grid: lead takes 8 columns, Today takes 4. Portrait 4:5 event photos, square dining photos, 3:2 list thumbnails, and a **full-bleed photo of the week** as the page's visual moment |
| Gold borders on sponsored units | Sponsored keeps the same layout as editorial units, with a mono "Sponsored" label and a warm sand tile behind the image. Clear, but it doesn't shout |

### Type (three roles plus mono)
- **Display**: a modern editorial serif at large sizes with slightly tight tracking (Boca: Instrument Serif; regular weight only; sizes 22–58px desktop, 21–42px phone).
- **Text/UI**: a contemporary grotesk (Boca: Geist, 400–600). On Apple devices the UI chrome uses the system font stack.
- **Mono** for metadata only: timestamps, datelines, counts, labels, credits (Boca: Geist Mono, 11–13px). This replaces small all-caps labels and is the main "modern" signal.
- Other towns pick from role-based sets, e.g. display Fraunces, Bricolage Grotesque or Young Serif paired with Geist, Figtree or Instrument Sans. Each set must work at 22px and 58px.

### Color
- White page, near-black text (#111418), one brand color for the logo mark, primary button and links on phone.
- Tints only for the Today bento (sky, sand, neutral tile) and the sponsored tile.
- Category colors as 6–10px dots. The amber alert bar is the only full-width color.
- Dark mode: the same roles mapped to a near-black page (#0E1013), with tiles lifted to #1A1D21. Build tokens for it now even if it ships later.

### Motion and polish
- Subtle only: 150ms hover underline and image zoom (1.02) on desktop. No animation with reduced motion.
- Images: 6px radius on desktop, 8–10px on phone, full-bleed lead on phone.
- No drop shadows. Elevation comes from tints and hairlines.

## Revision 3: balanced color, "your town's homepage", photos, iOS-style mobile (supersedes revision 2 where they conflict)

Updated canvas boards: Homepage (desktop, phone), Your Boca sheet (phone), Article (desktop, phone).

### Color budget: accents, not paint
- **Photos carry the color; the interface carries the identity.** With real photos on every card, the chrome stays calm.
- **Solid color is allowed only in these places:**
  - the header band (`brand`)
  - the weather card (`brand`)
  - the email sign-up (`cta`)
  - small category icon chips
  - "New" badges
  - house ads (`ink`)
- **Everything else** is white or the neutral `surface` (#F4F6F8 desktop, #F2F4F7 phone), with hairlines.
- **Category color appears as text labels and icon chips, never as filled pills or tinted sections.**
- **Tints are reserved:** sky for weather and key facts, sun-tint for the sign-up and sponsored units. Other tints are removed.
- **Heading weight** tops out at 700. The masthead is the only exception.

### The town's homepage (and the reader's own homepage)
- **Weather card above the fold on every viewport.** It's the reason to open the site every morning.
  - Current temperature, condition, high/low and feels-like.
  - A 6-step hourly row, plus UV, wind and sunset.
  - Beach and tides for coastal towns (rip current risk, water temperature, high and low tide). Inland towns swap in another local panel, such as air quality or pollen.
  - Sources: the NWS API for forecasts, hourly and alerts; NWS surf zone forecasts for rip currents; NOAA CO-OPS for tides and water temperature; the EPA UV index. Cache per town, refresh every 15 minutes, and always show the source line.
- **"Boca essentials":** quick links to the evergreen guides people look up weekly (trash and recycling days, beach parking, paying a city bill, library hours, reporting an issue, road closures).
- **"Your Boca" personalization**, with no account:
  - Readers pick a neighborhood and follow categories.
  - It's stored in localStorage and changes the order of modules and items.
  - On phone it's a bottom sheet (see the canvas); on desktop it's a popover from the "Your Boca" chip.
- **Make it a homepage:**
  - Desktop: "Make us your homepage" opens a short how-to per browser, since browsers can't set it in code.
  - Phone: ship a web app manifest and icons, and show a dismissible "Put Boca on your Home Screen" card after the second visit.
- **Greeting** by time of day ("Good morning/afternoon/evening"), in the town's local time.

### Photos (new image system)
| Use | Ratio | Notes |
| --- | --- | --- |
| Lead / hero | 16:9 (desktop lead may crop to 4:5) | Load eagerly with high fetch priority. This is the LCP element |
| Event and related cards | 4:3 or 3:2 | Lazy-loaded |
| Dining and directory | 1:1 | Business-supplied or reader photos |
| Photo of the week | 4:5 | Reader submissions |
| List thumbnails | 3:2 desktop, 1:1 (72px) phone | Typographic card when no photo |
- Store a focal point per image so crops never cut off the subject. Serve AVIF/WebP at several sizes with width and height set, which also keeps CLS low.
- Every photo has a credit, and a caption saying what it actually shows. Credit types: "Photo: City of Boca Raton", "Photo: [Business], provided", "Photo: [Name], submitted", "Stock photo", "Illustration (AI-generated)". Rules from CLAUDE.md 11c still apply.
- When an item has no allowed photo, it falls back to the typographic card, never a grey box.
- Add **"Send a photo"** (reader upload with license grant), linked from the footer and the photo-of-the-week module.

### Mobile UX (Apple Human Interface Guidelines, applied to the web)
- **Navigation:** a bottom tab bar replaces the hamburger as primary navigation, with 5 tabs: Today, News, Events, Places (dining, things to do, businesses, homes), Search. Translucent background, safe-area padding, current tab in the brand color.
- **Large title** on Today ("Good morning") with the date and neighborhood above it. Inner pages use a standard nav bar with a back button labeled with the previous screen ("‹ Today").
- **Inset grouped lists** for lists of links (3 things, latest, find a pro, sources): white groups on a light grey page, separators inset from the left, chevrons on rows that navigate.
- **Horizontal carousels with a visible peek** of the next card (weekend, new and now open, related businesses). Category chips scroll the same way, so a cut-off item reads as "there's more".
- **Sheets** for settings and filters (Your Boca, event filters), with a grabber, a centered title and a "Done" button. Never full-page modals.
- **Touch targets** of at least 44×44 pt. One prominent filled button per card. Primary buttons are 48–50 pt tall with 12 pt radius on phone; desktop keeps pill buttons.
- **Type:**
  - UI chrome (tab bar, lists, buttons) uses the system font stack (`-apple-system, BlinkMacSystemFont`, then the town's UI font), so it feels native on iPhone.
  - Headlines keep the town's display font for brand voice.
  - Sizes are set in rem so they follow the reader's text-size setting, plus an "Aa" control on articles.
- **Native behaviors:**
  - Share uses the Web Share API.
  - "Add to Calendar" downloads an .ics file.
  - "Directions" opens the device maps app.
  - Back-swipe works because pages are plain links.
  - Reduced-motion settings are respected.
  - No custom pull-to-refresh or scroll hijacking.

### Acceptance additions
- [ ] At 390×844, the weather card and the start of the top story are visible above the tab bar. At 1280×800, the header, categories, top story, weather card and sign-up are visible.
- [ ] A color audit per page: no filled color blocks outside the allowed list above.
- [ ] Every image slot renders a typographic-card fallback when it has no photo, with no layout shift.
- [ ] The hero photo is the LCP element and loads in under 2.5 s on a mid-range phone over 4G.
- [ ] Your Boca settings persist across visits on one device, and the page still renders correctly when storage is empty.

## Revision 2: color, headers, categories, fonts (supersedes sections 1–4 where they conflict)

Updated canvas boards: **Homepage · desktop**, **Homepage · phone**, **Town theme system**. Article, beat and About get the same treatment next.

### Color roles (add to theme schema; every town fills every role)
| Role | Use | Rule |
| --- | --- | --- |
| `ink` | Top strip, footer, headings | Darkest brand shade; the trust anchor |
| `brand` | Header band | From the town's identity (ocean, harbor, forest) |
| `cta` | The email sign-up only | Complement of `brand` (opposite hue) so it is the most eye-catching thing on the page |
| Category colors | Category buttons, labels, module headers | Fixed meaning network-wide: News blue, Events berry, Dining coral, Things to do teal, Businesses green, Homes violet. Towns may nudge lightness, never the hue family. Readers and advertisers learn them |
| `sponsored` | Gold border + gold tint on every paid unit | Never used on editorial. Makes paid spots attractive and unmistakable |
| `alert` | Amber, real warnings only | NWS alerts, closures. Never decorative |
| Tints | Module backgrounds (sky, pink, mint, lilac) | Light washes; text on them passes AA |
Ratio guide: ~60% white and tints, ~30% brand and ink, ~10% CTA and category color. The generator computes category tints and checks every text pair for AA.

### Header and above the fold (all towns)
1. Ink utility strip: date, weather, amber alert pill when active, "Advertise" and "List your business".
2. Brand header band: motif badge, masthead in the display font, a short friendly tagline in the CTA color, search, and the CTA button "Get the free morning email".
3. **Category buttons** overlapping the band: News, Events, Dining, Things to do, Businesses, Homes, Schools (desktop 7 across; phone 3×2, Schools under More). Each opens a category front. Towns can swap one category for a local one (e.g. Outdoors, Beaches) but each category keeps its color.
4. "Good morning, {Town}." with the top story card (typographic number or event card) and the This weekend module.
5. Newsletter strip in the CTA color with social proof ("Join [N] neighbors"); show the real count once over 500.
On a 1280×800 desktop and a 390×844 phone, items 1–4 and the newsletter sign-up must be visible without scrolling.

### Retention modules (new in the module library)
- `good-morning`: greeting plus top story and weekend picks.
- `three-things`: three numbered, color-coded items to know today. Becomes the newsletter's top block too.
- `this-weekend`: events, with one sponsored event slot.
- `new-now-open`: new food and drink businesses from filings, with one sponsored restaurant slot.
- `quick-poll`: one question a day, results in tomorrow's email. Needs a small votes table; no account required, one vote per browser.
- `find-a-pro`: directory chips, the category Top spot, and an "open Top spot" tile when unsold.

### Monetization surfaces (add to the slot contract, 11b)
- `category.sponsor`: "Dining, sponsored by [business]" on each category front (exclusive, monthly).
- `weekend.sponsored`, `dining.featured`: one gold slot inside each module.
- `directory.topspot`: the first listing per category, styled gold. When unsold, show "Top spot open: {category}. Claim it" to create demand from businesses already listed. This is the hook for directory bidding.
- House ads are now designed in brand and category colors ("This spot could be your restaurant"), not grey boxes.

### Fonts: three roles per town
Replace the 6 curated pairs in 11a with role-based sets: **display** (masthead and headlines, high personality, used large and bold), **text** (summaries and body, a highly readable sans at 16–19px), **UI** (labels, chips, buttons; usually the text family at 700–800). Starting sets, all Google Fonts:
- Fraunces / Figtree (Boca: warm, friendly)
- Bricolage Grotesque / Figtree (harbor towns: salty, modern)
- Young Serif / Instrument Sans (mountain and small towns: cozy)
- Newsreader / Public Sans (civic-heavy larger cities: classic)
- Add more by human decision; check each display face at 28px and 60px.
Body text on article pages may stay in a serif text face if a town's theme calls for it.

### Voice
Friendly and local, still factual: "Good morning, Boca.", "Who's new in town", "I'm in". Taglines and module titles live in the theme file per town. Headlines stay plain and accurate (no clickbait, no questions); the warmth goes in labels, greetings and module names.

### Acceptance additions
- [ ] Above-the-fold check on both viewports for all three test towns.
- [ ] Category colors and the gold sponsored style render identically across towns; brand, CTA, fonts and motif differ.
- [ ] Every text-on-color pair passes AA (white on category colors, ink on CTA and tints).
- [ ] Every new slot has a designed house ad.

## 1. What changes and why (revision 1)

| Problem in current build | Fix |
| --- | --- |
| Long text in one column; no front-page structure | Story blocks with a clear hierarchy: lead, secondary, brief and list items, each with a beat label, relative time and a one-line summary |
| Plain bulleted links | Scannable rows split by hairline rules (newspaper column rules), not cards |
| No visuals without photos | Typographic cards: number cards, event cards, vote bars, built in town colors from the story's own records |
| Wireframe house ads with tall empty space | Each slot's reserved size exactly matches a designed house ad, so it looks like a newspaper ad and no space sits empty |
| No "this town today" signals | Weather strip always visible, plus meetings next week, events, new in town, and relative times |
| Flat hierarchy | A type scale with distinct sizes per story level; headline links underline only on hover |
| Phone nav cut off with no hint | Fixed "More" button at the end of the tab row |
| Sparse beat pages | Beat fronts filled with record-derived modules: coming up, recent votes, documents posted, sub-body filters |

## 2. Design tokens to add (all components read these; nothing hardcoded)

- Derived color roles: `--text`, `--muted`, `--rule`. The theme generator derives them from `ink` and checks contrast (AA). Boca's values are in the canvas.
- Type scale, set per role, not per page:
  - `--fs-lead`: 34 desktop / 25 phone
  - `--fs-lead-variant`: 40
  - `--fs-secondary`: 21–22
  - `--fs-brief`: 20
  - `--fs-list`: 15–16
  - `--fs-label`: 13–14
  - `--fs-dek`: 22 / 19
  - `--fs-body`: 20 / 19 (serif)
- Rules: `--rule-hair` (1px), `--rule-section` (2px ink, under section headers), `--rule-masthead` (3px double under nav).
- Labels are sentence case in the accent color. No all-caps eyebrows. The only small-caps-like text is the locked slot label.

## 3. Components (new or rebuilt)

### Story and section building blocks

- `StoryBlock` with variants:
  - `lead`: text plus a typographic card.
  - `secondary`: column with a left hairline.
  - `brief`: label/time column plus headline and summary.
  - `list`: headline and time in one row.
- `BeatLabel`, `RelativeTime`. Render the absolute time on the server and hydrate the relative time on the client, so cached pages never show a stale "2 hours ago".
- `SectionHeader`: title, an optional "More →" link, and a 2px ink rule.

### Visuals

- `TypographicCard` with variants:
  - `number`: a big figure plus 3 breakdown rows.
  - `event`: what, date, time, venue.
  - `beat`: icon plus headline excerpt.
  - Built from story records only. Bracketed numbers in the canvas are placeholders.
- `VoteBars`: approved, denied and tabled counts from minutes. Hide the component when there is no vote data.

### Article page

- `KeyFacts`: a what/when/where/sign-up grid. Shown when the writer agent extracts at least 3 facts.
- `SourcesBox` (compact): source links, "How this story was written" and "Report an error", in one block.
- `CorrectionNote`: locked style, placed above the visual.

### Ad slots

- `SlotFrame`: the locked label, an exact reserved size, and a house-ad fallback.
- `HouseAd`, one design per size: 970×90, 320×100, 300×250, and the in-feed card.

### Homepage and beat modules

- `WeatherStrip`: never hidden. With no current data, show the latest NWS forecast and alerts.
- `NavOverflow`: the phone tab row with a fixed "More" button.
- Modules: `MeetingsModule` (4-up on desktop, list on phone; shows "Agenda posted" or "not yet posted"), `EventsList`, `NewInTown` (from filings, with a "Claim it" link into the directory), `DirectoryFeatured`, and `NewsletterCTA` (rail, inline and phone variants).

### New modules for the module library

- `coming-up`: beat-scoped meetings.
- `recent-votes`: from minutes, once vote extraction exists. Hide until then.
- `documents-posted`: new agendas and minutes, linked to the PDFs.

## 4. Page specs

### Homepage

- **Briefing front (fewer than 5 items a day; Boca today):**
  1. `briefing-column`: the top item gets a typographic card; then 4–6 briefs.
  2. `newsletter-cta` (second on phone).
  3. `home.infeed`.
  4. Meetings.
  5. Beat sections, 2×2 on desktop. A section with fewer than 2 items shows its next scheduled meeting instead of a bare list.
  6. New in town.
- **Rail:** newsletter, `rail.box`, events, directory.
- **Lead front (5+ items a day):** `lead-story` with a large card, then 3 secondary stories, then the same modules.
- The canvas homepage has a Tweak that switches between the two fronts.

### Article (`classic-rail` shown)

- Order: beat label and source type, headline, dek, byline row with share buttons, correction note, visual, first paragraph, key facts, paragraphs 2–3, `article.inline`, the rest of the body, sources box, `article.related-businesses`, related stories.
- On phone, the newsletter CTA follows the sources box.
- `wide-reading` and `magazine` reuse the same blocks.

### Beat front

- **Section masthead:** title, a one-line description of what the beat covers and which sources it uses, sub-body filter chips, and "Get [beat] news by email."
- **Main column:** lead with a visual, latest list with an in-feed sponsored row, recent votes, archive.
- **Rail:** coming up, documents posted, `rail.box`.
- **Phone:** coming up first, because it's the most useful thing on a sparse beat.

### About

- "In short" box, how we work in 3 steps, what we cover by beat, then corrections, advertising and contact.
- Ends with the locked line "{Site} is published by TownCore."
- Scannable sections, no long text wall.

## 5. Acceptance criteria

- [ ] Boca and Harbor Point both render home, article, beat and About on 390px and 1280px, and look different (different header, grid and first modules).
- [ ] With Boca's real content (fewer than 5 items a day), no section renders as a bare list of fewer than 2 links. Sparse sections show their designed empty states.
- [ ] Every slot renders a designed house ad at its exact reserved size. CLS < 0.1. Mobile ad density ≤ 30%.
- [ ] The weather strip renders on every page type, even without current conditions.
- [ ] Contrast AA passes for every token pair. Visible focus on every interactive element. Touch targets ≥ 44px on phone.
- [ ] The locked elements are unchanged: byline format, "Reviewed by", source links, slot labels, and the About/Privacy publisher line.
- [ ] Screenshot review: home, article, beat and About on both viewports for both towns, attached to the PR.

## 6. Out of scope (next in M4)

Maps and the image router (11c), topic and entity pages, evergreen guides. This plan's typographic cards are the always-available fallback those will slot into.

## 7. Open questions

1. Vote extraction from minutes: build it now (needed for `recent-votes` and `VoteBars`), or hide those modules until M4c?
2. Reviewer names: real staff names, or a role label ("Reviewed by an editor") until staff profiles exist?
