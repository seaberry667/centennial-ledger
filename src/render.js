'use strict';
/**
 * Server-rendered HTML for The Centennial Ledger live site.
 * Broadsheet styling: navy top bar, the drawn masthead artwork,
 * red rules, serif headlines. All SEO (titles, meta, canonical,
 * OG/Twitter, JSON-LD)
 * is centralized in layout().
 */

const { SECTIONS, REGIONS, sectionName, isSatire, regionSlug } = require('./store');
const { topbarSegment } = require('./weather');
const tracker = require('./tracker');

const SITE_NAME = 'The Centennial Ledger';

/* The Ledger's public profiles, cited as sameAs in the
   NewsMediaOrganization schema so search engines tie the site to
   its social entities (SEO pass, 2026-11-27). X is omitted until
   its handle is confirmed. */
const SOCIAL_PROFILES = [
  'https://www.facebook.com/profile.php?id=61595978079628',
  'https://www.instagram.com/centennialledger',
  'https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX',
];
const TAGLINE = 'A Clear View of Colorado';

/* AdSense client (publisher) ID. It is public by design — it prints
 * in every page's source — so it lives in code, with the env var as
 * an override. The shared head carries the account meta tag and the
 * loader script at all times so Google can verify and review the
 * site. The visible ad slots still switch to live units only when
 * real ad unit IDs are wired in after approval; their placeholder
 * slot ID is not a serving unit. */
const ADSENSE_CLIENT =
  process.env.ADSENSE_PUBLISHER_ID || 'ca-pub-6645873078235610';

function siteUrl() {
  return (process.env.SITE_URL || 'https://centennialledger.com').replace(/\/+$/, '');
}

function absUrl(p) {
  return siteUrl() + (p.startsWith('/') ? p : '/' + p);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Body-text rendering: stored article text can carry markdown-
 * style emphasis markers (owner-supplied pieces use them). Escape
 * first, so stored text can never inject markup, then convert
 * **text** to <strong> and *text* to <em>. Bold runs first so the
 * italic pass never sees the inner asterisks of a bold span; both
 * matches are non-greedy and cannot cross another asterisk, so a
 * lone unmatched asterisk stays literal and no nesting is
 * supported. Used ONLY for body-ish text (section leads and
 * paragraphs, deks, Why It Matters text, excerpts). Headlines,
 * kickers, captions, alt text, bylines, dates and meta/OG values
 * stay plain esc().
 */
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
      '<a href="$2">$1</a>'
    );
}

/**
 * Short date for the last-reviewed label: "November 8, 2026".
 * lastReviewed is a calendar DATE, not a moment in time, and it
 * reaches the live store in several shapes (bare YYYY-MM-DD, or a
 * UTC timestamp of that date). Always format it in UTC so the
 * printed date is the date that was recorded, never shifted a day
 * by Denver time.
 */
function fmtDateShort(iso) {
  try {
    // Take the recorded calendar date (the first 10 chars) at face
    // value and format it in UTC; any time-of-day the pipeline
    // attached along the way is not part of a review date.
    const d = String(iso || '').slice(0, 10);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(d + 'T12:00:00Z'));
  } catch {
    return '';
  }
}

/**
 * Colorado Explained series membership (owner directive,
 * 2026-11-08): the series designation is independent of the
 * article's primary section.
 */
function isExplained(a) {
  // The series was renamed "How Colorado Works" (owner order,
  // 2026-11-08); stored rows may still carry the old name (the
  // store migrates them at boot), so membership accepts both.
  return ['colorado explained', 'how colorado works'].includes(
    String((a && a.series) || '').trim().toLowerCase());
}

/**
 * The dek text for display. A dek that accidentally carries the
 * byline label as a prefix ("News Desk: ..." or "Editorial Desk:
 * ...") shows without it (owner instruction, 2026-11-02, after the
 * St. Mary preschool story's dek arrived with the label baked in).
 * Only the leading label is stripped; the byline itself renders
 * separately and is untouched.
 */
function dekText(a) {
  return String((a && a.dek) || '').replace(
    /^\s*(News Desk|Editorial Desk)\s*:\s*/i,
    ''
  );
}

function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/**
 * Card meta date: the article's publication date in Denver time.
 * (This formatter previously shared the name fmtDateShort with the
 * last-reviewed formatter above; the duplicate declaration silently
 * overrode it, which is why the review date printed a day early.)
 */
function fmtMetaDate(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

/** Denver calendar date as YYYY-MM-DD (companion-page URL shape). */
function fmtDenverYmd(iso) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return get('year') + '-' + get('month') + '-' + get('day');
  } catch {
    return '';
  }
}

/**
 * Byline stamp for features and article pages: the story's date AND
 * time in Mountain Time, uppercase, e.g. "NOV 1, 11:32 AM MT".
 * Assembled from format parts so the shape is exact.
 */
function fmtBylineStamp(iso) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date(iso));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    return (
      get('month') + ' ' + get('day') + ', ' + get('hour') + ':' +
      get('minute') + ' ' + get('dayPeriod') + ' MT'
    ).toUpperCase();
  } catch {
    return '';
  }
}

/**
 * Full byline line for features and article pages, pipe-separated
 * as in dev: byline, read time, then the date-and-time stamp.
 */
function bylineLine(a) {
  return (
    esc(a.byline) + ' | ' + readTimeMinutes(a) + ' min read | ' +
    esc(fmtBylineStamp(a.publishedAt))
  );
}

/** Title tags: aim for ~70 chars, trimmed at a word boundary. */
function fitTitle(text, max = 70) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Meta descriptions: 150-160 chars, unique per page, summarizing the
 * specific page. NEVER padded with shared boilerplate: an over-long
 * text is trimmed at a sentence or word boundary, and a short one is
 * extended only with sentences drawn from the page's own material
 * (the `extras` pool), never with a stock suffix.
 */
function buildDescription(base, extras) {
  let d = String(base || '').replace(/\s+/g, ' ').trim();
  if (d.length > 160) {
    const slice = d.slice(0, 160);
    const boundary = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? ')
    );
    if (boundary >= 110) return slice.slice(0, boundary + 1).trim();
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > 100 ? slice.slice(0, lastSpace) : slice).trim();
  }
  if (d.length >= 150) return d;
  for (const extra of extras || []) {
    if (d.length >= 150) break;
    const text = String(extra || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const sentences = text.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [text];
    for (const rawSentence of sentences) {
      if (d.length >= 150) break;
      const s = rawSentence.trim();
      if (!s || d.includes(s.slice(0, 40))) continue;
      if ((d + ' ' + s).length <= 160) {
        d = d + ' ' + s;
        continue;
      }
      // Fill the remaining room with a word-trimmed fragment of this
      // sentence, but only when the result still lands in range.
      const room = 160 - d.length - 1;
      if (room >= 12) {
        const cut = s.slice(0, room);
        const ls = cut.lastIndexOf(' ');
        const frag = (ls > 8 ? cut.slice(0, ls) : cut).trim();
        if (frag && (d + ' ' + frag).length >= 150) d = d + ' ' + frag;
      }
    }
  }
  return d;
}

/** Trim/keep a caller-supplied description; no boilerplate padding. */
function fitDescription(text) {
  return buildDescription(text, []);
}

/**
 * An article's meta description. The stored metaDescription wins when
 * it is a real, in-range description; a short or missing one is built
 * up from the story itself (dek, opening lead and paragraphs, the
 * why-it-matters note) so every article page carries a compliant,
 * story-specific description instead of shared boilerplate.
 */
function articleDescription(a) {
  const first = a && Array.isArray(a.sections) ? a.sections[0] : null;
  const extras = [];
  if (first) {
    extras.push(first.lead);
    for (const p of first.paragraphs || []) extras.push(p);
  }
  if (a) extras.push(a.whyItMatters);
  let base = a ? String(a.metaDescription || '').trim() : '';
  if (!base && a) base = String(a.dek || '').trim();
  if (!base && first) base = String(first.lead || '').trim();
  if (!base && a) base = a.headline || '';
  return buildDescription(base, extras);
}

/**
 * Article art is always black-and-white 19th-century newspaper engraving
 * illustration. Resolve a stored image URL: absolute URLs pass through,
 * site-relative paths are made absolute, anything else (e.g. data URIs in
 * test seeds) passes through untouched.
 */
function imageAbsUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return absUrl(url);
  return url;
}

/**
 * Display URL for a stored plate at a placement width. Plates
 * stored inline as data URIs are served by the /img route as
 * resized, cacheable WebP files (see server.js), so pages stop
 * inlining the full-size plate on every view. Absolute http(s)
 * image URLs are not ours to resize and pass through untouched,
 * as does anything else that is not an inline data URI.
 */
function plateUrl(a, w) {
  const url = a && a.image && a.image.url;
  if (!url) return '';
  if (!/^data:/i.test(url)) return url;
  return '/img/' + a.slug + '?w=' + w;
}

/**
 * Framed engraving figure, or '' when the article has no image. The
 * image and its caption stay together in the one figure block.
 *
 * Card components pass opts { noCaption: true, link: true }: cards
 * show no caption, and the figure is wrapped in a link to the article
 * so the image clicks through like the headline does. Homepage
 * features and article pages render the figure with its caption.
 * opts.width is the placement's plate width in pixels: the stored
 * data-URI plate is served resized at that width via /img (see
 * plateUrl) instead of being inlined into the page.
 */
/**
 * Display form of a stored image caption. Two owner rules meet
 * here (both 2026-11-02): the retired "S.I.-generated image."
 * credit never appears — stored article data is append-only and
 * may keep that suffix, so a trailing credit, together with the
 * whitespace before it, is stripped at render time; and every
 * illustration caption ends with the sentence "AI illustration.",
 * appended here when the stored caption does not already end
 * with it, so old and new stories alike show it exactly once. A
 * caption that consists only of the retired credit becomes ''
 * and renders no figcaption at all. Alt text is never touched.
 * Satire pages do not use this: they show the owner's own blurb.
 */
function displayCaption(caption) {
  const base = String(caption || '')
    .replace(/\s*S\.I\.-generated image\.\s*$/i, '')
    .trim();
  if (!base) return '';
  if (/AI illustration\.$/i.test(base)) return base;
  return base + (/[.!?]$/.test(base) ? ' ' : '. ') + 'AI illustration.';
}

function articleFigure(a, extraClass, opts) {
  if (!a || !a.image || !a.image.url) return '';
  const o = opts || {};
  const captionText = o.noCaption ? '' : displayCaption(a.image.caption);
  const cap = captionText
    ? '<figcaption>' + esc(captionText) + '</figcaption>'
    : '';
  const fig =
    '<figure class="art-figure' + (extraClass ? ' ' + extraClass : '') + '"><img src="' + esc(plateUrl(a, o.width || 900)) + '" alt="' +
    esc(a.image.alt || '') + '" loading="lazy">' + cap + '</figure>';
  return o.link
    ? '<a class="art-link" href="/article/' + esc(a.slug) + '" aria-label="' + esc(a.headline) + '">' + fig + '</a>'
    : fig;
}

/**
 * Homepage feature excerpt: the opening of the story itself — the
 * first body section's lead paragraph plus its body paragraphs, taken
 * as whole blocks until the excerpt reaches roughly 180 words —
 * so the front page gives readers a real read of the story, not just
 * its headline and dek. Whole blocks only: the excerpt always stops
 * at a clean paragraph boundary, never mid-sentence, so the last
 * block kept is the one that carries the total to the target. The
 * lead block itself is always kept, so a short story simply shows
 * whatever opening it has. Returns '' when the story has no body
 * text (the caller then falls back to headline/dek/figure).
 */
function leadExcerpt(a, targetWords, dropLast) {
  const first = a && Array.isArray(a.sections) ? a.sections[0] : null;
  if (!first) return '';
  const texts = [];
  if (first.lead) texts.push({ cls: 'lead', text: first.lead });
  for (const p of first.paragraphs || []) {
    if (texts.length >= 8) break;
    texts.push({ cls: '', text: p });
  }
  if (!texts.length) return '';
  const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const TARGET = targetWords || 180; // words (owner instruction, 2026-11-02); the crossing block lands whole
  const kept = [];
  let used = 0;
  for (const b of texts) {
    if (kept.length && used >= TARGET) break;
    kept.push(b);
    used += wordCount(b.text);
  }
  // Homepage lead feature only (owner instruction, 2026-11-23): one
  // paragraph shorter than the standard excerpt.
  if (dropLast && kept.length > 1) kept.pop();
  return kept
    .map((b, i) => {
      // The excerpt's first paragraph carries the red drop cap,
      // generated by CSS from its actual first letter.
      const cls = [b.cls, i === 0 ? 'dropcap' : ''].filter(Boolean).join(' ');
      return '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + inline(b.text) + '</p>';
    })
    .join('');
}

