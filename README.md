# The Centennial Ledger — Live Site

Public storefront for **The Centennial Ledger** ("A Clear View of Colorado"),
https://centennialledger.com.

This site does **not** write or gather stories. Stories are produced in the
separate Muse newsroom app and uploaded here daily through an append-only
ingest API. Once a story is live here, later uploads never change or remove
it.

## What's inside

- Server-rendered Express app (no SPA, no build step)
- Postgres in production (`DATABASE_URL`), local JSON file store
  (`data/db.json`) when `DATABASE_URL` is unset, for zero-setup local testing
- Pages: home (lead story, Latest grid, briefing
  signup), section pages (Politics, Rights, Taxes, Energy, Schools,
  Local, Opinion, Satire), Local region pages (`/local/<region-slug>`), article pages,
  subscribe, checkout placeholder, privacy policy, terms, search,
  sign-in placeholder, 404
- SEO on every page: ~70-char titles, 155–160-char meta descriptions,
  canonical + Open Graph/Twitter tags, JSON-LD (WebSite +
  NewsMediaOrganization on home, CollectionPage/ItemList on sections,
  NewsArticle + BreadcrumbList on articles), `sitemap.xml`, a Google
  News sitemap at `news-sitemap.xml` (only articles published within the
  last 48 hours, each with publication name/language, its real
  publication date, and headline), and `robots.txt` listing both
  sitemaps
- Ad slots render real Google AdSense units when `ADSENSE_PUBLISHER_ID`
  is set; otherwise they render a plain "Advertisement" placeholder
- Subscription tiers: Free / Patriot $6.99/mo / Founding $12.99/mo.
  Checkout is a placeholder page until Stripe is connected.
- Byline rule: the default byline for AI-written articles is
  "News Desk". If an ingest
  payload carries its own `byline`, that is what renders.
- Article images: optional per-article art in one house style —
  black-and-white 19th-century newspaper engravings on pure white,
  shown in an identical hairline-frame/caption treatment everywhere
  (see "Article images" below).
- Article pages use a two-column layout: the story plus a right rail of
  three horizontal Google AdSense units (real units when
  `ADSENSE_PUBLISHER_ID` is set, "Advertisement" placeholders otherwise).
  Directly under the ads, the rail carries a "Trending in Colorado" box:
  a numbered list (red circles) of up to five other stories, headline
  links only. The site has no view tracking, so the list is simply the
  most recent stories site-wide with spotlight-flagged stories first
  and the story being read excluded; it never claims read counts.
  The rail is sticky on desktop and stacks below the story on mobile.
  A "More in <section>" grid of other stories in the same section still
  follows the article, as before.

## Run it locally

```bash
npm install
npm run seed     # optional: inserts 3 clearly-marked SAMPLE articles
INGEST_SECRET=pick-a-secret npm start
# open http://localhost:3000
```

Without `DATABASE_URL` the app uses the file store at `data/db.json`
(created on first run). Delete that file to reset local data.

Environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (Render sets this automatically) |
| `SITE_URL` | Canonical site URL, `https://centennialledger.com` |
| `DATABASE_URL` | Postgres connection string (from Render Postgres) |
| `INGEST_SECRET` | Shared secret for the ingest API header |
| `ADSENSE_PUBLISHER_ID` | e.g. `ca-pub-...`; unset = placeholder ad slots |

## Ingest API

Health check:

```bash
curl https://centennialledger.com/api/health
```

Upload new stories (single article, or `{ "articles": [ ... ] }`):

```bash
curl -X POST https://centennialledger.com/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-ingest-secret: $INGEST_SECRET" \
  -d '{ "articles": [ { "slug": "...", "headline": "...", ... } ] }'
```

Response: `{ "received": n, "inserted": n, "skipped": n, "imaged": n }`.

**Append-only contract:** articles are keyed by `slug`. A slug that already
exists is counted as `skipped` and the stored story's text is left
untouched — never updated, never deleted. There is no update or delete
endpoint. There is exactly one narrow exception: if the stored article
has **no image** and a re-sent article carries a valid `image`, the image
alone is filled in (the item is then counted as `imaged`, not `skipped`).
An image can be filled in only once — a re-send can never replace an
image that is already stored, and no other field is ever changed this
way.

