# Logo art and identity assets for every town

Owner, 2026-10-17: "build the system, not one paper", then: "We will do ChatGPT image prompts for now. So when I start a new town you will provide the prompt. I do love the image being used for Boca right now though."

Boca's logo art was made in ChatGPT and cut by hand (`docs/brand/boca-town-square-logo.webp` → `apps/web/public/brand/boca-raton/`). Every new town now gets the same art the same way. The launcher writes the prompt, and code does all the cutting.

## What changes in the rules

- **§10b and D-M9-4:** AI-generated logo art is allowed for a town's identity. It is the illustration in the homepage greeting, and the picture the icons, favicon, share image, avatar, Facebook cover and email header are cut from. The owner makes it in ChatGPT from the launcher's prompt. It is imported by a staff member and recorded as AI-generated, with ChatGPT as its source and that person as approver.
- **No image API.** No code calls an image service, so no paid service is added (§14).
- **Unchanged:**
  - The masthead and wordmark are set in code from the town's name, type and motif, never drawn in the image.
  - The motif library grows only by human review.
  - A town without imported art keeps the motif drawing in its greeting and the motif icons drawn in code.
- **The owner's limits, in every prompt:**
  - no text or lettering;
  - evoke the town's architectural character, but never a recognizable copy of a specific real building presented as the town's own;
  - no city seal, official logo or government styling (Rule 1; §11a, "never suggest the site is the city government");
  - no people.

  Code also refuses identity notes that ask for text or mention a seal, crest, flag, official logo or government office (`logoInputProblems`).

## The workflow

1. **Prompt (launch step 6b).** After the theme, the launcher writes `docs/launches/<slug>/logo-prompt.md` with three ready-to-paste ChatGPT prompts: one main prompt and two alternates.
   - **Boca's style:** a flat, bright vector-style illustration with crisp edges, not a heavy-outline cartoon. It is a wide panoramic vignette, about 3:1, of the town's character: its waterfront or landscape, its architecture, its trees and one tower or skyline element. Tall foreground trees frame it on the left and right, and it fades into a pure white background with no border.
   - **Filled from the town:** its name, state, identity notes, motif and theme colors (the brand color, plus natural greens and warm building tones).
   - **The alternates** change only what leads the scene: a tower, the landscape, or a main street.
   - **In the report:** the launch report shows the first prompt, links the file, and adds a to-do until the art is imported. `pnpm identity prompt <slug>` prints the prompts again for any town.
2. **Make the image.** The owner pastes a prompt into ChatGPT, asks for a landscape image, and saves the result as PNG or WebP.
3. **Import.** Run `pnpm identity import <slug> <image> --approved-by you@towncore.net`. The command:
   - needs an active staff member;
   - cuts every asset into `apps/web/public/brand/<slug>/`;
   - sets `hero_art` and `app_icon` in the town's YAML (under `towns/`, or in the launch folder before approval) and in its config in the database;
   - records the art in `identity_art`: AI-generated, source "ChatGPT, made by the owner", the license, the file name and SHA-256, and the approver;
   - audits the import as `identity_art.import`.

   Commit the new files with the town. `--region l,t,w,h` cuts the art out of a larger image first, as for Boca's logo file, which has the name under the art.
4. **Assets** (`packages/photos/src/identity-assets.ts`):
   - **The cutout:** white joined to the image's edges becomes transparent. White walls and boats inside the scene stay. The cutout is trimmed to what's drawn.
   - **`hero.webp`:** 1221×407 (3:1, as Boca's), transparent.
   - **The icons** come from the art's left part: its first framing tree and what's beside it, as Boca's were cut by hand.
     - `icon-32.png` (the favicon) is on transparent.
     - `icon-180/192/512.png` and `social-avatar.png` are on white.
   - **On white:** `share-default.png` (1200×630), `newsletter-header.png` (600×120) and `facebook-cover.png` (1640×624).

   A test cuts Boca's logo file and checks that every file of Boca's hand-made set comes out with the same name, size, format and transparency.

**Why a new `identity_art` table and not `images`:** `images` rows belong to one article (`article_id` is required and unique, and some 30 queries rely on that). The new table keeps the same record for a town: AI-generated, source, license and approver.

## Fixtures

Pine Hollow carries imported placeholder art (`placeholderLogoArt`, drawn from its motif in code by the same cutting code), and the e2e test checks its hero and icons. Harbor Point has none and keeps the fallback. Placeholder art is for tests only and is never a town's real art.

## Later

- An Admin → Launches upload for the image, instead of the command, once the web app has durable file storage (S3). Files written under `public/` only ship with a deploy.
- Using `share-default.png` as the town's Open Graph default and `newsletter-header.png` in the newsletter. The files are cut; the pages still use the code-drawn versions.