/** Absolute http(s) image URL for og:image / JSON-LD, or '' if not usable. */
function shareImageUrl(a) {
  if (!a || !a.image || !a.image.url) return '';
  const u = imageAbsUrl(a.image.url);
  if (/^https?:\/\//i.test(u)) return u;
  // Plates stored inline as data URIs are not fetchable by social
  // platforms, so shares carried no picture. The site serves those
  // plates itself at /img/<slug> (see the route in server.js), and
  // the share image points there (owner instruction, 2026-11-02:
  // fix the site so link posts carry the illustration).
  return siteUrl() + '/img/' + a.slug + '.png';
}

// AdSense unit IDs per placement (owner request, 2026-11-08: spots
// on section pages and in articles, joining the homepage units).
// Real IDs are the defaults once the units exist in the Ledger's
// AdSense account; env vars override. A placement with no unit ID
// renders its labeled house placeholder instead of sending Google
// a bogus slot, so the layout holds its shape until the unit is
// wired in.
const ADSENSE_SLOTS = {
  leaderboard: process.env.ADSENSE_SLOT_LEADERBOARD || '5354866973',
  incontent: process.env.ADSENSE_SLOT_INCONTENT || '6512035971',
  rectangle: process.env.ADSENSE_SLOT_RECTANGLE || '6476376957',
};

/** One AdSense display unit: the ins tag plus its push call. */
function adsenseIns(slotId, format) {
  return (
    '<ins class="adsbygoogle" style="display:block" ' +
    'data-ad-client="' + esc(ADSENSE_CLIENT) + '" ' +
    'data-ad-slot="' + esc(slotId) + '" ' +
    'data-ad-format="' + format + '" data-full-width-responsive="true"></ins>' +
    '<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>'
  );
}

/**
 * In-content ad slot: inside article bodies and between the card
 * groups on section, Local hub and region pages. A real AdSense
 * unit when its ID is configured, the dashed house placeholder
 * otherwise.
 */
function adSlot(label) {
  if (ADSENSE_SLOTS.incontent) {
    return '<div class="ad-slot ad-incontent">' + adsenseIns(ADSENSE_SLOTS.incontent, 'auto') + '</div>';
  }
  return '<div class="ad-slot ad-placeholder" aria-hidden="true">Advertisement</div>';
}

/**
 * Card grids with in-content ad slots between them, on section,
 * Local hub and region listing pages (owner directive, 2026-11-21):
 * the first grid holds EIGHT cards — four wide, two deep — then an
 * ad; every following grid holds SIXTEEN cards — four wide, four
 * deep — with an ad between grids, for as many articles as the
 * page carries. Lists of eight or fewer render as a single grid
 * with no ad. Grids use the fixed four-column .grid-4col layout.
 */
function cardGridWithAd(articles, opts = {}) {
  if (!articles.length) return '';
  const chunks = [articles.slice(0, 8)];
  for (let i = 8; i < articles.length; i += 16) {
    chunks.push(articles.slice(i, i + 16));
  }
  return chunks
    .map(
      (chunk, idx) =>
        // Between grids, a thin leaderboard like the one at the
        // top of the page (owner directive, 2026-11-21) — not the
        // tall in-content unit. The .grid-ad wrapper gives it
        // breathing room below the grid above (owner follow-up,
        // same day: it sat too close to that grid's bottom).
        (idx ? '<div class="grid-ad">' + leaderboardAdSlot() + '</div>' : '') +
        '<div class="grid grid-4col">' +
        chunk.map((a) => articleCard(a, opts)).join('') +
        '</div>'
    )
    .join('');
}

/**
 * Listing pagination (owner directive, 2026-11-23): page 1 of a
 * section, Local hub or region listing carries the featured top
 * story plus FORTY grid cards (41 total); every later page is the
 * grid alone, forty at a time, with no top story. Returns the
 * clamped page, the featured story (page 1 only) and the grid
 * slice for the page.
 */
const LISTING_PAGE_SIZE = 40;
function paginateListing(items, rawPage) {
  const total = items.length;
  const totalPages =
    total <= LISTING_PAGE_SIZE + 1
      ? 1
      : 1 + Math.ceil((total - LISTING_PAGE_SIZE - 1) / LISTING_PAGE_SIZE);
  let page = parseInt(rawPage, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > totalPages) page = totalPages;
  const featured = page === 1 && total ? items[0] : null;
  const start =
    page === 1 ? 1 : LISTING_PAGE_SIZE + 1 + (page - 2) * LISTING_PAGE_SIZE;
  const grid = items.slice(start, start + LISTING_PAGE_SIZE);
  return { page, totalPages, featured, grid };
}

/**
 * One page of listing cards (owner directive, 2026-11-23): a
 * leaderboard sits after row 2 (eight cards) and after row 6
 * (twenty-four cards) of the four-column grid; the page's bottom
 * leaderboard is the caller's .final-ad. Shorter grids simply
 * omit the breaks they never reach.
 */
function paginatedCardGrid(cards) {
  if (!cards.length) return '';
  const chunks = [cards.slice(0, 8)];
  if (cards.length > 8) chunks.push(cards.slice(8, 24));
  if (cards.length > 24) chunks.push(cards.slice(24, 40));
  return chunks
    .map(
      (chunk, idx) =>
        (idx ? '<div class="grid-ad">' + leaderboardAdSlot() + '</div>' : '') +
        '<div class="grid grid-4col">' +
        chunk.map((a) => articleCard(a, { kicker: false })).join('') +
        '</div>'
    )
    .join('');
}

/** Newer/Older pager under a paginated listing; absent on one page. */
function listingPager(basePath, page, totalPages) {
  if (totalPages <= 1) return '';
  const link = (p, label) =>
    '<a class="pager-link" href="' + basePath + '?page=' + p + '">' + label + '</a>';
  const off = (label) => '<span class="pager-link pager-off">' + label + '</span>';
  return (
    '<nav class="listing-pager" aria-label="Listing pages">' +
    (page > 1 ? link(page - 1, '&larr; Newer') : off('&larr; Newer')) +
    '<span class="pager-status">Page ' + page + ' of ' + totalPages + '</span>' +
    (page < totalPages ? link(page + 1, 'Older &rarr;') : off('Older &rarr;')) +
    '</nav>'
  );
}

/**
 * Breaking news ticker (owner request, 2026-11-08): a red bar
 * directly under the top (weather) bar on every page, scrolling
 * the six most recent story headlines, newest first — the server
 * refreshes the contents per request via setTickerItems. Items
 * are { slug, headline } pairs; the chip reads BREAKING.
 */
let tickerState = { label: 'BREAKING', items: [] };
function setTickerItems(state) {
  if (state && Array.isArray(state.items)) {
    tickerState = {
      label: state.label === 'LATEST' ? 'LATEST' : 'BREAKING',
      items: state.items,
    };
  }
}
function tickerHtml() {
  const items = (tickerState.items || [])
    .filter((i) => i && i.slug && i.headline)
    .slice(0, 6);
  if (!items.length) return '';
  const label = tickerState.label === 'LATEST' ? 'THE LATEST' : 'BREAKING';
  const group = items
    .map(
      (i) =>
        '<a href="/article/' + esc(i.slug) + '">' + esc(i.headline) + '</a>'
    )
    .join('');
  const duration = Math.max(24, items.length * 9);
  return (
    '<div class="ticker" aria-label="' +
    (label === 'BREAKING' ? 'Breaking news' : 'The latest news') +
    '"><span class="ticker-chip">' + label + '</span>' +
    '<div class="ticker-viewport"><div class="ticker-track" style="animation-duration:' +
    duration +
    's"><span class="ticker-group">' + group + '</span>' +
    '<span class="ticker-group" aria-hidden="true">' + group + '</span></div></div></div>'
  );
}

/**
 * "Local & Statewide" sidebar box, shared by the homepage and article
 * pages (design addendum): the most recently published Local stories
 * (all eight regions), newest first, up to eight, with red circular
 * number markers and compact serif headlines. The numbers mark
 * chronological order only — this is not a popularity ranking. The
 * caller passes the stories already ordered newest first. Returns ''
 * when there is nothing to show.
 */
function localStatewideBox(items) {
  const list = (items || []).filter(Boolean).slice(0, 8);
  if (!list.length) return '';
  return (
    '<section class="local-statewide"><h2><a href="/section/local">Local &amp; Statewide</a></h2><ol>' +
    list
      .map(
        (a, i) =>
          '<li><img class="trend-icon" src="/quatrefoil.png" alt="">' +
          '<a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></li>'
      )
      .join('') +
    '</ol></section>'
  );
}

/**
 * Homepage leaderboard slot, directly under the nav: a full-width
 * cream band. A real AdSense unit when ADSENSE_PUBLISHER_ID is set
 * (same mechanism as adSlot), the house leaderboard placeholder
 * otherwise, dressed as in dev.
 */
function leaderboardAdSlot() {
  if (ADSENSE_SLOTS.leaderboard) {
    return (
      '<div class="ad-slot ad-leaderboard">' +
      adsenseIns(ADSENSE_SLOTS.leaderboard, 'horizontal') +
      '</div>'
    );
  }
  return (
    '<div class="ad-leaderboard" aria-label="Advertisement">' +
    '<div class="ad-label">Advertisement</div>' +
    '<div class="ad-house-title">Reach Colorado readers</div>' +
    '</div>'
  );
}

/**
 * Rectangle ad slot: the single advertisement at the bottom of the
 * homepage rail and of the article sidebar, in the leaderboard's
 * house dress. A real AdSense unit when ADSENSE_PUBLISHER_ID is set
 * (same mechanism as the other slots), the labeled house
 * placeholder otherwise.
 */
function rectangleAdSlot() {
  if (ADSENSE_SLOTS.rectangle) {
    return (
      '<div class="ad-slot ad-rectangle">' +
      adsenseIns(ADSENSE_SLOTS.rectangle, 'auto') +
      '</div>'
    );
  }
  return (
    '<div class="ad-rectangle" aria-label="Advertisement">' +
    '<div class="ad-label">Advertisement</div>' +
    '<div class="ad-house-title">Reach Colorado readers</div>' +
    '</div>'
  );
}

/**
 * The homepage rail's bottom advertisement (owner request,
 * 2026-11-12): the rail's rectangle unit, but in a fixed
 * near-square shape. As the responsive rectangle it rendered as a
 * long strip in the narrow rail and crowded the column; a fixed
 * 300x250 unit keeps it a rectangle. Homepage rail only — the
 * article sidebar keeps the responsive rectangleAdSlot(). Without
 * an AdSense unit this is the same house placeholder
 * rectangleAdSlot() returns, which is already near-square
 * (min-height 250px).
 */
function homeRailAdSlot() {
  if (ADSENSE_SLOTS.rectangle) {
    return (
      '<div class="ad-slot ad-rectangle rail-ad">' +
      '<ins class="adsbygoogle" style="display:block;width:300px;height:250px" ' +
      'data-ad-client="' + esc(ADSENSE_CLIENT) + '" ' +
      'data-ad-slot="' + esc(ADSENSE_SLOTS.rectangle) + '"></ins>' +
      '<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>' +
      '</div>'
    );
  }
  return rectangleAdSlot();
}

/**
 * One homepage rail story row: a small plate thumbnail on the left
 * (no border; the engraving shows at its natural edges), then the
 * red uppercase category label and the headline as a link. No
 * byline, no read time and no source line, as on cards.
 */
function railStoryRow(a, grouped) {
  const thumb =
    a.image && a.image.url
      ? '<a class="rail-thumb" href="/article/' + esc(a.slug) + '"><img src="' + esc(plateUrl(a, 200)) +
        '" alt="' + esc(a.image.alt || '') + '" loading="lazy"></a>'
      : '';
  return (
    '<div class="rail-row">' + thumb +
    '<div class="rail-row-text">' +
    (grouped ? '' : '<div class="kicker">' + esc(sectionName(a.section)) + '</div>') +
    '<h4><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h4>' +
    '</div></div>'
  );
}

/**
 * One homepage rail section group (owner instruction, 2026-11-02):
 * the section's name as a heading linking to its section page, with
 * the section's two most recent stories as rail rows under it. The
 * rows carry no category label of their own — the heading is it.
 */
function railSectionGroup(g) {
  return (
    '<div class="rail-group">' +
    '<h3 class="rail-group-title"><a href="/section/' + esc(g.section) + '">' +
    esc(sectionName(g.section)) + '</a></h3>' +
    g.articles.map((a) => railStoryRow(a, true)).join('') +
    '</div>'
  );
}

/**
 * The rail's Sports score strip (owner order, 2026-11-23): the
 * same rail-group dress as the section groups, but the heading is
 * plain text and the rows are bare score lines — the box links
 * nowhere and expands into nothing. Absent when no Colorado team
 * has a recent or upcoming game. Lines come from src/scores.js.
 */
/**
 * Sport icons marking each sports-strip line (owner orders,
 * 2026-11-23): professional Material Design Icons paths (filled,
 * currentColor), one per sport — the icon alone indicates the
 * sport; the sport's name is NOT written out. No links.
 */
const SPORT_ICONS = {
  football:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.39 21L3 15.61C3 16.7 3.04 17.71 3.2 18.63C3.35 19.55 3.5 20.1 3.71 20.29C3.9 20.5 4.44 20.65 5.35 20.81S7.27 21 8.39 21M15.5 9.89L9.89 15.5L8.5 14.11L14.11 8.5L15.5 9.89M3.29 13.08L10.92 20.71C13.7 20.21 15.9 19.15 17.53 17.53C19.15 15.9 20.21 13.7 20.71 10.92L13.08 3.29C10.3 3.79 8.1 4.85 6.47 6.47S3.79 10.3 3.29 13.08M15.61 3L21 8.39C21 7.3 20.96 6.29 20.81 5.37C20.65 4.45 20.5 3.9 20.29 3.71C20.1 3.5 19.56 3.35 18.65 3.2S16.73 3 15.61 3Z"/></svg>',
  basketball:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.34,14.63C2.94,14.41 3.56,14.3 4.22,14.3C5.56,14.3 6.73,14.72 7.73,15.56L4.59,18.7C3.53,17.5 2.78,16.13 2.34,14.63M15.56,9.8C17.53,11.27 19.66,11.63 21.94,10.88C21.97,11.09 22,11.47 22,12C22,13.03 21.75,14.18 21.28,15.45C20.81,16.71 20.23,17.73 19.55,18.5L13.22,12.19L15.56,9.8M8.77,16.64C9.83,18.17 10.05,19.84 9.42,21.66C8,21.25 6.73,20.61 5.67,19.73L8.77,16.64M12.19,13.22L18.5,19.55C16.33,21.45 13.78,22.25 10.88,21.94C11.09,21.28 11.2,20.56 11.2,19.78C11.2,19.16 11.06,18.43 10.78,17.6C10.5,16.77 10.17,16.09 9.8,15.56L12.19,13.22M8.81,14.5C7.88,13.67 6.8,13.15 5.58,12.91C4.36,12.68 3.19,12.75 2.06,13.13C2.03,12.91 2,12.53 2,12C2,10.97 2.25,9.82 2.72,8.55C3.19,7.29 3.77,6.27 4.45,5.5L11.11,12.19L8.81,14.5M15.56,7.73C14.22,6.08 13.91,4.28 14.63,2.34C15.25,2.5 15.96,2.8 16.76,3.26C17.55,3.71 18.2,4.16 18.7,4.59L15.56,7.73M21.66,9.38C21.06,9.59 20.44,9.7 19.78,9.7C18.69,9.7 17.64,9.38 16.64,8.72L19.73,5.67C20.61,6.77 21.25,8 21.66,9.38M12.19,11.11L5.5,4.45C7.67,2.55 10.22,1.75 13.13,2.06C12.91,2.72 12.8,3.44 12.8,4.22C12.8,4.94 12.96,5.75 13.29,6.66C13.62,7.56 14,8.28 14.5,8.81L12.19,11.11Z"/></svg>',
  hockey:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12,5C6.5,5 2,6.57 2,8.5C2,10.43 6.5,12 12,12C17.5,12 22,10.43 22,8.5C22,6.57 17.5,5 12,5M2,11.76V16.5C2,18.43 6.5,20 12,20C17.5,20 22,18.43 22,16.5V11.76C21.33,12.22 20.58,12.57 19.73,12.86C17.62,13.6 14.95,14 12,14C9.05,14 6.38,13.6 4.27,12.86C3.42,12.57 2.67,12.22 2,11.76Z"/></svg>',
  baseball:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12,2C9.5,2 7.25,2.9 5.5,4.4C6,4.81 6.41,5.27 6.8,5.76L7.89,5.13L8.89,6.87L7.89,7.44C8.45,8.53 8.82,9.73 8.95,11H10V12L10,13H8.95C8.82,14.27 8.45,15.47 7.89,16.56L8.89,17.13L7.89,18.87L6.8,18.24C6.41,18.73 6,19.19 5.5,19.6C7.25,21.1 9.5,22 12,22C14.5,22 16.75,21.1 18.5,19.6C18,19.19 17.59,18.73 17.19,18.24L16.11,18.87L15.11,17.13L16.11,16.55C15.55,15.47 15.18,14.27 15.05,13H14V11H15.05C15.18,9.73 15.55,8.53 16.11,7.45L15.11,6.87L16.11,5.13L17.19,5.76C17.59,5.27 18,4.81 18.5,4.4C16.75,2.9 14.5,2 12,2M4.12,5.85C2.79,7.55 2,9.68 2,12C2,14.32 2.79,16.45 4.12,18.15C4.46,17.87 4.76,17.55 5.05,17.22L4.43,16.87L5.43,15.13L6.16,15.56C6.55,14.77 6.82,13.91 6.93,13H6V12L6,11H6.93C6.82,10.09 6.55,9.23 6.16,8.44L5.43,8.87L4.43,7.13L5.05,6.78C4.76,6.45 4.46,6.13 4.12,5.85M19.88,5.85C19.54,6.13 19.24,6.45 18.95,6.78L19.57,7.13L18.57,8.87L17.84,8.44C17.45,9.23 17.18,10.09 17.07,11H18V13H17.07C17.18,13.91 17.45,14.77 17.84,15.56L18.57,15.13L19.57,16.87L18.95,17.22C19.24,17.55 19.54,17.87 19.88,18.15C21.21,16.45 22,14.32 22,12C22,9.68 21.21,7.55 19.88,5.85Z"/></svg>',
  soccer:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.93 17.12L16.13 15.76L17.59 11.39L19 10.92L20 11.67C20 11.7 20 11.75 20 11.81C20 11.88 20.03 11.94 20.03 12C20.03 13.97 19.37 15.71 18.06 17.21L16.93 17.12M9.75 15L8.38 10.97L12 8.43L15.62 10.97L14.25 15H9.75M12 20.03C11.12 20.03 10.29 19.89 9.5 19.61L8.81 18.1L9.47 17H14.58L15.19 18.1L14.5 19.61C13.71 19.89 12.88 20.03 12 20.03M5.94 17.21C5.41 16.59 4.95 15.76 4.56 14.75C4.17 13.73 3.97 12.81 3.97 12C3.97 11.94 4 11.88 4 11.81C4 11.75 4 11.7 4 11.67L5 10.92L6.41 11.39L7.87 15.76L7.07 17.12L5.94 17.21M11 5.29V6.69L7 9.46L5.66 9.04L5.24 7.68C5.68 7 6.33 6.32 7.19 5.66S8.87 4.57 9.65 4.35L11 5.29M14.35 4.35C15.13 4.57 15.95 5 16.81 5.66C17.67 6.32 18.32 7 18.76 7.68L18.34 9.04L17 9.47L13 6.7V5.29L14.35 4.35M4.93 4.93C3 6.89 2 9.25 2 12S3 17.11 4.93 19.07 9.25 22 12 22 17.11 21 19.07 19.07 22 14.75 22 12 21 6.89 19.07 4.93 14.75 2 12 2 6.89 3 4.93 4.93Z"/></svg>'
};

function sportsRailBox(lines) {
  const rows = (Array.isArray(lines) ? lines : []).filter(Boolean);
  if (!rows.length) return '';
  return (
    '<div class="rail-group sports-box">' +
    '<h3 class="rail-group-title">Sports</h3>' +
    rows
      .map((l) => {
        const text = typeof l === 'string' ? l : l.text || '';
        const sport = typeof l === 'object' ? l.sport || '' : '';
        const icon = SPORT_ICONS[sport]
          ? '<span class="sports-icon sport-' + sport + '">' + SPORT_ICONS[sport] + '</span>'
          : '';
        return '<div class="sports-line">' + icon + esc(text) + '</div>';
      })
      .join('') +
    '</div>'
  );
}

const CSS = `
:root{
  --color-bg:#FFFFFF;--color-text:#111111;--color-red:#981E24;--color-navy:#102438;
  --color-gold:#AA8548;--color-ivory:#F8F4EB;--color-border:#DED7C9;--color-muted:#777777;
  --font-headline:"Playfair Display",Georgia,serif;
  --font-body:"Source Serif 4",Georgia,serif;
  /* Sans roles follow the dev (newsroom) site's font system
     (owner instruction, 2026-11-08): wherever the dev version
     uses Archivo — its default sans for UI text, meta lines and
     the ticker — the live site uses Archivo too. This supersedes
     the same morning's Inter choice for the bars. */
  --font-ui:"Archivo",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --font-bar:"Archivo",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  /* Legacy aliases, kept so older rules resolve to the spec palette. */
  --navy:var(--color-navy);--red:var(--color-red);--ink:var(--color-text);
  --paper:var(--color-bg);--rule:var(--color-border)
}
*{box-sizing:border-box}
body{margin:0;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body);line-height:1.55}
a{color:inherit}
/* ---------- Top utility bar: navy, gold accent line at the bottom ---------- */
.topbar{background:var(--color-navy);color:#e8e4d8;font-family:var(--font-bar);font-size:.78rem;min-height:28px;padding:.15rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;border-bottom:1px solid var(--color-gold)}
.topbar .center{font-style:italic;font-family:var(--font-body);flex:1;text-align:center}
.topbar .topbar-left{letter-spacing:.05em;font-weight:bold;white-space:nowrap}
/* One city's weather segment never splits across lines on a
   narrow screen; the bar wraps around it instead (2026-11-22). */
#wx-rotor{white-space:nowrap}
.topbar .topbar-right{display:flex;align-items:center;gap:.9rem;white-space:nowrap}
.topbar a{color:#fff;text-decoration:none}
.btn-subscribe{background:var(--color-red);color:#fff!important;padding:.3rem .8rem;border-radius:3px;font-weight:bold}
/* ---------- Masthead: the supplied banner artwork on pure white ---------- */
.masthead{text-align:center;padding:1.1rem 1rem .4rem;background:#fff}
.masthead-banner a{display:inline-block;text-decoration:none}
.masthead-banner img{display:block;width:990px;max-width:100%;height:auto;margin:0 auto}
.tagline{display:flex;align-items:center;gap:.9rem;font-style:italic;font-size:1.15rem;max-width:600px;margin:-.65rem auto 0;line-height:1;position:relative}
.tagline::before,.tagline::after{content:"";flex:1 1 0;height:2px;background:var(--color-gold)}
/* ---------- Navigation: white, thin double black rules, serif labels ---------- */
nav.main{background:#fff;border-top:4px double var(--color-text);border-bottom:4px double var(--color-text);position:relative}
nav.main ul.nav-list{display:flex;justify-content:flex-start;align-items:center;flex-wrap:wrap;gap:.2rem .55rem;list-style:none;margin:0 auto;padding:.5rem 24px;max-width:1200px}
nav.main a{text-decoration:none;font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;display:inline-block;padding:.28rem .45rem;border-radius:3px}
nav.main a.active{background:var(--color-red);color:#fff}
nav.main a:focus-visible,nav.main button:focus-visible{outline:2px solid var(--color-red);outline-offset:2px}
.nav-toggle{display:none}
.local-toggle{display:none}
/* Local dropdown: hover/focus menu on desktop. On mobile it becomes a
   state-driven submenu (see the max-width media query below). */
nav.main li.has-dropdown{position:relative;display:flex;align-items:center}
nav.main ul.dropdown{display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#fff;border:1px solid var(--color-border);border-top:2px solid var(--color-text);list-style:none;margin:0;padding:.45rem 0;min-width:230px;z-index:30;flex-direction:column;flex-wrap:nowrap;gap:0;justify-content:flex-start;text-align:left;box-shadow:0 6px 14px rgba(0,0,0,.08)}
nav.main li.has-dropdown:hover ul.dropdown,nav.main li.has-dropdown:focus-within ul.dropdown{display:flex}
nav.main ul.dropdown a{display:block;padding:.35rem 1.1rem;white-space:nowrap;font-size:.96rem}
nav.main ul.dropdown a:hover{background:var(--color-ivory)}
@media (min-width:768px){
  nav.main li.has-dropdown>a::after{content:" \\25BE";font-size:.8em}
}
nav.main li.nav-search{margin-left:auto;display:flex;align-items:center}
.nav-search-form{display:flex;align-items:center;gap:.35rem}
.nav-search-form input[type=search]{padding:.38rem .6rem;border:1px solid #b9b2a0;border-radius:3px;font-size:.95rem;font-family:var(--font-body);width:170px;background:#fff}
.nav-search-form button{background:none;border:0;cursor:pointer;color:#555;padding:.15rem;display:flex;align-items:center}
/* Breaking news ticker: red bar under the top (weather) bar, headlines scrolling
   left; the track is clipped by its viewport so the page itself
   never scrolls sideways. Pauses on hover. */
.ticker{display:flex;align-items:center;gap:.9rem;background:var(--color-red);color:#fff;overflow:hidden;max-width:100%;font-family:var(--font-bar);padding:.35rem .6rem}
.ticker-chip{background:#fff;color:var(--color-red);font-family:var(--font-bar);font-weight:800;font-size:12.5px;letter-spacing:.1em;padding:.31rem .6rem .17rem calc(.6rem + .1em);flex:0 0 auto;position:relative;z-index:1;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.25}
.ticker-viewport{overflow:hidden;flex:1 1 auto;display:flex;align-items:center}
.ticker-track{display:inline-flex;white-space:nowrap;animation-name:ticker-scroll;animation-timing-function:linear;animation-iteration-count:infinite;will-change:transform}
.ticker-group{display:inline-flex;align-items:center;gap:2.5rem;padding-right:2.5rem}
.ticker-track a{color:#fff;text-decoration:none;font-weight:400;font-size:.875rem;font-family:var(--font-bar)}
.ticker-track a:hover{text-decoration:underline}
.ticker-sep{opacity:.7}
.ticker:hover .ticker-track{animation-play-state:paused}
@keyframes ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion: reduce){.ticker-track{animation:none}}
/* Mobile navigation (under 768px): the list collapses behind a real
   toggle button, and the Local submenu is collapsed by default and
   driven by an explicit open state on the list item — never by
   :hover and never by a permanent display override. */
@media (max-width:767px){
  .nav-toggle{display:flex;align-items:center;gap:.5rem;width:100%;background:#fff;border:0;border-bottom:1px solid var(--color-border);padding:.6rem 16px;font-family:var(--font-body);font-weight:600;font-size:1rem;cursor:pointer;color:var(--color-text)}
  .nav-toggle .nav-toggle-caret{transition:transform .2s ease}
  nav.main.nav-open .nav-toggle .nav-toggle-caret{transform:rotate(180deg)}
  nav.main ul.nav-list{display:none;flex-direction:column;align-items:stretch;flex-wrap:nowrap;gap:0;padding:.4rem 16px .7rem}
  nav.main.nav-open ul.nav-list{display:flex}
  nav.main ul.nav-list>li{display:block}
  nav.main ul.nav-list a{display:block;padding:.5rem .2rem}
  nav.main li.has-dropdown{flex-wrap:wrap}
  nav.main li.has-dropdown>a{flex:1}
  .local-toggle{display:inline-flex;align-items:center;justify-content:center;background:none;border:1px solid var(--color-border);border-radius:3px;width:2.2rem;height:2.2rem;cursor:pointer;color:var(--color-text);flex:0 0 auto}
  .local-toggle svg{transition:transform .2s ease}
  nav.main li.has-dropdown.submenu-open .local-toggle svg{transform:rotate(180deg)}
  nav.main ul.dropdown{display:none;position:static;transform:none;border:0;box-shadow:none;min-width:0;width:100%;padding:.2rem 0 .3rem .9rem}
  nav.main li.has-dropdown.submenu-open ul.dropdown{display:block}
  nav.main ul.dropdown a{font-size:.95rem;padding:.4rem .2rem}
  nav.main li.nav-search{margin-left:0;padding:.5rem 0 .2rem}
  .nav-search-form{width:100%}
  .nav-search-form input[type=search]{flex:1;width:auto}
  .topbar .topbar-left{white-space:normal}
  .topbar .center{flex-basis:100%;order:3;text-align:center}
}
.region-list{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;list-style:none;margin:.7rem 0 1.1rem;padding:.7rem 0;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border)}
.region-list a{text-decoration:none}
.region-list a:hover{text-decoration:underline}
.region-list a.active{color:var(--color-red);font-weight:bold}
/* ---------- Shared layout and type ---------- */
.wrap{max-width:1200px;margin:0 auto;padding:1.2rem 24px 3rem}
@media (max-width:767px){.wrap{padding-left:16px;padding-right:16px}}
.kicker{color:var(--color-red);text-transform:uppercase;font-family:var(--font-ui);font-size:.6875rem;font-weight:bold;letter-spacing:.08em}
.kicker-row{display:flex;align-items:center;gap:.9rem}
.kicker-row::after{content:"";flex:1;height:1px;background:var(--color-gold)}
h2.headline,h1.headline{font-family:var(--font-headline);font-weight:800;line-height:1.12;margin:.3rem 0}
.dek{font-size:1.1875rem;line-height:1.4;color:#333;font-style:italic}
.byline{font-family:var(--font-ui);color:var(--color-muted);font-size:11px;text-transform:uppercase;letter-spacing:.14em}
.meta{font-family:var(--font-ui);font-size:11px;color:var(--color-muted);text-transform:uppercase;letter-spacing:.14em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.2rem}
/* On the listing pages the featured article leads straight
   into the card grid: a little air between its Why It Matters
   box and the grid (owner directive, 2026-11-21). The homepage
   never puts a .grid directly after a .lead-story, so this
   touches only the listing pages. */
.lead-story + .grid{margin-top:1.2rem}
/* Breathing room above the between-grids leaderboard on listing
   pages (owner directive, 2026-11-21). */
.grid-ad{margin-top:1.4rem}
/* Same breathing room above the bottom leaderboard on section
   pages (owner directive, 2026-11-21). */
.ad-breather{margin-top:1.4rem}
/* Final leaderboard on any page, spaced exactly like the top ad
   (owner directive, 2026-11-21). The top ad's gaps come from the
   page frame itself: main's padding-top (1.2rem) above it and its
   own 1.4rem margin below. A bottom ad sits at the end of main,
   so without correction it would get main's 3rem padding-bottom
   plus the footer's 2rem margin-top stacked under it. The
   wrapper's margins cancel that stack: the slot's own bottom
   margin is zeroed inside the wrapper (its margin would collapse
   with the wrapper's and throw the sum off), so the below-gap is
   exactly -3.6 + 3 + 2 = 1.4rem, and the wrapper's 1.2rem top
   margin gives it the same 1.2rem above. */
.final-ad{margin-top:1.2rem;margin-bottom:-3.6rem}
.final-ad .ad-slot.ad-leaderboard{margin-bottom:0}
.final-ad .ad-slot.ad-incontent{margin-bottom:0}

/* Section intro text at the top of section pages (owner
   directive, 2026-11-21): plain content paragraphs, no box. */
.section-intro{margin:.2rem 0 1.2rem}
.section-intro p{margin:0 0 .7em;line-height:1.55}
/* Listing-page grids (owner directive, 2026-11-21): exactly four
   cards wide on desktop, collapsing on narrower screens. */
.grid-4col{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:1000px){
  .grid-4col{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:600px){
  .grid-4col{grid-template-columns:minmax(0,1fr)}
}
.card{border-top:2px solid var(--color-gold);padding-top:.6rem}
.card h3{font-family:var(--font-headline);font-size:1.125rem;margin:.25rem 0;line-height:1.25}
.card h3 a{text-decoration:none}
.card p{color:#444;font-size:.95rem;margin:.3rem 0}
a.art-link{display:block;text-decoration:none}
/* ---------- House plate style ----------
   Every article image gets the identical treatment: pure white figure,
   a thin solid black border on the image itself, the caption below the
   bordered image. Card thumbnails crop to a fixed 16:9 plate box;
   feature and article illustrations show the full plate. */
figure.art-figure{margin:1.1rem 0;background:#ffffff;padding:0}
figure.art-figure img{display:block;width:100%;height:auto;filter:grayscale(1) contrast(1.06);background:#ffffff}
figure.art-figure figcaption{font-style:italic;font-size:.8125rem;line-height:1.4;color:#444;text-align:center;padding:.45rem .3rem .15rem}
.card figure.art-figure{margin:0 0 .55rem}
.card figure.art-figure img{height:auto}
/* ---------- Briefing signup panel ---------- */
.briefing{background:var(--color-ivory);border:1px solid var(--color-gold);padding:18px;margin:1.4rem 0}
.briefing .briefing-kicker{color:var(--color-red);font-family:var(--font-ui);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase}
.briefing .briefing-title{font-family:var(--font-headline);font-weight:700;font-size:1.75rem;line-height:1.15;margin:.35rem 0 .5rem}
.briefing .briefing-tag{margin:0 0 .8rem;font-style:italic}
.briefing form{display:flex;flex-direction:column;gap:.5rem;margin-top:.6rem}
.briefing input[type=email]{width:100%;padding:.55rem;font-size:1rem;font-family:var(--font-body);border:1px solid #999;background:#fff}
.briefing button{align-self:center;background:var(--color-red);color:#fff;border:0;text-decoration:none;font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;padding:.28rem .65rem;border-radius:3px;cursor:pointer}
.briefing button:hover{background:#7d181e}
.briefing .briefing-note{font-style:italic;color:#555;font-size:.92rem;margin:.55rem 0 0}
/* Podcast box: the briefing box's dress, with the show artwork, the
   newest episode's title and date, an excerpt of its notes and a
   button-styled listen link. */
.podcast-box .podcast-art{display:block;width:100%;height:auto;object-fit:cover;border:1px solid var(--color-border);margin:.2rem 0 .6rem}
.podcast-box .podcast-date{font-family:var(--font-ui);font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:#555;margin:0 0 .5rem}
.podcast-box .podcast-ep-title{font-family:var(--font-headline);font-size:1.08rem;line-height:1.3;margin:0 0 .4rem;text-align:left}
.podcast-box .podcast-ep-title a{color:inherit;text-decoration:none}
.podcast-box .podcast-ep-title a:hover{text-decoration:underline}
.podcast-box .podcast-titles{margin:0 0 .8rem;padding-left:1.15rem;text-align:left}
.podcast-box .podcast-titles li{margin:.35rem 0;line-height:1.35}
.podcast-box .podcast-titles a{color:inherit;text-decoration:none}
.podcast-box .podcast-blurb{margin:0 0 .8rem;text-align:left;line-height:1.45}
.podcast-box .podcast-blurb a{color:inherit;text-decoration:none}
.podcast-box .podcast-blurb a:hover{text-decoration:underline}
.podcast-box .podcast-titles a:hover{text-decoration:underline}
.podcast-box .podcast-listen-wrap{display:flex;flex-direction:column;align-items:center;gap:.45rem}
.podcast-box .podcast-read{display:block;text-align:center;margin-top:.55rem;font-family:var(--font-body);font-size:.85rem;color:var(--color-red);text-decoration:underline}
/* ---------- Advertisements ---------- */
/* An ad unit can never push the page wider than the screen:
   the slot clips to its container and the unit caps at 100%
   (mobile fix, 2026-11-22). */
.ad-slot{margin:1.2rem 0;text-align:center;max-width:100%;overflow:hidden}
.ad-slot ins,.ad-slot iframe{max-width:100%}
/* Collapse ad slots Google leaves unfilled (owner directive,
   2026-11-22): while the site awaits AdSense review, an
   unfilled unit reserves hundreds of pixels of blank space.
   AdSense marks an unfilled unit data-ad-status="unfilled";
   such a slot hides entirely, and returns on its own the
   moment a real creative fills it (status becomes "filled"). */
ins.adsbygoogle[data-ad-status="unfilled"]{display:none}
.ad-slot:has(> ins.adsbygoogle[data-ad-status="unfilled"]){display:none}
.ad-placeholder{border:1px dashed #bbb;color:#999;font-family:var(--font-ui);font-size:.75rem;text-transform:uppercase;letter-spacing:.15em;padding:1.4rem 0}
.ad-placeholder.ad-horizontal{padding:2.4rem 0}
.ad-leaderboard{background:var(--color-ivory);border:1px solid var(--color-border);text-align:center;padding:.9rem 1rem 1rem;margin-bottom:1.4rem}
.ad-leaderboard .ad-label,.ad-rectangle .ad-label{font-family:var(--font-ui);font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;color:#8a8474}
.ad-leaderboard .ad-house-title,.ad-rectangle .ad-house-title{font-family:var(--font-headline);font-size:1.35rem;margin:.35rem 0 .2rem;color:#333}
.ad-slot.ad-leaderboard{margin:0 0 1.4rem;background:var(--color-ivory);border:1px solid var(--color-border);padding:.4rem}
.ad-rectangle{background:var(--color-ivory);border:1px solid var(--color-border);text-align:center;padding:1rem;display:flex;flex-direction:column;justify-content:center;min-height:250px}
.ad-slot.ad-rectangle{margin:0;background:var(--color-ivory);border:1px solid var(--color-border);padding:.4rem;display:block;min-height:0}
/* In-content slot gets the same house dress as the leaderboard and
   rectangle (owner flagged the bare slot, 2026-11-08): without it the
   unfilled unit rendered as an undelineated blank void mid-article. */
.ad-slot.ad-incontent{background:var(--color-ivory);border:1px solid var(--color-border);padding:.4rem}
/* ---------- Homepage two-column layout ---------- */
.home-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0 2.2rem;align-items:start}
.home-features{grid-column:1;grid-row:1}
.home-rail{grid-column:2;grid-row:1;position:sticky;top:1rem}
.home-rail .briefing{margin:0 0 1.2rem}
.home-rail .ad-slot{margin:0 0 1.2rem}
.home-rail .ad-rectangle{margin-top:1.2rem}
/* The homepage rail's bottom ad is the fixed near-square rectangle
   (see homeRailAdSlot): no slot padding, and the box holds the
   rectangle's 250px height while the unit loads. */
.home-rail .ad-slot.rail-ad{padding:0;min-height:250px}
.home-rail .rail-ad .adsbygoogle{display:block;margin:0 auto}
@media (max-width:900px){
  /* minmax(0,1fr), not plain 1fr: a plain 1fr track is
     minmax(auto,1fr), so a grid item's content (the 1152px
     divider art, wide ad units) can force the single mobile
     column far past the screen and every headline, card and
     rail box inside it renders at that blown-out width
     (owner report, 2026-11-22: mobile view "totally messed
     up"). minmax(0,1fr) caps the track at the container, and
     min-width:0 lets the items shrink with it. */
  .home-layout{grid-template-columns:minmax(0,1fr)}
  .home-layout>*{min-width:0}
  .home-features{grid-column:auto;grid-row:auto}
  .home-rail{grid-column:auto;grid-row:auto;position:static}
}
/* Homepage features: kicker with a fine gold rule, headline, italic
   deck, byline, then the intro — the framed plate with its caption
   floated right, the excerpt text wrapping around it — then the
   action buttons, the Why It Matters box and the sources line. */
.lead-story{padding-bottom:0;margin-bottom:0}
/* Same size as the section-page H1s (2.4rem; the font is already
   the shared .headline face) — owner directive, 2026-11-21. */
.feature-headline{font-size:2.4rem}
.feature-intro{margin-top:1rem}
.feature-intro::after{content:"";display:block;clear:both}
.feature-intro figure.art-figure{float:right;width:52%;margin:.15rem 0 1rem 1.6rem}
.feature-intro .feature-excerpt p{font-size:1.14rem;margin:0 0 .8em}
.feature-intro .feature-excerpt p.lead{font-size:1.14rem}
@media (max-width:767px){
  .feature-intro figure.art-figure{float:none;width:100%;margin:0 0 1rem}
}
/* Red drop cap on the opening paragraph (features and articles):
   generated from the paragraph's actual first letter. */
.dropcap::first-letter{font-family:var(--font-headline);font-weight:700;font-size:3.4em;line-height:.82;float:left;color:var(--color-red);margin:.05em .12em 0 0}
.feature-actions{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem}
/* Action buttons (Read Full Story, Save, Share) carry the
   navigation's typography — the serif body font at 1rem, weight
   600, with the nav's letter spacing (owner instruction,
   2026-11-03). Their fills stay: red for the primary action,
   bordered white for the secondary ones. */
.btn-read{display:inline-block;background:var(--color-red);color:#fff;text-decoration:none;font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;padding:.28rem .65rem;border-radius:3px}
.btn-read:hover{background:#7d181e}
.btn-save{background:#fff;border:1px solid #b9b2a0;color:var(--color-text);font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;padding:.28rem .65rem;border-radius:3px;cursor:pointer}
.btn-save.saved{background:#fbeeee;border-color:var(--color-red);color:var(--color-red)}
.btn-share{background:#fff;border:1px solid #b9b2a0;color:var(--color-text);font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;padding:.28rem .65rem;border-radius:3px;cursor:pointer}
.share-wrap{position:relative;display:inline-block}
.share-menu{position:absolute;left:0;top:calc(100% + 6px);z-index:60;display:block;min-width:215px;background:#fff;border:1px solid #b9b2a0;border-radius:4px;box-shadow:0 8px 22px rgba(16,36,56,.18);padding:.35rem 0}
.share-menu[hidden]{display:none}
.share-menu a,.share-menu button{display:block;width:100%;box-sizing:border-box;text-align:left;background:none;border:0;padding:.5rem .9rem;font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;color:var(--color-text);text-decoration:none;cursor:pointer}
.share-menu a:hover,.share-menu button:hover{background:var(--color-ivory)}
.why-feature{border-left:4px solid var(--color-red);background:var(--color-ivory);padding:16px 18px;margin-top:1rem}
.why-feature .why-label{font-family:var(--font-ui);color:var(--color-red);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.35rem}
.why-feature p{margin:0;font-size:1.03rem}
/* Satire pieces (owner instruction, 2026-11-02): a satire page is
   only the comic and the owner's long caption — no headline, no
   dek, no byline, no sidebar, no related grid — with previous /
   next buttons under the caption for moving between comics. The
   section page lists the comics the same way: image, then caption. */
.satire-wrap{max-width:760px;margin:0 auto;padding-top:.6rem}
.satire-dateline{font-family:var(--font-ui);font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;color:#555;margin:0 0 .8rem}
.satire-wrap figure.art-figure{margin:0}
.satire-caption{font-size:.8125rem;font-style:italic;line-height:1.4;color:#444;margin:1rem 0 0}
.satire-caption p{margin:0 0 .8em}
.satire-nav{display:flex;gap:.8rem;margin:1.4rem 0 .4rem}
.satire-nav a{display:inline-block;font-family:var(--font-ui);font-weight:bold;font-size:.95rem;text-decoration:none;padding:.55rem 1.15rem;border-radius:3px;border:1px solid var(--color-red);color:var(--color-red);background:#fff}
.satire-nav a.prev{margin-right:auto}
.satire-nav a.next{background:var(--color-red);color:#fff;margin-left:auto}
.section-subhead{font-family:var(--font-headline);font-size:2.4rem;font-weight:800;line-height:1.12;margin:0 0 .9rem}
.satire-list{display:grid;grid-template-columns:1fr 1fr;gap:2.4rem 2rem}
@media (max-width:767px){.satire-list{grid-template-columns:1fr}}
.satire-list figure.art-figure{margin:0}
.satire-list .satire-caption{margin-top:.7rem}
/* Gold filigree divider between homepage features. The art is
   the wrapper's background, not an <img> (owner report,
   2026-11-22: the <img> form rendered stretched in his viewer
   even though the served rule pinned it to natural size — a
   background cannot be stretched by image rules or viewer
   overrides at all). It renders at exactly its natural size
   (1152x26, height 26px) — never stretched larger or shrunk
   smaller (owner directive, 2026-11-21) — centered, and on
   screens narrower than the art the wrapper clips the edges
   instead of scaling it. */
.feature-divider{height:26px;margin:1.2rem 0;background:url(/section-break.png) no-repeat center/1152px 26px}
/* One-day Broncos win banner (owner order, 2026-11-22): the owner's
   "Broncos Win!" cartoon sits above the top headline on the homepage
   for 24 hours only. The render gate in homePage stops emitting it
   after 2026-11-24T01:15:00Z (24h from placement), so it removes
   itself with no second deploy. */
.win-banner{margin:0}
.win-banner a{display:block}
.win-banner img{display:block;width:100%;height:auto}
/* Federal Lawsuit Tracker (perennial Politics guide, 2026-11-23;
   news-graphics redesign, 2026-11-27): a dark scoreboard with a
   segmented record bar and count-up stats, a filterable case
   explorer, Supreme Court cards on a year timeline with justice-dot
   vote graphics, and an animated taxpayer-cost chart, all in the
   site palette. Motion honors prefers-reduced-motion, and every
   animated state is gated behind .trk-js / .trk-in classes the
   page script adds, so the static page is complete without it. */
.trk-kicker{font-family:var(--font-ui);font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-red);margin-top:1rem}
.trk-h1{font-size:2.6rem;margin:.35rem 0 .5rem}
.trk-dek{font-size:1.25rem}
.trk-updated{font-family:var(--font-ui);font-size:.82rem;color:var(--color-muted);border-bottom:1px solid var(--color-border);padding-bottom:.9rem;margin-bottom:1.1rem}
.trk-prose p{font-size:1.05rem;line-height:1.65;margin:.7rem 0}
.trk-board{background:linear-gradient(155deg,#13293F 0%,var(--color-navy) 55%,#0A1826 100%);color:var(--color-ivory);padding:1.6rem 1.7rem 1.5rem;margin:1.6rem 0 .4rem;box-shadow:0 10px 28px rgba(16,36,56,.22)}
.trk-board-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;border-bottom:1px solid rgba(248,244,235,.25);padding-bottom:.6rem}
.trk-board-title{font-family:var(--font-ui);font-size:.82rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--color-gold)}
.trk-board-sub{font-family:var(--font-ui);font-size:.78rem;color:rgba(248,244,235,.75)}
.trk-recordbar{display:flex;gap:3px;height:16px;margin-top:1.1rem}
.trk-rb-seg{display:block;height:100%;transition:width 1.1s cubic-bezier(.22,.8,.3,1)}
.trk-rb-loss{background:#C05358}
.trk-rb-win{background:var(--color-ivory)}
.trk-rb-pending{background:repeating-linear-gradient(45deg,var(--color-gold) 0 7px,#8F713C 7px 14px)}
.trk-rb-legend{display:flex;flex-wrap:wrap;gap:.4rem 1.4rem;margin-top:.55rem;font-family:var(--font-ui);font-size:.76rem;color:rgba(248,244,235,.88)}
.trk-legend-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:.45rem;vertical-align:-1px}
.trk-legend-loss{background:#C05358}
.trk-legend-win{background:var(--color-ivory)}
.trk-legend-pending{background:var(--color-gold)}
.trk-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1rem;margin-top:1.25rem}
.trk-stat{display:flex;flex-direction:column;gap:.2rem;border-top:1px solid rgba(248,244,235,.22);padding-top:.7rem}
.trk-stat-num{font-family:var(--font-headline);font-size:2.6rem;font-weight:800;line-height:1;color:#fff;font-variant-numeric:tabular-nums}
.trk-num-loss{color:#EBA9AC}
.trk-num-pending{color:var(--color-gold)}
.trk-num-cost{color:var(--color-gold)}
.trk-stat-label{font-family:var(--font-ui);font-size:.74rem;line-height:1.35;color:rgba(248,244,235,.85)}
.trk-casestrip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:.5rem;margin-top:1.3rem}
.trk-tile{display:flex;flex-direction:column;gap:.15rem;background:rgba(248,244,235,.06);border:1px solid rgba(248,244,235,.18);border-top:3px solid rgba(248,244,235,.4);padding:.6rem .65rem .55rem;text-decoration:none;color:var(--color-ivory);transition:background .18s ease,transform .18s ease}
.trk-tile:hover{background:rgba(248,244,235,.13);transform:translateY(-2px);text-decoration:none}
.trk-tile-loss{border-top-color:#C05358}
.trk-tile-win{border-top-color:var(--color-ivory)}
.trk-tile-pending{border-top-color:var(--color-gold)}
.trk-tile-name{font-family:var(--font-headline);font-weight:700;font-size:.98rem;line-height:1.15}
.trk-tile-meta{font-family:var(--font-ui);font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(248,244,235,.75)}
.trk-section-head{margin:2.6rem 0 1rem}
.trk-section-head .trk-kicker{margin-top:0}
.trk-h2{font-family:var(--font-headline);font-size:1.9rem;font-weight:800;line-height:1.15;margin:.3rem 0 0}
.trk-rule{width:64px;height:3px;background:var(--color-gold);margin-top:.55rem}
.trk-explorer{margin:0 0 .4rem}
.trk-filters{display:flex;flex-wrap:wrap;gap:.5rem;margin:.2rem 0 .55rem}
.trk-filter{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.03em;padding:.42rem .85rem;border:1px solid var(--color-navy);border-radius:999px;background:#fff;color:var(--color-navy);cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease}
.trk-filter:hover{border-color:var(--color-gold);background:var(--color-ivory)}
.trk-filter.is-active{background:var(--color-navy);color:var(--color-ivory);border-color:var(--color-navy)}
.trk-showing{font-family:var(--font-ui);font-size:.78rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--color-muted);margin:.1rem 0 .4rem}
.trk-rows{border-top:1px solid var(--color-border)}
.trk-row{display:grid;grid-template-columns:6px minmax(0,1fr) auto 18px;gap:.9rem;align-items:center;padding:.8rem .6rem .8rem 0;border-bottom:1px solid var(--color-border);text-decoration:none;color:inherit;transition:background .15s ease}
.trk-row:hover{background:var(--color-ivory);text-decoration:none}
.trk-row-rail{display:block;width:6px;align-self:stretch;background:#D8D2C2}
.trk-rail-loss,.trk-rail-mixed{background:var(--color-red)}
.trk-rail-win{background:var(--color-navy)}
.trk-rail-pending{background:var(--color-gold)}
.trk-row-main{display:flex;flex-direction:column;gap:.12rem;min-width:0}
.trk-row-name{font-family:var(--font-headline);font-weight:700;font-size:1.12rem;line-height:1.25}
.trk-row:hover .trk-row-name{text-decoration:underline}
.trk-row-court{font-family:var(--font-ui);font-size:.78rem;color:var(--color-muted)}
.trk-row-arrow{font-family:var(--font-headline);font-size:1.3rem;color:var(--color-gold);text-align:right}
.trk-chip{display:inline-block;font-family:var(--font-ui);font-size:.76rem;font-weight:600;line-height:1.3;padding:.22rem .5rem;border:1px solid;border-radius:2px}
.trk-chip-loss{background:#F9E8E9;color:#7E161C;border-color:#E3B7BA}
.trk-chip-win{background:#E8EDF3;color:var(--color-navy);border-color:#B9C6D4}
.trk-chip-pending{background:#F5EDD9;color:#7A5E22;border-color:#DCC794}
.trk-chip-mixed{background:#F9E8E9;color:#7E161C;border-color:#E3B7BA}
.trk-note{background:var(--color-ivory);border-left:3px solid var(--color-gold);padding:.9rem 1.1rem;margin:1.2rem 0;font-size:.95rem;line-height:1.55}
.trk-promo{display:block;background:var(--color-navy);color:var(--color-ivory);padding:1.1rem 1.3rem;margin:1.2rem 0 .4rem;text-decoration:none;border-left:4px solid var(--color-gold)}
.trk-promo:hover{text-decoration:none}
.trk-promo-kicker{font-family:var(--font-ui);font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-gold)}
.trk-promo-title{font-family:var(--font-headline);font-size:1.35rem;font-weight:800;line-height:1.2;margin:.3rem 0}
.trk-promo-line{font-size:.95rem;line-height:1.5;color:rgba(248,244,235,.88)}
.trk-promo-cta{font-family:var(--font-ui);font-size:.82rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;margin-top:.5rem;display:inline-block}
.trk-lede{font-size:1.02rem;line-height:1.6;color:#333;margin:.4rem 0 1rem}
.trk-card{position:relative;border:1px solid var(--color-border);border-top:3px solid var(--color-gold);background:#fff;padding:1.3rem 1.5rem 1.1rem;margin:1.3rem 0;box-shadow:0 1px 3px rgba(16,36,56,.06)}
.trk-card-loss,.trk-card-mixed{border-top-color:var(--color-red)}
.trk-card-win{border-top-color:var(--color-navy)}
.trk-card-pending{border-top-color:var(--color-gold)}
.trk-tl-tag{display:none}
@media (min-width:1000px){
  .trk-timeline{position:relative;padding-left:118px}
  .trk-timeline::before{content:"";position:absolute;left:76px;top:10px;bottom:10px;width:2px;background:linear-gradient(var(--color-gold),rgba(170,133,72,.25))}
  .trk-timeline .trk-card::before{content:"";position:absolute;left:-46px;top:1.55rem;width:9px;height:9px;border-radius:50%;background:var(--color-gold);box-shadow:0 0 0 3px #fff}
  .trk-timeline .trk-card-loss::before,.trk-timeline .trk-card-mixed::before{background:var(--color-red)}
  .trk-timeline .trk-card-win::before{background:var(--color-navy)}
  .trk-tl-tag{display:block;position:absolute;left:-118px;top:1.3rem;width:64px;text-align:right;font-family:var(--font-headline);font-weight:800;font-size:1.05rem;color:var(--color-navy)}
}
.trk-card-head{display:flex;align-items:flex-start;gap:.8rem}
.trk-card-num{flex:none;width:2rem;height:2rem;background:var(--color-navy);color:var(--color-ivory);font-family:var(--font-headline);font-weight:800;font-size:1.05rem;display:flex;align-items:center;justify-content:center}
.trk-card-title{font-family:var(--font-headline);font-size:1.4rem;font-weight:800;line-height:1.2;margin:.15rem 0 0}
.trk-card-year{color:var(--color-muted);font-weight:400}
.trk-outcome{margin:.8rem 0 .2rem}
.trk-vote{display:flex;align-items:center;gap:.9rem;margin:.75rem 0 .35rem;flex-wrap:wrap}
.trk-vote-score{font-family:var(--font-headline);font-size:1.55rem;font-weight:800;line-height:1;color:var(--color-navy);font-variant-numeric:tabular-nums}
.trk-score-loss{color:var(--color-red)}
.trk-score-win{color:var(--color-navy)}
.trk-score-pending{color:#7A5E22;font-size:1.05rem;font-family:var(--font-ui);letter-spacing:.08em;text-transform:uppercase}
.trk-vote-dots{display:inline-flex;gap:5px}
.trk-dot-vote{width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #CFC9B8}
.trk-dot-majority.trk-dot-loss{background:var(--color-red);border-color:var(--color-red)}
.trk-dot-majority.trk-dot-win{background:var(--color-navy);border-color:var(--color-navy)}
.trk-dot-pending{background:#FBF6E9;border:2px dashed var(--color-gold)}
.trk-vote-note{font-family:var(--font-ui);font-size:.8rem;font-weight:600;color:var(--color-muted)}
.trk-hero{float:right;width:340px;margin:.35rem 0 1rem 1.6rem}
.trk-prose::after{content:"";display:block;clear:both}
@media (max-width:767px){
  .trk-hero{float:none;width:100%;margin:0 0 1rem}
}
.trk-hero img{display:block;width:100%;height:auto;border:1px solid var(--color-border)}
.trk-hero figcaption{font-family:var(--font-ui);font-size:.8rem;color:var(--color-muted);margin-top:.45rem}
.trk-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.6rem 1.4rem;background:var(--color-ivory);padding:.8rem 1rem;margin:.9rem 0}
.trk-meta dt{font-family:var(--font-ui);font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-muted)}
.trk-meta dd{margin:.15rem 0 0;font-weight:600;font-size:.95rem}
.trk-subhead{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--color-navy);margin:1.15rem 0 .35rem}
.trk-card p{font-size:1rem;line-height:1.62;margin:.45rem 0}
.trk-source{font-family:var(--font-ui);font-size:.8rem;color:var(--color-muted);border-top:1px dashed var(--color-border);padding-top:.6rem;margin-top:1rem}
.trk-chart{border:1px solid var(--color-border);padding:1.2rem 1.3rem 1rem;margin:1.2rem 0;background:#fff}
.trk-chart-row{display:grid;grid-template-columns:200px minmax(0,1fr) 168px;gap:1rem;align-items:center;margin:.65rem 0}
.trk-chart-name{font-family:var(--font-headline);font-weight:700;font-size:.98rem}
.trk-chart-track{background:#EDEAE0;height:22px}
.trk-chart-bar{display:block;height:100%;background:var(--color-navy);transition:width 1.1s cubic-bezier(.22,.8,.3,1)}
.trk-chart-row:first-child .trk-chart-bar{background:var(--color-red)}
.trk-chart-amt{font-family:var(--font-ui);font-weight:700;font-size:.92rem;white-space:nowrap;text-align:right}
.trk-chart-total{display:flex;justify-content:space-between;align-items:center;gap:1rem;background:var(--color-navy);color:var(--color-ivory);padding:.75rem 0 .75rem .95rem;margin-top:1rem;font-family:var(--font-ui);font-size:.85rem;letter-spacing:.04em;text-transform:uppercase}
.trk-chart-total strong{font-family:var(--font-headline);font-size:1.3rem;color:var(--color-gold);text-transform:none;letter-spacing:0;white-space:nowrap}
.trk-themes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.2rem;margin:1rem 0}
.trk-theme{background:var(--color-ivory);border-top:3px solid var(--color-gold);padding:1rem 1.1rem;transition:transform .18s ease,box-shadow .18s ease}
.trk-theme:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(16,36,56,.12)}
.trk-theme h3{font-family:var(--font-headline);font-size:1.12rem;font-weight:800;line-height:1.25;margin:0 0 .4rem}
.trk-theme-cases{font-family:var(--font-ui);font-size:.74rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--color-red)}
.trk-theme p{font-size:.95rem;line-height:1.55}
.trk-quote{font-family:var(--font-headline);font-style:italic;font-size:1.45rem;line-height:1.4;color:var(--color-navy);text-align:center;border-top:2px solid var(--color-gold);border-bottom:2px solid var(--color-gold);padding:1.3rem 2rem;margin:2rem 0}
.trk-method p{font-size:1rem;line-height:1.6}
.trk-monitor{line-height:1.6;list-style:none;padding-left:.2rem}
.trk-monitor li{margin:.35rem 0}
.trk-watch-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--color-gold);margin-right:.55rem;vertical-align:1px;animation:trk-pulse 2.2s ease-out infinite}
@keyframes trk-pulse{0%{box-shadow:0 0 0 0 rgba(170,133,72,.45)}70%{box-shadow:0 0 0 7px rgba(170,133,72,0)}100%{box-shadow:0 0 0 0 rgba(170,133,72,0)}}
.trk-src-group{font-family:var(--font-headline);font-size:1.15rem;font-weight:800;margin:1.3rem 0 .4rem}
.trk-sources{font-size:.92rem;line-height:1.5;padding-left:1.4rem}
.trk-sources li{margin:.3rem 0}
.trk-sources a{color:var(--color-navy)}
.trk-js .trk-reveal{opacity:0;transform:translateY(16px)}
.trk-js .trk-reveal.trk-in{opacity:1;transform:none;transition:opacity .6s ease,transform .6s ease}
.trk-js .trk-in .trk-dot-vote{animation:trk-dot-in .45s ease both;animation-delay:calc(var(--d,0)*60ms)}
@keyframes trk-dot-in{from{transform:scale(.4);opacity:.2}to{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){
  .trk-watch-dot{animation:none}
  .trk-rb-seg,.trk-chart-bar{transition:none}
  .trk-js .trk-reveal{opacity:1;transform:none}
  .trk-js .trk-in .trk-dot-vote{animation:none}
  .trk-tile,.trk-theme{transition:none}
}
@media (max-width:900px){
  .trk-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .trk-casestrip{grid-template-columns:repeat(auto-fit,minmax(104px,1fr))}
  .trk-themes{grid-template-columns:minmax(0,1fr)}
  .trk-chart-row{grid-template-columns:minmax(0,1fr);gap:.3rem}
  .trk-chart-amt{white-space:normal}
  .trk-chart-total{flex-direction:column;align-items:flex-start;gap:.25rem}
  .trk-chart-total strong{white-space:normal}
}
@media (max-width:767px){
  .trk-kicker{font-size:.64rem;letter-spacing:.16em}
  .trk-h1{font-size:2rem}
  .trk-board{padding:1.2rem 1.1rem 1.1rem}
  .trk-stat-num{font-size:2.1rem}
  .trk-dot-vote{width:12px;height:12px}
  .trk-vote-score{font-size:1.3rem}
  .trk-card{padding:1.1rem 1rem .9rem}
  .trk-quote{font-size:1.2rem;padding:1.1rem .8rem}
  .trk-row{grid-template-columns:6px minmax(0,1fr) 18px}
  .trk-row-status{grid-column:2}
  .trk-row-arrow{grid-column:3;grid-row:1}
}
/* Special-report redesign (owner mockup, 2026-11-27): hero head with
   the Supreme Court engraving, the At a Glance band, the horizontal
   case timeline, status pills, and the cost/takeaways columns. */
.trk-kicker{color:#a62b25}
.trk-hero-head{display:flex;gap:30px;align-items:flex-start;margin:.4rem 0 1.2rem}
.trk-hero-text{flex:1 1 auto;min-width:0}
.trk-hero-img{flex:0 0 302px;width:302px;max-width:42%;height:auto;margin-top:.4rem}
.trk-hero-court{width:470px}
@media (max-width:760px){.trk-hero-court{float:none;width:100%;margin:0 0 1rem}}
.trk-updated{display:inline-block;background:#f6ecd9;border:1px solid #ddd3bd;padding:.34rem .75rem;font:600 .76rem/1.35 'Archivo',sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#5c5546}
@media (max-width:760px){.trk-hero-head{flex-direction:column;gap:14px}.trk-hero-img{max-width:250px;flex-basis:auto}}
.trk-glance{display:grid;grid-template-columns:1.3fr repeat(5,1fr);align-items:center}
.trk-glance-label{display:flex;flex-direction:column;gap:.4rem;padding-right:1.1rem}
.trk-glance-kicker{align-self:flex-start;border-top:3px solid #c05358;padding-top:.5rem;font:700 .7rem 'Archivo',sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#e8c987}
.trk-glance-title{font-family:'Playfair Display',serif;font-size:1.32rem;font-weight:700;line-height:1.16;color:#f4eedf}
.trk-glance .trk-stat{border-left:1px solid rgba(244,238,223,.18);padding:.15rem .85rem}
.trk-rb-label{font:600 .72rem 'Archivo',sans-serif;letter-spacing:.15em;text-transform:uppercase;color:rgba(244,238,223,.72);margin:1.05rem 0 .45rem}
@media (max-width:900px){.trk-glance{grid-template-columns:1fr 1fr;row-gap:.9rem}.trk-glance-label{grid-column:1/-1}.trk-glance .trk-stat{border-left:none;padding:.1rem .5rem .1rem 0}}
.trk-tl-scroll{overflow-x:auto;padding:.2rem .1rem .9rem;scrollbar-width:thin}
.trk-tl-h{display:grid;grid-template-columns:repeat(12,1fr);min-width:940px;position:relative}
.trk-tl-h::before{content:'';position:absolute;left:4.2%;right:4.2%;top:34px;height:2px;background:#c9bfa5}
.trk-node{display:flex;flex-direction:column;align-items:center;text-align:center;text-decoration:none;padding:0 .22rem;position:relative}
.trk-node-year{font:700 .93rem 'Playfair Display',serif;color:#16283f;height:22px;line-height:22px}
.trk-node-dotwrap{height:24px;display:flex;align-items:center;justify-content:center}
.trk-node-dot{width:13px;height:13px;border-radius:50%;background:#a62b25;border:2px solid #fffdf6;box-shadow:0 0 0 1.5px #c9bfa5;position:relative;z-index:1}
.trk-node-win .trk-node-dot{background:#16283f}
.trk-node-mixed .trk-node-dot{background:linear-gradient(90deg,#a62b25 50%,#fffdf6 50%)}
.trk-node-pending .trk-node-dot{background:#fffdf6;border-color:#b98a1c;box-shadow:0 0 0 1.5px #b98a1c}
.trk-node-name{font:600 .71rem 'Archivo',sans-serif;color:#2b2620;line-height:1.28;margin-top:.32rem}
.trk-node-status{font:600 .6rem 'Archivo',sans-serif;letter-spacing:.07em;text-transform:uppercase;color:#8a8172;margin-top:.14rem}
.trk-node-pending .trk-node-status{color:#8a6410}
.trk-node:hover .trk-node-name{text-decoration:underline}
.trk-node-off{opacity:.15;filter:grayscale(.7)}
.trk-range-chip{margin-left:auto;align-self:center;font:600 .76rem 'Archivo',sans-serif;color:#5c5546;border:1px solid #c9bfa5;border-radius:999px;padding:.42rem .8rem;background:#fffdf6;white-space:nowrap}
.trk-pill{margin-left:auto;flex:0 0 auto;align-self:flex-start;font:700 .66rem 'Archivo',sans-serif;letter-spacing:.1em;text-transform:uppercase;padding:.34rem .62rem;border-radius:3px;color:#fff;background:#a62b25}
.trk-pill-win{background:#16283f}
.trk-pill-mixed{background:#fffdf6;color:#a62b25;border:1.5px solid #a62b25;padding:.26rem .62rem}
.trk-pill-pending{background:#16283f}
.trk-card-court{font:600 .83rem 'Archivo',sans-serif;color:#5c5546;margin:.05rem 0 .55rem;letter-spacing:.01em}
.trk-card-court .trk-sep{color:#b98a1c;padding:0 .2rem}
.trk-bill-grid{display:grid;grid-template-columns:minmax(0,1fr) 322px;gap:2.1rem;align-items:start}
@media (max-width:900px){.trk-bill-grid{grid-template-columns:1fr}}
.trk-takeaways{background:#f6ecd9;border:1px solid #ddd3bd;border-top:3px solid #a62b25;padding:1.15rem 1.25rem 1.25rem}
.trk-takeaways h3{font-family:'Playfair Display',serif;font-size:1.28rem;font-weight:800;margin:0 0 .75rem;color:#16283f}
.trk-takeaways ul{list-style:none;margin:0;padding:0}
.trk-takeaways li{position:relative;padding-left:1.05rem;margin-bottom:.68rem;font-size:.94rem;line-height:1.52;color:#2b2620}
.trk-takeaways li:last-child{margin-bottom:0}
.trk-takeaways li::before{content:'';position:absolute;left:0;top:.52em;width:7px;height:7px;background:#a62b25}

.trk-cora{background:#16283f;color:#f4eedf;padding:1.55rem 1.7rem 1.65rem;margin:0 0 1.7rem;border-top:4px solid #c05358}
.trk-cora-kicker{font:700 .7rem 'Archivo',sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#e8c987;margin-bottom:.55rem}
.trk-cora-title{font-family:'Playfair Display',serif;font-size:1.68rem;font-weight:800;line-height:1.15;margin:0 0 .6rem;color:#fff}
.trk-cora-body{font-size:1rem;line-height:1.62;margin:0 0 .85rem}
.trk-cora-status{font:600 .87rem 'Archivo',sans-serif;line-height:1.5;color:#e8c987;margin:0;display:flex;gap:.55rem;align-items:flex-start}
.trk-cora-status .trk-watch-dot{flex:none;margin-top:.42em}
.trk-h1-row{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;flex-wrap:wrap}
.trk-h1-row .trk-updated{margin-top:0;flex:none}
.trk-hero-court img{border:none}
.trk-hero-court figcaption{font-family:inherit;font-style:italic;font-size:.8125rem;line-height:1.4;color:#444;text-align:center;padding:.45rem .3rem .15rem;margin-top:0}
.briefing-cta{margin-top:.6rem;text-align:center}
button,input[type="submit"],.btn-read,.btn-save,.btn-share,.btn-signup,.btn-subscribe,.trk-filter,.briefing button,.share-menu button,.searchbox button,.footer-signup button,.nav-search-form button{font-family:var(--font-ui);font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.btn-read,.btn-save,.btn-share,.briefing button,.searchbox button{font-size:.9rem}
.btn-signup{font-size:.85rem}
.btn-subscribe,.btn-signup,.briefing button,.footer-signup button,.nl-primary{font-family:var(--font-ui);font-weight:700;font-size:.85rem;padding:.5rem 1rem}
@media (max-width:640px){.trk-cora{padding:1.25rem 1.1rem 1.35rem}.trk-cora-title{font-size:1.42rem}}

/* Homepage feature grid (owner directive, 2026-11-21): eight more
   feature stories as compact cards, two wide and four long, inside
   the main column under the two full features. Cards reuse the
   Latest card dress. */
.feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.25rem}
@media (max-width:767px){
  .feature-grid{grid-template-columns:minmax(0,1fr)}
}
/* Homepage rail story rows: thumbnail left (no outline, engraving at
   its natural edges), red category label, serif headline. */
.rail-latest{margin-bottom:1.4rem}
.rail-row{display:flex;gap:.85rem;padding:.75rem 0;border-bottom:1px solid var(--color-border)}
.rail-row:first-child{padding-top:0}
.rail-row:last-child{border-bottom:0;padding-bottom:0}
.rail-thumb{flex:0 0 100px;width:100px;height:70px;overflow:hidden;background:#fff}
.rail-thumb img{display:block;width:100%;height:100%;object-fit:contain;object-position:center;filter:grayscale(1) contrast(1.06);background:#fff}
.rail-group{margin:0 0 1.15rem}
.rail-group:last-child{margin-bottom:0}
.rail-group-title{font-family:var(--font-ui);font-weight:700;font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;color:var(--color-red);margin:0 0 .2rem;display:flex;align-items:center;gap:.7rem}
.rail-group-title::after{content:"";flex:1;height:1px;background:var(--color-gold)}
.rail-group-title a{text-decoration:none;color:inherit}
.rail-group-title a:hover{text-decoration:underline}
.sports-line{font-family:var(--font-ui);font-size:.9rem;padding:.38rem 0;border-bottom:1px solid var(--color-border)}
.sports-line:last-child{border-bottom:0;padding-bottom:0}
.sports-icon{display:inline-block;width:16px;height:16px;margin-right:.45rem;color:var(--color-navy);vertical-align:-2px}
.sports-icon.sport-football{color:#7B4B26}
.sports-icon.sport-basketball{color:#E06F00}
.sports-icon.sport-hockey{color:#1A1A1A}
.sports-icon.sport-baseball{color:#BC3F34}
.sports-icon.sport-soccer{color:#1A1A1A}
.sports-icon svg{display:block;width:100%;height:100%}
.listing-pager{display:flex;justify-content:center;align-items:center;gap:1.1rem;margin:1.7rem 0 .3rem;font-family:var(--font-ui)}
.pager-link{font-weight:700;font-size:.9rem;color:var(--color-navy);text-decoration:none;border:1px solid var(--color-border);padding:.45rem .95rem;background:#fff}
a.pager-link:hover{border-color:var(--color-gold)}
.pager-off{color:var(--color-muted)}
.pager-status{font-size:.82rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--color-muted)}
.rail-row-text h4{font-family:var(--font-headline);font-size:1.03rem;line-height:1.28;margin:.15rem 0 .3rem}
.rail-row-text h4 a{text-decoration:none}
.rail-row-text h4 a:hover{text-decoration:underline}
/* Local & Statewide sidebar box (replaces the old trending box):
   the most recent Local stories, newest first, each marked with
   the owner's maroon quatrefoil icon (owner instruction,
   2026-11-02; the rows were previously numbered 1-8 in red
   circles). Order is chronological, not a popularity ranking. */
.local-statewide{padding-top:.7rem;margin-bottom:1.2rem}
.local-statewide h2{font-family:var(--font-ui);font-weight:700;font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;color:var(--color-red);margin:0 0 .2rem;display:flex;align-items:center;gap:.7rem}
.local-statewide h2::after{content:"";flex:1;height:1px;background:var(--color-gold)}
.local-statewide h2 a{text-decoration:none;color:inherit;font:inherit}
.local-statewide h2 a:hover{text-decoration:underline}
.local-statewide ol{list-style:none;margin:0;padding:0}
.local-statewide li{display:flex;gap:.65rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid var(--color-border)}
.local-statewide li:last-child{border-bottom:0;padding-bottom:0}
.local-statewide .trend-icon{flex:0 0 auto;width:1.25rem;height:1.25rem;margin-top:.15rem}
.local-statewide a{text-decoration:none;font-family:var(--font-headline);font-size:1.06rem;line-height:1.3}
.local-statewide a:hover{text-decoration:underline}
/* Editorial strip: a full-width ivory band below the homepage
   columns and above Latest from Colorado, promoting the newest
   Opinion piece. Rendered only when an Opinion article exists. */
.editorial-strip{background:var(--color-ivory);border:1px solid var(--color-border);padding:1rem 1.2rem;margin-top:1.8rem}
.editorial-strip-row{display:flex;align-items:flex-start;gap:1.2rem;flex-wrap:wrap}
.editorial-strip figure.art-figure{flex:0 0 240px;margin:0}
.editorial-strip figure.art-figure img{border:1px solid #000}
.editorial-strip .editorial-text{flex:1;min-width:220px}
.editorial-strip .editorial-label{color:var(--color-red);font-family:var(--font-ui);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
.editorial-strip .editorial-headline{display:block;font-family:var(--font-headline);font-weight:700;font-size:2.3rem;line-height:1.12;margin:0 0 .9rem}
.editorial-strip .editorial-excerpt{margin-top:.45rem}
.editorial-strip .editorial-excerpt p{font-size:1.14rem;margin:0 0 .8em}
/* ---------- How Colorado Works (series; launched 2026-11-08 as Colorado Explained, renamed the same day) ---------- */
.series-label{font-family:var(--font-ui);font-size:.82rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin:0 0 .4rem}
.series-label a{color:var(--color-red);text-decoration:none}
.short-answer{background:var(--color-ivory);border:1px solid var(--color-border);border-left:4px solid var(--color-gold);padding:1rem 1.2rem;margin:1.4rem 0}
.short-answer-label{font-family:var(--font-ui);font-size:.82rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-red);margin-bottom:.5rem}
.short-answer p{margin:0 0 .6em}
.short-answer p:last-child{margin-bottom:0}
.explainer-list{margin:.4rem 0 1rem;padding-left:1.4rem}
.explainer-list li{margin-bottom:.55rem;line-height:1.5}
.explained-related{border-top:2px solid var(--color-gold);margin-top:1.6rem;padding-top:1rem}
.explained-related h2{font-family:var(--font-headline);font-size:1.4rem;margin:0 0 .6rem}
.explained-related ul{list-style:none;margin:0;padding:0}
.explained-related li{margin-bottom:.45rem}
.explained-related .rel-cat{font-family:var(--font-ui);font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--color-red);margin-right:.5rem}
.last-reviewed{font-style:italic;color:#555;font-size:.95rem;margin-top:1.2rem}
.explained-home{margin-top:1.8rem}
.explained-heading{display:flex;align-items:center;gap:1rem;font-family:var(--font-ui);font-size:.95rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:0 0 .4rem}
.explained-heading::after{content:"";flex:1;height:2px;background:var(--color-gold)}
.explained-tagline{font-style:italic;font-size:1.05rem;color:#444;margin:0 0 1.1rem}
.explained-feature{display:flex;gap:1.4rem;flex-wrap:wrap;margin-bottom:1.3rem}
.explained-feature--wrap{display:block}
.explained-feature--wrap::after{content:"";display:block;clear:both}
.explained-feature--wrap>.art-link{float:left;width:340px;max-width:100%;margin:.15rem 1.4rem .8rem 0}
@media (max-width:767px){.explained-feature--wrap>.art-link{float:none;width:100%;margin:0 0 1rem}}
.explained-feature>.art-link{flex:0 0 340px;max-width:100%}
.explained-feature figure.art-figure{margin:0}
.explained-feature-text{flex:1;min-width:240px}
/* Explainer headlines match the H1 standard: headline face,
   800, 2.4rem (owner directive, 2026-11-21). */
.explained-feature-headline{font-family:var(--font-headline);font-weight:800;font-size:2.4rem;line-height:1.12;margin:.2rem 0 .5rem}
.explained-feature-headline a{color:inherit;text-decoration:none}
.explained-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.25rem}
@media (max-width:900px){.explained-grid{grid-template-columns:minmax(0,1fr)}}
/* Left-justified, and the link inside is a .btn-read button now,
   so no link styling of its own (owner directive, 2026-11-21). */
.explained-more{margin-top:1rem;text-align:left}
.explained-intro{margin:0 0 1.6rem}
.explained-intro h2{font-family:var(--font-display);font-weight:700;font-size:1.65rem;line-height:1.2;margin:.6rem 0 .8rem}
.explained-intro p{font-size:1.06rem;line-height:1.58;margin:.7rem 0}
.explained-chips{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1.4rem}
.explained-chips a{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--color-border);padding:.35rem .7rem;color:#333;text-decoration:none}
.explained-chips a.active{background:var(--color-navy);color:#fff;border-color:var(--color-navy)}
/* Latest from Colorado: heading with a gold rule, then one row of
   three cards (framed plate, red category, serif headline, short
   excerpt, muted metadata). No shadows, no rounded corners. */
.latest-home{margin-top:1.8rem}
.latest-home-heading{display:flex;align-items:center;gap:1rem;font-family:var(--font-ui);font-size:.95rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:0 0 1rem}
.latest-home-heading::after{content:"";flex:1;height:2px;background:var(--color-gold)}
.latest-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.25rem}
@media (max-width:767px){
  .latest-grid{grid-template-columns:minmax(0,1fr)}
}
.latest-card h3{font-family:var(--font-headline);font-size:1.125rem;margin:.25rem 0;line-height:1.25}
.latest-card h3 a{text-decoration:none}
.latest-card p{color:#444;font-size:.95rem;margin:.3rem 0}
.latest-card figure.art-figure{margin:0 0 .55rem}
.latest-card figure.art-figure img{height:auto}
/* Reader-facing topic navigation module (homepage) and the topic
   hub boxes on article/section pages: ivory, fine border, no
   internal SEO terminology in the visible copy. */
.hub-box{border:1px solid var(--color-border);border-top:3px solid var(--color-text);background:var(--color-ivory);padding:1rem 1.2rem;margin-top:2rem}
.hub-box h2{font-family:var(--font-headline);font-size:1.35rem;margin:.1rem 0 .4rem}
.hub-box p{margin:.2rem 0;color:#444}
/* ---------- Article page ---------- */
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:2.2rem;align-items:start}
.article-rail{position:sticky;top:1rem}
.article-rail .briefing{margin:0 0 1.2rem}
/* The rail's rectangle carries the standard ad spacing (1.2rem
   above, 1.4rem below) like every other ad on the site — with
   margin:0 it sat flush against the end-of-article leaderboard
   below the grid (owner flag, 2026-11-21). */
.article-rail .ad-slot{margin:1.2rem 0 1.4rem}
@media (max-width:900px){
  /* Same minmax(0,1fr) fix as .home-layout (2026-11-22): plain
     1fr let article content push the single column ~30px past
     the screen on phones. */
  .article-layout{grid-template-columns:minmax(0,1fr)}
  .article-layout>*{min-width:0}
  .article-rail{position:static}
}
/* Size matched to the section-page H1s (2.4rem), same as the
   homepage feature headlines — owner directive, 2026-11-21. */
article.full h1{font-family:var(--font-headline);font-weight:800;font-size:2.4rem;line-height:1.12;margin:.4rem 0}
article.full h2{font-family:var(--font-headline);font-weight:700;font-size:1.6875rem;line-height:1.25;margin:1.8rem 0 .8rem}
article.full p{font-size:1.15rem;line-height:1.6;margin:0 0 .8em}
article.full p.lead{font-size:1.15rem}
article.full figure.article-hero{margin:1.1rem 0}
.why{border-left:4px solid var(--color-red);background:var(--color-ivory);padding:20px;margin:24px 0}
.series-box{border-left:4px solid var(--color-red);background:var(--color-ivory);padding:16px 20px;margin:20px 0}
.series-box .series-label{font-family:var(--font-ui);color:var(--color-red);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.3rem}
.series-box .series-title{font-family:var(--font-headline);font-size:1.15rem;font-weight:700;margin-bottom:.5rem}
.series-box ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.4rem 1.4rem}
.series-box li{font-family:var(--font-ui);font-size:.95rem}
.series-box li.current{font-weight:bold}
.why .why-label{font-family:var(--font-ui);color:var(--color-red);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.4rem}
.why p{margin:0 0 .6em;font-size:1.06rem}
.why p:last-child{margin-bottom:0}
/* Sources list: the article's own serif, a step smaller than the
   article body text (owner instruction, 2026-11-03). */
.source{font-family:var(--font-body);font-size:1rem;color:#555}
.breadcrumb{font-family:var(--font-ui);font-size:.8rem;color:#666;margin-bottom:.5rem}
.breadcrumb a{color:#666}
.sources-block{border-top:1px solid var(--color-border);margin-top:1.8rem;padding-top:.8rem}
.sources-block h2{font-family:var(--font-headline);font-size:1.15rem;margin:.1rem 0 .4rem}
/* Podcast brief pages (2026-11-16): one page per episode, short
   story versions with a source list under each story. */
.brief-kicker{font-family:var(--font-ui);color:var(--color-red);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:0 0 .4rem}
.brief-story{border-top:1px solid var(--color-border);margin-top:1.6rem;padding-top:1.1rem;scroll-margin-top:1.2rem}
.brief-dateline{font-family:var(--font-ui);font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;color:#555;margin:.3rem 0 .8rem}
.brief-story h2{font-family:var(--font-headline);font-size:1.55rem;line-height:1.2;margin:.1rem 0 .6rem}
.brief-story h3{font-family:var(--font-headline);font-size:1.25rem;line-height:1.25;margin:.1rem 0 .5rem}
.brief-story p{font-family:var(--font-body);font-size:1.06rem;line-height:1.55;margin:0 0 .8em}
.brief-sources{margin-top:.2rem}
.brief-sources h3,.brief-sources h4{font-family:var(--font-ui);font-size:.78rem;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#666;margin:0 0 .3rem}
.brief-listen{display:inline-block;background:var(--color-navy);color:#fff;text-decoration:none;padding:.55rem 1.1rem;font-family:var(--font-ui);margin:.2rem 0 .6rem}
.brief-around{font-family:var(--font-headline);font-size:1.7rem;margin:2.2rem 0 .2rem}
.brief-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:2.2rem;font-family:var(--font-ui);font-size:.95rem}
.brief-index-list{list-style:none;margin:1rem 0;padding:0}
.podcast-listen{display:flex;gap:.7rem;flex-wrap:wrap;margin:1rem 0 1.6rem;clear:both}
.podcast-page-art{float:right;width:300px;height:auto;margin:.2rem 0 .8rem 1.4rem;border:1px solid var(--color-border)}
@media (max-width:640px){.podcast-page-art{width:160px;margin-left:1rem}}
.podcast-feature{border-top:2px solid var(--color-navy);border-bottom:1px solid var(--color-border);padding:1.1rem 0 1.3rem;margin:0 0 1.6rem}
.podcast-feature-headline{font-family:var(--font-headline);font-size:1.9rem;line-height:1.2;margin:.2rem 0 .5rem}
.podcast-feature-headline a{color:var(--color-navy);text-decoration:none}
.podcast-feature-headline a:hover{text-decoration:underline}
.podcast-feature-intro{font-family:var(--font-body);font-size:1.06rem;line-height:1.55;margin:0 0 .8rem}
.podcast-feature-stories{list-style:none;margin:.4rem 0 0;padding:0}
.podcast-feature-stories li{border-top:1px dotted var(--color-border);padding:.45rem 0}
.podcast-feature-stories a{font-family:var(--font-headline);font-size:1.05rem;color:var(--color-navy);text-decoration:none}
.podcast-feature-stories a:hover{text-decoration:underline}
.podcast-archive-title{font-family:var(--font-headline);font-size:1.7rem;margin:1.8rem 0 .2rem}
.brief-index-list .bi-date{display:block;font-family:var(--font-ui);font-size:.76rem;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;color:#666;margin-bottom:.15rem}
.brief-index-list .bi-title{font-family:var(--font-headline);font-size:1.2rem;color:var(--color-navy)}
.brief-index-list li{border-top:1px solid var(--color-border);padding:.7rem 0}
.brief-index-list a{font-family:var(--font-headline);font-size:1.2rem;color:var(--color-navy);text-decoration:none}
/* ---------- Subscribe / static pages ---------- */
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem;margin-top:1rem}
.tier{border:1px solid var(--color-border);background:#fff;padding:1.2rem;text-align:center}
.tier .price{font-size:2rem;font-family:var(--font-headline)}
.tier button,.tier a.btn{display:inline-block;background:var(--color-red);color:#fff;text-decoration:none;border:0;padding:.6rem 1.3rem;font-size:1rem;cursor:pointer;margin-top:.6rem}
.searchbox{display:flex;gap:.5rem;margin:1rem 0}
.searchbox input{flex:1;padding:.55rem;font-size:1rem;font-family:var(--font-body)}
.searchbox button{background:var(--color-navy);color:#fff;border:0;padding:.55rem 1.1rem;cursor:pointer;font-family:var(--font-ui)}
.static-page{max-width:760px}
.static-page.static-wide{max-width:none}
.static-page.about-page{max-width:none}
/* All H1s share the headline face at 2.4rem (owner directive,
   2026-11-21). */
.static-page h1{font-family:var(--font-headline);font-weight:800;font-size:2.4rem;line-height:1.12}
.static-page h2{font-family:var(--font-headline);margin:1.6em 0 .5em}
.static-page ul{margin:0 0 1em;padding-left:1.4em}
.static-page li{margin-bottom:.45em;line-height:1.55}
.about-tagline{font-size:1.3rem;color:var(--color-navy);margin-bottom:1.2rem}
.static-page.about-page p,.static-page.about-page li{font-size:1.12rem;line-height:1.65}
/* About page (owner redesign v2, 2026-11-12; column restructure
   the same day): a classic newspaper editorial page at the full
   .wrap width — section-style header, then alternating one- and
   two-column stretches built from explicit section blocks (never
   a CSS multi-column flow, so no section splits across columns):
   a full-width intro, a two-column grid stretch of whole
   sections, the mission statement full width in bold italic, a
   full-width independence section, a centered pull-quote, and a
   closing two-column band under its own double rule. No boxes or
   cards. Every rule is scoped to .about-page; the other static
   pages keep the narrow .static-page column above. */
.about-head .about-tagline{margin:.3rem 0 0}
.about-intro{margin-top:1.4rem}
.about-intro p,.about-section p{margin:0 0 1em}
.about-grid{display:grid;grid-template-columns:1fr}
.about-mission p{font-weight:bold;font-style:italic}
.about-dropcap::first-letter{font-family:var(--font-headline);font-weight:700;font-size:3.3em;float:left;line-height:.82;padding:.05em .14em 0 0}
.static-page.about-page .about-section h2,.static-page.about-page .about-closing h2{font-family:var(--font-ui);color:var(--color-red);font-size:1rem;font-weight:bold;letter-spacing:.13em;text-transform:uppercase;line-height:1.4;border-bottom:1px solid var(--color-border);padding-bottom:.45rem;margin:1.8em 0 .85em;break-after:avoid}
.about-standards{list-style:none;margin:0 0 1em;padding:0}
.static-page.about-page .about-standards li{border-top:1px solid var(--color-border);padding:.6rem 0;margin:0}
.static-page.about-page .about-standards li:first-child{border-top:0;padding-top:.1rem}
.about-pullquote{text-align:center;font-family:var(--font-headline);font-style:italic;font-size:1.75rem;line-height:1.35;color:var(--color-navy);border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);padding:1.5rem 2rem;margin:2.2rem 0 0}
.about-social{margin:.5rem 0 0;padding-left:1.25rem}
.about-social li{margin:.35rem 0}
.about-closing{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:2.6rem;margin-top:2.8rem;border-top:1px solid var(--color-text);padding-top:1.7rem}
.about-closing::before{content:"";position:absolute;left:0;right:0;top:-7px;border-top:3px solid var(--color-text)}
.about-closing p{margin:0 0 1em}
.static-page.about-page .about-closing h2{margin-top:0}
@media (min-width:900px){
.about-grid{grid-template-columns:1fr 1fr}
.about-s-produced{grid-column:1;grid-row:1/span 2;padding-right:1.3rem}
.about-s-statewide{grid-column:2;grid-row:1;border-left:1px solid var(--color-border);padding-left:1.3rem}
.about-s-news{grid-column:2;grid-row:2;border-left:1px solid var(--color-border);padding-left:1.3rem}
.static-page.about-page .about-grid .about-section h2{margin-top:0}
}
@media (max-width:900px){
.about-closing{grid-template-columns:1fr;gap:.4rem}
}
@media (max-width:767px){

.about-pullquote{font-size:1.35rem;padding:1.1rem .4rem}
}
/* ---------- Footer ---------- */
footer{background:#fff;color:#3d3d3d;border-top:4px double var(--color-text);font-family:var(--font-body);font-size:.92rem;margin-top:2rem;position:relative}
footer::before{content:"";position:absolute;top:-8px;left:0;right:0;height:1px;background:var(--color-gold)}
.footer-inner{max-width:1200px;margin:0 auto;padding:32px 24px 8px}
.footer-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr 1.3fr;gap:1.8rem}
.footer-brand img{display:block;max-width:285px;width:100%;height:auto}
.footer-brand p{margin:.7rem 0 0;color:#555;font-size:.9rem}
.footer-col h3{color:var(--color-red);font-family:var(--font-ui);font-size:.82rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:.1rem 0 .6rem}
.footer-col ul{list-style:none;margin:0;padding:0}
.footer-col li{margin:.28rem 0}
.footer-col a{text-decoration:none}
.footer-col a:hover{text-decoration:underline}
.footer-col{border-left:1px solid rgba(170,133,72,.4);padding-left:1.2rem}
.footer-col:first-child{border-left:0;padding-left:0}
.footer-ornament{display:block;width:110px;max-width:100%;height:auto;margin-top:.9rem;margin-bottom:.5rem}
.footer-stay-text{font-style:italic;margin:.2rem 0 .8rem;color:#333}
.btn-signup{display:inline-block;border:1.5px solid var(--color-red);color:var(--color-red);text-decoration:none;font-family:var(--font-ui);font-weight:bold;font-size:.9rem;padding:.45rem 1.1rem;background:#fff}
.btn-signup:hover{background:var(--color-red);color:#fff}
.footer-bar{background:var(--color-navy);color:#e8e4d8;margin-top:1.2rem}
.footer-bar-inner{max-width:1200px;margin:0 auto;padding:.65rem 24px;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;font-family:var(--font-ui);font-size:.8rem}
.footer-bar a{color:#e8e4d8;text-decoration:none}
.footer-bar a:hover{text-decoration:underline}
@media (max-width:900px){
  .footer-grid{grid-template-columns:1fr 1fr}
  .footer-col{border-left:0;padding-left:0}
}
@media (max-width:767px){
  .footer-grid{grid-template-columns:1fr}
  .footer-inner{padding-left:16px;padding-right:16px}
  .footer-bar-inner{padding-left:16px;padding-right:16px}
}
/* Newsletter signup and preference center (2026-11-12): built on the
   .briefing panel language, minimal additions in the same style. */
.nl-module .briefing-title{font-size:1.4rem}
.nl-panel{background:var(--color-ivory);border:1px solid var(--color-gold);padding:22px;max-width:760px;margin:1rem 0}
.nl-panel h2{font-family:var(--font-headline);font-size:1.3rem;margin:1.2rem 0 .5rem}
.nl-panel h2:first-of-type{margin-top:.4rem}
.nl-field{margin-bottom:1rem}
.nl-field label{display:block;font-family:var(--font-ui);font-weight:600;font-size:.92rem;margin-bottom:.35rem}
.nl-field input[type="email"],.nl-field input[type="text"]{width:100%;padding:.55rem;border:1px solid #b9b2a0;font-family:var(--font-body);font-size:1rem;background:#fff}
.nl-checks{display:grid;grid-template-columns:1fr 1fr;gap:.35rem .9rem;margin:.3rem 0 .6rem}
.nl-check{display:flex;gap:.5rem;align-items:flex-start;font-size:1rem;line-height:1.35}
.nl-check input{margin-top:.25rem}
.nl-radio{display:flex;gap:.5rem;align-items:flex-start;font-size:1rem;margin:.25rem 0}
.nl-radio input{margin-top:.25rem}
.nl-primary{display:block;width:100%;background:var(--color-red);color:#fff;border:0;padding:.6rem;font-family:var(--font-ui);font-size:1rem;font-weight:600;cursor:pointer}
.nl-primary:hover{background:#7d181e}
.nl-note-small{font-size:.9rem;color:#555;margin:.6rem 0 0}
.nl-notice{border:1px solid var(--color-gold);background:var(--color-ivory);padding:.8rem 1rem;margin:0 0 1rem;max-width:760px}
.nl-row{display:flex;gap:1rem}
.nl-row .nl-field{flex:1}
.nl-panel.nl-wide-panel{max-width:none}
.nl-notice.nl-wide-notice{max-width:none}
@media (max-width:767px){.nl-row{flex-direction:column;gap:0}}
.nl-danger{background:#fff;border:1.5px solid var(--color-red);color:var(--color-red);font-family:var(--font-ui);font-weight:600;padding:.5rem 1rem;cursor:pointer}
.nl-danger:hover{background:var(--color-red);color:#fff}
.footer-signup{display:flex;gap:.4rem;margin:.4rem 0 .2rem}
.footer-signup input{flex:1;min-width:0;padding:.45rem;border:1px solid #b9b2a0;font-family:var(--font-body);font-size:.95rem;background:#fff}
.footer-signup button{background:var(--color-red);color:#fff;border:0;padding:.45rem .8rem;font-family:var(--font-ui);font-weight:600;cursor:pointer}
.footer-pref-link{font-size:.88rem;margin:.3rem 0 0}
.admin-cards{display:flex;gap:.8rem;flex-wrap:wrap;margin:.8rem 0 1.2rem}
.admin-card{border:1px solid var(--color-border);background:var(--color-ivory);padding:.7rem 1rem;min-width:140px}
.admin-card .num{font-family:var(--font-headline);font-size:1.55rem;line-height:1.1}
.admin-card .lbl{font-family:var(--font-ui);font-size:.8rem;color:#555}
table.admin-table{border-collapse:collapse;width:100%;margin:.5rem 0 1.4rem}
.admin-table th,.admin-table td{border:1px solid var(--color-border);padding:.35rem .5rem;text-align:left;font-size:.92rem;vertical-align:top}
.admin-table th{font-family:var(--font-ui);background:var(--color-ivory)}
.admin-preview{border:1px solid var(--color-border);margin:.6rem 0 1rem;background:#fff}
.admin-section{margin:1.6rem 0}
@media (max-width:767px){
  .nl-checks{grid-template-columns:1fr}
  .nl-panel{padding:16px}
}
/* Subscribe-button unification, placed at the very end of the sheet
   so it governs over the per-component rules above (owner order,
   2026-11-27): every subscribe button — topbar, signup outline,
   briefing box, footer form, newsletter panels — shares the same
   font treatment and padding. Colors and borders stay as designed. */
.btn-subscribe,.btn-signup,.briefing button,.footer-signup button,.nl-primary{font-family:var(--font-ui);font-weight:700;font-size:.85rem;padding:.5rem 1rem}
/* The topbar Subscribe button takes the BREAKING chip's font and
   padding treatment exactly (owner order, 2026-11-27), keeping its
   own red/white colors and its rounded corners (border-radius from
   its base rule above is untouched). */
.btn-subscribe{font-family:var(--font-bar);font-weight:800;font-size:12.5px;letter-spacing:.1em;line-height:1.25;padding:.31rem .6rem .17rem calc(.6rem + .1em)}
`;

function layout({ title, description, path, ogType = 'website', ogImage = '', articleMeta = null, jsonLd = [], activeNav = '', body }) {
  const canonical = absUrl(path);
  const articleTags = articleMeta
    ? '<meta property="article:published_time" content="' + esc(articleMeta.published) + '">\n' +
      '<meta property="article:modified_time" content="' + esc(articleMeta.modified) + '">\n' +
      '<meta property="article:section" content="' + esc(articleMeta.section) + '">\n'
    : '';
  const ld = jsonLd.length
    ? '<script type="application/ld+json">' +
      JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : { '@context': 'https://schema.org', '@graph': jsonLd }) +
      '</script>'
    : '';
  const adsense =
    '<meta name="google-adsense-account" content="' + esc(ADSENSE_CLIENT) + '">\n' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
    esc(ADSENSE_CLIENT) + '" crossorigin="anonymous"></script>';
  const chevronSvg =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const localDropdown =
    '<ul class="dropdown" id="local-submenu">' +
    REGIONS.map((r) => '<li><a href="/local/' + r.slug + '">' + r.name + '</a></li>').join('') +
    '</ul>';
  // Nav composition (owner orders, 2026-11-08): no Home link
  // (removed in the evening, superseding its same-day return);
  // Opinion is out (no longer public, see the store's read layer);
  // "How Colorado Works" — the series renamed from Colorado
  // Explained the same evening — joins the nav as a plain
  // left-justified link like the section links, after Local
  // (an earlier same-evening red button at the right was
  // corrected by the owner to match the other links).
  const navItems =
    SECTIONS.filter((s) => s.slug !== 'opinion').map((s) => {
      // Nav-only short label (owner instruction, 2026-11-08): the
      // Local section is labeled "Local" in the nav bar; its full
      // name "Local News" still stands everywhere else (footer,
      // page titles, kickers). Politics shows under its plain
      // section name (the nav-only "Colorado Politics" label was
      // retired the same evening).
      const label =
        s.slug === 'local' ? 'Local' : s.name;
      const link =
        '<a href="/section/' + s.slug + '"' +
        (activeNav === s.slug ? ' class="active"' : '') + '>' + label + '</a>';
      return s.slug === 'local'
        ? '<li class="has-dropdown">' + link +
          // Mobile only (hidden on desktop): a separate chevron
          // button toggles the regions submenu; the Local link
          // itself still navigates to the Local section page.
          '<button class="local-toggle" type="button" aria-expanded="false" aria-controls="local-submenu" aria-label="Show Local regions">' +
          chevronSvg + '</button>' + localDropdown + '</li>'
        : '<li>' + link + '</li>';
    }).join('') +
    // How Colorado Works: a plain nav link like the section
    // links (owner correction, 2026-11-08), left-justified with
    // them and highlighted on the series archive like a section
    // link on its section page.
    '<li><a href="/explained"' + (activeNav === 'explained' ? ' class="active"' : '') + '>How Colorado Works</a></li>' +
    // Search box at the right end of the nav row, as in dev: a GET
    // form on the existing /search route, which reads ?q=.
    '<li class="nav-search"><form class="nav-search-form" method="get" action="/search" role="search">' +
    '<input type="search" name="q" placeholder="Search..." aria-label="Search stories">' +
    '<button type="submit" aria-label="Search"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
    '</form></li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-K8M2GTSM4D"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-K8M2GTSM4D');