Article fields: `slug` (optional; derived from headline), `headline`
(required), `dek`, `byline`, `publishedAt` (ISO), `section` (politics,
rights, taxes, energy, schools, local — legacy topic names are mapped
automatically: "Capitol", "Governor", "Elections", and "Opinion" →
politics; "Second Amendment" → rights; "Taxes & TABOR" / "TABOR" →
taxes; "Education" → schools; "Counties" → local),
`topicLabel`, `region`, `spotlight` (`gop_positive`, `dem_negative`, or
null), `sections` (array of `{ heading, lead, paragraphs[] }`),
`whyItMatters`, `image` (optional, see below), `sourceName`, `sourceUrl`,
`seoTitle`, `metaDescription`.

The main nav is, in this order: **Home, Politics, Rights, Taxes,
Energy, Schools, Local, Opinion, Satire**. "Home" is the first item, at the left of the
nav, and links to `/`; the masthead also links to `/`. **Local** carries a dropdown of the parts of the
state — Denver Metro, Northern Colorado, Southern Colorado, Western
Slope, Southwest, Mountains, Eastern Plains, San Luis Valley — and each
entry opens a region page (`/local/<region-slug>`, e.g.
`/local/northern-colorado`) listing Local-section stories whose `region`
tag matches that part of the state. The Local hub page (`/section/local`)
lists all Local stories plus the same parts-of-the-state list.

**Opinion and Satire are empty placeholder sections for now.** Their
nav items and pages (`/section/opinion`, `/section/satire`) exist, but
no stories are written or ingested into them yet: ingest keeps its
existing mapping (an incoming "Opinion" story still files under
Politics), so both sections render their empty state until the owner
decides to fill them.

**Sports & Outdoors coverage has been dropped entirely.** There is no
sports/outdoors section, route, or nav item, and ingest refuses it: a
story whose section resolves to "Sports", "Outdoors", or
"Sports & Outdoors" is counted as `skipped` and never inserted.

## Article images

Each article may carry one optional image, produced by the Muse
newsroom and delivered in the ingest payload:

```json
"image": {
  "url": "https://.../plate.jpg  (absolute URL, or a site-relative /uploads/... path)",
  "alt": "Colorado State Capitol in Denver during the legislative session (required in practice; keep under 125 characters)",
  "caption": "Optional caption, shown under the plate in small italic serif (newspaper-style: name the people, place, and action; never mention the art medium)"
}
```

**House style rule (no exceptions):** article art is always a
black-and-white 19th-century American newspaper illustration — wood/steel
engraving look, crosshatched black ink, in the manner of Harper's Weekly.
Never color, never photographs, and every plate must feel like it came
from the same illustration shop: same medium, line weight, hatching
character, and tonal range. Off-style images should not be sent.

**Backgrounds are transparent or pure white — never sepia, never an
off-white or aged-paper tint.** The plate must blend seamlessly into the
site's pure white page. And the *subjects* are modern: today's people in
modern dress, today's buildings, vehicles, and equipment. Only the
illustration *technique* is 19th-century — no period costumes or
old-timey props unless the story's subject is itself historical.

**Uniform presentation on this site:** every image renders on pure white
in the identical treatment — a hairline frame only (no matte), the same
`grayscale(1) contrast(1.06)` treatment (a safety net so nothing can
render in color), and captions in the same small italic serif, centered
under the plate. Card and home-lead thumbnails crop to a fixed 16:9 plate
box (`aspect-ratio` + `object-fit: cover`); article pages show the full
plate uncropped at a standard width (max 880px, centered). Articles
without an image render exactly as before, with no empty frame.