</script>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="UqshzzuCgZVhRdVyE8HdU96yZw1hMI8SbgJ8Ii1Tnuw">
<meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME)} — Latest Stories" href="${siteUrl()}/rss.xml">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${articleTags}${ogImage ? '<meta property="og:image" content="' + esc(ogImage) + '">\n' : ''}<meta name="twitter:card" content="summary_large_image">
${ogImage ? '<meta name="twitter:image" content="' + esc(ogImage) + '">\n' : ''}<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Playfair+Display:wght@600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,600;1,8..60,700&display=swap" rel="stylesheet">
<style>${CSS}</style>
${ld}
${adsense}
</head>
<body>
<div class="topbar">
  <span class="topbar-left">${esc(fmtDate(new Date().toISOString()).toUpperCase())} | ${topbarSegment()}</span>
  <span class="topbar-right"><a href="/signin">Sign In</a><a class="btn-subscribe" href="/subscribe">Subscribe</a></span>
</div>
${tickerHtml()}
<header class="masthead">
  <!-- Masthead banner: the owner's supplied artwork — the engraved
       lettering flanked by both mountain engravings in a single
       image (WebP with a PNG fallback), centered on white. Below
       it, the tagline flanked by short gold rules. -->
  <div class="masthead-banner"><a href="/" aria-label="${SITE_NAME}"><picture><source srcset="/masthead-banner.webp" type="image/webp"><img src="/masthead-banner.png" alt="The Centennial Ledger" width="990" height="101"></picture></a></div>
  <div class="tagline">${TAGLINE}</div>