**Homepage lead layout:** the front page's lead story runs in classic
newspaper float style — the plate (image and caption as one block)
floats right at about 44% of the column and the opening of the story
itself (the first section's lead and first paragraphs) wraps around it,
ending in a "Continue reading" link to the article page. Directly under
the lead, a second feature — the most recent story from a different
section than the lead's — runs in the identical format; it is excluded
from the "Latest from Colorado" grid below, and when no
different-section story exists the front page shows the single lead
exactly as before. On narrow screens the float drops and the plate
stacks full width above the text. Article pages are unaffected: their
plate stays centered above the story, beside the ad/Trending rail.

**Captions read like real newspaper image captions.** News voice:
name the people, the place, and the action in the scene, the way a
staff caption under a photo would. A caption never mentions engraving,
illustration, or the art style — to the reader it is simply a picture
of the news.

**Alt text is written for Colorado political readers and searchers,
not for art fans.** It names the actual subject of the story — the
official, place, agency, or issue — in plain news language with the
story's keywords, and never mentions the art medium. Alt text must stay
**under 125 characters** and must never start with "image of",
"photo of", or "illustration of". When an
image is present, its absolute URL is also used for the NewsArticle
JSON-LD `image` field and the page's `og:image` / `twitter:image`.

## Deploy to Render

1. Create a Render account at https://render.com (the owner's account and
   card; the web service uses the **Starter** plan, about $7/mo, plus a
   small Postgres plan).
2. Put this folder in a Git repository (GitHub/GitLab) — or use Render's
   manual deploy from a repo you connect.
3. In Render: **New + → Blueprint**, select the repo. Render reads
   `render.yaml` and creates:
   - the `centennial-ledger` web service (build `npm install`, start
     `npm start`),
   - the `centennial-ledger-db` Postgres database, wired into
     `DATABASE_URL` automatically,
   - a generated `INGEST_SECRET` (save this value — the Muse newsroom's
     daily upload job needs it),
   - `SITE_URL=https://centennialledger.com`.
4. In the service's Environment tab, set `ADSENSE_PUBLISHER_ID` once the
   AdSense account is approved (it is `sync: false` in the blueprint, so
   Render prompts for it and never stores it in the repo).
5. Deploy. The service first answers at its `*.onrender.com` address;
   confirm `/api/health` returns `{ "ok": true, ... }` before doing DNS.

## Put Cloudflare (free) in front

1. Create a free Cloudflare account and choose **Add a site** →
   `centennialledger.com` → Free plan.
2. Cloudflare scans the existing DNS and shows two nameservers
   (e.g. `x.ns.cloudflare.com`). Keep that tab open.
3. **GoDaddy nameserver change:** sign in to GoDaddy → My Products →
   centennialledger.com → DNS → Nameservers → "I'll use my own
   nameservers" → paste the two Cloudflare nameservers → Save. (The
   domain stays registered at GoDaddy; only DNS moves.) Propagation can
   take a few hours; Cloudflare emails when the domain is active.
4. In Cloudflare DNS, add the record pointing at Render: in Render, open
   the web service → Settings → Custom Domains → add
   `centennialledger.com` and `www.centennialledger.com`; Render shows the
   target values. Add matching records in Cloudflare:
   - `www` → CNAME to the service's `*.onrender.com` hostname (proxied),
   - root (`@`) → use Cloudflare's CNAME flattening to the same hostname,
     or an A record if Render gives you an IP.
5. In Cloudflare → SSL/TLS → Overview, set the encryption mode to
   **Full**. (Render already terminates HTTPS with its own certificate;
   Full keeps the Cloudflare-to-Render hop encrypted too.)
6. Browse https://centennialledger.com and check a story page and
   `/sitemap.xml` load.

## How the daily upload works

The Muse newsroom app is where stories are culled and written. A
scheduled daily job there collects the stories published in the newsroom
since the last upload and POSTs them to
`https://centennialledger.com/api/ingest` with the `x-ingest-secret`
header set to the same `INGEST_SECRET` configured on Render.

Because ingest is append-only and idempotent, the job can safely re-send
a batch: new slugs are inserted, anything already live is skipped, and
stories already on the public site are never affected. Corrections to a
live story do not travel automatically — they are handled deliberately,
one at a time, by the owner.

## Sample data

`npm run seed` inserts three articles whose headlines, deks, and sources
are clearly marked as samples. It only runs when you run it by hand, so a
fresh production database starts empty.