</header>
<nav class="main"><button class="nav-toggle" type="button" aria-expanded="false" aria-controls="main-nav-list">Menu <svg class="nav-toggle-caret" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button><ul class="nav-list" id="main-nav-list">${navItems}</ul></nav>
<main class="wrap">
${body}
</main>
<footer>
  <div class="footer-inner">
    <div class="footer-grid">
      <div class="footer-col footer-brand">
        <a href="/" aria-label="The Centennial Ledger: back to the front page"><picture><source srcset="/footer-logo-v2.webp" type="image/webp"><img src="/footer-logo-v2.png" alt="The Centennial Ledger" width="285" height="117"></picture></a>
        <p>Covering Colorado’s Capitol and all 64 counties. Independent and unaffiliated with any party or campaign. Articles are produced with AI-assisted tools under human editorial review, with sources linked on every story.</p>
      </div>
      <nav class="footer-col" aria-label="Sections">
        <h3>Sections</h3>
        <ul>
          <li><a href="/section/politics">Politics</a></li>
          <li><a href="/section/business">Business &amp; Taxes</a></li>
          <li><a href="/section/energy-environment">Energy &amp; Environment</a></li>
          <li><a href="/section/education-health">Education &amp; Health</a></li>
          <li><a href="/section/local">Local News</a></li>
          <li><a href="/section/opinion">Opinion &amp; Satire</a></li>
          <li><a href="/podcast">Podcast</a></li>
          <li><a href="/about">About Us</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Colorado regions">
        <h3>Colorado Regions</h3>
        <ul>
          ${REGIONS.map((r) => '<li><a href="/local/' + r.slug + '">' + r.name + '</a></li>').join('')}
        </ul>
      </nav>
      <div class="footer-col">
        <h3>Social</h3>
        <ul>
          <li><a href="https://www.facebook.com/profile.php?id=61595978079628" target="_blank" rel="noopener">Facebook</a></li>
          <li><a href="https://www.instagram.com/centennialledger" target="_blank" rel="noopener">Instagram</a></li>
          <li><a href="https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX" target="_blank" rel="noopener">Spotify</a></li>
          <li><a href="https://www.pandora.com/podcast/colorado-daily-news-brief/PC:1001124564" target="_blank" rel="noopener">Pandora</a></li>
          <li><a href="/rss.xml">RSS Feed</a></li>
        </ul>
        <p class="footer-stay-text">Sign up for your free daily newsletter.</p>
        <form class="footer-signup" method="post" action="/briefing">
          <input type="hidden" name="source" value="footer">
          <input type="email" name="email" required placeholder="Your email address" aria-label="Email address">
          <button type="submit">Subscribe</button>
        </form>
      </div>
    </div>
  </div>
  <div class="footer-bar">
    <div class="footer-bar-inner">
      <span><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Use</a> | <a href="/editorial-standards">Editorial Standards</a></span>
      <span>&copy; ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.</span>
    </div>
  </div>
</footer>
${NAV_SCRIPT}
${SAVE_SCRIPT}${SHARE_SCRIPT}
</body>
</html>`;
}

/** Reading time in whole minutes, from the story's own text. */
function readTimeMinutes(a) {
  let words = 0;
  const count = (s) => {
    if (s) words += String(s).trim().split(/\s+/).filter(Boolean).length;
  };
  if (a) {
    count(a.dek);
    count(a.whyItMatters);
    for (const s of a.sections || []) {
      count(s.lead);
      for (const p of s.paragraphs || []) count(p);
    }
  }
  return Math.max(1, Math.round(words / 200));
}

/**
 * Story card, one dress everywhere (homepage groups, section grids,
 * More-in grids, search results): 16:9 plate thumbnail, the red
 * uppercase category label, headline, date and read time. No byline
 * and no source line on cards — those live on the article page
 * (owner's standing rule). No image caption on cards either
 * (captions live on article pages and homepage features), and the
 * thumbnail links to the article.
 */
function articleCard(a, opts = {}) {
  return (
    '<div class="card">' +
    articleFigure(a, '', { noCaption: true, link: true, width: 600 }) +
    // No red kicker above card headlines on section pages (owner
    // order, 2026-11-08): callers there pass { kicker: false }.
    (opts.kicker === false
      ? ''
      : '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) + '</div>') +
    '<h3><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    '<div class="meta">' + esc(fmtMetaDate(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>' +
    '</div>'
  );
}

/**
 * The number of sources actually stored on an article: the length
 * of its stored sources list, falling back to the single primary
 * source (sourceName/sourceUrl) when no list is stored. Reported
 * truthfully — it is never dressed up.
 */
function sourceCount(a) {
  if (!a) return 0;
  if (Array.isArray(a.sources) && a.sources.length) return a.sources.length;
  return a.sourceUrl || a.sourceName ? 1 : 0;
}

/**
 * The Colorado Briefing signup box (redesign spec 3.7): ivory panel
 * with a thin gold border — red-caps kicker, big serif title, one
 * short italic line, a full-width email field and Subscribe button,
 * and the Monday-Friday note. No roundup paragraph: the panel
 * carries only the brief newsletter description and the form.
 */
/** Short card excerpt for the homepage Latest row: the dek, or the
 *  opening section's lead when there is no dek, trimmed at a word
 *  boundary with an ellipsis when it runs long. */
function cardExcerpt(a) {
  let t = String((a && a.dek) || '').replace(/\s+/g, ' ').trim();
  if (!t && a && Array.isArray(a.sections) && a.sections[0]) {
    t = String(a.sections[0].lead || '').replace(/\s+/g, ' ').trim();
  }
  if (t.length <= 170) return t;
  const cut = t.slice(0, 170);
  const ls = cut.lastIndexOf(' ');
  return (ls > 60 ? cut.slice(0, ls) : cut).trim() + '...';
}

/**
 * Card for the homepage "Latest from Colorado" row: framed plate on
 * top, the red uppercase category label, serif headline, a short
 * excerpt, and muted publication metadata (date and read time). No
 * byline or source line.
 */
function latestCard(a) {
  const excerpt = cardExcerpt(a);
  return (
    '<div class="latest-card">' +
    articleFigure(a, '', { noCaption: true, link: true, width: 600 }) +
    '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<h3><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    (excerpt ? '<p>' + inline(excerpt) + '</p>' : '') +
    '<div class="meta">' + esc(fmtMetaDate(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>' +
    '</div>'
  );
}

function briefingBox(thanks, source) {
  return (
    '<section class="briefing">' +
    '<div class="briefing-kicker">Free Weekday Newsletter</div>' +
    '<p class="briefing-tag">The day\'s top Colorado stories, in your inbox before the workday starts.</p>' +
    (thanks
      ? '<p><strong>Thank you. Please check your inbox to confirm your subscription.</strong></p>'
      : '<div class="briefing-cta"><a class="btn-read" href="/subscribe">Subscribe</a></div>') +
    '</section>'
  );
}

const PODCAST_SPOTIFY_URL = 'https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX';
const PODCAST_PANDORA_URL = 'https://www.pandora.com/podcast/colorado-daily-news-brief/PC:1001124564';
const PODCAST_FALLBACK_LINE =
  "Colorado's top stories, weather and sports — a new episode every weekday morning by 6 a.m.";

/**
 * Podcast box at the top of the homepage rail (owner request,
 * 2026-11-12), in the newsletter box's dress: the show name,
 * what's on the newest episode of the Colorado Daily News Brief
 * (title, date and a plain-text excerpt of its notes, from the
 * show's RSS feed via src/podcast.js), the show artwork, and a
 * Listen on Spotify button. When the feed has not loaded yet (or
 * is down) the box renders a standing line instead — same box,
 * same link — so the rail never waits on the podcast feed.
 */
function podcastBox(episode, briefDates) {
  /* Kicker (owner rule, 2026-11-12): "TODAY'S PODCAST" only while
   * the box's episode is today's (Denver date); "LATEST PODCAST"
   * on Sundays, in the morning before the day's episode lands,
   * and whenever the box is showing its fallback copy. */
  const epDate = episode && episode.publishedAt ? fmtMetaDate(episode.publishedAt) : '';
  const kicker =
    epDate && epDate === fmtMetaDate(new Date().toISOString())
      ? 'TODAY\'S PODCAST'
      : 'LATEST PODCAST';
  /* Link targets (owner order, 2026-11-20): the ONLY things in
   * the box that link to Spotify are the artwork at the top and
   * the Listen on Spotify button. Each headline links to that
   * story's anchor on the episode's own podcast page
   * (/podcast/YYYY-MM-DD#story-N, stories in the same order on
   * both). briefDates carries the dates that have a companion
   * page; an episode without one links its headlines and its
   * read line to the /podcast archive instead of a page that
   * does not exist. A Saturday history episode carries no story
   * rundown; the box shows its description's summary paragraph
   * as a blurb (owner request, 2026-11-21), linked to the same
   * page target. */
  const epYmd = episode && episode.publishedAt ? fmtDenverYmd(episode.publishedAt) : '';
  const hasPage = !!(epYmd && briefDates && briefDates.has(epYmd));
  const pageUrl = hasPage ? '/podcast/' + epYmd : '/podcast';
  let inner =
    '<div class="briefing-kicker">' + kicker + '</div>';
  if (episode && episode.title) {
    if (episode.image) {
      inner +=
        '<a href="' + PODCAST_SPOTIFY_URL + '" target="_blank" rel="noopener">' +
        '<img class="podcast-art" src="' + esc(episode.image) +
        '" alt="Colorado Daily News Brief podcast artwork" loading="lazy"></a>';
    }
    inner +=
      (episode.publishedAt
        ? '<p class="podcast-date">' + esc(fmtMetaDate(episode.publishedAt)) + '</p>'
        : '') +
      (episode.blurb
        ? /* Episode title above the description (owner order,
           * 2026-11-21). Only the history layout has a real episode
           * title to show: weekday feed titles are just the date,
           * which the date line above already carries. */
          '<p class="podcast-ep-title"><a href="' + pageUrl + '">' +
          esc(episode.title) + '</a></p>' +
          '<p class="podcast-blurb"><a href="' + pageUrl + '">' +
          esc(episode.blurb) + '</a></p>'
        : episode.titles && episode.titles.length
        ? '<ul class="podcast-titles">' +
          episode.titles
            .map(
              (t, i) =>
                '<li><a href="' + pageUrl +
                (hasPage ? '#story-' + (i + 1) : '') +
                '">' + esc(t) + '</a></li>'
            )
            .join('') +
          '</ul>'
        : '');
  } else {
    inner += '<p class="briefing-tag">' + esc(PODCAST_FALLBACK_LINE) + '</p>';
  }
  /* Listen button in the Read More buttons' dress (owner order,
   * 2026-11-20): the same .btn-read formatting as the homepage
   * features' read buttons, centered in the box. */
  inner +=
    '<div class="podcast-listen-wrap"><a class="btn-read" href="' + PODCAST_SPOTIFY_URL +
    '" target="_blank" rel="noopener">Listen on Spotify</a>' +
    '<a class="btn-read" href="' + PODCAST_PANDORA_URL +
    '" target="_blank" rel="noopener">Listen on Pandora</a></div>';
  /* Companion story page link (owner order, 2026-11-20): the box
   * is how site readers reach the episode's page of stories with
   * sources at /podcast/YYYY-MM-DD; under it, a link to the
   * podcast archive at /podcast, which lists every past
   * episode's page. When the episode has no page of its own, the
   * read line itself points at the archive (same wording as the
   * fallback state) and no separate archive link is stacked
   * under it. */
  if (hasPage) {
    inner +=
      '<a class="podcast-read" href="' + pageUrl +
      '">Read this episode&rsquo;s stories, with sources</a>' +
      '<a class="podcast-read" href="/podcast">Podcast archive &mdash; all past episodes</a>';
  } else {
    inner +=
      '<a class="podcast-read" href="/podcast">Read the episodes&rsquo; stories, with sources</a>';
  }
  return '<section class="briefing podcast-box">' + inner + '</section>';
}

/**
 * Compact contextual signup module: an email field plus hidden
 * topic/region preselections, posting to /subscribe-quick. Used at
 * the end of articles and on section and region pages. After the
 * reader confirms from their inbox they can adjust everything in
 * the preference center, so skipping customization never blocks
 * the signup.
 */
function signupModule({ heading, text, source, topic, region, returnTo }) {
  return (
    '<section class="briefing nl-module">' +
    '<div class="briefing-kicker">Newsletter</div>' +
    '<h2 class="briefing-title">' + esc(heading) + '</h2>' +
    '<p class="briefing-tag">' + esc(text) + '</p>' +
    '<form method="post" action="/subscribe-quick">' +
    '<input type="hidden" name="source" value="' + esc(source || 'module') + '">' +
    (topic ? '<input type="hidden" name="topics" value="' + esc(topic) + '">' : '') +
    (region ? '<input type="hidden" name="regions" value="' + esc(region) + '">' : '') +
    (returnTo ? '<input type="hidden" name="return" value="' + esc(returnTo) + '">' : '') +
    '<input type="email" name="email" required placeholder="Your email address" aria-label="Email address">' +
    '<button type="submit">Subscribe for Free</button></form>' +
    '<p class="briefing-note">Free to subscribe. No spam. Unsubscribe or change your preferences anytime.</p>' +
    '</section>'
  );
}

/** Checkbox grid of the site's topics (its sections), for forms. */
function topicCheckboxes(selected) {
  const sel = new Set(selected || []);
  return (
    '<div class="nl-checks">' +
    SECTIONS.map(
      (s) =>
        '<label class="nl-check"><input type="checkbox" name="topics" value="' +
        esc(s.slug) +
        '"' +
        (sel.has(s.slug) ? ' checked' : '') +
        '> <span>' +
        esc(s.name) +
        '</span></label>'
    ).join('') +
    '</div>'
  );
}

/** Checkbox grid of the site's regions, for forms. */
function regionCheckboxes(selected) {
  const sel = new Set(selected || []);
  return (
    '<div class="nl-checks">' +
    REGIONS.map(
      (r) =>
        '<label class="nl-check"><input type="checkbox" name="regions" value="' +
        esc(r.slug) +
        '"' +
        (sel.has(r.slug) ? ' checked' : '') +
        '> <span>' +
        esc(r.name) +
        '</span></label>'
    ).join('') +
    '</div>'
  );
}

/**
 * Inline script for the mobile navigation (design addendum 3):
 * vanilla, no dependencies. The menu toggle opens and closes the
 * nav list; the Local chevron button toggles the regions submenu
 * as an explicit open/closed state on the list item, mirrored in
 * aria-expanded. Opening the menu never auto-expands Local, and
 * closing the menu resets the submenu to collapsed; a fresh page
 * load always starts collapsed.
 */
const NAV_SCRIPT =
  '<script>(function(){' +
  'var nav=document.querySelector("nav.main");' +
  'if(!nav)return;' +
  'var toggle=nav.querySelector(".nav-toggle");' +
  'var localItem=nav.querySelector("li.has-dropdown");' +
  'var localBtn=nav.querySelector(".local-toggle");' +
  'function setLocal(open){' +
  'if(!localItem||!localBtn)return;' +
  'localItem.classList.toggle("submenu-open",open);' +
  'localBtn.setAttribute("aria-expanded",open?"true":"false");}' +
  'if(toggle){toggle.addEventListener("click",function(){' +
  'var open=nav.classList.toggle("nav-open");' +
  'toggle.setAttribute("aria-expanded",open?"true":"false");' +
  'if(!open)setLocal(false);});}' +
  'if(localBtn&&localItem){localBtn.addEventListener("click",function(){' +
  'setLocal(!localItem.classList.contains("submenu-open"));});}' +
  '})();</script>';

/**
 * Inline script for the homepage features' Save buttons: a per-slug
 * flag in localStorage ("cl-saved:<slug>"), no accounts involved.
 * The button label and pressed state reflect the stored flag on
 * load and after every click.
 */
const SAVE_SCRIPT =
  '<script>(function(){' +
  'var KEY="cl-saved:";' +
  'function paint(b){var s=false;try{s=!!localStorage.getItem(KEY+b.getAttribute("data-save-slug"));}catch(e){}' +
  'b.classList.toggle("saved",s);b.setAttribute("aria-pressed",s?"true":"false");' +
  'b.textContent=s?"📌 Saved":"📌 Save";}' +
  'var bs=document.querySelectorAll("[data-save-slug]");' +
  'for(var i=0;i<bs.length;i++){(function(b){paint(b);' +
  'b.addEventListener("click",function(){var slug=b.getAttribute("data-save-slug");' +
  'try{if(localStorage.getItem(KEY+slug)){localStorage.removeItem(KEY+slug);}else{localStorage.setItem(KEY+slug,"1");}}catch(e){}' +
  'paint(b);});})(bs[i]);}' +
  '})();</script>';

/**
 * Share control rendered beside every Save button (owner
 * instruction, 2026-11-03): a Share button opening a small menu
 * with the usual destinations — Facebook and X share links,
 * WhatsApp, Email, Instagram and Copy link. Instagram offers no
 * web share link, so its entry copies the article URL and tells
 * the reader to paste it into Instagram. The menu's behavior
 * (open/close, copy) lives in SHARE_SCRIPT.
 */
function shareControl(a) {
  const url = absUrl('/article/' + a.slug);
  const eu = encodeURIComponent(url);
  const et = encodeURIComponent(a.headline || '');
  return (
    '<span class="share-wrap">' +
    '<button type="button" class="btn-share" aria-haspopup="true" aria-expanded="false">🔗 Share</button>' +
    '<span class="share-menu" role="menu" hidden>' +
    '<a role="menuitem" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' +
    eu + '">Facebook</a>' +
    '<a role="menuitem" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?url=' +
    eu + '&text=' + et + '">X</a>' +
    '<a role="menuitem" target="_blank" rel="noopener" href="https://wa.me/?text=' +
    et + '%20' + eu + '">WhatsApp</a>' +
    '<a role="menuitem" href="mailto:?subject=' + et + '&body=' + eu + '">Email</a>' +
    '<button type="button" role="menuitem" class="share-copy" data-copy-url="' + esc(url) +
    '" data-copy-label="Instagram">Instagram</button>' +
    '<button type="button" role="menuitem" class="share-copy" data-copy-url="' + esc(url) +
    '" data-copy-label="Copy link">Copy link</button>' +
    '</span></span>'
  );
}

/**
 * Inline script for the Share controls: toggling one menu closes
 * the others, a click anywhere else or Escape closes them, share
 * links close the menu as they open, and the copy entries write
 * the article URL to the clipboard with a brief confirmation
 * label (the Instagram entry explains the paste step).
 */
const SHARE_SCRIPT =
  '<script>(function(){' +
  'var wraps=document.querySelectorAll(".share-wrap");' +
  'function closeAll(){for(var i=0;i<wraps.length;i++){var m=wraps[i].querySelector(".share-menu");if(m)m.hidden=true;var b=wraps[i].querySelector(".btn-share");if(b)b.setAttribute("aria-expanded","false");}}' +
  'for(var i=0;i<wraps.length;i++){(function(w){' +
  'var btn=w.querySelector(".btn-share"),menu=w.querySelector(".share-menu");' +
  'if(!btn||!menu)return;' +
  'btn.addEventListener("click",function(e){e.stopPropagation();var open=menu.hidden;closeAll();menu.hidden=!open;btn.setAttribute("aria-expanded",open?"true":"false");});' +
  'menu.addEventListener("click",function(e){e.stopPropagation();if(e.target.tagName==="A")closeAll();});' +
  'var cps=menu.querySelectorAll(".share-copy");' +
  'for(var k=0;k<cps.length;k++){(function(cp){cp.addEventListener("click",function(){' +
  'var url=cp.getAttribute("data-copy-url"),orig=cp.getAttribute("data-copy-label");' +
  'function done(){cp.textContent=orig==="Instagram"?"Copied — paste it in Instagram":"✓ Link copied";setTimeout(function(){cp.textContent=orig;closeAll();},1600);}' +
  'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done,done);}' +
  'else{var ta=document.createElement("textarea");ta.value=url;document.body.appendChild(ta);ta.select();try{document.execCommand("copy");}catch(err){}document.body.removeChild(ta);done();}' +
  '});})(cps[k]);}' +
  '})(wraps[i]);}' +
  'document.addEventListener("click",function(){closeAll();});' +
  'document.addEventListener("keydown",function(e){if(e.key==="Escape")closeAll();});' +
  '})();</script>';

/** Gold filigree divider: an empty div whose CSS background is
 * the section-break art at natural size (see .feature-divider). */
function featureDivider() {
  return '<div class="feature-divider" aria-hidden="true"></div>';
}

/** One-day Broncos win banner (owner order, 2026-11-22): emitted only
 * until 2026-11-24T01:15:00Z — 24 hours from placement — then the
 * homepage returns to normal with no further deploy. */
function broncosWinBanner() {
  if (Date.now() >= Date.parse('2026-11-24T01:15:00Z')) return '';
  return '<div class="win-banner"><picture>' +
    '<source srcset="/broncos-win-v5.webp" type="image/webp">' +
    '<img src="/broncos-win-v5.png" alt="Broncos & Nuggets Win! Engraving of a celebrating Bronco and the Nuggets mountain lion over the Denver skyline" width="2118" height="599">' +
    '</picture></div>' + featureDivider();
}

/** Broncos win at Pittsburgh, Fri 2026-11-27 (owner order, 2026-11-24):
 * the "Broncos Win!" Steelers woodcut runs in the hero position from
 * the win through all of Saturday Nov 28 — but only if Denver actually
 * won. BRONCOS_STEELERS_WIN stays false until the post-game check
 * confirms the final score and flips it; the Denver-date gate then
 * keeps it up through Saturday and takes it down on Sunday. While it
 * runs it replaces the seasonal banner in the hero slot. */
const BRONCOS_STEELERS_WIN = false;
function broncosSteelersWinBanner() {
  if (!BRONCOS_STEELERS_WIN) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pv = {};
  for (const p of parts) pv[p.type] = p.value;
  const day = pv.year + '-' + pv.month + '-' + pv.day;
  if (day !== '2026-11-27' && day !== '2026-11-28') return '';
  return '<div class="win-banner"><picture>' +
    '<source srcset="/broncos-win-steelers-2026.webp" type="image/webp">' +
    '<img src="/broncos-win-steelers-2026.png" alt="Broncos Win! Engraving of the Bronco celebrating over a fallen Pittsburgh Steeler" width="1760" height="598">' +
    '</picture></div>' + featureDivider();
}

/** Seasonal hero banners (owner order, 2026-11-24): owner-supplied Bronco
 * engravings shown above the top headline on set Denver dates, each
 * removing itself when its window ends — Thanksgiving Day (Nov 26),
 * skiing Fri–Sun Nov 27–29, Christmas Dec 21–25, New Year Dec 31–Jan 1. */
function seasonalHeroBanner() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pv = {};
  for (const p of parts) pv[p.type] = p.value;
  const day = pv.year + '-' + pv.month + '-' + pv.day;
  let file = null, alt = '', w = 0, h = 0;
  if (day === '2026-11-26') {
    file = 'hero-thanksgiving-2026'; w = 1854; h = 712;
    alt = 'A Bronco napping on the couch after Thanksgiving dinner, engraving';
  } else if (day >= '2026-11-27' && day <= '2026-11-29') {
    file = 'hero-skiing-2026'; w = 1929; h = 764;
    alt = 'A Bronco skiing down a Colorado mountain slope, engraving';
  } else if (day >= '2026-12-21' && day <= '2026-12-25') {
    file = 'hero-christmas-2026'; w = 1568; h = 724;
    alt = 'A Bronco opening a Christmas gift — a Broncos jersey — on the couch, engraving';
  } else if (day === '2026-12-31' || day === '2027-01-01') {
    file = 'hero-newyear-2026'; w = 1796; h = 704;
    alt = 'A Bronco in a 2027 top hat toasting the New Year with champagne under fireworks, engraving';
  }
  if (!file) return '';
  return '<div class="win-banner"><picture>' +
    '<source srcset="/' + file + '.webp" type="image/webp">' +
    '<img src="/' + file + '.png" alt="' + alt + '" width="' + w + '" height="' + h + '">' +
    '</picture></div>' + featureDivider();
}

/** Colorado event hero banners (owner order, 2026-11-24): sixteen
 * owner-supplied event banners, each shown in the hero position from
 * 7 days before its event starts through the event's last day
 * (Denver dates). When one event's lead-in week overlaps another
 * event, the overlapping banners alternate days (owner order,
 * 2026-11-24): the banners whose windows are open rotate one per
 * day in event-start order. A one-day event always takes its own
 * day. Dates below are the ones printed on each banner. Every
 * banner links through to its event's official website (owner
 * order, 2026-11-24: "Link all banners"). Two official sites would
 * not load from this server and were pointed at the organizer's
 * working official page instead: Steamboat Winter Carnival →
 * sswsc.org (the host club; wintercarnivalsteamboat.com unreachable
 * here) and the March Powwow → denvermarchpowwow.com (the .org
 * would not load; the org runs both). */
const EVENT_HEROES = [
  { file: 'event-stock-show-2027', start: '2027-01-09', end: '2027-01-24', w: 2804, h: 561, url: 'https://nationalwestern.com/', alt: 'National Western Stock Show, Denver, January 9–24, 2027 — engraving of the Bronco leading a prize steer' },
  { file: 'event-sundance-2027', start: '2027-01-21', end: '2027-01-31', w: 2804, h: 561, url: 'https://festival.sundance.org/', alt: 'Sundance Film Festival, Boulder, January 21–31, 2027 — engraving of the Bronco with a film camera' },
  { file: 'event-ouray-ice-2027', start: '2027-01-28', end: '2027-01-31', w: 2804, h: 561, url: 'https://ourayicepark.com/', alt: 'Ouray Ice Festival, January 28–31, 2027 — engraving of the Bronco ice climbing' },
  { file: 'event-snowdown-2027', start: '2027-01-29', end: '2027-02-07', w: 2137, h: 451, url: 'https://snowdown.org/', alt: 'Snowdown, Durango, January 29–February 7 — engraving of the Bronco with a snowflake flag' },
  { file: 'event-steamboat-carnival-2027', start: '2027-02-02', end: '2027-02-07', w: 2804, h: 561, url: 'https://www.sswsc.org/', alt: 'Steamboat Winter Carnival, Steamboat Springs, February 2–7 — engraving of the Bronco skiing' },
  { file: 'event-bluegrass-2027', start: '2027-02-12', end: '2027-02-13', w: 2132, h: 458, url: 'https://midwinterbluegrass.com/', alt: 'Midwinter Bluegrass Festival, February 12–13 — engraving of the Bronco playing the banjo' },
  { file: 'event-palm-tree-2027', start: '2027-02-19', end: '2027-02-20', w: 2804, h: 561, url: 'https://palmtreemusicfestival.com/aspen/', alt: 'Palm Tree Festival, Aspen, February 19–20 — engraving of the Bronco playing guitar' },
  { file: 'event-mardi-gras-2027', start: '2027-02-27', end: '2027-02-27', w: 2146, h: 453, url: 'https://denvermardigras.com/', alt: 'Denver Mardi Gras, Greenwood Village, February 27 — engraving of the Bronco with beads and a mask' },
  { file: 'event-restaurant-week-2027', start: '2027-03-05', end: '2027-03-14', w: 2172, h: 724, url: 'https://denverrestaurantweek.com/', alt: 'Denver Restaurant Week, March 5–14 — engraving of the Bronco as a chef' },
  { file: 'event-st-patricks-2027', start: '2027-03-13', end: '2027-03-13', w: 2172, h: 724, url: 'https://denverstpatricksdayparade.com/', alt: "Denver St. Patrick's Day Parade, March 13 — engraving of the Bronco marching in the parade" },
  { file: 'event-march-powwow-2027', start: '2027-03-19', end: '2027-03-21', w: 2172, h: 724, url: 'https://denvermarchpowwow.com/', alt: 'Denver March Powwow, March 19–21 — engraving of powwow dancers' },
  { file: 'event-frozen-dead-guy-2027', start: '2027-04-09', end: '2027-04-11', w: 2077, h: 676, url: 'https://frozendeadguydays.com/', alt: 'Frozen Dead Guy Days, Estes Park, April 9–11, 2027 — engraving of the Bronco beside the frozen dead guy' },
  { file: 'event-biff-2027', start: '2027-04-08', end: '2027-04-11', w: 2761, h: 547, url: 'https://biff1.com/', alt: 'Boulder International Film Festival, April 8–11, 2027 — engraving of the Bronco with a film reel' },
  { file: 'event-durango-meltdown-2027', start: '2027-04-16', end: '2027-04-18', w: 2670, h: 545, url: 'https://durangomeltdown.com/', alt: 'Durango Bluegrass Meltdown, April 16–18, 2027 — engraving of the Bronco playing the fiddle' },
  { file: 'event-bigfoot-days-2027', start: '2027-04-23', end: '2027-04-24', w: 2644, h: 550, url: 'https://eventsinestes.com/bigfoot-days/', alt: 'Bigfoot Days Festival, Bond Park in Estes Park, April 23–24, 2027 — engraving of the Bronco meeting Bigfoot' },
  { file: 'event-focomx-2027', start: '2027-04-30', end: '2027-05-01', w: 2804, h: 561, url: 'https://focoma.org/focomx', alt: 'FoCoMX, Fort Collins, April 30–May 1, 2027 — engraving of the Bronco singing with a guitar' },
];
function heroWindowStart(startIso) {
  const d = new Date(startIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
function eventHeroBanner() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pv = {};
  for (const p of parts) pv[p.type] = p.value;
  const day = pv.year + '-' + pv.month + '-' + pv.day;
  const open = EVENT_HEROES.filter((e) => day >= heroWindowStart(e.start) && day <= e.end);
  if (!open.length) return '';
  open.sort((a, b) => a.start.localeCompare(b.start));
  let pick = open.find((e) => e.start === e.end && e.start === day);
  if (!pick) {
    const dayStart = new Date(day + 'T12:00:00Z');
    const yearStart = new Date(pv.year + '-01-01T12:00:00Z');
    const dayOfYear = Math.round((dayStart - yearStart) / 86400000) + 1;
    pick = open[dayOfYear % open.length];
  }
  const pic = '<picture>' +
    '<source srcset="/' + pick.file + '.webp" type="image/webp">' +
    '<img src="/' + pick.file + '.png" alt="' + esc(pick.alt) + '" width="' + pick.w + '" height="' + pick.h + '">' +
    '</picture>';
  const inner = pick.url
    ? '<a href="' + pick.url + '" target="_blank" rel="noopener">' + pic + '</a>'
    : pic;
  return '<div class="win-banner">' + inner + '</div>' + featureDivider();
}

/** Christmas market hero banners (owner order, 2026-11-24): three
 * owner-supplied market banners start immediately (2026-11-24, at
 * the owner's direction — ahead of the usual lead-in) and alternate
 * days in the hero position through each market's last day. They
 * sit below the seasonal holiday banners and the Broncos win banner
 * in precedence, so Thanksgiving, the ski weekend, and Christmas
 * keep their days. Ends: Denver Christkindlmarket Dec 23, Cherry
 * Creek Dec 24, Colorado Springs Dec 23 (its printed dates are
 * Dec 4–6, 9–13 and 16–23). Every market banner links through to
 * the market's official website (owner order, 2026-11-24). */
const MARKET_HEROES = [
  { file: 'market-cherry-creek-2026', start: '2026-11-24', end: '2026-12-24', w: 2159, h: 710, url: 'https://www.cherrycreekholidaymarket.com/', alt: 'Cherry Creek Holiday Market, November 19–December 24, 2026 — engraving of the Bronco shopping at the market' },
  { file: 'market-denver-christkindl-2026', start: '2026-11-24', end: '2026-12-23', w: 2158, h: 707, url: 'https://www.christkindlmarketdenver.com/', alt: 'Denver Christkindlmarket, November 20–December 23, 2026 — engraving of the Bronco at the market' },
  { file: 'market-cos-christkindl-2026', start: '2026-11-24', end: '2026-12-23', w: 2172, h: 712, url: 'https://www.occchristkindlmarket.com/', alt: 'Colorado Springs Christkindlmarket, Bancroft Park, Old Colorado City, December 2026 — engraving of the Bronco at the market' },
];
function marketHeroBanner() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const pv = {};
  for (const p of parts) pv[p.type] = p.value;
  const day = pv.year + '-' + pv.month + '-' + pv.day;
  const open = MARKET_HEROES.filter((e) => day >= e.start && day <= e.end);
  if (!open.length) return '';
  const dayStart = new Date(day + 'T12:00:00Z');
  const yearStart = new Date(pv.year + '-01-01T12:00:00Z');
  const dayOfYear = Math.round((dayStart - yearStart) / 86400000) + 1;
  const pick = open[dayOfYear % open.length];
  const pic = '<picture>' +
    '<source srcset="/' + pick.file + '.webp" type="image/webp">' +
    '<img src="/' + pick.file + '.png" alt="' + esc(pick.alt) + '" width="' + pick.w + '" height="' + pick.h + '">' +
    '</picture>';
  const inner = pick.url
    ? '<a href="' + pick.url + '" target="_blank" rel="noopener">' + pic + '</a>'
    : pic;
  return '<div class="win-banner">' + inner + '</div>' + featureDivider();
}

/**
 * One homepage feature block (redesign spec 3.3), in order: headline
 * (no category label above it — owner instruction, 2026-11-02),
 * italic dek, byline, the
 * two-column intro (excerpt left at ~48%, the story's framed plate
 * with its caption right at ~52%), the Read Full Story and Save
 * controls, and the Why It Matters box. The excerpt's
 * first paragraph carries the red drop cap (see leadExcerpt). Used
 * for the lead story and the features under it (each drawn from a
 * different section by the home route).
 */
function featureStory(a, opts = {}) {
  // On listing pages the page's H1 is the section title, so the
  // featured article's headline renders as an H2 with the same
  // .feature-headline dress (owner directive, 2026-11-21).
  const tag = opts.heading === 'h2' ? 'h2' : 'h1';
  const excerpt = leadExcerpt(a, undefined, !!opts.trimExcerpt);
  let s =
    '<section class="lead-story"><' + tag + ' class="headline feature-headline"><a style="text-decoration:none" href="/article/' +
    esc(a.slug) + '">' + esc(a.headline) + '</a></' + tag + '>' +
    (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '') +
    '<div class="byline">' + bylineLine(a) + '</div>';
  if (excerpt) {
    // Intro: the plate (with caption) floats right and the excerpt
    // text wraps around it. With no image the excerpt runs full width.
    const fig = articleFigure(a, 'feature-figure', { link: true, width: 900 });
    s += fig
      ? '<div class="feature-intro">' + fig + '<div class="feature-excerpt">' + excerpt + '</div></div>'
      : '<div class="feature-excerpt">' + excerpt + '</div>';
  } else {
    s += articleFigure(a, 'feature-figure', { link: true, width: 900 });
  }
  s +=
    '<div class="feature-actions"><a class="btn-read" href="/article/' + esc(a.slug) +
    '">Read Full Story &rarr;</a>' +
    '<button type="button" class="btn-save" data-save-slug="' + esc(a.slug) +
    '" aria-pressed="false">📌 Save</button>' + shareControl(a) + '</div>';
  if (a.whyItMatters) {
    s +=
      '<div class="why-feature"><div class="why-label">Why It Matters</div><p>' +
      inline(a.whyItMatters) + '</p></div>';
  }
  s += '</section>';
  return s;
}

/**
 * Per-section SEO titles and meta descriptions, written to the house
 * standard: title 50-70 chars with the primary search phrase first, no
 * site name and no superlatives; description 150-160 chars, specific
 * to the section, with the main keywords used naturally and a light
 * call to action. Local has its own hub/region copy below.
 */
const SECTION_META = {
  politics: {
    title: 'Colorado Politics News: Legislature, Governor, Elections & Courts',
    description:
      'Follow Colorado politics from the Capitol to the courts, including the legislature, governor, elections, ballot measures, rights cases and spending. Read today.',
  },
  business: {
    title: 'Colorado Business & Tax News: Economy, Jobs, Housing & TABOR',
    description:
      'Follow Colorado business, jobs, housing, real estate, taxes, TABOR refunds, budgets and spending that shape wages, prices and growth statewide. Read today.',
  },
  'energy-environment': {
    title: 'Colorado Energy & Environment News: Oil, Gas, Water & Utilities',
    description:
      'Track Colorado oil and gas, utilities, electric bills, water rights, drought, wildfires, public lands and climate policy across the state. Read more today.',
  },
  'education-health': {
    title: 'Colorado Education & Health News: Schools, Hospitals & Policy',
    description:
      'Follow Colorado schools, school boards, colleges, hospitals, insurance, Medicaid and public health decisions affecting families in every region. Read today.',
  },
  'colorado-life': {
    title: 'Colorado life: sports, outdoors, history, travel and culture',
    description:
      'Colorado life: Broncos, Avalanche and college sports, skiing, hiking, history, travel and the people of the Centennial State. Read the latest stories here.',
  },
  local: {
    title: 'Colorado Local News: Counties, Cities, Councils & School Boards',
    description:
      'Read Colorado news from all 64 counties, covering city councils, commissioners, school boards, public safety, zoning, budgets and development. Explore today.',
  },
  opinion: {
    title: 'Colorado Opinion, Commentary & Satire on Politics, Taxes & Schools',
    description:
      'Read Colorado opinion columns, editorials, cartoons and satire on politics, taxes, schools and state decisions, with sharp arguments worth weighing. Read today.',
  },
};

/** Per-region meta descriptions for the Local region pages. */
const REGION_META = {
  'denver-metro':
    'Denver Metro local news: Denver and Aurora city councils, county budgets, sheriffs and school boards across the metro area, with the original sources linked. Read the latest.',
  'northern-colorado':
    'Northern Colorado local news: Fort Collins, Loveland and Greeley councils, Larimer and Weld county news, sheriffs and school boards. Read the latest stories.',
  'southern-colorado':
    'Southern Colorado local news: Colorado Springs and Pueblo councils, county commissions, sheriffs and school boards, with the original sources linked. Read more.',
  'western-slope':
    'Western Slope local news: Grand Junction and Montrose, Mesa and Delta county commissions, water fights and school boards, with sources linked. Read the latest.',
  southwest:
    'Southwest Colorado local news: Durango and Pagosa Springs, La Plata and Archuleta county news, sheriffs, water and school boards. Read the latest stories here.',
  mountains:
    'Colorado Mountains local news: Summit and Eagle county towns, Aspen and Vail councils, ski-town housing fights and school boards. Read the latest stories here.',
  'eastern-plains':
    'Eastern Plains local news: Sterling, Fort Morgan and Lamar, county commissions, water, wind energy and small-town school boards. Read the latest stories here.',
  'san-luis-valley':
    'San Luis Valley local news: Alamosa and Monte Vista, county commissions, water fights, farm news and school boards, with the sources linked. Read the latest.',
};

/**
 * Topic-cluster hub box: the section's hub title and description,
 * reusing the per-section copy written for the SEO pass (SECTION_META,
 * and the Local hub's own meta copy). Rendered as the LAST element on
 * article, section and Local pages.
 */
const LOCAL_HUB = {
  title: 'Colorado local news hub: counties, cities, sheriffs, schools',
  description:
    'Colorado local news from all eight regions: county commissions, city councils, sheriffs and school boards, with the original sources linked. Read the latest stories from every part of the state, or pick a region above.',
};

/**
 * Bottom-of-page section and region descriptions (owner-supplied
 * copy, 2026-11-08 restructure): each category page ends with this
 * heading and these two paragraphs in the hub box, and each Local
 * region page ends with its own. The same box closes article
 * pages, so the copy stays consistent site-wide. Page <title>/meta
 * tags still come from SECTION_META / REGION_META.
 */
const SECTION_DESCRIPTIONS = {
  "politics": {
    title: "Colorado Politics News, Elections, Government & Civil Rights",
    paragraphs: [
      "Follow Colorado politics news, state government developments, and election coverage from the Colorado State Capitol to communities across the Centennial State. The Centennial Ledger reports on the Colorado governor, General Assembly, state House and Senate legislation, political campaigns, ballot initiatives, election results, and decisions by elected officials. Our reporting examines government spending, proposed laws, political controversies, campaign finance, and the policies shaping Colorado's future.",
      "Explore Colorado Supreme Court decisions, constitutional rights, First and Second Amendment disputes, religious liberty cases, parental rights, and challenges to government authority. From legislative debates and judicial rulings to political investigations, ethics complaints, and government accountability, our coverage explains how decisions by Colorado politicians, lawmakers, and courts affect residents, businesses, and individual freedoms.",
    ],
  },
  "business": {
    title: "Colorado Business News, Economy, Taxes, Jobs & Real Estate",
    paragraphs: [
      "Colorado business news covers the companies, industries, and economic developments driving the state's economy. The Centennial Ledger follows Colorado businesses, entrepreneurship, employment trends, job growth, commercial development, banking, finance, agriculture, and the real estate market. Explore reporting on Denver-area businesses, emerging industries, construction projects, housing affordability, inflation, and the economic challenges facing employers, workers, and consumers throughout Colorado.",
      "Our coverage also examines Colorado income taxes, property taxes, TABOR refunds, sales taxes, government budgets, public spending, and the financial impact of state and local regulations. From Colorado housing prices and small business developments to economic forecasts, labor markets, and agricultural policy, stay informed about the decisions and market conditions affecting Colorado's cost of living, business climate, and financial future.",
    ],
  },
  "energy-environment": {
    title: "Colorado Energy & Environment News, Oil, Gas, Water & Climate",
    paragraphs: [
      "Colorado energy and environment news covers the natural resources, industries, and environmental issues shaping the state's economy and landscape. The Centennial Ledger reports on Colorado oil and gas development, natural gas production, renewable energy projects, electricity rates, utility companies, energy regulations, and the transition toward wind, solar, and other power sources. Follow developments involving Xcel Energy, oil and gas permits, electricity costs, electric grid reliability, and energy affordability.",
      "Our environmental reporting examines Colorado water rights, Colorado River issues, drought conditions, wildfires, forest management, wildlife conservation, public lands, air quality, and climate-related policies. From Front Range energy development and Western Slope water disputes to national forest management and environmental protection regulations, explore the economic, scientific, and public-policy questions affecting Colorado's land, water, wildlife, and energy future.",
    ],
  },
  "education-health": {
    title: "Colorado Education & Healthcare News, Schools, Hospitals & Policy",
    paragraphs: [
      "Colorado education and healthcare news covers two essential parts of everyday life for families across the state. The Centennial Ledger reports on Colorado public schools, private education, charter schools, school choice, school board elections, district budgets, curriculum debates, school closures, and student academic performance. Follow education legislation, parental rights, school funding, teacher shortages, higher education, and developments at Colorado colleges and universities.",
      "Our Colorado healthcare coverage examines hospitals, medical providers, health insurance costs, healthcare legislation, Medicaid, public health programs, and access to medical care. From rural hospital funding and healthcare staffing shortages to insurance premiums, medical research, and state health regulations, we follow the decisions affecting patients, healthcare professionals, students, parents, and communities throughout Colorado.",
    ],
  },
  "colorado-life": {
    title: "Colorado Sports, Outdoors, History, Travel & Lifestyle News",
    paragraphs: [
      "Discover Colorado life through the sports, outdoor adventures, history, culture, and people that make the Centennial State distinctive. The Centennial Ledger covers Colorado sports news, including the Denver Broncos, Colorado Avalanche, Denver Nuggets, Colorado Rockies, college athletics, and high school sports. Explore Colorado skiing and snowboarding, hiking trails, camping, hunting, fishing, outdoor recreation, and adventures in the Rocky Mountains.",
      "Our lifestyle coverage also explores Colorado history, Old West legends, historic towns, famous Coloradans, travel destinations, arts and entertainment, festivals, food, and local traditions. From Colorado ski resort news and national park travel to historical events, unusual discoveries, and inspiring human-interest stories, Colorado Life celebrates the places, personalities, pastimes, and remarkable stories that define living in Colorado.",
    ],
  },
  "local": {
    title: "Colorado Local News, City & County Government, Communities & Events",
    paragraphs: [
      "Colorado local news brings together the community stories, government decisions, and regional developments affecting residents throughout the state's 64 counties. The Centennial Ledger covers city councils, county commissioners, local elections, public safety, sheriffs' offices, school boards, infrastructure projects, community events, and municipal spending. Follow local government news, housing developments, property tax decisions, zoning controversies, and issues affecting Colorado neighborhoods, businesses, and families.",
      "Explore regional news from Denver Metro, Northern Colorado, Southern Colorado, the Western Slope, Southwest Colorado, mountain communities, the Eastern Plains, and the San Luis Valley. Whether you're following Fort Collins city government, Pueblo community news, Grand Junction development, or small-town decisions elsewhere in Colorado, our local coverage connects readers with the people, places, and issues shaping their communities.",
    ],
  },
  "opinion": {
    title: "Colorado Political Opinion, Editorials, Satire & Commentary",
    paragraphs: [
      "Explore Colorado opinion articles, political commentary, editorials, and thought-provoking perspectives on the issues shaping the Centennial State. The Centennial Ledger publishes opinion columns and analysis examining Colorado politics, government spending, taxation, constitutional rights, education, healthcare, energy policy, and the decisions of elected officials. Our editorial coverage offers arguments, criticism, historical context, and perspectives on state and local controversies.",
      "The Opinion section also features Colorado political satire, editorial cartoons, political humor, guest commentary, and satirical takes on government, public policy, and everyday life. From Colorado legislative debates and election controversies to cultural issues, political hypocrisy, and the occasional absurdity of government bureaucracy, discover commentary designed to challenge assumptions, encourage discussion, and give readers something worth thinking about.",
    ],
  },
};

const REGION_DESCRIPTIONS = {
  "denver-metro": {
    title: "Denver Metro Local News, Aurora, Lakewood & County Government",
    paragraphs: [
      "Denver metro news covers local government, community developments, and public issues affecting Denver, Aurora, Lakewood, and surrounding Front Range communities. The Centennial Ledger follows Denver City Council, Aurora city government, Jefferson County, Arapahoe County, Adams County, local elections, school boards, and municipal decisions affecting Colorado's largest metropolitan area.",
      "Explore Denver local news involving housing development, property taxes, crime and public safety, transportation projects, zoning regulations, and infrastructure spending. From Aurora community developments and Lakewood politics to Denver-area business growth, school district decisions, and neighborhood controversies, our coverage examines the people, policies, and events shaping life throughout the Denver metropolitan region.",
    ],
  },
  "northern-colorado": {
    title: "Northern Colorado News, Fort Collins, Loveland, Greeley & Longmont",
    paragraphs: [
      "Northern Colorado news covers the latest community developments, local politics, and government decisions affecting Fort Collins, Loveland, Greeley, Longmont, and surrounding communities. The Centennial Ledger reports on Larimer County news, Weld County government, Fort Collins City Council, Loveland city politics, Greeley development, local elections, and school board decisions throughout the region.",
      "Follow Northern Colorado local news involving housing growth, water rights, property taxes, road construction, public safety, education funding, and economic development. From Poudre School District controversies and Colorado State University developments to oil and gas activity, agricultural issues, and municipal spending, explore the stories affecting Northern Colorado residents, businesses, and communities along the northern Front Range.",
    ],
  },
  "southern-colorado": {
    title: "Southern Colorado News, Colorado Springs, Pueblo & Local Government",
    paragraphs: [
      "Southern Colorado news covers local government, community events, and regional developments affecting Colorado Springs, Pueblo, and surrounding communities. The Centennial Ledger follows Colorado Springs City Council, Pueblo city government, El Paso County, Pueblo County, local elections, school districts, and the public officials making decisions throughout Southern Colorado.",
      "Explore Colorado Springs news and Pueblo local news involving housing, property taxes, public safety, business development, infrastructure, healthcare, and education. Our reporting examines municipal budgets, economic growth, utility costs, transportation projects, and the changing needs of Southern Colorado communities. From school board decisions and county government controversies to major construction projects and regional economic issues, stay informed about the developments shaping life south of the Denver metro area.",
    ],
  },
  "western-slope": {
    title: "Western Slope Colorado News, Grand Junction, Montrose & Delta",
    paragraphs: [
      "Western Slope Colorado news covers local politics, community developments, and regional issues affecting Grand Junction, Montrose, Delta, and surrounding Western Colorado communities. The Centennial Ledger reports on Mesa County news, Montrose County government, Delta County developments, city council decisions, local elections, and school board activities across the region.",
      "Follow Grand Junction news and Western Slope developments involving water rights, agriculture, oil and gas production, public lands, housing growth, and economic development. Our coverage examines county budgets, land use regulations, infrastructure investments, environmental issues, and the policies affecting rural communities. From Grand Junction city politics to Montrose development projects and Colorado River water issues, explore the stories shaping life on Colorado's Western Slope.",
    ],
  },
  "southwest": {
    title: "Southwest Colorado News, Durango, Cortez & Pagosa Springs",
    paragraphs: [
      "Southwest Colorado news covers local government, community developments, and regional issues affecting Durango, Cortez, Pagosa Springs, and the surrounding Four Corners region. The Centennial Ledger follows La Plata County news, Montezuma County government, Archuleta County developments, municipal elections, city council decisions, and school boards across southwestern Colorado.",
      "Explore Durango local news, Pagosa Springs community updates, and regional reporting involving water rights, wildfire risks, drought, tourism, housing development, and public lands. Our coverage examines local government spending, economic growth, transportation infrastructure, agriculture, and environmental concerns affecting Southwest Colorado communities. From county commission decisions to local business developments and public safety issues, stay informed about life in Colorado's southwestern corner.",
    ],
  },
  "mountains": {
    title: "Colorado Mountain News, Aspen, Vail, Breckenridge & Ski Towns",
    paragraphs: [
      "Colorado mountain news covers the communities, businesses, and government decisions shaping life in the Rocky Mountains. The Centennial Ledger follows Aspen, Vail, Breckenridge, Steamboat Springs, and surrounding mountain towns, including Summit County, Eagle County, Pitkin County, and Routt County developments, local elections, municipal budgets, and town council decisions.",
      "Explore Colorado ski resort news, mountain town real estate, tourism, short-term rental regulations, workforce housing, transportation, and the economic challenges facing resort communities. Our local reporting also examines public lands, wildlife, wildfire preparedness, water resources, and outdoor recreation. From Vail government decisions and Breckenridge development disputes to Aspen community issues, follow the stories affecting Colorado's mountain residents, businesses, and visitors.",
    ],
  },
  "eastern-plains": {
    title: "Eastern Plains Colorado News, Sterling, Fort Morgan & Lamar",
    paragraphs: [
      "Eastern Plains Colorado news covers local government, agriculture, economic development, and community life throughout eastern Colorado. The Centennial Ledger follows Sterling, Fort Morgan, Lamar, Burlington, and surrounding rural communities, reporting on county commissioners, municipal elections, school boards, public safety, and decisions affecting small towns across the plains.",
      "Explore Eastern Colorado news involving farming and ranching, agricultural water rights, irrigation, wind energy development, rural infrastructure, property taxes, and local business growth. Our reporting examines Logan County, Morgan County, Prowers County, and neighboring communities, including school funding, agricultural policy, land use regulations, and government spending. From rural economic challenges to new development projects, stay informed about the issues shaping Colorado's Eastern Plains.",
    ],
  },
  "san-luis-valley": {
    title: "San Luis Valley Colorado News, Alamosa, Monte Vista & Water Rights",
    paragraphs: [
      "San Luis Valley news covers local government, agriculture, community developments, and public issues affecting Alamosa, Monte Vista, Del Norte, and surrounding southern Colorado communities. The Centennial Ledger follows Alamosa County news, Rio Grande County government, Conejos County developments, local elections, school boards, and city council decisions throughout the valley.",
      "Explore San Luis Valley Colorado news involving water rights, groundwater conservation, irrigation, farming, ranching, rural healthcare, and economic development. Our reporting examines government budgets, infrastructure improvements, property taxes, education funding, and policies affecting residents and agricultural businesses. From Alamosa local politics and Monte Vista community developments to regional water management and land use disputes, follow the stories shaping the future of the San Luis Valley.",
    ],
  },
};
function hubBox(section) {
  const d = SECTION_DESCRIPTIONS[section];
  if (d) {
    return (
      '<aside class="hub-box"><h2>' +
      esc(d.title) +
      '</h2>' +
      d.paragraphs.map((p) => '<p>' + esc(p) + '</p>').join('') +
      '</aside>'
    );
  }
  let title;
  let text;
  if (section === 'local') {
    title = LOCAL_HUB.title;
    text = LOCAL_HUB.description;
  } else if (SECTION_META[section]) {
    title = SECTION_META[section].title.replace(' news:', ' news hub:');
    text = SECTION_META[section].description;
  } else {
    title = 'Colorado ' + sectionName(section).toLowerCase() + ' news hub';
    text =
      'Colorado ' + sectionName(section).toLowerCase() +
      ' news reported with the facts first and the original sources linked, from communities across the state.';
  }
  return (
    '<aside class="hub-box"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></aside>'
  );
}

/**
 * The section's descriptive text as plain page content (owner
 * directive, 2026-11-21): the words that used to sit in the hub
 * box at the bottom of the section page now run as ordinary
 * paragraphs at the top, under the H1 and above the first ad.
 * Same source text as hubBox (SECTION_DESCRIPTIONS, with the
 * Local hub and SECTION_META fallbacks), without the box or its
 * H2 title.
 */
function sectionIntro(section) {
  const d = SECTION_DESCRIPTIONS[section];
  let paragraphs;
  if (d) {
    paragraphs = d.paragraphs;
  } else if (section === 'local') {
    paragraphs = [LOCAL_HUB.description];
  } else if (SECTION_META[section]) {
    paragraphs = [SECTION_META[section].description];
  } else {
    paragraphs = [
      'Colorado ' + sectionName(section).toLowerCase() +
        ' news reported with the facts first and the original sources linked, from communities across the state.',
    ];
  }
  return (
    '<div class="section-intro">' +
    paragraphs.map((p) => '<p>' + esc(p) + '</p>').join('') +
    '</div>'
  );
}

/**
 * The region blurb as plain intro paragraphs at the top of the
 * region page, mirroring sectionIntro on the section pages
 * (owner directive, 2026-11-21: the same move the section pages
 * got — blurb from the bottom box to the top, no box, no H2).
 * Same source text as the old bottom box.
 */
function regionIntro(region) {
  const d = REGION_DESCRIPTIONS[region.slug];
  const paragraphs = d
    ? d.paragraphs
    : [
        REGION_META[region.slug] ||
          'Local news from ' + region.name +
            ', Colorado: county commissions, city councils, sheriffs and school boards, with the original sources linked. Read the latest.',
      ];
  return (
    '<div class="section-intro">' +
    paragraphs.map((p) => '<p>' + esc(p) + '</p>').join('') +
    '</div>'
  );
}

/** Region variant of the hub box for Local region pages. */
function regionHubBox(region) {
  const d = REGION_DESCRIPTIONS[region.slug];
  if (d) {
    return (
      '<aside class="hub-box"><h2>' +
      esc(d.title) +
      '</h2>' +
      d.paragraphs.map((p) => '<p>' + esc(p) + '</p>').join('') +
      '</aside>'
    );
  }
  const title = region.name + ' local news hub: counties, cities and schools';
  const text =
    REGION_META[region.slug] ||
    'Local news from ' + region.name +
      ', Colorado: county commissions, city councils, sheriffs and school boards, with the original sources linked. Read the latest.';
  return (
    '<aside class="hub-box"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p></aside>'
  );
}

/**
 * The "From Our Editorial Desk" strip: a full-width cream band below
 * the homepage columns and above Latest from Colorado, promoting
 * the newest Opinion piece — the headline as "Editorial:
 * <headline>" across the top of the box, then the piece's framed
 * plate at the left and the red small-caps label with the piece's
 * opening at about half the features' excerpt length (a 90-word
 * target; owner instruction, 2026-11-03) and the features' type size,
 * plus the same Read Full Story and Save buttons the features
 * carry (owner instruction, 2026-11-03). Rendered only when the
 * store holds an Opinion article; the home route passes the
 * latest one, or null and the strip is absent.
 */
function editorialStrip(opinion) {
  if (!opinion) return '';
  const excerpt = leadExcerpt(opinion, 90);
  return (
    '<section class="editorial-strip">' +
    // The headline runs across the top of the box, above the
    // image, in the same font and size as the featured articles'
    // headlines (owner instruction, 2026-11-02).
    '<span class="editorial-headline">Editorial: ' + esc(opinion.headline) + '</span>' +
    '<div class="editorial-strip-row">' +
    articleFigure(opinion, '', { noCaption: true, link: true, width: 900 }) +
    '<div class="editorial-text">' +
    '<span class="editorial-label">From Our Editorial Desk</span>' +
    (excerpt ? '<div class="editorial-excerpt">' + excerpt + '</div>' : '') +
    '<div class="feature-actions"><a class="btn-read" href="/article/' + esc(opinion.slug) +
    '">Read Full Story &rarr;</a>' +
    '<button type="button" class="btn-save" data-save-slug="' + esc(opinion.slug) +
    '" aria-pressed="false">📌 Save</button>' + shareControl(opinion) + '</div>' +
    '</div>' +
    '</div>' +
    '</section>'
  );
}

/**
 * The featured explainer treatment, shared by the homepage module
 * and the /explained archive: plate at the left, category kicker,
 * headline, dek and an opening excerpt at the right.
 *
 * Homepage variant (owner order, 2026-11-20, as corrected by the
 * owner the same morning): with { wrap: true } the block keeps the
 * treatment above — plate at the left at its usual 340px size,
 * kicker, headline, dek and excerpt beside it — except the plate
 * (with its caption) FLOATS left, so text that runs past the
 * bottom of the plate and caption wraps underneath them at full
 * width instead of staying in a narrow column. NOT the main
 * feature stories' float-right layout. The /explained archive
 * keeps the plain side-by-side treatment above.
 */
function explainedFeature(a, opts) {
  if (!a) return '';
  const excerpt = leadExcerpt(a, 90);
  if (opts && opts.wrap) {
    let s =
      '<article class="explained-feature explained-feature--wrap">' +
      articleFigure(a, 'explained-figure', { link: true, width: 700 }) +
      '<div class="kicker">' + esc(sectionName(a.section)) + '</div>' +
      '<h3 class="explained-feature-headline"><a href="/article/' +
      esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
      (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '');
    if (excerpt) s += '<div class="feature-excerpt">' + excerpt + '</div>';
    s +=
      '<div class="feature-actions"><a class="btn-read" href="/article/' +
      esc(a.slug) + '">Read More &rarr;</a></div>';
    s += '</article>';
    return s;
  }
  let s =
    '<article class="explained-feature">' +
    articleFigure(a, 'explained-figure', { link: true, width: 700 }) +
    '<div class="explained-feature-text"><div class="kicker">' +
    esc(sectionName(a.section)) +
    '</div>' +
    '<h3 class="explained-feature-headline"><a href="/article/' +
    esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '');
  if (excerpt) s += '<div class="feature-excerpt">' + excerpt + '</div>';
  s +=
    '<div class="feature-actions"><a class="btn-read" href="/article/' +
    esc(a.slug) + '">Read More &rarr;</a></div>';
  s += '</div></article>';
  return s;
}

/**
 * Homepage How Colorado Works module (owner directive,
 * 2026-11-13): the latest explainer big, then one row of three
 * (the next three latest, supplied by the home route). Nothing
 * older appears on the homepage.
 */
function explainedModule(ex) {
  let s =
    '<section class="explained-home" aria-label="How Colorado Works">' +
    '<h2 class="explained-heading">How Colorado Works</h2>';
  s += explainedFeature(ex.featured, { wrap: true });
  const items = (ex.items || []).filter(Boolean).slice(0, 3);
  if (items.length) {
    s += '<div class="explained-grid">' + items.map(articleCard).join('') + '</div>';
  }
  s +=
    // Dressed as a Read More button (owner directive, 2026-11-21).
    '<div class="explained-more"><a class="btn-read" href="/explained">More on How Colorado Works &rarr;</a></div></section>';
  return s;
}

/**
 * The Colorado Explained series archive at /explained (owner
 * directive, 2026-11-08): a featured explainer, subject filter
 * chips (an archive feature, not navigation), and the full grid.
 */
function explainedPage({ articles, featured, category, cats }) {
  const list = Array.isArray(articles) ? articles : [];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'How Colorado Works | ' + SITE_NAME,
      url: absUrl('/explained'),
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl() + '/' },
    },
    {
      '@type': 'ItemList',
      '@context': 'https://schema.org',
      itemListElement: (featured ? [featured, ...list] : list).map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absUrl('/article/' + a.slug),
        name: a.headline,
      })),
    },
  ];
  // Top leaderboard restored (owner directive, 2026-11-21,
  // reversing the same-day removal): first element, above the
  // H1, like the section pages.
  let body = leaderboardAdSlot();
  body +=
    '<h1 class="headline" style="font-size:2.4rem">How Colorado Works</h1>' +
    '<p class="dek">The laws, institutions, history, and peculiarities that make Colorado tick.</p>' +
    // Owner-supplied top-of-page copy for the series archive
    // (John, 2026-11-08), verbatim.
    '<div class="explained-intro">' +
    // The intro's H2 ("How Colorado Works: Understanding the
    // Centennial State") was removed at the owner's order,
    // 2026-11-21; the intro paragraphs remain.
    '<p>Colorado is a state of complicated laws, unique institutions, remarkable geography, and often-confusing public policies. <strong>How Colorado Works</strong>, an ongoing editorial series from <em>The Centennial Ledger</em>, breaks down the issues, systems, and questions that shape everyday life in the Centennial State. From Colorado\'s TABOR law, property taxes, and state government to water rights, energy policy, education, healthcare, housing, and public lands, our in-depth explainers make complex subjects easier to understand.</p>' +
    '<p>Explore thoroughly researched Colorado guides covering how state and local government works, where taxpayer dollars go, why certain laws exist, and how public policies affect Colorado residents and businesses. We examine the history, facts, competing arguments, and practical consequences behind important Colorado issues, providing clear answers without unnecessary political spin or bureaucratic jargon.</p>' +
    '<p>Whether you\'re trying to understand a ballot measure, decipher your property tax bill, navigate Colorado regulations, or learn something surprising about the state\'s history and geography, <strong>How Colorado Works helps you make sense of Colorado, one question at a time.</strong></p>' +
    '</div>';
  const chips = Array.isArray(cats) ? cats : [];
  if (chips.length > 1) {
    body +=
      '<nav class="explained-chips" aria-label="Filter explainers by subject">' +
      '<a href="/explained"' + (!category ? ' class="active"' : '') + '>All Topics</a>' +
      chips
        .map(
          (c) =>
            '<a href="/explained?category=' + esc(c.slug) + '"' +
            (category === c.slug ? ' class="active"' : '') + '>' +
            esc(c.name) + '</a>'
        )
        .join('') +
      '</nav>';
  }
  if (featured) body += explainedFeature(featured);
  if (list.length) {
    // Thin leaderboard above the grid, and another after every
    // sixteen grid stories — grids of four wide by four deep,
    // like the section pages (owner directive, 2026-11-21).
    body += leaderboardAdSlot();
    for (let i = 0; i < list.length; i += 16) {
      if (i) body += leaderboardAdSlot();
      body +=
        '<div class="grid grid-4col">' +
        list.slice(i, i + 16).map(articleCard).join('') +
        '</div>';
    }
  } else if (!featured) {
    body += '<p>The first explainers are on the way.</p>';
  }
  body +=
    '<p class="last-reviewed">New explainers arrive every Tuesday and Friday. Each article lists its sources and the date it was last reviewed; explainers on law, taxes, and healthcare are rechecked at least every six months, and sooner when the law changes.</p>';
  // Bottom leaderboard just above the footer, like the other
  // section pages (owner directive, 2026-11-21), in the .final-ad
  // wrapper so its spacing matches the top ad.
  body += '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Colorado Explainers: How TABOR, Water, Taxes & Laws Really Work', 70),
    description: fitDescription(
      'Understand how Colorado works with explainers on TABOR, property taxes, water rights, school funding, energy rules and state government. Start learning today.'
    ),
    path: '/explained',
    activeNav: 'explained',
    jsonLd,
    body,
  });
}

/* Podcast brief pages (owner order, 2026-11-16): the web companion
   to one Colorado Daily News Brief episode — short article versions
   of the episode's stories, each with its sources listed under it. */

function briefStoryHtml(s, headingTag, anchorId) {
  const tag = headingTag || 'h2';
  let h =
    '<article class="brief-story"' +
    (anchorId ? ' id="' + anchorId + '"' : '') +
    '><' + tag + '>' + esc(s.headline) + '</' + tag + '>';
  h += (Array.isArray(s.body) ? s.body : [])
    .map((p) => '<p>' + inline(p) + '</p>')
    .join('');
  const sources = (Array.isArray(s.sources) ? s.sources : []).filter(
    (x) => x && (x.url || x.name)
  );
  if (sources.length) {
    h +=
      '<div class="brief-sources"><h4>Sources</h4>' +
      sources
        .map((x) =>
          x.url
            ? '<p class="source"><a href="' + esc(x.url) +
              '" rel="noopener" target="_blank">' + esc(x.name || x.url) + '</a></p>'
            : '<p class="source">' + esc(x.name) + '</p>'
        )
        .join('') +
      '</div>';
  }
  return h + '</article>';
}

function briefPage(page, newer, older) {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Colorado Daily News Brief: ' + page.episodeTitle,
      url: absUrl('/podcast/' + page.date),
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl() + '/' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'PodcastEpisode',
      name: page.episodeTitle,
      url: absUrl('/podcast/' + page.date),
      datePublished: page.date,
      description: page.intro || undefined,
      partOfSeries: {
        '@type': 'PodcastSeries',
        name: 'Colorado Daily News Brief',
        url: absUrl('/podcast'),
      },
    },
  ];
  let body = leaderboardAdSlot();
  body +=
    '<p class="brief-kicker">' +
    (page.format === 'article'
      ? 'Colorado Daily News Brief &mdash; Saturday History Edition'
      : 'Colorado Daily News Brief') +
    '</p>' +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(page.episodeTitle) + '</h1>' +
    (page.format === 'article'
      ? '<p class="brief-dateline">' +
        esc(
          new Date(page.date + 'T12:00:00-07:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'America/Denver',
          })
        ) +
        ' &middot; The Centennial Ledger</p>'
      : '') +
    '<p class="dek">' +
    inline(
      page.intro ||
        "The stories from this episode of the Colorado Daily News Brief, in short form, with their sources."
    ) +
    '</p>';
  if (page.spotifyUrl) {
    body +=
      '<a class="brief-listen" href="' + esc(page.spotifyUrl) +
      '" rel="noopener" target="_blank">Listen on Spotify</a>';
  }
  /* Each top story carries a story-N anchor (owner order,
   * 2026-11-20): the homepage podcast box links each of its
   * headlines to the matching story on this page, in order. */
  if (page.format === 'article') {
    /* Article format (owner order, 2026-11-20): the illustration
     * under the dek, then the sections as one flowing article —
     * subheads, no per-section source blocks — and one combined
     * Sources list at the end. Sections keep their story-N
     * anchors so the homepage podcast box can link to them. */
    if (page.illustration && page.illustration.src) {
      body +=
        '<figure class="art-figure"><img src="' + esc(page.illustration.src) +
        '" alt="' + esc(page.illustration.alt || '') + '" loading="lazy">' +
        (page.illustration.caption
          ? '<figcaption>' + esc(page.illustration.caption) + '</figcaption>'
          : '') +
        '</figure>';
    }
    const sectionHtml = page.stories.map(
      (s, i) =>
        '<article class="brief-story" id="story-' + (i + 1) + '"><h2>' +
        esc(s.headline) + '</h2>' +
        (Array.isArray(s.body) ? s.body : [])
          .map((p) => '<p>' + inline(p) + '</p>')
          .join('') +
        '</article>'
    );
    // A leaderboard halfway through the sections (owner
    // directive, 2026-11-21).
    if (sectionHtml.length >= 2) {
      sectionHtml.splice(
        Math.floor(sectionHtml.length / 2),
        0,
        leaderboardAdSlot()
      );
    }
    body += sectionHtml.join('');
    const seen = new Set();
    const allSources = [];
    for (const s of page.stories) {
      for (const x of Array.isArray(s.sources) ? s.sources : []) {
        if (!x || (!x.url && !x.name)) continue;
        const key = x.url || x.name;
        if (seen.has(key)) continue;
        seen.add(key);
        allSources.push(x);
      }
    }
    if (allSources.length) {
      body +=
        '<div class="brief-sources"><h4>Sources</h4>' +
        allSources
          .map((x) =>
            x.url
              ? '<p class="source"><a href="' + esc(x.url) +
                '" rel="noopener" target="_blank">' + esc(x.name || x.url) + '</a></p>'
              : '<p class="source">' + esc(x.name) + '</p>'
          )
          .join('') +
        '</div>';
    }
  } else {
    const around = Array.isArray(page.aroundColorado) ? page.aroundColorado : [];
    const storyHtml = page.stories.map((s, i) =>
      briefStoryHtml(s, 'h2', 'story-' + (i + 1))
    );
    // A leaderboard halfway through (owner directive,
    // 2026-11-21): between the top stories and Around Colorado
    // when that block exists, otherwise midway through the top
    // stories.
    if (!around.length && storyHtml.length >= 2) {
      storyHtml.splice(Math.floor(storyHtml.length / 2), 0, leaderboardAdSlot());
    }
    body += storyHtml.join('');
    if (around.length) {
      body += leaderboardAdSlot();
      body += '<h2 class="brief-around">Around Colorado</h2>';
      body += around.map((s) => briefStoryHtml(s, 'h3')).join('');
    }
  }
  body +=
    '<p class="last-reviewed">Colorado Daily News Brief is produced by The Centennial Ledger. The voices you hear in the podcast are AI-generated; the reporting is gathered and verified by people.</p>';
  if (newer || older) {
    body += '<nav class="brief-nav" aria-label="More episode pages">';
    body += older
      ? '<a href="/podcast/' + esc(older.date) + '">&larr; ' + esc(older.episodeTitle) + '</a>'
      : '<span></span>';
    body += newer
      ? '<a href="/podcast/' + esc(newer.date) + '">' + esc(newer.episodeTitle) + ' &rarr;</a>'
      : '<span></span>';
    body += '</nav>';
  }
  // Bottom leaderboard with the standard .final-ad spacing
  // (owner directive, 2026-11-21: every page gets one).
  body += '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Colorado Daily News Brief: ' + page.episodeTitle, 70),
    description: fitDescription(
      page.intro ||
        'Short versions of the stories from the ' +
          page.episodeTitle +
          ' episode of the Colorado Daily News Brief, each with its sources.'
    ),
    path: '/podcast/' + page.date,
    jsonLd,
    body,
  });
}

function briefIndexPage(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Colorado Daily News Brief | ' + SITE_NAME,
      url: absUrl('/podcast'),
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl() + '/' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'PodcastSeries',
      name: 'Colorado Daily News Brief',
      url: absUrl('/podcast'),
      webFeed: 'https://anchor.fm/s/11a0ed790/podcast/rss',
      author: { '@type': 'NewsMediaOrganization', name: SITE_NAME, url: siteUrl() + '/' },
    },
  ];
  const dateLine = (iso) =>
    new Date(iso + 'T12:00:00-07:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Denver',
    });
  let body = leaderboardAdSlot();
  body +=
    '<p class="brief-kicker">Podcast</p>' +
    '<h1 class="headline" style="font-size:2.4rem">Colorado Daily News Brief</h1>' +
    // The show cover, floated right of the dek so the dek and
    // the intro text wrap around it, at the homepage podcast
    // box's size (the rail is 300px and the box art fills it)
    // — owner directive, 2026-11-21.
    '<a href="https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX" target="_blank" rel="noopener"><img class="podcast-page-art" src="/images/podcast-cover.jpg" alt="Colorado Daily News Brief &mdash; a Centennial Ledger podcast" width="300" height="300"></a>' +
    '<p class="dek">The Centennial Ledger&rsquo;s morning podcast: Colorado news, weather, and sports to start the day &mdash; and every episode&rsquo;s stories in print, with their sources.</p>' +
    '<div class="section-intro">' +
    '<p>Colorado Daily News Brief is the weekday podcast of The Centennial Ledger. A new episode is published every weekday morning by 6:00 AM, covering the day&rsquo;s statewide news &mdash; politics, business, energy, education, and local stories from across all 64 counties &mdash; along with Colorado weather and sports. On Saturdays, the show turns to Colorado history with a long-form story from the state&rsquo;s past.</p>' +
    '<p>Every episode gets a companion page here with short print versions of its stories and the sources behind them, so listeners can read the reporting and check the record for themselves. The podcast is produced by The Centennial Ledger with AI-generated voices; the reporting is gathered and verified by people.</p>' +
    '</div>' +
    '<div class="podcast-listen">' +
    '<a class="btn-read" href="https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX" target="_blank" rel="noopener">Listen on Spotify</a>' +
    '<a class="btn-read" href="https://www.pandora.com/podcast/colorado-daily-news-brief/PC:1001124564" target="_blank" rel="noopener">Listen on Pandora</a>' +
    '</div>';
  if (list.length) {
    const latest = list[0];
    const isHistory = latest.format === 'article';
    const featureHeadline = isHistory
      ? latest.episodeTitle
      : (latest.stories[0] && latest.stories[0].headline) || latest.episodeTitle;
    body += '<section class="podcast-feature">';
    body +=
      '<p class="brief-kicker">Latest Episode' +
      (isHistory ? ' &middot; Saturday History Edition' : '') +
      (latest.episodeNumber ? ' &middot; Episode ' + latest.episodeNumber : '') +
      '</p>';
    body += '<p class="brief-dateline">' + esc(dateLine(latest.date)) + '</p>';
    if (isHistory && latest.illustration && latest.illustration.src) {
      body +=
        '<figure class="art-figure"><img src="' + esc(latest.illustration.src) +
        '" alt="' + esc(latest.illustration.alt || '') + '" loading="lazy">' +
        (latest.illustration.caption
          ? '<figcaption>' + esc(latest.illustration.caption) + '</figcaption>'
          : '') +
        '</figure>';
    }
    body +=
      '<h2 class="podcast-feature-headline"><a href="/podcast/' + esc(latest.date) + '">' +
      esc(featureHeadline) + '</a></h2>';
    if (latest.intro) {
      body += '<p class="podcast-feature-intro">' + inline(latest.intro) + '</p>';
    }
    if (!isHistory && latest.stories.length > 1) {
      body +=
        '<ul class="podcast-feature-stories">' +
        latest.stories
          .map(
            (s, i) =>
              '<li><a href="/podcast/' + esc(latest.date) + '#story-' + (i + 1) + '">' +
              esc(s.headline) +
              '</a></li>'
          )
          .join('') +
        '</ul>';
    }
    body += '<div class="podcast-listen">';
    body +=
      '<a class="btn-read" href="/podcast/' + esc(latest.date) + '">Read the Episode&rsquo;s Stories</a>';
    if (latest.spotifyUrl) {
      body +=
        '<a class="btn-read" href="' + esc(latest.spotifyUrl) +
        '" target="_blank" rel="noopener">Listen to This Episode</a>';
    }
    body += '</div></section>';
    body +=
      '<h2 class="podcast-archive-title">Episode Archive</h2>' +
      '<ul class="brief-index-list">' +
      list
        .map((p) => {
          const title =
            p.format === 'article'
              ? p.episodeTitle
              : (p.stories[0] && p.stories[0].headline) || p.episodeTitle;
          const meta =
            (p.episodeNumber ? 'Episode ' + p.episodeNumber + ' &middot; ' : '') +
            (p.format === 'article' ? 'Saturday History Edition &middot; ' : '') +
            esc(dateLine(p.date));
          return (
            '<li><a href="/podcast/' + esc(p.date) + '">' +
            '<span class="bi-date">' + meta + '</span>' +
            '<span class="bi-title">' + esc(title) + '</span>' +
            '</a></li>'
          );
        })
        .join('') +
      '</ul>';
  } else {
    body += '<p>The first episode pages are on the way.</p>';
  }
  body += '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Colorado Daily News Brief Podcast: News, Weather & Sports Daily', 70),
    description: fitDescription(
      'Listen to the Colorado Daily News Brief from The Centennial Ledger: weekday Colorado news, weather and sports by 6 AM, a Saturday history edition, and sources.'
    ),
    path: '/podcast',
    jsonLd,
    body,
  });
}

function homePage({ lead, second, third, gridFeatures, latest, railGroups, latestRow, localStories, opinion, briefingThanks, explained, podcast, briefDates, sportsLines }) {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: siteUrl() + '/',
      potentialAction: {
        '@type': 'SearchAction',
        target: siteUrl() + '/search?q={query}',
        'query-input': 'required name=query',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'NewsMediaOrganization',
      name: SITE_NAME,
      url: siteUrl() + '/',
      sameAs: SOCIAL_PROFILES,
      slogan: TAGLINE,
      address: { '@type': 'PostalAddress', addressLocality: 'Denver', addressRegion: 'CO', addressCountry: 'US' },
    },
  ];

  let body = leaderboardAdSlot();
  if (lead) {
    // Two-column front page from the top: the lead opens the main
    // column and the rail starts beside it at the same height;
    // below the columns, full width, come the editorial strip (when
    // an Opinion piece exists) and the three-card "Latest from
    // Colorado" grid. The lead
    // and third feature were pulled out of `latest` by the route.
    let features = (broncosSteelersWinBanner() || seasonalHeroBanner() + broncosWinBanner() || marketHeroBanner() || eventHeroBanner()) + featureStory(lead, { trimExcerpt: true });
    // Second feature, directly under the lead in the
    // same format (the most recent news story after the lead,
    // selected by the home route), with the gold filigree divider
    // between features; then the feature-card grid.
    if (second) features += featureDivider() + featureStory(second);
    if (third) features += featureDivider() + featureStory(third);
    // Feature grid (owner directive, 2026-11-21, revised the same
    // day): eight more feature stories as compact cards in a grid
    // two wide and four long under the full features, picked by the
    // home route as the next most recent news stories. Absent when
    // the pool runs out.
    const gridCards = (Array.isArray(gridFeatures) ? gridFeatures : []).filter(Boolean);
    if (gridCards.length) {
      features += featureDivider() +
        '<div class="feature-grid">' + gridCards.map(latestCard).join('') + '</div>';
    }
    // The rail groups the five news sections (Politics, Rights,
    // Taxes, Energy, Schools), each with its two most recent
    // stories under the section heading, picked by the home route
    // skipping the features. The Latest grid takes the three
    // most recent stories after the features, also skipping
    // whatever the rail groups use, so no story appears twice on
    // the front page: features, rail rows and Latest cards are
    // all disjoint.
    const groups = (Array.isArray(railGroups) ? railGroups : [])
      .filter((g) => g && Array.isArray(g.articles) && g.articles.length);
    const railSlugs = new Set(
      groups.flatMap((g) => g.articles.map((a) => a.slug))
    );
    const latestCards = (Array.isArray(latestRow)
      ? latestRow
      : latest.filter((a) => !railSlugs.has(a.slug)).slice(0, 3)
    ).filter(Boolean).slice(0, 3);
    // Rail order: the podcast box (owner request, 2026-11-12),
    // the per-section story groups, the briefing signup (title,
    // one italic line and the form — no roundup paragraph), Local
    // & Statewide, then the near-square rectangle ad slot. In the
    // markup the rail follows the features inside the two-column
    // layout, so on narrow screens the page stacks in reading
    // order: features, rail, strip, Latest grid, module.
    body +=
      '<div class="home-layout"><div class="home-features">' + features + '</div>' +
      '<aside class="home-rail" aria-label="Sidebar">' +
      podcastBox(podcast, briefDates) +
      (groups.length
        ? '<section class="rail-latest" aria-label="Latest stories by section">' +
          groups.map(railSectionGroup).join('') + '</section>'
        : '') +
      // Sports score strip directly under the last rail group
      // (Education & Health) — owner order, 2026-11-23.
      sportsRailBox(sportsLines) +
      briefingBox(briefingThanks, 'homepage') +
      localStatewideBox(localStories) +
      homeRailAdSlot() +
      '</aside></div>';
    // Below the columns, full width: the editorial strip when an
    // Opinion piece exists, then the three-card Latest grid, then
    // the Explore module as the last content element, then the
    // Save buttons' inline script.
    body += editorialStrip(opinion);
    // Colorado Explained module (owner directive, 2026-11-08)
    // replaces the "Latest from Colorado" grid; the Latest grid
    // remains only as the fallback while the store holds no
    // explainers yet.
    if (explained && explained.featured) {
      // Thin leaderboard just above the How Colorado Works module
      // (owner directive, 2026-11-21), with breathing room below
      // the content above it (owner follow-up, same day).
      body += '<div class="ad-breather">' + leaderboardAdSlot() + '</div>';
      body += explainedModule(explained);
    } else if (latestCards.length) {
      body +=
        '<section class="latest-home"><h2 class="latest-home-heading">Latest from Colorado</h2>' +
        '<div class="latest-grid">' + latestCards.map(latestCard).join('') + '</div></section>';
    }
    // Thin leaderboard at the very bottom of the homepage, just
    // above the footer (owner directive, 2026-11-21), in the
    // .final-ad wrapper so its spacing matches the top ad — see
    // its CSS note.
    body += '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
    // Save/Share scripts are added by layout() on every page
    // (2026-11-22: they used to be appended only here, which
    // left the same buttons dead on section and article pages).
  } else {
    body += '<section class="lead-story"><h1 class="headline" style="font-size:2.4rem">Colorado news, reported plainly.</h1><p class="dek">New stories are on the way.</p></section>';
    body += briefingBox(briefingThanks, 'homepage');
    body += '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  }

  return layout({
    title: fitTitle('Colorado News: Politics, Taxes, Energy, Schools & Local Updates', 70),
    description: fitDescription(
      'Track Colorado politics, taxes, energy, schools, business and local decisions with reporting on what changed, who decided it and why it matters. Read today.'
    ),
    path: '/',
    jsonLd,
    activeNav: 'home',
    body,
  });
}

function sectionPage({ section, articles, page: rawPage }) {
  const name = sectionName(section);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: name + ' | ' + SITE_NAME,
      url: absUrl('/section/' + section),
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl() + '/' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: articles.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absUrl('/article/' + a.slug),
        name: a.headline,
      })),
    },
  ];
  const meta = SECTION_META[section] || {
    title: 'Colorado ' + name.toLowerCase() + ' news: state coverage and analysis',
    description:
      'Colorado ' + name.toLowerCase() + ' news reported with the facts first and the original sources linked, from communities across the state. Read the latest stories here.',
  };
  // Opinion carries the satire cartoons too (owner restructure,
  // 2026-11-08): editorials list as ordinary cards, and the comics
  // keep their bare listing (owner instruction, 2026-11-02 — the
  // comic itself, linked to its page, with the owner's long caption
  // under it; no headline, no byline, no date) under their own
  // subhead at the bottom of the Opinion page.
  const satireItems = section === 'opinion' ? articles.filter(isSatire) : [];
  const cardItems =
    section === 'opinion' ? articles.filter((a) => !isSatire(a)) : articles;
  // Paginated listing (owner directive, 2026-11-23): page 1 leads
  // with the most recent story as a featured article below the H1
  // and the opening paragraph, plus forty grid cards; later pages
  // are the grid alone. The Opinion satire block rides page 1 only.
  const pg = paginateListing(cardItems, rawPage);
  const listing =
    (pg.featured
      ? featureDivider() + featureStory(pg.featured, { heading: 'h2' }) + featureDivider()
      : '') +
    paginatedCardGrid(pg.grid) +
    (pg.page === 1 && satireItems.length
      ? featureDivider() +
        '<h2 class="section-subhead">Satire &amp; Editorial Cartoons</h2>' +
        '<div class="satire-list">' +
        satireItems.map(satireListItem).join('') +
        '</div>'
      : '') +
    listingPager('/section/' + section, pg.page, pg.totalPages);
  // No small red section-name label above the title (owner
  // instruction, 2026-11-03): the H1 alone heads the page.
  // Section H1s carry the full masthead form (owner directive,
  // 2026-11-21): "Colorado <Section> News" — a name already ending
  // in "News" does not gain a second one. Three sections have
  // owner-set wording that differs from the pattern (same day).
  const H1_OVERRIDES = {
    politics: 'Colorado Political News',
    business: 'Colorado Business & Tax News',
    'energy-environment': 'Colorado Energy & Environmental News',
    opinion: 'Colorado Opinion & Satire',
  };
  const h1 =
    H1_OVERRIDES[section] ||
    'Colorado ' + name + (/news$/i.test(name) ? '' : ' News');
  const body =
    // The first ad leads the page, above the H1, like the
    // homepage (owner directive, 2026-11-21): as the first
    // element it gets the frame's 1.2rem above and its own 1.4rem
    // below, exactly the homepage top ad's spacing.
    leaderboardAdSlot() +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(h1) + '</h1>' +
    sectionIntro(section) +
    // Politics carries the perennial Federal Lawsuit Tracker guide
    // as a pinned promo above the story listing (owner order,
    // 2026-11-23) — page 1 of the listing only.
    (section === 'politics' && pg.page === 1
      ? '<a class="trk-promo" href="/politics/federal-lawsuit-tracker">' +
        '<span class="trk-promo-kicker">Perennial Guide</span>' +
        '<span class="trk-promo-title" style="display:block">Colorado vs. the Constitution: Federal Lawsuit Tracker</span>' +
        '<span class="trk-promo-line" style="display:block">Every major federal case against Colorado\'s laws in one place: what the state tried to do, what the courts decided, and the $7.82 million taxpayers have paid in fee settlements.</span>' +
        '<span class="trk-promo-cta">Read the tracker &rarr;</span></a>'
      : '') +
    (articles.length
      ? listing
      : '<p>No stories in this section yet. Check back after the next edition.</p>') +
    // Ad where the newsletter signup module used to sit (owner
    // directive, 2026-11-21: ad space instead of the signup box in
    // page content) — the narrow leaderboard form, like the
    // between-grids ads (owner follow-up, same day), in the
    // .final-ad wrapper so its spacing matches the top ad (owner
    // directive, same day).
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle(meta.title + (pg.page > 1 ? ' — Page ' + pg.page : ''), 70),
    description: fitDescription(meta.description),
    path: '/section/' + section,
    jsonLd,
    activeNav: section,
    body,
  });
}

/** Horizontal list of the parts of the state, linking to Local region pages. */
function regionNavList(activeSlug) {
  return (
    '<ul class="region-list">' +
    REGIONS.map(
      (r) =>
        '<li><a href="/local/' + r.slug + '"' +
        (activeSlug === r.slug ? ' class="active"' : '') + '>' + r.name + '</a></li>'
    ).join('') +
    '</ul>'
  );
}

function collectionJsonLd(name, path, articles) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      url: absUrl(path),
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: siteUrl() + '/' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: articles.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absUrl('/article/' + a.slug),
        name: a.headline,
      })),
    },
  ];
}

/** The Local section hub: all Local stories plus the parts-of-the-state list. */
function localHubPage({ articles, page: rawPage }) {
  const pg = paginateListing(articles, rawPage);
  // Same no-kicker rule as the section pages (owner, 2026-11-03).
  const body =
    leaderboardAdSlot() +
    '<h1 class="headline" style="font-size:2.4rem">Colorado Local News</h1>' +
    sectionIntro('local') +
    regionNavList('') +
    (articles.length
      ? // Paginated listing (owner directive, 2026-11-23): page 1
        // leads with the most recent story as a featured article
        // plus forty grid cards; later pages are the grid alone.
        (pg.featured
          ? featureDivider() + featureStory(pg.featured, { heading: 'h2' }) + featureDivider()
          : '') +
        paginatedCardGrid(pg.grid) +
        listingPager('/section/local', pg.page, pg.totalPages)
      : '<p>No local stories yet. Check back after the next edition.</p>') +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';

  return layout({
    title: fitTitle(SECTION_META.local.title + (pg.page > 1 ? ' — Page ' + pg.page : ''), 70),
    description: fitDescription(SECTION_META.local.description),
    path: '/section/local',
    jsonLd: collectionJsonLd('Local News | ' + SITE_NAME, '/section/local', articles),
    activeNav: 'local',
    body,
  });
}

/** A Local region page: Local-section stories carrying one region tag. */
/* Region page meta titles and descriptions, owner-supplied
   (2026-11-21). Separate from REGION_META, which is the visible
   hub-box copy at the foot of region pages. */
const REGION_SEO = {
  'denver-metro': {
    title: 'Denver Metro Local News: Denver, Aurora, Lakewood & School Boards',
    description:
      'Read Denver Metro news covering Denver, Aurora, Lakewood, Thornton and Douglas County, from school boards and housing to taxes, safety and growth. Read today.',
  },
  'northern-colorado': {
    title: 'Northern Colorado Local News: Fort Collins, Boulder, Loveland & More',
    description:
      'Follow Northern Colorado news from Fort Collins, Boulder, Loveland, Longmont and Larimer County, covering councils, budgets, schools and safety. Read today.',
  },
  'southern-colorado': {
    title: 'Southern Colorado Local News: Pueblo, Canon City, Taxes & Schools',
    description:
      'Read Southern Colorado news from Pueblo and Canon City, covering sales taxes, rail plans, school boards, electric bills, elections and city budgets. Read today.',
  },
  'western-slope': {
    title: 'Western Slope Local News: Grand Junction, Montrose, Paonia & Budgets',
    description:
      'Follow Western Slope news from Grand Junction, Montrose and Paonia, covering budgets, schools, public safety, wildlife, water and local services. Read today.',
  },
  southwest: {
    title: 'Southwest Colorado Local News: Durango, Cortez, Pagosa & Floods',
    description:
      'Read Southwest Colorado news from Durango, Cortez, Pagosa Springs and Montezuma County, covering floods, budgets, water rates, growth and elections. Read today.',
  },
  mountains: {
    title: 'Colorado Mountains Local News: Summit, Eagle, Vail, Breckenridge',
    description:
      'Follow Colorado mountain news from Summit, Eagle, Pitkin and Chaffee counties, covering taxes, housing, ski season, budgets and public land use. Read today.',
  },
  'eastern-plains': {
    title: 'Eastern Plains Local News: Sterling, Fort Morgan, Lamar & Farming',
    description:
      'Read Eastern Plains news from Sterling, Fort Morgan, Lamar, Burlington and Logan County, covering farm country, data centers, councils and schools. Read today.',
  },
  'san-luis-valley': {
    title: 'San Luis Valley Local News: Alamosa, Wolf Creek Pass, Schools & Water',
    description:
      'Follow San Luis Valley news from Alamosa, Wolf Creek Pass and school districts, covering county budgets, Highway 160, water, pay plans and recalls. Read today.',
  },
};

/* Region page H1s, owner-set wording (2026-11-21). */
const REGION_H1 = {
  'denver-metro': 'Denver Metro News',
  'northern-colorado': 'Northern Colorado News',
  'southern-colorado': 'Southern Colorado News',
  'western-slope': 'Colorado Western Slope News',
  southwest: 'Southwest Colorado News',
  mountains: 'Colorado Mountain News',
  'eastern-plains': 'Colorado Eastern Plains News',
  'san-luis-valley': 'San Luis Valley News',
};

function localRegionPage({ region, articles, page: rawPage }) {
  const pg = paginateListing(articles, rawPage);
  const path = '/local/' + region.slug;
  const body =
    leaderboardAdSlot() +
    // The region nav bar sits just below the top ad (owner
    // directive, 2026-11-21), above the breadcrumb and H1.
    regionNavList(region.slug) +
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/local">Local News</a> &rsaquo; ' +
    esc(region.name) + '</div>' +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(REGION_H1[region.slug] || region.name) + '</h1>' +
    regionIntro(region) +
    (articles.length
      ? // Paginated listing (owner directive, 2026-11-23): page 1
        // leads with the region's most recent story as a featured
        // article plus forty grid cards; later pages are grid only.
        (pg.featured
          ? featureDivider() + featureStory(pg.featured, { heading: 'h2' }) + featureDivider()
          : '') +
        paginatedCardGrid(pg.grid) +
        listingPager(path, pg.page, pg.totalPages)
      : '<p>No local stories from ' + esc(region.name) + ' yet. Check back after the next edition.</p>') +
    // The page's last element now that the hub box moved to the
    // top: the .final-ad wrapper, so its spacing matches every
    // other bottom ad on the site (owner directive, 2026-11-21).
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';

  const seo = REGION_SEO[region.slug] || {};
  return layout({
    title: fitTitle(
      (seo.title || region.name + ' local news: counties, cities and school boards') +
        (pg.page > 1 ? ' — Page ' + pg.page : ''),
      70
    ),
    description: fitDescription(
      seo.description ||
        REGION_META[region.slug] ||
        'Local news from ' + region.name + ', Colorado: county commissions, city councils, sheriffs and school boards, with the original sources linked. Read the latest.'
    ),
    path,
    jsonLd: collectionJsonLd(region.name + ' Local News | ' + SITE_NAME, path, articles),
    activeNav: 'local',
    body,
  });
}

/**
 * Split an article's stored body into its ordinary sections and its
 * Why It Matters content (redesign spec 4.3). The Why content may be
 * stored as its own field (whyItMatters) and/or as an in-body section
 * headed "Why it matters"; both are pulled out of the section
 * sequence so the renderer can place the callout after the first
 * real section. Nothing is dropped: every paragraph of an extracted
 * in-body section joins the callout, after the stored field's text
 * when both exist, and no content is ever duplicated.
 */
function splitWhySections(a) {
  const whyParas = [];
  if (a.whyItMatters) whyParas.push(a.whyItMatters);
  const sections = [];
  for (const s of a.sections || []) {
    if (s.heading && /^why it matters$/i.test(s.heading.trim())) {
      if (s.lead) whyParas.push(s.lead);
      for (const p of s.paragraphs || []) whyParas.push(p);
    } else {
      sections.push(s);
    }
  }
  return { sections, whyParas };
}

/**
 * The paragraphs of a satire piece's stored body, in order: the
 * owner's long caption exactly as provided (the blurbs are stored
 * as the body). Section headings, if any ever appear, are not part
 * of the caption and are skipped.
 */
function satireCaptionParas(a) {
  const paras = [];
  for (const s of a.sections || []) {
    if (s.lead) paras.push(s.lead);
    for (const p of s.paragraphs || []) paras.push(p);
  }
  return paras;
}

function satireCaptionHtml(a) {
  const paras = satireCaptionParas(a);
  if (!paras.length) return '';
  return (
    '<div class="satire-caption">' +
    paras.map((p) => '<p>' + inline(p) + '</p>').join('') +
    '</div>'
  );
}

/** One entry on the Satire section page: the comic, linked to its
 * own page, with the long caption under it. No headline or byline. */
function satireListItem(a) {
  return (
    '<div class="satire-item">' +
    articleFigure(a, '', { link: true, noCaption: true, width: 1000 }) +
    satireCaptionHtml(a) +
    '</div>'
  );
}

/**
 * A satire piece's page (owner instruction, 2026-11-02): only the
 * comic and the owner's long caption as provided — no headline, no
 * subheader, no byline, no sidebar, no related grid — with
 * previous/next buttons under the caption to move between comics.
 * `prev` is the older comic, `next` the newer one; either may be
 * null at the ends of the run, and its button is then omitted. The
 * working title still serves the browser tab and search metadata,
 * where a title has to exist; it is not printed on the page.
 */
function satirePage(a, prev, next) {
  const url = absUrl('/article/' + a.slug);
  const title = fitTitle(a.seoTitle || a.headline, 70);
  const description = articleDescription(a);
  const imgUrl = shareImageUrl(a);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: a.headline,
      description,
      image: imgUrl || undefined,
      datePublished: a.publishedAt,
      dateModified: a.modifiedAt || a.publishedAt,
      publisher: {
        '@type': 'NewsMediaOrganization',
        name: SITE_NAME,
        url: siteUrl() + '/',
        sameAs: SOCIAL_PROFILES,
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: 'Opinion',
    },
  ];
  let nav = '';
  if (prev || next) {
    nav =
      '<nav class="satire-nav" aria-label="More cartoons">' +
      (prev
        ? '<a class="prev" href="/article/' + esc(prev.slug) + '">&larr; Previous comic</a>'
        : '') +
      (next
        ? '<a class="next" href="/article/' + esc(next.slug) + '">Next comic &rarr;</a>'
        : '') +
      '</nav>';
  }
  // The usual ads (owner order, 2026-11-22): a leaderboard above
  // the comic and the standard .final-ad bottom leaderboard,
  // superseding the earlier no-ads exception for satire pages.
  // The comic, its caption and the Previous/Next nav are unchanged.
  const body =
    leaderboardAdSlot() +
    '<div class="satire-wrap">' +
    // Dateline (owner order, 2026-11-24): the date the cartoon was
    // first posted, on the cartoon's own page only — never on the
    // section-page cards.
    (a.publishedAt
      ? '<p class="satire-dateline">' + esc(fmtMetaDate(a.publishedAt)) + '</p>'
      : '') +
    articleFigure(a, 'satire-hero', { noCaption: true, width: 1000 }) +
    satireCaptionHtml(a) +
    nav +
    '</div>' +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title,
    description,
    path: '/article/' + a.slug,
    ogType: 'article',
    ogImage: imgUrl,
    articleMeta: {
      published: a.publishedAt,
      modified: a.modifiedAt || a.publishedAt,
      section: 'Opinion',
    },
    jsonLd,
    activeNav: 'opinion',
    body,
  });
}

/* Article series (owner order, 2026-11-22): each installment of
 * the Opinion series "Colorado Wasn't Just Flipped. It Was
 * Engineered." carries a series box — at the top of the article
 * and again at its end — naming the series and linking every part,
 * so a reader landing on any installment can reach the others.
 * The part being read is shown in bold, not as a link. */
const ARTICLE_SERIES = [
  {
    title: "Colorado Wasn't Just Flipped. It Was Engineered.",
    parts: [
      { slug: 'colorado-wasnt-just-flipped-it-was-engineered-part-one', label: 'Part 1' },
      { slug: 'colorado-wasnt-just-flipped-it-was-engineered-part-two', label: 'Part 2' },
      { slug: 'colorado-wasnt-just-flipped-it-was-engineered-part-three', label: 'Part 3' },
      { slug: 'colorado-wasnt-just-flipped-it-was-engineered-part-four', label: 'Part 4' },
    ],
  },
];

function seriesBox(a) {
  const series = ARTICLE_SERIES.find((s) => s.parts.some((p) => p.slug === a.slug));
  if (!series) return '';
  const items = series.parts
    .map((p) =>
      p.slug === a.slug
        ? '<li class="current">' + esc(p.label) + ' (this part)</li>'
        : '<li><a href="/article/' + p.slug + '">' + esc(p.label) + '</a></li>'
    )
    .join('');
  return (
    '<nav class="series-box" aria-label="Series: ' + esc(series.title) + '">' +
    '<div class="series-label">A four-part series</div>' +
    '<div class="series-title">' + esc(series.title) + '</div>' +
    '<ul>' + items + '</ul>' +
    '</nav>'
  );
}

function articlePage(a, related, localStories, explainedRelated, podcast, briefDates, railGroups) {
  const url = absUrl('/article/' + a.slug);
  const title = fitTitle(a.seoTitle || a.headline, 70);
  const description = articleDescription(a);
  const imgUrl = shareImageUrl(a);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: a.headline,
      description,
      image: imgUrl || undefined,
      datePublished: a.publishedAt,
      dateModified: a.modifiedAt || a.publishedAt,
      author: { '@type': 'Person', name: a.byline },
      publisher: {
        '@type': 'NewsMediaOrganization',
        name: SITE_NAME,
        url: siteUrl() + '/',
        sameAs: SOCIAL_PROFILES,
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: sectionName(a.section),
      isBasedOn: a.sourceUrl || undefined,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl() + '/' },
        { '@type': 'ListItem', position: 2, name: sectionName(a.section), item: absUrl('/section/' + a.section) },
        { '@type': 'ListItem', position: 3, name: a.headline, item: url },
      ],
    },
  ];

  // Article rendering order (redesign spec 4.2): breadcrumb;
  // kicker with a gold rule extending right; H1; italic deck;
  // byline; the full-width illustration with its caption; the first
  // section in full, its opening paragraph carrying the red drop
  // cap; the Why It Matters callout; the remaining sections in
  // their original order; Sources. No paragraph, heading or source
  // is shortened, rewritten or dropped in the rearrangement.
  const { sections, whyParas } = splitWhySections(a);
  const whyBox = whyParas.length
    ? '<div class="why"><div class="why-label">Why It Matters</div>' +
      whyParas.map((p) => '<p>' + inline(p) + '</p>').join('') + '</div>'
    : '';

  let body =
    '<div class="article-layout"><article class="full">' +
    leaderboardAdSlot() +
    (isExplained(a)
      ? '<div class="series-label"><a href="/explained">How Colorado Works</a></div>'
      : '') +
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/' + a.section + '">' +
    esc(sectionName(a.section)) + '</a> &rsaquo; ' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<div class="kicker-row"><span class="kicker">' + esc(a.topicLabel || sectionName(a.section)) +
    (a.region
      ? ' &middot; <a href="/local/' + regionSlug(a.region) + '">' + esc(a.region) + '</a>'
      : '') + '</span></div>' +
    '<h1>' + esc(a.headline) + '</h1>' +
    (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '') +
    '<div class="byline">' + bylineLine(a) + '</div>';

  // Save and Share controls under the byline (owner order,
  // 2026-11-22: the buttons from the homepage features, now on
  // article pages too; their behavior ships in layout()).
  body +=
    '<div class="feature-actions"><button type="button" class="btn-save" data-save-slug="' + esc(a.slug) +
    '" aria-pressed="false">📌 Save</button>' + shareControl(a) + '</div>';

  // Full-width hero illustration, in its own figure directly under
  // the byline: no float, no crop, caption beneath.
  body += seriesBox(a);
  body += articleFigure(a, 'article-hero', { width: 1200 });
  body += '<div class="article-body">';
  sections.forEach((s, i) => {
    // Colorado Explained pieces carry a "The Short Answer" section
    // that renders as a distinct summary box instead of a headed
    // section (owner directive, 2026-11-08).
    const shortAnswer =
      isExplained(a) &&
      String(s.heading || '').trim().toLowerCase() === 'the short answer';
    let inner = '';
    if (s.heading && !shortAnswer) inner += '<h2>' + esc(s.heading) + '</h2>';
    // Blocks: the section lead, then its paragraphs. Consecutive
    // bullet blocks (starting with "•") group into one list — the
    // explainer house style; every other block keeps the
    // established paragraph treatment, drop cap included.
    const blocks = [];
    if (s.lead) blocks.push(s.lead);
    for (const p of s.paragraphs) blocks.push(p);
    let firstPara = true;
    let listBuf = [];
    const flushList = () => {
      if (listBuf.length) {
        inner +=
          '<ul class="explainer-list">' +
          listBuf.map((t) => '<li>' + inline(t) + '</li>').join('') +
          '</ul>';
        listBuf = [];
      }
    };
    blocks.forEach((raw, bi) => {
      const txt = String(raw || '');
      if (txt.trim().startsWith('•')) {
        listBuf.push(txt.trim().replace(/^•\s*/, ''));
        firstPara = false;
        return;
      }
      flushList();
      if (bi === 0 && s.lead) {
        inner +=
          '<p class="lead' + (i === 0 && !shortAnswer ? ' dropcap' : '') + '">' +
          inline(txt) + '</p>';
      } else {
        inner +=
          '<p' + (i === 0 && firstPara && !shortAnswer ? ' class="dropcap"' : '') + '>' +
          inline(txt) + '</p>';
      }
      firstPara = false;
    });
    flushList();
    if (shortAnswer) {
      body +=
        '<div class="short-answer"><div class="short-answer-label">The Short Answer</div>' +
        inner + '</div>';
    } else {
      body += inner;
    }
    // The Why It Matters callout goes after the first complete
    // section (also when it is the only section), before the
    // second H2.
    if (i === 0) body += whyBox + leaderboardAdSlot();
  });
  if (!sections.length) body += whyBox + leaderboardAdSlot();

  // Sources block: the article's full stored source list, one link
  // per source (owner instruction, 2026-11-03: list them all — the
  // live store once kept only the primary source). Pieces whose body
  // already ends with their own Sources section (the owner's Opinion
  // pieces carry their citations at the bottom of the text) skip
  // this block, so no page ever shows two source listings.
  const lastHeading = sections.length
    ? String(sections[sections.length - 1].heading || '').trim().toLowerCase()
    : '';
  const bodyHasSources = lastHeading === 'sources';
  const storedSources = (Array.isArray(a.sources) ? a.sources : []).filter(
    (s) => s && s.url
  );
  if (!bodyHasSources && storedSources.length) {
    body +=
      '<section class="sources-block"><h2>Sources</h2>' +
      storedSources
        .map(
          (s) =>
            '<p class="source"><a href="' + esc(s.url) +
            '" rel="noopener" target="_blank">' + esc(s.name || s.url) + '</a></p>'
        )
        .join('') +
      '</section>';
  } else if (!bodyHasSources && (a.sourceUrl || a.sourceName)) {
    body +=
      '<section class="sources-block"><h2>Sources</h2><p class="source">' +
      (a.sourceUrl
        ? '<a href="' + esc(a.sourceUrl) + '" rel="noopener" target="_blank">' +
          esc(a.sourceName || a.sourceUrl) + '</a>'
        : esc(a.sourceName)) +
      '</p></section>';
  }
  // Colorado Explained pieces close with links to related
  // explainers and their last-reviewed date (owner directive,
  // 2026-11-08), inside the article column after Sources.
  if (isExplained(a)) {
    const rel = (Array.isArray(explainedRelated) ? explainedRelated : [])
      .filter(Boolean)
      .slice(0, 3);
    if (rel.length) {
      body +=
        '<section class="explained-related"><h2>More From How Colorado Works</h2><ul>' +
        rel
          .map(
            (r) =>
              '<li><span class="rel-cat">' + esc(sectionName(r.section)) +
              '</span><a href="/article/' + esc(r.slug) + '">' +
              esc(r.headline) + '</a></li>'
          )
          .join('') +
        '</ul></section>';
    }
    body +=
      '<p class="last-reviewed">Last reviewed ' +
      esc(fmtDateShort(a.lastReviewed || a.publishedAt)) +
      ' &middot; Part of the <a href="/explained">How Colorado Works</a> series</p>';
  }
  body += '</div></article>';
  // Article sidebar: the same right column as the homepage rail,
  // minus the Sports score strip and minus Local & Statewide
  // (owner orders, 2026-11-24) — the podcast box, the per-section
  // story groups, the newsletter (Briefing) signup, then a single
  // rectangle advertisement.
  const aGroups = (Array.isArray(railGroups) ? railGroups : [])
    .filter((g) => g && Array.isArray(g.articles) && g.articles.length);
  body +=
    '<aside class="article-rail" aria-label="Sidebar">' +
    podcastBox(podcast, briefDates) +
    (aGroups.length
      ? '<section class="rail-latest" aria-label="Latest stories by section">' +
        aGroups.map(railSectionGroup).join('') + '</section>'
      : '') +
    briefingBox(false, 'article') +
    rectangleAdSlot() +
    '</aside></div>';

  body += seriesBox(a);

  // Ad at the end of the article, where the contextual newsletter
  // signup module used to sit (owner directive, 2026-11-21: ad
  // space instead of the signup box in page content, on articles
  // and section pages alike) — a thin leaderboard like the section
  // pages, not the tall in-content unit (owner directive, same
  // day; all article-page placeholders are leaderboards now).
  // Satire pages carry no ads, as before. When no related-stories
  // grid follows, the ad is the page's last element, so it takes
  // the .final-ad wrapper and its spacing matches the top ad
  // (owner directive, same day); with the grid below it, it is a
  // mid-page ad as-is.
  if (!isSatire(a)) {
    body +=
      related && related.length
        ? leaderboardAdSlot()
        : '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  }

  if (related && related.length) {
    // "More in <Section>" grid (owner order, 2026-11-24): the
    // section pages' four-across card grid, two rows deep (the
    // route passes up to eight related stories), spanning the
    // full page width below the article columns, with the
    // section-break divider directly above the heading (owner
    // order, same day).
    body += featureDivider() + '<h2 style="font-family:\'Playfair Display\',Georgia,serif">More in ' + esc(sectionName(a.section)) +
      '</h2><div class="grid grid-4col">' + related.map(articleCard).join('') + '</div>';
  }
  // The section's end-of-page SEO blurb (hubBox) belongs ONLY on
  // the section's main page, never on articles in that section
  // (owner instruction, 2026-11-08).

  return layout({
    title,
    description,
    path: '/article/' + a.slug,
    ogType: 'article',
    ogImage: imgUrl,
    articleMeta: {
      published: a.publishedAt,
      modified: a.modifiedAt || a.publishedAt,
      section: sectionName(a.section),
    },
    jsonLd,
    activeNav: a.section,
    body,
  });
}

function subscribePage(opts) {
  const o = opts || {};
  let notice = '';
  if (o.sent) {
    notice =
      '<div class="nl-notice nl-wide-notice"><strong>Thank you.</strong> We have sent a confirmation email to ' +
      esc(o.email || 'your inbox') +
      '. Click the link in that email to finish signing up. You can set topics and regions there too, or leave them for later.</div>';
  } else if (o.error) {
    notice =
      '<div class="nl-notice nl-wide-notice"><strong>That email address does not look right.</strong> Check it and try again.</div>';
  }
  const body =
    '<div class="kicker">Newsletter</div>' +
    '<h1 class="headline" style="font-size:2.4rem">Stay Informed. Stay Colorado.</h1>' +
    '<p class="dek">Get Colorado\'s top stories delivered to your inbox. Subscribe to the free morning briefing, follow your favorite topics, or receive news from the regions that matter to you.</p>' +
    notice +
    '<form class="nl-panel nl-wide-panel" method="post" action="/subscribe">' +
    '<input type="hidden" name="source" value="subscribe-page">' +
    '<div class="nl-field"><label for="nl-email">Email address</label>' +
    '<input id="nl-email" type="email" name="email" required placeholder="Your email address" value="' +
    esc(o.email || '') +
    '"></div>' +
    '<div class="nl-row">' +
    '<div class="nl-field"><label for="nl-name">First name (optional)</label>' +
    '<input id="nl-name" type="text" name="first_name" placeholder="First name"></div>' +
    '<div class="nl-field"><label for="nl-last">Last name (optional)</label>' +
    '<input id="nl-last" type="text" name="last_name" placeholder="Last name"></div>' +
    '</div>' +
    '<div class="nl-row">' +
    '<div class="nl-field" style="flex:0 1 240px"><label for="nl-zip">ZIP code (optional)</label>' +
    '<input id="nl-zip" type="text" name="zip_code" inputmode="numeric" autocomplete="postal-code" placeholder="ZIP code"></div>' +
    '</div>' +
    '<h2>Free Weekday Newsletter</h2>' +
    '<label class="nl-check"><input type="checkbox" name="daily_brief" checked> <span>Send me the free weekday morning newsletter.</span></label>' +
    '<h2>Topics</h2>' +
    '<p class="nl-note-small" style="margin:0 0 .4rem">Pick the sections you want in a personal digest email. Leave them all blank if you only want the weekday newsletter.</p>' +
    topicCheckboxes([]) +
    '<h2>Regions</h2>' +
    '<p class="nl-note-small" style="margin:0 0 .4rem">Pick the parts of Colorado you want local news from.</p>' +
    regionCheckboxes([]) +
    '<button class="nl-primary" type="submit">Subscribe for Free</button>' +
    '<p class="nl-note-small">Free to subscribe. No spam. Unsubscribe or change your preferences anytime.</p>' +
    '<p class="nl-note-small">If you pick topics or regions, we will also send a digest of matching stories, once a day on weekdays by default. You can change the frequency, pause, or stop it in your preferences at any time.</p>' +
    '</form>' +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Colorado News by Email: Free Weekday Newsletter & Local Digests', 70),
    description: fitDescription(
      'Get Colorado\'s top stories by email with a free weekday newsletter, topic digests and regional updates for the places and issues you follow most. Sign up today.'
    ),
    path: '/subscribe',
    body,
  });
}

/** Landing page for /preferences: ask for the address, email a link. */
function preferencesLandingPage(opts) {
  const o = opts || {};
  const body =
    '<div class="static-page"><h1>Manage Your Email Preferences</h1>' +
    (o.sent
      ? '<p>We have sent a manage-preferences link to that address. The link works for 30 days. If no email arrives, check that the address matches the one you subscribed with.</p>'
      : '<p>Enter the email address you subscribed with and we will send you a link to your preference center. There is no password. From the preference center you can change your topics, regions and digest frequency, pause your subscription, change your email address, or unsubscribe.</p>' +
        '<form class="nl-panel" method="post" action="/preferences/request">' +
        '<div class="nl-field"><label for="pref-email">Email address</label>' +
        '<input id="pref-email" type="email" name="email" required placeholder="Your email address"></div>' +
        '<button class="nl-primary" type="submit">Email Me the Link</button>' +
        '</form>') +
    '</div>' +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Manage your email preferences, The Centennial Ledger', 70),
    description: fitDescription(
      'Manage your Centennial Ledger email subscriptions: change topics, regions and digest frequency, pause, change your address, or unsubscribe. No password needed.'
    ),
    path: '/preferences',
    body,
  });
}

/** The preference center itself, reached from a signed email link. */
function preferencesPage({ sub, token, saved, error }) {
  const action = '/preferences/' + esc(token);
  const freqRadio = (value, label, hint) =>
    '<label class="nl-radio"><input type="radio" name="digest_frequency" value="' +
    value +
    '"' +
    (sub.digestFrequency === value ? ' checked' : '') +
    '> <span>' +
    label +
    (hint ? ' <span style="color:#555">(' + hint + ')</span>' : '') +
    '</span></label>';
  let body =
    '<div class="static-page"><h1>Your Email Preferences</h1>' +
    '<p>Signed in as <strong>' + esc(sub.email) + '</strong>. ' +
    (sub.status === 'confirmed'
      ? 'Your subscription is active.'
      : sub.status === 'pending'
        ? 'Your subscription is waiting for confirmation. Check your inbox for the confirmation email.'
        : 'You are unsubscribed. To start again, use the <a href="/subscribe">subscribe page</a> and confirm from your inbox.') +
    '</p>';
  if (saved) body += '<div class="nl-notice"><strong>Saved.</strong> Your preferences are updated.</div>';
  if (error === 'email-sent') {
    body += '<div class="nl-notice"><strong>Confirmation sent.</strong> We emailed the new address. Click the link in that email to finish the change.</div>';
  } else if (error === 'invalid-email') {
    body += '<div class="nl-notice"><strong>That email address does not look right.</strong> The change was not made.</div>';
  } else if (error === 'email-in-use') {
    body += '<div class="nl-notice"><strong>That address already has a subscription.</strong> The change was not made.</div>';
  }
  body +=
    '<form class="nl-panel" method="post" action="' + action + '">' +
    '<div class="nl-row">' +
    '<div class="nl-field"><label for="pref-name">First name</label>' +
    '<input id="pref-name" type="text" name="first_name" value="' + esc(sub.firstName || '') + '"></div>' +
    '<div class="nl-field"><label for="pref-last">Last name</label>' +
    '<input id="pref-last" type="text" name="last_name" value="' + esc(sub.lastName || '') + '"></div>' +
    '</div>' +
    '<div class="nl-row">' +
    '<div class="nl-field" style="flex:0 1 240px"><label for="pref-zip">ZIP code</label>' +
    '<input id="pref-zip" type="text" name="zip_code" inputmode="numeric" autocomplete="postal-code" value="' + esc(sub.zipCode || '') + '"></div>' +
    '</div>' +
    '<h2>Free Weekday Newsletter</h2>' +
    '<label class="nl-check"><input type="checkbox" name="daily_brief"' +
    (sub.dailyBrief ? ' checked' : '') +
    '> <span>Send me the free weekday newsletter, Monday to Friday.</span></label>' +
    '<h2>Topics</h2>' +
    topicCheckboxes(sub.topics) +
    '<h2>Regions</h2>' +
    regionCheckboxes(sub.regions) +
    '<h2>Digest frequency</h2>' +
    '<p class="nl-note-small" style="margin:0 0 .4rem">A digest collects stories matching your topics and regions. A story is never sent to you twice.</p>' +
    freqRadio('daily', 'Daily', 'weekdays') +
    freqRadio('weekly', 'Weekly', 'Monday, covering the past week') +
    freqRadio('off', 'No digest') +
    '<h2>Breaking news</h2>' +
    '<label class="nl-check"><input type="checkbox" name="breaking"' +
    (sub.breakingOptIn ? ' checked' : '') +
    '> <span>Email me when major Colorado news breaks.</span></label>' +
    '<h2>Pause</h2>' +
    '<label class="nl-check"><input type="checkbox" name="paused"' +
    (sub.paused ? ' checked' : '') +
    '> <span>Pause all newsletter email for now. Your settings stay saved.</span></label>' +
    '<button class="nl-primary" type="submit">Save Preferences</button>' +
    '</form>' +
    '<h2 style="font-family:var(--font-headline)">Change your email address</h2>' +
    '<form class="nl-panel" method="post" action="' + action + '/change-email">' +
    '<div class="nl-field"><label for="pref-new-email">New email address</label>' +
    '<input id="pref-new-email" type="email" name="new_email" required placeholder="New email address"></div>' +
    '<p class="nl-note-small">We will email the new address a confirmation link. The change applies when you click it.</p>' +
    '<button class="nl-primary" type="submit">Send Confirmation to the New Address</button>' +
    '</form>' +
    '<h2 style="font-family:var(--font-headline)">Unsubscribe</h2>' +
    '<form class="nl-panel" method="post" action="' + action + '/unsubscribe">' +
    '<p>Stop all Ledger email: the weekday newsletter, digests and breaking news.</p>' +
    '<button class="nl-danger" type="submit">Unsubscribe From All Emails</button>' +
    '</form></div>' +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Your email preferences, The Centennial Ledger', 70),
    description: fitDescription(
      'Your Centennial Ledger preference center: weekday newsletter, topics, regions, digest frequency, breaking news, pause, email change and unsubscribe.'
    ),
    path: '/preferences',
    body,
  });
}

/** GET page behind an unsubscribe link: confirm before it happens. */
function unsubscribeConfirmPage(token) {
  const body =
    '<div class="static-page"><h1>Unsubscribe</h1>' +
    '<p>Stop all email from The Centennial Ledger: the weekday newsletter, digests and breaking news alerts. You can subscribe again at any time.</p>' +
    '<form method="post" action="/unsubscribe/' + esc(token) + '">' +
    '<button class="nl-danger" type="submit">Unsubscribe Me</button></form>' +
    '<p class="nl-note-small">Changed your mind about some of it? <a href="/preferences">Manage your preferences</a> instead.</p></div>' +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Unsubscribe from Ledger email, The Centennial Ledger', 70),
    description: fitDescription(
      'Unsubscribe from The Centennial Ledger email: the weekday newsletter, digests and breaking news alerts stop, and the address is not emailed again.'
    ),
    path: '/unsubscribe',
    body,
  });
}

/**
 * Internal newsletter dashboard (secret-gated in server.js). Plain
 * tables and forms; the secret rides in the query string so links
 * and form posts stay inside the tool.
 */
function adminNewsletterPage(d) {
  const key = '?key=' + encodeURIComponent(d.key);
  const card = (num, lbl) =>
    '<div class="admin-card"><div class="num">' + esc(String(num)) + '</div><div class="lbl">' + esc(lbl) + '</div></div>';
  const countRows = (rows) =>
    rows
      .map((r) => '<tr><td>' + esc(r.name) + '</td><td>' + esc(String(r.count)) + '</td></tr>')
      .join('');
  let body = '<div class="static-page" style="max-width:1000px"><h1>Newsletter Admin</h1>';
  if (d.msg) body += '<div class="nl-notice">' + esc(d.msg) + '</div>';
  body +=
    '<p>Email provider: <strong>' +
    (d.provider === 'ses' ? 'Amazon SES (live)' : 'Outbox only. Amazon SES is not configured, so sends are written to the outbox table below.') +
    '</strong><br>Scheduled send time: ' + esc(d.sendTime) + ' Denver, Monday to Friday. Autosend: ' +
    (d.autosend ? 'on' : 'off (drafts wait for approval here)') +
    '.<br><a href="/admin/newsletter/export.csv' + key + '">Download subscriber CSV</a></p>';

  body +=
    '<div class="admin-cards">' +
    card(d.stats.total, 'Total subscribers') +
    card(d.stats.confirmed, 'Confirmed active') +
    card(d.stats.newToday, 'New today') +
    card(d.stats.new7d, 'New in 7 days') +
    card(d.stats.new30d, 'New in 30 days') +
    card(d.stats.unsubscribed, 'Unsubscribed (total)') +
    '</div>';

  body +=
    '<div class="admin-section"><h2>Signups by day, last 30 days</h2>' +
    '<table class="admin-table"><tr><th>Date</th><th>Signups</th></tr>' +
    d.growth
      .map((g) => '<tr><td>' + esc(g.date) + '</td><td>' + esc(String(g.count)) + '</td></tr>')
      .join('') +
    '</table></div>';

  body +=
    '<div class="admin-section"><h2>Preferences (confirmed subscribers)</h2>' +
    '<p class="nl-note-small">Topic and region counts overlap: one subscriber can follow several topics and regions, so these numbers are not unique people.</p>' +
    '<table class="admin-table"><tr><th>Topic</th><th>Subscribers</th></tr>' +
    countRows(d.topicCounts) +
    '</table>' +
    '<table class="admin-table"><tr><th>Region</th><th>Subscribers</th></tr>' +
    countRows(d.regionCounts) +
    '</table>' +
    '<table class="admin-table"><tr><th>Preference</th><th>Subscribers</th></tr>' +
    '<tr><td>Weekday newsletter</td><td>' + esc(String(d.dailyBriefCount)) + '</td></tr>' +
    '<tr><td>Digest: daily</td><td>' + esc(String(d.freqCounts.daily || 0)) + '</td></tr>' +
    '<tr><td>Digest: weekly</td><td>' + esc(String(d.freqCounts.weekly || 0)) + '</td></tr>' +
    '<tr><td>Digest: off</td><td>' + esc(String(d.freqCounts.off || 0)) + '</td></tr>' +
    '<tr><td>Breaking news opt-in</td><td>' + esc(String(d.breakingCount)) + '</td></tr>' +
    '<tr><td>Paused</td><td>' + esc(String(d.pausedCount)) + '</td></tr>' +
    '</table></div>';

  body +=
    '<div class="admin-section"><h2>Weekday Newsletter</h2>' +
    '<form method="post" action="/admin/newsletter/generate' + key + '">' +
    '<button class="nl-danger" style="border-color:var(--color-gold);color:#333" type="submit">Build today\'s draft</button></form>' +
    '<p class="nl-note-small">The scheduler builds the draft at the send time on weekdays. This button does the same thing now, for testing.</p></div>';

  body +=
    '<div class="admin-section"><h2>Campaigns</h2>' +
    '<table class="admin-table"><tr><th>ID</th><th>Type</th><th>Date</th><th>Subject</th><th>Status</th><th>Recipients</th><th></th></tr>' +
    d.campaigns
      .map(
        (c) =>
          '<tr><td>' + c.id + '</td><td>' + esc(c.type) + '</td><td>' + esc(c.sendDate) + '</td><td>' +
          esc(c.subject) + '</td><td>' + esc(c.status) + '</td><td>' + esc(String(c.recipients || 0)) +
          '</td><td><a href="/admin/newsletter' + key + '&preview=' + c.id + '">Preview</a></td></tr>'
      )
      .join('') +
    '</table></div>';

  if (d.preview) {
    const c = d.preview.campaign;
    body +=
      '<div class="admin-section"><h2>Preview: ' + esc(c.type) + ' #' + c.id + ', ' + esc(c.subject) + '</h2>' +
      '<div class="admin-preview"><iframe title="Email preview" style="width:100%;height:640px;border:0" srcdoc="' +
      esc(d.preview.html) +
      '"></iframe></div>';
    if (c.status === 'draft') {
      body +=
        '<form method="post" action="/admin/newsletter/campaign/' + c.id + '/send' + key + '" style="display:inline-block;margin-right:.6rem">' +
        '<button class="nl-primary" style="width:auto;padding:.55rem 1.2rem" type="submit">Approve &amp; Send</button></form>' +
        '<form method="post" action="/admin/newsletter/campaign/' + c.id + '/test' + key + '" style="display:inline-block">' +
        '<button type="submit">Send test to ' + esc(d.testEmail || 'NEWSLETTER_TEST_EMAIL (not set)') + '</button></form>' +
        '<form method="post" action="/admin/newsletter/campaign/' + c.id + '/sponsor' + key + '" style="margin-top:1rem">' +
        '<div class="nl-field"><label>Sponsor name (optional; block hidden when any field is empty)</label>' +
        '<input type="text" name="sponsor_name" value="' + esc(c.sponsorName || '') + '"></div>' +
        '<div class="nl-field"><label>Sponsor message</label>' +
        '<input type="text" name="sponsor_message" value="' + esc(c.sponsorMessage || '') + '"></div>' +
        '<div class="nl-field"><label>Sponsor link</label>' +
        '<input type="text" name="sponsor_url" value="' + esc(c.sponsorUrl || '') + '"></div>' +
        '<button type="submit">Save Sponsor Block</button></form>';
    }
    body += '</div>';
  }

  body +=
    '<div class="admin-section"><h2>Breaking news (manual only)</h2>' +
    '<form method="post" action="/admin/newsletter/breaking' + key + '">' +
    '<div class="nl-field"><label>Subject line</label>' +
    '<input type="text" name="subject" required placeholder="Breaking: ..."></div>' +
    '<p class="nl-note-small">Pick the stories to include. The campaign is created as a draft; sending still takes the Approve &amp; Send button on its preview. Only subscribers who opted in to breaking news receive it.</p>' +
    d.breakingCandidates
      .map(
        (a) =>
          '<label class="nl-check"><input type="checkbox" name="articles" value="' +
          esc(a.slug) +
          '"> <span>' +
          esc(a.headline) +
          ' <span style="color:#555">(' +
          esc(a.sectionName) +
          ')</span></span></label>'
      )
      .join('') +
    '<button class="nl-primary" style="width:auto;padding:.55rem 1.2rem;margin-top:.6rem" type="submit">Create Breaking Draft</button>' +
    '</form></div>';

  body +=
    '<div class="admin-section"><h2>Outbox, latest 50</h2>' +
    '<table class="admin-table"><tr><th>When</th><th>To</th><th>Subject</th><th>Kind</th><th>Status</th></tr>' +
    d.outbox
      .map(
        (o) =>
          '<tr><td>' + esc(o.createdAt) + '</td><td>' + esc(o.to) + '</td><td>' + esc(o.subject) +
          '</td><td>' + esc(o.kind) + '</td><td>' + esc(o.status) + '</td></tr>'
      )
      .join('') +
    '</table></div></div>';

  return layout({
    title: 'Newsletter admin | ' + SITE_NAME,
    description: 'Internal newsletter dashboard.',
    path: '/admin/newsletter',
    body,
  });
}

/** Small notice page for confirm and unsubscribe outcomes. */
function newsletterNoticePage({ heading, text, linkHref, linkText }) {
  const body =
    '<div class="static-page"><h1>' + esc(heading) + '</h1><p>' + esc(text) + '</p>' +
    (linkHref
      ? '<p><a href="' + esc(linkHref) + '">' + esc(linkText || 'Continue') + '</a></p>'
      : '') +
    '</div>';
  return layout({
    title: fitTitle(heading + ', The Centennial Ledger', 70),
    description: fitDescription(text),
    path: '/subscribe',
    body,
  });
}

function checkoutPage(tier) {
  const names = { free: 'Free', patriot: 'Patriot', founding: 'Founding' };
  const name = names[tier] || 'Patriot';
  let checkoutDescription =
    'Complete your ' + name + ' subscription for full access to Colorado political news, deeper reporting and your saved stories. Secure checkout opens shortly.';
  // The shortest tier name leaves the description under the 150-char
  // floor; close with the call to action to land it in range.
  if (checkoutDescription.length < 150) checkoutDescription += ' Join today.';
  const body =
    '<div class="static-page"><h1>Checkout</h1>' +
    '<p>You selected the <strong>' + esc(name) + '</strong> tier.</p>' +
    '<p>Online checkout is being connected now and will open shortly. Paid tiers launch as soon as secure billing is in place; the Free tier and the free weekday newsletter are available today.</p>' +
    '<p><a href="/subscribe">&larr; Back to subscription options</a></p></div>' +
    briefingBox(false);
  return layout({
    title: fitTitle(name + ' subscription checkout for Colorado political news', 70),
    description: fitDescription(checkoutDescription),
    path: '/subscribe/checkout',
    body,
  });
}

function searchPage(q, results) {
  const body =
    '<h1 class="headline" style="font-size:2.4rem">Search The Centennial Ledger</h1>' +
    '<form class="searchbox" method="get" action="/search"><input type="search" name="q" value="' +
    esc(q || '') + '" placeholder="Search Colorado stories" aria-label="Search"><button type="submit">Search</button></form>' +
    (q
      ? results.length
        ? '<div class="grid">' + results.map(articleCard).join('') + '</div>'
        : '<p>No stories matched &ldquo;' + esc(q) + '&rdquo;. Try a town, a county, or a topic.</p>'
      : '<p>Search headlines, topics, and regions across every section.</p>') +
    '<div class="final-ad">' + leaderboardAdSlot() + '</div>';
  return layout({
    title: fitTitle('Search Colorado news by town, county, topic and headline', 70),
    description: fitDescription(
      'Search Colorado news stories by town, county, topic or headline across politics, taxes, rights, energy, schools and local coverage. Find a story and read it.'
    ),
    path: '/search',
    body,
  });
}

/* Editorial Standards page body (owner order, 2026-11-21): the
 * publication's standards, stated plainly — human review, primary
 * sources, attribution, fairness without false equivalence,
 * corrections, transparency, and AI-assisted tools under human
 * editorial oversight. */
const EDITORIAL_STANDARDS_HTML =
  '<p>The Centennial Ledger is an independent Colorado news and public-affairs publication. These standards govern how our reporting is produced, reviewed, and corrected, and they apply to every article we publish.</p>' +
  '<h2>Human editorial review</h2><p>Every article undergoes human editorial review before publication. Material information — factual claims, statistics, quotations, names, dates, and figures — is checked for accuracy against the underlying sources. Editorial content is reviewed for accuracy, fairness, completeness, context, and clarity.</p>' +
  '<h2>Sources</h2><p>Reporting relies on credible sources, with primary sources prioritized whenever they are available: government documents, court records, legislative materials, official data, and public records, supplemented by reporting from established news organizations. Material claims are checked against the record before they are published as fact.</p>' +
  '<h2>Attribution</h2><p>Articles attribute the information they rely on and carry a Sources list linking to the supporting documentation, so readers can examine the record behind a story for themselves.</p>' +
  '<h2>News, analysis, opinion, and satire</h2><p>Factual news reporting is distinguished from analysis, opinion, commentary, and satire, and each is presented so readers can tell them apart. Opinion content argues a position openly; it is never disguised as impartial reporting.</p>' +
  '<h2>Fairness without false equivalence</h2><p>Reporting strives to represent relevant perspectives fairly. Fairness does not mean treating substantiated facts and unsupported claims as equals: where the evidence settles a question, our coverage says so.</p>' +
  '<h2>Original editorial value</h2><p>Articles are expected to add original editorial value — research, analysis, historical context, and Colorado-specific relevance that helps readers understand government, politics, business, education, energy, and public policy — rather than republishing or lightly rewriting other publications\' content.</p>' +
  '<h2>Transparency</h2><p>The Ledger is transparent about its editorial practices, sources, ownership, and authorship. The publication is independently owned and operated and is unaffiliated with any political party, candidate, campaign, or government agency. Stories carry the byline of the desk responsible for them — News Desk for reporting, Editorial Desk for opinion.</p>' +
  '<h2>Corrections</h2><p>Errors are addressed through an established corrections process. Readers may report an error to <a href="mailto:news@centennialledger.com">news@centennialledger.com</a> with the article URL and any supporting documentation. Reports are reviewed; confirmed errors are corrected promptly and identified within the affected article.</p>' +
  '<h2>AI-assisted tools</h2><p>AI-assisted research and writing tools are used to support the editorial process — gathering, organizing, and drafting material. They do not replace human editorial oversight, and they do not carry accountability: the publication answers for every story it publishes. Illustrations produced with AI assistance are captioned as illustrations and are never presented as documentary photographs.</p>';

function staticPage(kind) {
  const isPrivacy = kind === 'privacy';
  const isStandards = kind === 'editorial-standards';
  const title = isPrivacy
    ? 'Privacy Policy'
    : isStandards
      ? 'Editorial Standards'
      : 'Terms of Use';
  const content = isStandards
    ? EDITORIAL_STANDARDS_HTML
    : isPrivacy
    ? '<p>The Centennial Ledger collects the least information needed to run this site. When you sign up for the weekday newsletter, we store your email address so we can send it. When you subscribe, our payment processor handles your payment details; we never see or store full card numbers.</p>' +
      '<h2>What we collect</h2><p>Email addresses for the briefing and subscriptions, basic server logs (pages visited, browser type, approximate location from your IP address), and cookies used for site function and, where enabled, advertising through Google AdSense.</p>' +
      '<h2>Advertising</h2><p>We may run Google AdSense advertising. Google and its partners may use cookies to serve ads based on your visits to this and other sites. You can opt out of personalized advertising in your Google account settings.</p>' +
      '<h2>Your choices</h2><p>Every briefing email includes an unsubscribe link. To ask what we hold about you or to have it deleted, contact the publisher through the address on this page.</p>' +
      '<h2>Newsletters and subscriptions</h2><p>When you subscribe to the free weekday newsletter, a topic or regional digest, or breaking news alerts, we store your email address, any first name you give us, the topics and regions you choose, and a record of when and where you signed up. We use that information only to send the emails you asked for and to manage your subscription.</p>' +
      '<h2>Email delivery</h2><p>Our newsletters are delivered by Amazon Simple Email Service (Amazon SES), a third-party email provider. Your email address is shared with that provider only so your emails can be sent. Where the provider supports it, we may record whether an email was delivered, bounced, or reported as spam, and which links were clicked, so we can keep the newsletter useful and the subscriber list accurate.</p>' +
      '<h2>Managing your subscription</h2><p>Every newsletter carries an unsubscribe link that works without a password or an account, and a link to a preference center where you can change topics, regions and frequency, pause your subscription, change your email address, or unsubscribe from everything. Unsubscribed addresses stay on a suppression list so they are not emailed again by mistake. To have your information removed entirely, contact the publisher through the address on this page.</p>' +
      '<h2>Advertisers and sponsors</h2><p>We do not sell or share subscriber email addresses with advertisers or sponsors. When a newsletter carries a sponsored placement, it is delivered by The Centennial Ledger itself as part of the email; sponsors never receive the subscriber list.</p>' +
      '<h2>Changes</h2><p>We will post changes to this policy on this page with a new effective date. Effective November 1, 2026.</p>'
    : '<p>By using The Centennial Ledger you agree to these terms. The site provides news and analysis for general information. Every article is reviewed by a human editor before publication and links to the sources behind it; errors are corrected through the corrections process set out in our <a href="/editorial-standards">Editorial Standards</a>.</p>' +
      '<h2>Subscriptions</h2><p>Paid tiers (Patriot and Founding) are billed monthly once checkout is active and can be cancelled at any time, effective at the end of the billing period. Free content remains free.</p>' +
      '<h2>Acceptable use</h2><p>Do not scrape the site at a rate that burdens the service, misrepresent Ledger content as your own, or use the site for unlawful purposes. Brief quotations with attribution and a link are welcome.</p>' +
      '<h2>Liability</h2><p>Content is provided as is, without warranties of any kind. To the extent allowed by law, The Centennial Ledger is not liable for indirect damages arising from use of the site. Effective November 1, 2026.</p>';
  const meta = isStandards
    ? {
        title: 'Editorial Standards: How The Centennial Ledger Reports & Reviews',
        description:
          'Read how The Centennial Ledger reviews every article before publication: primary sources first, linked attribution, fairness, corrections and oversight.',
      }
    : isPrivacy
    ? {
        title: 'Colorado News Privacy Policy: Reader Data, Cookies & Ad Choices',
        description:
          'See how data is handled for newsletters and subscriptions, including email storage, cookies, Amazon SES delivery, AdSense and your choices. Review it today.',
      }
    : {
        title: 'Colorado News Terms of Use: Subscriptions, Content & Reader Rules',
        description:
          'Review the terms for using a Colorado news site, including subscription billing, cancellations, acceptable use, content sharing and liability. Read them today.',
      };
  return layout({
    title: fitTitle(meta.title, 70),
    description: fitDescription(meta.description),
    path: '/' + kind,
    body:
      // The Editorial Standards page also carries a top
      // leaderboard, first on the page like the section pages
      // (owner directive, 2026-11-21).
      (isStandards ? leaderboardAdSlot() : '') +
      '<div class="static-page' + (isStandards ? ' static-wide' : '') + '"><h1>' + title + '</h1>' + content + '</div>' +
      '<div class="final-ad">' + leaderboardAdSlot() + '</div>',
  });
}

/**
 * About page (owner-supplied text, 2026-11-03): the paper's mission,
 * how its stories are produced (including the AI disclosure), the
 * news/opinion/satire split, independence, and the corrections
 * contact — the Ledger's own mailbox fills the contact placeholder
 * in the owner's draft.
 */
function aboutPage() {
  /* Header mirrors the section pages (owner instruction,
   * 2026-11-12): leaderboard ad first, then the H1 with the same
   * class and size the section pages use; the tagline follows as
   * the standfirst. */
  const nameplate =
    '<header class="about-head">' +
    '<h1 class="headline" style="font-size:2.4rem">About The Centennial Ledger</h1>' +
    '</header>';
  /* Layout (owner restructure, 2026-11-12): alternating one- and
   * two-column stretches built from explicit blocks, never a CSS
   * multi-column flow, so no section can split across columns.
   * The two-column stretch is a grid whose items are whole
   * sections: Produced (long) fills the left column across both
   * rows; Statewide and News stack in the right column. DOM order
   * keeps the prose in its original sequence on mobile. */
  const main =
    '<div class="about-intro">' +
    "<p class=\"about-dropcap\">Colorado deserves a closer look.</p>" +
    "<p>From the State Capitol in Denver to county courthouses, school board meetings, and city halls across all 64 counties, the decisions shaping our state deserve attention, scrutiny, and a little healthy skepticism.</p>" +
    "<p><strong>The Centennial Ledger</strong> is an independent digital newspaper dedicated to Colorado politics, government, public policy, and local affairs. We cover the stories that affect how Coloradans live, work, raise families, spend their money, and exercise their freedoms.</p>" +
    "<p>Our mission is straightforward: make Colorado news accessible, informative, and worth reading.</p>" +
    "<p>We believe good journalism should ask difficult questions, follow the public's money, challenge official narratives, and explain why events matter. We also believe a newspaper should have some personality. Serious reporting and a sharp editorial wit have shared newspaper pages for centuries. We see no reason to abandon that tradition.</p>" +
    "<p>Nothing appears on this site unreviewed. Every article is read and checked by a human editor before publication, and every story carries links to the sources behind it. The standards behind that process are published in full on our <a href=\"/editorial-standards\">Editorial Standards</a> page.</p>" +
    '</div>' +
    '<div class="about-grid">' +
    '<section class="about-section about-s-statewide">' +
    "<h2>Statewide Coverage, Local Perspective</h2>" +
    "<p>Colorado is more than Denver, and the stories that matter don't always make the evening news.</p>" +
    "<p>Our coverage spans state politics, constitutional rights, taxation, energy, education, elections, and local government. We pay particular attention to public decisions that may receive little attention outside the communities they affect.</p>" +
    "<p>Whether it's a Supreme Court case, a contentious school board vote, a county budget, or a new regulation from the Capitol, our goal is to explain what happened, who's responsible, and what it means for Coloradans.</p>" +
    '</section>' +
    '<section class="about-section about-s-produced">' +
    "<h2>How Our Stories Are Produced</h2>" +
    "<p>We believe readers deserve to know how their news is made — and who answers for it.</p>" +
    "<p>Every article published by The Centennial Ledger undergoes human editorial review before publication. Factual claims, statistics, quotations, and other material information are checked for accuracy against the underlying sources, and each story is reviewed for accuracy, fairness, completeness, context, and clarity before it appears.</p>" +
    "<p>Our reporting relies on credible sources, with primary sources prioritized whenever they are available: government documents, court records, legislative materials, official data, and public announcements, supplemented by reporting from established news organizations. Articles attribute the information they rely on, and each story's Sources list links to the supporting documentation, so readers can examine the record behind a story for themselves.</p>" +
    "<p>We use AI-assisted research and writing tools to help gather, organize, and draft coverage. Those tools support the editorial process; they do not replace it. Human editorial oversight governs what is published, and the publication — not the software — is accountable for every story. We do not fabricate interviews, quotations, or sources, and assisted material is never presented as firsthand eyewitness reporting.</p>" +
    "<p>Our aim is original editorial value: research, analysis, historical context, and Colorado-specific relevance that helps readers understand what a development means — not a republished or lightly rewritten version of another publication's work. And when we get something wrong, we correct it through the corrections process described below.</p>" +
    '</section>' +
    '<section class="about-section about-s-news">' +
    "<h2>News, Opinion &amp; Satire</h2>" +
    "<p>News reports the facts. Analysis explains what those facts mean. Opinion argues a position. Satire uses humor and exaggeration to make a point. Each is what it says it is: factual reporting is distinguished from analysis, opinion, commentary, and satire, and each is presented so readers can tell them apart.</p>" +
    "<p>Editorials and commentary may take strong positions on the issues and personalities shaping Colorado. Those views belong in clearly identified opinion content, not disguised as impartial reporting.</p>" +
    "<p>Fairness in our news pages means representing relevant perspectives honestly. It does not mean creating a false equivalence between substantiated facts and unsupported claims: where the evidence settles a question, our coverage says so.</p>" +
    "<p>Our satire and political cartoons draw on the long tradition of American newspaper commentary, where humor, caricature, and pointed criticism have always had a place.</p>" +
    "<p>Illustrations, including AI-assisted imagery, are used to complement our coverage and are captioned as illustrations. Such images are illustrative representations, not documentary photographs of actual events, unless explicitly identified otherwise.</p>" +
    '</section>' +
    '</div>' +
    '<section class="about-section about-mission">' +
    "<h2>Editorial Mission</h2>" +
    "<p>The Centennial Ledger is an independent Colorado news publication covering the people, policies, institutions, and decisions shaping our state. We believe in fiscal accountability, individual liberty, limited government, public transparency, and responsible stewardship of taxpayer resources. Through original reporting, thoughtful analysis, and commentary, we aim to help Coloradans better understand the issues affecting their communities.</p>" +
    '</section>' +
    '<section class="about-section">' +
    "<h2>Independence &amp; Ownership</h2>" +
    "<p>The Centennial Ledger is an independently owned and operated publication. We are not affiliated with any political party, candidate, political campaign, or government agency.</p>" +
    "<p>We are transparent about how this publication operates: our editorial practices and standards are published on this site, our stories carry their sources, and bylines identify the desk responsible for each piece — News Desk for reporting, Editorial Desk for opinion.</p>" +
    "<p>Editorial independence does not require the absence of opinions. It requires the freedom to question powerful institutions, scrutinize public officials, and follow the facts regardless of whom they favor.</p>" +
    "<p>Our allegiance is to our readers and to Colorado.</p>" +
    '</section>' +
    '<blockquote class="about-pullquote">Our allegiance is to our readers and to Colorado.</blockquote>';
  const closing =
    '<div class="about-closing">' +
    '<section>' +
    "<h2>Corrections &amp; Accountability</h2>" +
    "<p>Accuracy matters. When we get something wrong, we make it right — openly.</p>" +
    "<p>Our corrections process is established and straightforward. Readers can report a factual error, misleading context, broken source link, or questionable attribution at the address below. Reports are reviewed, and when an error is confirmed, the article is corrected promptly and the correction is identified within the affected article. Significant developments may also warrant an updated or follow-up story.</p>" +
    "<p>To request a correction or submit feedback, contact us at <a href=\"mailto:news@centennialledger.com\">news@centennialledger.com</a>. Please include the article URL and a brief explanation of the issue, along with supporting documentation when available.</p>" +
    '</section>' +
    '<section>' +
    "<h2>Stay Informed</h2>" +
    "<p>Colorado never runs out of stories worth telling.</p>" +
    "<p>Subscribe to our free weekday newsletter for a concise roundup of the day's important developments, from the Capitol to communities across the state.</p>" +
    "<ul class=\"about-social\">" +
    "<li><a href=\"/subscribe\">Subscribe to the newsletter</a></li>" +
    "<li><a href=\"https://www.facebook.com/profile.php?id=61595978079628\" target=\"_blank\" rel=\"noopener\">Follow The Centennial Ledger on Facebook</a></li>" +
    "<li><a href=\"https://www.instagram.com/centennialledger\" target=\"_blank\" rel=\"noopener\">Follow @centennialledger on Instagram</a></li>" +
    "<li><a href=\"https://open.spotify.com/show/5r0ObdqenGKnYskuKRxWrX\" target=\"_blank\" rel=\"noopener\">Listen to the Colorado Daily News Brief on Spotify</a></li>" +
    "<li><a href=\"https://www.pandora.com/podcast/colorado-daily-news-brief/PC:1001124564\" target=\"_blank\" rel=\"noopener\">Listen to the Colorado Daily News Brief on Pandora</a></li>" +
    "<li><a href=\"/rss.xml\">Subscribe to the Ledger's RSS feed of latest stories</a></li>" +
    "</ul>" +
    "<p><strong>The Centennial Ledger. A Clear View of Colorado.</strong></p>" +
    '</section>' +
    '</div>';
  return layout({
    title: fitTitle('Colorado Independent News: About Our Statewide Reporting Mission', 70),
    description: fitDescription(
      'Learn how this independent Colorado newspaper covers politics, taxes, energy, schools and local government across 64 counties, with sources shown. Read today.'
    ),
    path: '/about',
    body:
      leaderboardAdSlot() +
      '<div class="static-page about-page">' + nameplate + main + closing + '</div>' +
      '<div class="final-ad">' + leaderboardAdSlot() + '</div>',
  });
}

function simplePage(title, heading, text, path, description) {
  return layout({
    title: fitTitle(title, 70),
    description: fitDescription(description || text),
    path,
    body: '<div class="static-page"><h1>' + esc(heading) + '</h1><p>' + esc(text) + '</p></div>',
  });
}

/** The Federal Lawsuit Tracker guide page (see src/tracker.js). */
function lawsuitTrackerPage() {
  return tracker.renderTrackerPage({
    layout,
    esc,
    leaderboardAdSlot,
    featureDivider,
    absUrl,
    fitTitle,
    fitDescription,
    siteName: SITE_NAME,
  });
}

module.exports = {
  SITE_NAME,
  TAGLINE,
  siteUrl,
  absUrl,
  fitTitle,
  fitDescription,
  articleDescription,
  fmtDate,
  homePage,
  sectionPage,
  lawsuitTrackerPage,
  localHubPage,
  localRegionPage,
  articlePage,
  explainedPage,
  briefPage,
  briefIndexPage,
  satirePage,
  subscribePage,
  preferencesLandingPage,
  preferencesPage,
  unsubscribeConfirmPage,
  newsletterNoticePage,
  adminNewsletterPage,
  signupModule,
  checkoutPage,
  searchPage,
  staticPage,
  aboutPage,
  simplePage,
  setTickerItems,
};
