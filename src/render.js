'use strict';
/**
 * Server-rendered HTML for The Centennial Ledger live site.
 * Broadsheet styling: navy top bar, the drawn masthead artwork,
 * red rules, serif headlines. All SEO (titles, meta, canonical,
 * OG/Twitter, JSON-LD)
 * is centralized in layout().
 */

const { SECTIONS, REGIONS, sectionName } = require('./store');

const SITE_NAME = 'The Centennial Ledger';
const TAGLINE = 'A Clear View of Colorado';

/* AdSense client (publisher) ID. It is public by design — it prints
 * in every page's source — so it lives in code, with the env var as
 * an override. The shared head carries the account meta tag and the
 * loader script at all times so Google can verify and review the
 * site. The visible ad slots still switch to live units only when
 * real ad unit IDs are wired in after approval; their placeholder
 * slot ID is not a serving unit. */
const ADSENSE_CLIENT =
  process.env.ADSENSE_PUBLISHER_ID || 'ca-pub-5686724565796685';

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
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
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

function fmtDateShort(iso) {
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
 * Framed engraving figure, or '' when the article has no image. The
 * image and its caption stay together in the one figure block.
 *
 * Card components pass opts { noCaption: true, link: true }: cards
 * show no caption, and the figure is wrapped in a link to the article
 * so the image clicks through like the headline does. Homepage
 * features and article pages render the figure with its caption.
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
    '<figure class="art-figure' + (extraClass ? ' ' + extraClass : '') + '"><img src="' + esc(a.image.url) + '" alt="' +
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
function leadExcerpt(a) {
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
  const TARGET = 180; // words (owner instruction, 2026-11-02); the crossing block lands whole
  const kept = [];
  let used = 0;
  for (const b of texts) {
    if (kept.length && used >= TARGET) break;
    kept.push(b);
    used += wordCount(b.text);
  }
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

function adSlot(label) {
  const pub = process.env.ADSENSE_PUBLISHER_ID;
  if (pub) {
    return (
      '<div class="ad-slot"><ins class="adsbygoogle" style="display:block" ' +
      'data-ad-client="' + esc(pub) + '" data-ad-slot="0000000000" ' +
      'data-ad-format="auto" data-full-width-responsive="true"></ins></div>'
    );
  }
  return '<div class="ad-slot ad-placeholder" aria-hidden="true">Advertisement</div>';
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
  const pub = process.env.ADSENSE_PUBLISHER_ID;
  if (pub) {
    return (
      '<div class="ad-slot ad-leaderboard"><ins class="adsbygoogle" style="display:block" ' +
      'data-ad-client="' + esc(pub) + '" data-ad-slot="0000000000" ' +
      'data-ad-format="horizontal" data-full-width-responsive="true"></ins></div>'
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
  const pub = process.env.ADSENSE_PUBLISHER_ID;
  if (pub) {
    return (
      '<div class="ad-slot ad-rectangle"><ins class="adsbygoogle" style="display:block" ' +
      'data-ad-client="' + esc(pub) + '" data-ad-slot="0000000000" ' +
      'data-ad-format="rectangle" data-full-width-responsive="false"></ins></div>'
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
 * One homepage rail story row: a small plate thumbnail on the left
 * (no border; the engraving shows at its natural edges), then the
 * red uppercase category label and the headline as a link. No
 * byline, no read time and no source line, as on cards.
 */
function railStoryRow(a, grouped) {
  const thumb =
    a.image && a.image.url
      ? '<a class="rail-thumb" href="/article/' + esc(a.slug) + '"><img src="' + esc(a.image.url) +
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

const CSS = `
:root{
  --color-bg:#FFFFFF;--color-text:#111111;--color-red:#981E24;--color-navy:#102438;
  --color-gold:#AA8548;--color-ivory:#F8F4EB;--color-border:#DED7C9;--color-muted:#777777;
  --font-headline:"Playfair Display",Georgia,serif;
  --font-body:"Source Serif 4",Georgia,serif;
  --font-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  /* Legacy aliases, kept so older rules resolve to the spec palette. */
  --navy:var(--color-navy);--red:var(--color-red);--ink:var(--color-text);
  --paper:var(--color-bg);--rule:var(--color-border)
}
*{box-sizing:border-box}
body{margin:0;background:var(--color-bg);color:var(--color-text);font-family:var(--font-body);line-height:1.55}
a{color:inherit}
/* ---------- Top utility bar: navy, gold accent line at the bottom ---------- */
.topbar{background:var(--color-navy);color:#e8e4d8;font-family:var(--font-ui);font-size:.78rem;min-height:34px;padding:.3rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;border-bottom:1px solid var(--color-gold)}
.topbar .center{font-style:italic;font-family:var(--font-body);flex:1;text-align:center}
.topbar .topbar-left{letter-spacing:.05em;font-weight:bold;white-space:nowrap}
.topbar .topbar-right{display:flex;align-items:center;gap:.9rem;white-space:nowrap}
.topbar a{color:#fff;text-decoration:none}
.btn-subscribe{background:var(--color-red);color:#fff!important;padding:.3rem .8rem;border-radius:3px;font-weight:bold}
/* ---------- Masthead: the supplied banner artwork on pure white ---------- */
.masthead{text-align:center;padding:1.1rem 1rem .4rem;background:#fff}
.masthead-banner a{display:inline-block;text-decoration:none}
.masthead-banner img{display:block;width:990px;max-width:100%;height:auto;margin:0 auto}
.tagline{display:flex;align-items:center;gap:.9rem;font-style:italic;font-size:1.15rem;max-width:600px;margin:-.65rem auto 0;line-height:1;position:relative}
.tagline::before,.tagline::after{content:"";flex:1 1 0;height:2px;background:var(--color-red)}
/* ---------- Navigation: white, thin double black rules, serif labels ---------- */
nav.main{background:#fff;border-top:4px double var(--color-text);border-bottom:4px double var(--color-text);position:relative}
nav.main ul.nav-list{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:.2rem 1.3rem;list-style:none;margin:0 auto;padding:.5rem 24px;max-width:1200px}
nav.main a{text-decoration:none;font-family:var(--font-body);font-weight:600;font-size:1rem;letter-spacing:.02em;display:inline-block;padding:.28rem .65rem;border-radius:3px}
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
.nav-search-form input[type=search]{padding:.38rem .6rem;border:1px solid #b9b2a0;border-radius:3px;font-size:.95rem;font-family:var(--font-body);width:190px;background:#fff}
.nav-search-form button{background:none;border:0;cursor:pointer;color:#555;padding:.15rem;display:flex;align-items:center}
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
.byline{font-family:var(--font-ui);color:var(--color-muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
.meta{font-family:var(--font-ui);font-size:.75rem;color:var(--color-muted);text-transform:uppercase;letter-spacing:.05em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.2rem}
.card{border-top:3px solid var(--color-text);padding-top:.6rem}
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
.card figure.art-figure img{aspect-ratio:16/9;object-fit:cover}
/* ---------- Briefing signup panel ---------- */
.briefing{background:var(--color-ivory);border:1px solid var(--color-gold);padding:18px;margin:1.4rem 0}
.briefing .briefing-kicker{color:var(--color-red);font-family:var(--font-ui);font-size:.75rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase}
.briefing .briefing-title{font-family:var(--font-headline);font-weight:700;font-size:1.75rem;line-height:1.15;margin:.35rem 0 .5rem}
.briefing .briefing-tag{margin:0 0 .8rem;font-style:italic}
.briefing form{display:flex;flex-direction:column;gap:.5rem;margin-top:.6rem}
.briefing input[type=email]{width:100%;padding:.55rem;font-size:1rem;font-family:var(--font-body);border:1px solid #999;background:#fff}
.briefing button{background:var(--color-red);color:#fff;border:0;padding:.55rem 1.1rem;font-size:1rem;font-family:var(--font-ui);cursor:pointer;width:100%}
.briefing .briefing-note{font-style:italic;color:#555;font-size:.92rem;margin:.55rem 0 0}
/* ---------- Advertisements ---------- */
.ad-slot{margin:1.2rem 0;text-align:center}
.ad-placeholder{border:1px dashed #bbb;color:#999;font-family:var(--font-ui);font-size:.75rem;text-transform:uppercase;letter-spacing:.15em;padding:1.4rem 0}
.ad-placeholder.ad-horizontal{padding:2.4rem 0}
.ad-leaderboard{background:var(--color-ivory);border:1px solid var(--color-border);text-align:center;padding:.9rem 1rem 1rem;margin-bottom:1.4rem}
.ad-leaderboard .ad-label,.ad-rectangle .ad-label{font-family:var(--font-ui);font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;color:#8a8474}
.ad-leaderboard .ad-house-title,.ad-rectangle .ad-house-title{font-family:var(--font-headline);font-size:1.35rem;margin:.35rem 0 .2rem;color:#333}
.ad-slot.ad-leaderboard{margin:0 0 1.4rem;background:var(--color-ivory);border:1px solid var(--color-border);padding:.4rem}
.ad-rectangle{background:var(--color-ivory);border:1px solid var(--color-border);text-align:center;padding:1rem;display:flex;flex-direction:column;justify-content:center;min-height:250px}
.ad-slot.ad-rectangle{margin:0;background:var(--color-ivory);border:1px solid var(--color-border);padding:.4rem;display:block;min-height:0}
/* ---------- Homepage two-column layout ---------- */
.home-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0 2.2rem;align-items:start}
.home-features{grid-column:1;grid-row:1}
.home-rail{grid-column:2;grid-row:1;position:sticky;top:1rem}
.home-rail .briefing{margin:0 0 1.2rem}
.home-rail .ad-slot{margin:0 0 1.2rem}
.home-rail .ad-rectangle{margin-top:1.2rem}
@media (max-width:900px){
  .home-layout{grid-template-columns:1fr}
  .home-features{grid-column:auto;grid-row:auto}
  .home-rail{grid-column:auto;grid-row:auto;position:static}
}
/* Homepage features: kicker with a fine gold rule, headline, italic
   deck, byline, then the intro — the framed plate with its caption
   floated right, the excerpt text wrapping around it — then the
   action buttons, the Why It Matters box and the sources line. */
.lead-story{padding-bottom:0;margin-bottom:0}
.feature-headline{font-size:clamp(2rem,4.5vw,2.875rem)}
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
.btn-read{display:inline-block;background:var(--color-red);color:#fff;text-decoration:none;font-family:var(--font-ui);font-weight:bold;font-size:.92rem;padding:.55rem 1.15rem;border-radius:3px}
.btn-read:hover{background:#7d181e}
.btn-save{background:#fff;border:1px solid #b9b2a0;color:var(--color-text);font-family:var(--font-ui);font-weight:bold;font-size:.92rem;padding:.55rem 1rem;border-radius:3px;cursor:pointer}
.btn-save.saved{background:#fbeeee;border-color:var(--color-red);color:var(--color-red)}
.why-feature{border-left:4px solid var(--color-red);background:var(--color-ivory);padding:16px 18px;margin-top:1rem}
.why-feature .why-label{font-family:var(--font-ui);color:var(--color-red);font-size:.78rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.35rem}
.why-feature p{margin:0;font-size:1.03rem}
/* Satire pieces (owner instruction, 2026-11-02): a satire page is
   only the comic and the owner's long caption — no headline, no
   dek, no byline, no sidebar, no related grid — with previous /
   next buttons under the caption for moving between comics. The
   section page lists the comics the same way: image, then caption. */
.satire-wrap{max-width:760px;margin:0 auto;padding-top:.6rem}
.satire-wrap figure.art-figure{margin:0}
.satire-caption{font-size:1.06rem;line-height:1.55;margin:1rem 0 0}
.satire-caption p{margin:0 0 .8em}
.satire-nav{display:flex;gap:.8rem;margin:1.4rem 0 .4rem}
.satire-nav a{display:inline-block;font-family:var(--font-ui);font-weight:bold;font-size:.95rem;text-decoration:none;padding:.55rem 1.15rem;border-radius:3px;border:1px solid var(--color-red);color:var(--color-red);background:#fff}
.satire-nav a.prev{margin-right:auto}
.satire-nav a.next{background:var(--color-red);color:#fff;margin-left:auto}
.satire-list{display:flex;flex-direction:column;gap:2.4rem}
.satire-list figure.art-figure{margin:0}
.satire-list .satire-caption{margin-top:.7rem}
/* Gold filigree divider between homepage features. */
.feature-divider{text-align:center;margin:1.2rem 0}
.feature-divider img{display:block;width:100%;max-width:100%;height:auto}
/* Homepage rail story rows: thumbnail left (no outline, engraving at
   its natural edges), red category label, serif headline. */
.rail-latest{margin-bottom:1.4rem}
.rail-row{display:flex;gap:.85rem;padding:.75rem 0;border-bottom:1px solid var(--color-border)}
.rail-row:first-child{padding-top:0}
.rail-row:last-child{border-bottom:0;padding-bottom:0}
.rail-thumb{flex:0 0 100px;width:100px;height:70px;overflow:hidden;background:#fff}
.rail-thumb img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;filter:grayscale(1) contrast(1.06);background:#fff}
.rail-group{margin:0 0 1.15rem}
.rail-group:last-child{margin-bottom:0}
.rail-group-title{font-family:var(--font-ui);font-weight:700;font-size:.82rem;letter-spacing:.14em;text-transform:uppercase;color:var(--color-red);margin:0 0 .2rem;display:flex;align-items:center;gap:.7rem}
.rail-group-title::after{content:"";flex:1;height:1px;background:var(--color-gold)}
.rail-group-title a{text-decoration:none;color:inherit}
.rail-group-title a:hover{text-decoration:underline}
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
.editorial-strip figure.art-figure img{aspect-ratio:16/9;object-fit:cover;border:1px solid #000}
.editorial-strip .editorial-text{flex:1;min-width:220px}
.editorial-strip .editorial-label{color:var(--color-red);font-family:var(--font-ui);font-size:.75rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
.editorial-strip .editorial-headline{display:block;font-family:var(--font-headline);font-weight:700;font-size:2.3rem;line-height:1.12;margin:0 0 .9rem}
.editorial-strip .editorial-excerpt{font-size:1rem;line-height:1.5;color:#333;margin:.45rem 0 0}
.editorial-strip .editorial-link{color:var(--color-red);font-family:var(--font-ui);font-weight:bold;font-size:.9rem;text-decoration:none;white-space:nowrap;align-self:center}
.editorial-strip .editorial-link:hover{text-decoration:underline}
/* Latest from Colorado: heading with a gold rule, then one row of
   three cards (framed plate, red category, serif headline, short
   excerpt, muted metadata). No shadows, no rounded corners. */
.latest-home{margin-top:1.8rem}
.latest-home-heading{display:flex;align-items:center;gap:1rem;font-family:var(--font-ui);font-size:.95rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:0 0 1rem}
.latest-home-heading::after{content:"";flex:1;height:2px;background:var(--color-gold)}
.latest-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.25rem}
@media (max-width:767px){
  .latest-grid{grid-template-columns:1fr}
}
.latest-card h3{font-family:var(--font-headline);font-size:1.125rem;margin:.25rem 0;line-height:1.25}
.latest-card h3 a{text-decoration:none}
.latest-card p{color:#444;font-size:.95rem;margin:.3rem 0}
.latest-card figure.art-figure{margin:0 0 .55rem}
.latest-card figure.art-figure img{aspect-ratio:16/9;object-fit:cover}
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
.article-rail .ad-slot{margin:0}
@media (max-width:900px){
  .article-layout{grid-template-columns:1fr}
  .article-rail{position:static}
}
article.full h1{font-family:var(--font-headline);font-weight:800;font-size:clamp(1.875rem,4.5vw,2.875rem);line-height:1.12;margin:.4rem 0}
article.full h2{font-family:var(--font-headline);font-weight:700;font-size:1.6875rem;line-height:1.25;margin:1.8rem 0 .8rem}
article.full p{font-size:1.15rem;line-height:1.6;margin:0 0 .8em}
article.full p.lead{font-size:1.15rem}
article.full figure.article-hero{margin:1.1rem 0}
.why{border-left:4px solid var(--color-red);background:var(--color-ivory);padding:20px;margin:24px 0}
.why .why-label{font-family:var(--font-ui);color:var(--color-red);font-size:.8rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-bottom:.4rem}
.why p{margin:0 0 .6em;font-size:1.06rem}
.why p:last-child{margin-bottom:0}
.source{font-family:var(--font-ui);font-size:.9rem;color:#555}
.breadcrumb{font-family:var(--font-ui);font-size:.8rem;color:#666;margin-bottom:.5rem}
.breadcrumb a{color:#666}
.sources-block{border-top:1px solid var(--color-border);margin-top:1.8rem;padding-top:.8rem}
.sources-block h2{font-family:var(--font-headline);font-size:1.15rem;margin:.1rem 0 .4rem}
/* ---------- Subscribe / static pages ---------- */
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem;margin-top:1rem}
.tier{border:1px solid var(--color-border);background:#fff;padding:1.2rem;text-align:center}
.tier .price{font-size:2rem;font-family:var(--font-headline)}
.tier button,.tier a.btn{display:inline-block;background:var(--color-red);color:#fff;text-decoration:none;border:0;padding:.6rem 1.3rem;font-size:1rem;cursor:pointer;margin-top:.6rem}
.searchbox{display:flex;gap:.5rem;margin:1rem 0}
.searchbox input{flex:1;padding:.55rem;font-size:1rem;font-family:var(--font-body)}
.searchbox button{background:var(--color-navy);color:#fff;border:0;padding:.55rem 1.1rem;cursor:pointer;font-family:var(--font-ui)}
.static-page{max-width:760px}
.static-page.about-page{max-width:920px;margin-left:auto;margin-right:auto}
.static-page h1{font-family:var(--font-headline)}
.static-page h2{font-family:var(--font-headline);margin:1.6em 0 .5em}
.static-page ul{margin:0 0 1em;padding-left:1.4em}
.static-page li{margin-bottom:.45em;line-height:1.55}
.about-tagline{font-size:1.3rem;color:var(--color-navy);margin-bottom:1.2rem}
.static-page.about-page p,.static-page.about-page li{font-size:1.12rem;line-height:1.65}
/* ---------- Footer ---------- */
footer{background:#fff;color:#3d3d3d;border-top:4px double var(--color-text);font-family:var(--font-body);font-size:.92rem;margin-top:2rem;position:relative}
footer::before{content:"";position:absolute;top:-8px;left:0;right:0;height:1px;background:var(--color-gold)}
.footer-inner{max-width:1200px;margin:0 auto;padding:32px 24px 8px}
.footer-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr .8fr 1.2fr;gap:1.8rem}
.footer-brand img{display:block;max-width:230px;width:100%;height:auto}
.footer-brand p{margin:.7rem 0 0;color:#555;font-size:.9rem}
.footer-col h3{color:var(--color-red);font-family:var(--font-ui);font-size:.75rem;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin:.1rem 0 .6rem}
.footer-col ul{list-style:none;margin:0;padding:0}
.footer-col li{margin:.28rem 0}
.footer-col a{text-decoration:none}
.footer-col a:hover{text-decoration:underline}
.footer-col{border-left:1px solid rgba(170,133,72,.4);padding-left:1.2rem}
.footer-col:first-child{border-left:0;padding-left:0}
.footer-ornament{display:block;width:110px;max-width:100%;height:auto;margin-bottom:.5rem}
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
  const navItems =
    '<li><a href="/"' + (activeNav === 'home' ? ' class="active"' : '') + '>Home</a></li>' +
    SECTIONS.map((s) => {
      const link =
        '<a href="/section/' + s.slug + '"' +
        (activeNav === s.slug ? ' class="active"' : '') + '>' + s.name + '</a>';
      return s.slug === 'local'
        ? '<li class="has-dropdown">' + link +
          // Mobile only (hidden on desktop): a separate chevron
          // button toggles the regions submenu; the Local link
          // itself still navigates to the Local section page.
          '<button class="local-toggle" type="button" aria-expanded="false" aria-controls="local-submenu" aria-label="Show Local regions">' +
          chevronSvg + '</button>' + localDropdown + '</li>'
        : '<li>' + link + '</li>';
    }).join('') +
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
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
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
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400;1,8..60,600;1,8..60,700&display=swap" rel="stylesheet">
<style>${CSS}</style>
${ld}
${adsense}
</head>
<body>
<div class="topbar">
  <span class="topbar-left">${esc(fmtDate(new Date().toISOString()).toUpperCase())} | DENVER, COLORADO &nbsp; 54&deg; &middot; Fair</span>
  <span class="center">Colorado Political News, Reporting, and Analysis</span>
  <span class="topbar-right"><a href="/signin">Sign In</a><a class="btn-subscribe" href="/subscribe">Subscribe</a></span>
</div>
<header class="masthead">
  <!-- Masthead banner: the owner's supplied artwork — the engraved
       lettering flanked by both mountain engravings in a single
       image (WebP with a PNG fallback), centered on white. Below
       it, the tagline flanked by short red rules. -->
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
        <a href="/" aria-label="The Centennial Ledger: back to the front page"><picture><source srcset="/footer-logo.webp" type="image/webp"><img src="/footer-logo.png" alt="The Centennial Ledger" width="285" height="140"></picture></a>
        <p>Covering Colorado’s Capitol and all 64 counties. Independent and unaffiliated with any party or campaign. Stories are AI-written from linked sources; always check original sources for full context.</p>
      </div>
      <nav class="footer-col" aria-label="Sections">
        <h3>Sections</h3>
        <ul>
          <li><a href="/section/politics">Politics</a></li>
          <li><a href="/section/rights">Rights</a></li>
          <li><a href="/section/taxes">Taxes</a></li>
          <li><a href="/section/energy">Energy</a></li>
          <li><a href="/section/schools">Schools</a></li>
          <li><a href="/section/local">Local</a></li>
          <li><a href="/section/opinion">Opinion</a></li>
          <li><a href="/section/satire">Satire</a></li>
        </ul>
      </nav>
      <nav class="footer-col" aria-label="Colorado regions">
        <h3>Colorado Regions</h3>
        <ul>
          ${REGIONS.map((r) => '<li><a href="/local/' + r.slug + '">' + r.name + '</a></li>').join('')}
        </ul>
      </nav>
      <nav class="footer-col" aria-label="About">
        <h3>About</h3>
        <ul>
          <li><a href="/about">About Us</a></li>
          <li><a href="/subscribe">Subscribe</a></li>
        </ul>
      </nav>
      <div class="footer-col footer-stay">
        <img class="footer-ornament" src="/section-break.png" alt="" width="642" height="26">
        <h3>Stay Informed</h3>
        <p class="footer-stay-text">The Colorado Daily Briefing in your inbox.</p>
        <a class="btn-signup" href="/subscribe">Sign Up &rarr;</a>
      </div>
    </div>
  </div>
  <div class="footer-bar">
    <div class="footer-bar-inner">
      <span><a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Use</a></span>
      <span>&copy; ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.</span>
    </div>
  </div>
</footer>
${NAV_SCRIPT}
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
function articleCard(a) {
  return (
    '<div class="card">' +
    articleFigure(a, '', { noCaption: true, link: true }) +
    '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<h3><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    '<div class="meta">' + esc(fmtDateShort(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>' +
    '</div>'
  );
}

/**
 * The number of sources actually stored on an article. The live
 * store keeps one primary source per story (sourceName/sourceUrl),
 * so the count is 1 when a source is stored and 0 when none is; a
 * stored sources list, if one ever appears, is counted as-is. The
 * homepage feature line reports this number truthfully — it is
 * never dressed up.
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
    articleFigure(a, '', { noCaption: true, link: true }) +
    '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<h3><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    (excerpt ? '<p>' + inline(excerpt) + '</p>' : '') +
    '<div class="meta">' + esc(fmtDateShort(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>' +
    '</div>'
  );
}

function briefingBox(thanks) {
  return (
    '<section class="briefing">' +
    '<div class="briefing-kicker">The Colorado Briefing</div>' +
    '<h2 class="briefing-title">The Colorado Daily Briefing</h2>' +
    '<p class="briefing-tag">A smart, concise roundup of the day\'s top Colorado news, plus what to watch next across the state.</p>' +
    (thanks
      ? '<p><strong>Thank you. You are on the list.</strong></p>'
      : '<form method="post" action="/briefing"><input type="email" name="email" required placeholder="Your email address" aria-label="Email address"><button type="submit">Subscribe</button></form>') +
    '<p class="briefing-note">Get the briefing in your inbox, Monday-Friday.</p>' +
    '</section>'
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

/** Gold filigree divider, used between homepage features. */
function featureDivider() {
  return (
    '<div class="feature-divider" aria-hidden="true">' +
    '<img src="/section-break.png" alt="" width="642" height="26"></div>'
  );
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
function featureStory(a) {
  const excerpt = leadExcerpt(a);
  let s =
    '<section class="lead-story"><h1 class="headline feature-headline"><a style="text-decoration:none" href="/article/' +
    esc(a.slug) + '">' + esc(a.headline) + '</a></h1>' +
    (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '') +
    '<div class="byline">' + bylineLine(a) + '</div>';
  if (excerpt) {
    // Intro: the plate (with caption) floats right and the excerpt
    // text wraps around it. With no image the excerpt runs full width.
    const fig = articleFigure(a, 'feature-figure');
    s += fig
      ? '<div class="feature-intro">' + fig + '<div class="feature-excerpt">' + excerpt + '</div></div>'
      : '<div class="feature-excerpt">' + excerpt + '</div>';
  } else {
    s += articleFigure(a, 'feature-figure');
  }
  s +=
    '<div class="feature-actions"><a class="btn-read" href="/article/' + esc(a.slug) +
    '">Read Full Story &rarr;</a>' +
    '<button type="button" class="btn-save" data-save-slug="' + esc(a.slug) +
    '" aria-pressed="false">📌 Save</button></div>';
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
    title: 'Colorado politics news: legislature, governor and elections',
    description:
      'Colorado politics news from the Capitol: the legislature, the governor, elections, courts and the state budget, reported with the original sources linked. Read the latest.',
  },
  rights: {
    title: 'Colorado gun rights news: firearms laws, courts and permits',
    description:
      'Colorado gun rights news: Second Amendment laws, permit rules, court challenges and sheriff policies across the state, with the source records linked. Read more.',
  },
  taxes: {
    title: "Colorado tax news: Taxpayer's Bill of Rights and refunds",
    description:
      'Colorado tax news: Taxpayer\'s Bill of Rights refunds, property taxes, fees and fines and the state budget fight in Denver, with the official documents linked. Read the latest.',
  },
  energy: {
    title: 'Colorado energy news: oil, gas, utilities and power costs',
    description:
      'Colorado energy news: oil and gas permits, utility rates, electricity costs and land fights in producing counties, with the original records linked. Read more.',
  },
  schools: {
    title: 'Colorado school news: districts, boards, closures, results',
    description:
      'Colorado school news: district budgets, school board votes, school closures and student test results across the state, with district documents linked. Read more.',
  },
  opinion: {
    title: 'Colorado opinion and commentary: politics, taxes, schools',
    description:
      'Colorado opinion and commentary on state politics, taxes, schools and energy, examining what the governing majority in Denver delivers. Read the latest columns.',
  },
  satire: {
    title: 'Colorado political satire: a lighter look at state politics',
    description:
      'Colorado political satire: the lighter side of the state Capitol, county courthouses and city halls across the state, written for a laugh, not a lecture.',
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

function hubBox(section) {
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

/** Region variant of the hub box for Local region pages. */
function regionHubBox(region) {
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
 * Teaser text for the Editorial Desk strip: the opening of the piece
 * itself — its first section's lead plus up to two body paragraphs —
 * trimmed at a word boundary to about 340 characters with an
 * ellipsis, so the strip gives readers a real taste of the argument,
 * not just the headline. Falls back to the dek when the piece has no
 * body sections. Returns '' when there is no text at all.
 */
function stripExcerpt(a) {
  const first = a && Array.isArray(a.sections) ? a.sections[0] : null;
  const parts = [];
  if (first && first.lead) parts.push(first.lead);
  if (first && Array.isArray(first.paragraphs)) {
    for (const p of first.paragraphs.slice(0, 2)) parts.push(p);
  }
  if (!parts.length && a && a.dek) parts.push(a.dek);
  const t = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (t.length <= 340) return t;
  const cut = t.slice(0, 340);
  const ls = cut.lastIndexOf(' ');
  return (ls > 200 ? cut.slice(0, ls) : cut).trim() + '...';
}

/**
 * The "From Our Editorial Desk" strip: a full-width cream band below
 * the homepage columns and above Latest from Colorado, promoting
 * the newest Opinion piece — the piece's framed plate at the left,
 * then the red small-caps label, the headline as "Editorial:
 * <headline>" in bold serif and a short excerpt from the piece, with
 * the read-on link at the right (owner instruction, 2026-11-02: the
 * strip carries the image and more of the article's text). Rendered
 * only when the store holds an Opinion article; the home route
 * passes the latest one, or null and the strip is absent.
 */
function editorialStrip(opinion) {
  if (!opinion) return '';
  const excerpt = stripExcerpt(opinion);
  return (
    '<section class="editorial-strip">' +
    // The headline runs across the top of the box, above the
    // image, in the same font and size as the featured articles'
    // headlines (owner instruction, 2026-11-02).
    '<span class="editorial-headline">Editorial: ' + esc(opinion.headline) + '</span>' +
    '<div class="editorial-strip-row">' +
    articleFigure(opinion, '', { noCaption: true, link: true }) +
    '<div class="editorial-text">' +
    '<span class="editorial-label">From Our Editorial Desk</span>' +
    (excerpt ? '<p class="editorial-excerpt">' + inline(excerpt) + '</p>' : '') +
    '</div>' +
    '<a class="editorial-link" href="/article/' + esc(opinion.slug) + '">Read the Editorial &rarr;</a>' +
    '</div>' +
    '</section>'
  );
}

function homePage({ lead, second, third, latest, railGroups, latestRow, localStories, opinion, briefingThanks }) {
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
    let features = featureStory(lead);
    // Second and third features, directly under the lead in the
    // same format, each from a different section (selected by the
    // home route), with the gold filigree divider between features.
    // Either is absent when no different-section story exists.
    if (second) features += featureDivider() + featureStory(second);
    if (third) features += featureDivider() + featureStory(third);
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
    // Rail order: the per-section story groups, the briefing
    // signup (title, one italic line and the form — no roundup
    // paragraph), Local & Statewide, then a rectangle ad slot. In
    // the markup the rail follows the features inside the
    // two-column layout, so on narrow screens the page stacks in
    // reading order: features, rail, strip, Latest grid, module.
    body +=
      '<div class="home-layout"><div class="home-features">' + features + '</div>' +
      '<aside class="home-rail" aria-label="Sidebar">' +
      (groups.length
        ? '<section class="rail-latest" aria-label="Latest stories by section">' +
          groups.map(railSectionGroup).join('') + '</section>'
        : '') +
      briefingBox(briefingThanks) +
      localStatewideBox(localStories) +
      rectangleAdSlot() +
      '</aside></div>';
    // Below the columns, full width: the editorial strip when an
    // Opinion piece exists, then the three-card Latest grid, then
    // the Explore module as the last content element, then the
    // Save buttons' inline script.
    body += editorialStrip(opinion);
    if (latestCards.length) {
      body +=
        '<section class="latest-home"><h2 class="latest-home-heading">Latest from Colorado</h2>' +
        '<div class="latest-grid">' + latestCards.map(latestCard).join('') + '</div></section>';
    }
    body += SAVE_SCRIPT;
  } else {
    body += '<section class="lead-story"><h1 class="headline">Colorado news, reported plainly.</h1><p class="dek">New stories are on the way.</p></section>';
    body += briefingBox(briefingThanks);
  }

  return layout({
    title: fitTitle('Colorado politics, taxes, energy, schools and local news', 70),
    description: fitDescription(
      'Colorado political news on taxes and the Taxpayer\'s Bill of Rights, gun rights, energy, schools and local government statewide. Read today\'s top stories.'
    ),
    path: '/',
    jsonLd,
    activeNav: 'home',
    body,
  });
}

function sectionPage({ section, articles }) {
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
  // Satire lists its comics bare (owner instruction, 2026-11-02):
  // each entry is the comic itself, linked to its page, with the
  // owner's long caption under it — no headline, no byline, no date.
  const listing =
    section === 'satire'
      ? '<div class="satire-list">' + articles.map(satireListItem).join('') + '</div>'
      : '<div class="grid">' + articles.map(articleCard).join('') + '</div>';
  const body =
    '<div class="kicker">' + esc(name) + '</div>' +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(name) + '</h1>' +
    '<p class="dek">' + esc(meta.description) + '</p>' +
    (articles.length
      ? listing
      : '<p>No stories in this section yet. Check back after the next edition.</p>') +
    hubBox(section);
  return layout({
    title: fitTitle(meta.title, 70),
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
function localHubPage({ articles }) {
  const body =
    '<div class="kicker">Local</div>' +
    '<h1 class="headline" style="font-size:2.4rem">Local</h1>' +
    '<p class="dek">County commissions, city councils, sheriffs, and school boards, from every part of Colorado. Pick a part of the state, or browse the latest local stories below.</p>' +
    regionNavList('') +
    (articles.length
      ? '<div class="grid">' + articles.map(articleCard).join('') + '</div>'
      : '<p>No local stories yet. Check back after the next edition.</p>') +
    hubBox('local');

  return layout({
    title: fitTitle('Colorado local news: counties, cities and school boards', 70),
    description: fitDescription(
      'Colorado local news from all eight regions: county commissions, city councils, sheriffs and school boards, with the original sources linked. Read the latest.'
    ),
    path: '/section/local',
    jsonLd: collectionJsonLd('Local | ' + SITE_NAME, '/section/local', articles),
    activeNav: 'local',
    body,
  });
}

/** A Local region page: Local-section stories carrying one region tag. */
function localRegionPage({ region, articles }) {
  const path = '/local/' + region.slug;
  const body =
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/local">Local</a> &rsaquo; ' +
    esc(region.name) + '</div>' +
    '<div class="kicker">Local &middot; ' + esc(region.name) + '</div>' +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(region.name) + '</h1>' +
    regionNavList(region.slug) +
    (articles.length
      ? '<div class="grid">' + articles.map(articleCard).join('') + '</div>'
      : '<p>No local stories from ' + esc(region.name) + ' yet. Check back after the next edition.</p>') +
    regionHubBox(region);

  return layout({
    title: fitTitle(region.name + ' local news: counties, cities and school boards', 70),
    description: fitDescription(
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
    articleFigure(a, '', { link: true, noCaption: true }) +
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
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: 'Satire',
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
  const body =
    '<div class="satire-wrap">' +
    articleFigure(a, 'satire-hero', { noCaption: true }) +
    satireCaptionHtml(a) +
    nav +
    '</div>';
  return layout({
    title,
    description,
    path: '/article/' + a.slug,
    ogType: 'article',
    ogImage: imgUrl,
    articleMeta: {
      published: a.publishedAt,
      modified: a.modifiedAt || a.publishedAt,
      section: 'Satire',
    },
    jsonLd,
    activeNav: 'satire',
    body,
  });
}

function articlePage(a, related, localStories) {
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
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/' + a.section + '">' +
    esc(sectionName(a.section)) + '</a> &rsaquo; ' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<div class="kicker-row"><span class="kicker">' + esc(a.topicLabel || sectionName(a.section)) +
    (a.region ? ' &middot; ' + esc(a.region) : '') + '</span></div>' +
    '<h1>' + esc(a.headline) + '</h1>' +
    (a.dek ? '<p class="dek">' + inline(dekText(a)) + '</p>' : '') +
    '<div class="byline">' + bylineLine(a) + '</div>';

  // Full-width hero illustration, in its own figure directly under
  // the byline: no float, no crop, caption beneath.
  body += articleFigure(a, 'article-hero');
  body += '<div class="article-body">';
  sections.forEach((s, i) => {
    if (s.heading) body += '<h2>' + esc(s.heading) + '</h2>';
    let firstPara = true;
    if (s.lead) {
      body += '<p class="lead' + (i === 0 ? ' dropcap' : '') + '">' + inline(s.lead) + '</p>';
      firstPara = false;
    }
    for (const p of s.paragraphs) {
      body += '<p' + (i === 0 && firstPara ? ' class="dropcap"' : '') + '>' + inline(p) + '</p>';
      firstPara = false;
    }
    // The Why It Matters callout goes after the first complete
    // section (also when it is the only section), before the
    // second H2.
    if (i === 0) body += whyBox;
  });
  if (!sections.length) body += whyBox;

  // Sources block: whatever source data the stored article carries
  // (the live store keeps one primary source per story).
  if (a.sourceUrl || a.sourceName) {
    body +=
      '<section class="sources-block"><h2>Sources</h2><p class="source">' +
      (a.sourceUrl
        ? '<a href="' + esc(a.sourceUrl) + '" rel="noopener" target="_blank">' +
          esc(a.sourceName || a.sourceUrl) + '</a>'
        : esc(a.sourceName)) +
      '</p></section>';
  }
  body += '</div></article>';
  // Article sidebar (spec 5): the Briefing signup first, then
  // Local & Statewide, then a single rectangle advertisement.
  body +=
    '<aside class="article-rail" aria-label="Sidebar">' +
    briefingBox(false) +
    localStatewideBox(localStories) +
    rectangleAdSlot() +
    '</aside></div>';

  if (related && related.length) {
    body += '<h2 style="font-family:\'Playfair Display\',Georgia,serif">More in ' + esc(sectionName(a.section)) +
      '</h2><div class="grid">' + related.map(articleCard).join('') + '</div>';
  }
  // The topic-cluster hub box is the last element on the page.
  body += hubBox(a.section);

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

function subscribePage() {
  const tiers = [
    { name: 'Free', price: '$0', per: '', features: ['Front page and section headlines', 'The Colorado Briefing, Monday to Friday', 'Breaking news alerts'], key: 'free' },
    { name: 'Patriot', price: '$6.99', per: '/month', features: ['Full access to every story', 'Deeper reporting on the big stories', 'Saved stories and reading lists'], key: 'patriot' },
    { name: 'Founding', price: '$12.99', per: '/month', features: ['Everything in Patriot', 'Founding member recognition', 'Direct line to the editors'], key: 'founding' },
  ];
  const body =
    '<div class="kicker">Membership</div><h1 class="headline" style="font-size:2.4rem">Subscribe to The Centennial Ledger</h1>' +
    '<p class="dek">Support independent Colorado reporting. Paid checkout opens shortly; pick a tier and we will email you the moment billing goes live.</p>' +
    '<div class="tiers">' +
    tiers
      .map(
        (t) =>
          '<div class="tier"><h2 style="font-family:\'Playfair Display\',Georgia,serif;margin:.2rem 0">' + t.name + '</h2>' +
          '<div class="price">' + t.price + '<span style="font-size:1rem">' + t.per + '</span></div>' +
          '<ul style="text-align:left">' + t.features.map((f) => '<li>' + f + '</li>').join('') + '</ul>' +
          '<a class="btn" href="/subscribe/checkout?tier=' + t.key + '">Choose ' + t.name + '</a></div>'
      )
      .join('') +
    '</div>' +
    briefingBox(false);
  return layout({
    title: fitTitle('Colorado news subscription plans: Free, Patriot, Founding', 70),
    description: fitDescription(
      'Subscribe for full access to Colorado political news: Free headlines and the daily briefing, Patriot at $6.99 a month, Founding at $12.99. Compare the plans.'
    ),
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
    '<p>Online checkout is being connected now and will open shortly. Paid tiers launch as soon as secure billing is in place; the Free tier and The Colorado Briefing are available today.</p>' +
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
    '<h1 class="headline" style="font-size:2.2rem">Search The Centennial Ledger</h1>' +
    '<form class="searchbox" method="get" action="/search"><input type="search" name="q" value="' +
    esc(q || '') + '" placeholder="Search Colorado stories" aria-label="Search"><button type="submit">Search</button></form>' +
    (q
      ? results.length
        ? '<div class="grid">' + results.map(articleCard).join('') + '</div>'
        : '<p>No stories matched &ldquo;' + esc(q) + '&rdquo;. Try a town, a county, or a topic.</p>'
      : '<p>Search headlines, topics, and regions across every section.</p>');
  return layout({
    title: fitTitle('Search Colorado news by town, county, topic and headline', 70),
    description: fitDescription(
      'Search Colorado news stories by town, county, topic or headline across politics, taxes, rights, energy, schools and local coverage. Find a story and read it.'
    ),
    path: '/search',
    body,
  });
}

function staticPage(kind) {
  const isPrivacy = kind === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Use';
  const content = isPrivacy
    ? '<p>The Centennial Ledger collects the least information needed to run this site. When you sign up for The Colorado Briefing, we store your email address so we can send it. When you subscribe, our payment processor handles your payment details; we never see or store full card numbers.</p>' +
      '<h2>What we collect</h2><p>Email addresses for the briefing and subscriptions, basic server logs (pages visited, browser type, approximate location from your IP address), and cookies used for site function and, where enabled, advertising through Google AdSense.</p>' +
      '<h2>Advertising</h2><p>We may run Google AdSense advertising. Google and its partners may use cookies to serve ads based on your visits to this and other sites. You can opt out of personalized advertising in your Google account settings.</p>' +
      '<h2>Your choices</h2><p>Every briefing email includes an unsubscribe link. To ask what we hold about you or to have it deleted, contact the publisher through the address on this page.</p>' +
      '<h2>Changes</h2><p>We will post changes to this policy on this page with a new effective date. Effective November 1, 2026.</p>'
    : '<p>By using The Centennial Ledger you agree to these terms. The site provides news and analysis for general information. Stories are written from source material linked on each article page; we work to correct errors promptly when they are brought to our attention.</p>' +
      '<h2>Subscriptions</h2><p>Paid tiers (Patriot and Founding) are billed monthly once checkout is active and can be cancelled at any time, effective at the end of the billing period. Free content remains free.</p>' +
      '<h2>Acceptable use</h2><p>Do not scrape the site at a rate that burdens the service, misrepresent Ledger content as your own, or use the site for unlawful purposes. Brief quotations with attribution and a link are welcome.</p>' +
      '<h2>Liability</h2><p>Content is provided as is, without warranties of any kind. To the extent allowed by law, The Centennial Ledger is not liable for indirect damages arising from use of the site. Effective November 1, 2026.</p>';
  const meta = isPrivacy
    ? {
        title: 'Privacy policy: reader data, cookies and advertising',
        description:
          'Privacy policy for this Colorado news site: what reader data is collected, how briefing emails and subscriptions use it, and how AdSense cookies work. Read it.',
      }
    : {
        title: 'Terms of use: subscriptions, content and reader rules',
        description:
          'Terms of use for this Colorado news site: subscription billing and cancellation, reader conduct, content corrections and liability. Read the full terms here.',
      };
  return layout({
    title: fitTitle(meta.title, 70),
    description: fitDescription(meta.description),
    path: '/' + kind,
    body: '<div class="static-page"><h1>' + title + '</h1>' + content + '</div>',
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
  const content =
    "<p class=\"about-tagline\"><em>A Clear View of Colorado.</em></p>" +
    "<p>Colorado deserves a closer look.</p>" +
    "<p>From the State Capitol in Denver to county courthouses, school board meetings, and city halls across all 64 counties, the decisions shaping our state deserve attention, scrutiny, and a little healthy skepticism.</p>" +
    "<p><strong>The Centennial Ledger</strong> is an independent digital newspaper dedicated to Colorado politics, government, public policy, and local affairs. We cover the stories that affect how Coloradans live, work, raise families, spend their money, and exercise their freedoms.</p>" +
    "<p>Our mission is straightforward: make Colorado news accessible, informative, and worth reading.</p>" +
    "<p>We believe good journalism should ask difficult questions, follow the public's money, challenge official narratives, and explain why events matter. We also believe a newspaper should have some personality. Serious reporting and a sharp editorial wit have shared newspaper pages for centuries. We see no reason to abandon that tradition.</p>" +
    "<h2>Statewide Coverage, Local Perspective</h2>" +
    "<p>Colorado is more than Denver, and the stories that matter don't always make the evening news.</p>" +
    "<p>Our coverage spans state politics, constitutional rights, taxation, energy, education, elections, and local government. We pay particular attention to public decisions that may receive little attention outside the communities they affect.</p>" +
    "<p>Whether it's a Supreme Court case, a contentious school board vote, a county budget, or a new regulation from the Capitol, our goal is to explain what happened, who's responsible, and what it means for Coloradans.</p>" +
    "<h2>How Our Stories Are Produced</h2>" +
    "<p>We believe readers deserve to know how their news is made.</p>" +
    "<p>The Centennial Ledger uses artificial intelligence to research, organize, and write much of its news coverage from publicly available sources, including government documents, court records, legislative materials, official announcements, and reporting by established news organizations.</p>" +
    "<p><strong>We are transparent about this process.</strong> AI-generated writing is not a substitute for firsthand reporting or independent verification, and it can contain errors. We encourage readers to consult the original materials linked in our articles, particularly when evaluating disputed claims or developing stories.</p>" +
    "<p>Our editorial standards emphasize:</p>" +
    "<ul>" +
    "<li><strong>Source transparency:</strong> We aim to link directly to the documents, records, and original reporting supporting our coverage.</li>" +
    "<li><strong>Accurate attribution:</strong> Information originating with another news organization should be properly credited.</li>" +
    "<li><strong>Facts before conclusions:</strong> Allegations, opinions, and established facts should be clearly distinguished.</li>" +
    "<li><strong>Context and fairness:</strong> Readers deserve the relevant background and competing perspectives necessary to understand a story.</li>" +
    "<li><strong>Accountability:</strong> Errors should be acknowledged and corrected, not quietly ignored.</li>" +
    "</ul>" +
    "<p>We do not present AI-generated material as firsthand eyewitness reporting or fabricate interviews, quotations, or sources.</p>" +
    "<h2>News, Opinion &amp; Satire</h2>" +
    "<p>Our news coverage is intended to inform. Our opinion pages are intended to provoke thought, encourage debate, and occasionally raise an eyebrow.</p>" +
    "<p>Editorials and commentary may take strong positions on the issues and personalities shaping Colorado. Those views belong in clearly identified opinion content, not disguised as impartial reporting.</p>" +
    "<p>Our satire and political cartoons draw on the long tradition of American newspaper commentary, where humor, caricature, and pointed criticism have always had a place.</p>" +
    "<p>Illustrations, including AI-generated imagery, are used to complement our coverage. Such images are illustrative representations, not documentary photographs of actual events, unless explicitly identified otherwise.</p>" +
    "<h2>Independence &amp; Ownership</h2>" +
    "<p>The Centennial Ledger is an independently operated publication. We are not affiliated with any political party, candidate, political campaign, or government agency.</p>" +
    "<p>Editorial independence does not require the absence of opinions. It requires the freedom to question powerful institutions, scrutinize public officials, and follow the facts regardless of whom they favor.</p>" +
    "<p>Our allegiance is to our readers and to Colorado.</p>" +
    "<h2>Corrections &amp; Accountability</h2>" +
    "<p>Accuracy matters. When we get something wrong, we want to make it right.</p>" +
    "<p>Readers are encouraged to report factual errors, misleading context, broken source links, or questionable attributions. Substantive corrections should be made promptly and identified within the affected article. Significant developments may also warrant an updated story.</p>" +
    "<p>To request a correction or submit feedback, contact us at <a href=\"mailto:centennialledger@gmail.com\">centennialledger@gmail.com</a>. Please include the article URL and a brief explanation of the issue, along with supporting documentation when available.</p>" +
    "<h2>Stay Informed</h2>" +
    "<p>Colorado never runs out of stories worth telling.</p>" +
    "<p>Subscribe to <strong>The Colorado Daily Briefing</strong> for a concise roundup of the day's important developments, from the Capitol to communities across the state.</p>" +
    "<p><strong>The Centennial Ledger. A Clear View of Colorado.</strong></p>";
  return layout({
    title: fitTitle('About The Centennial Ledger: Colorado news, statewide coverage', 70),
    description: fitDescription(
      'The Centennial Ledger is an independent Colorado digital newspaper covering politics, rights, taxes, energy, schools and local news in all 64 counties.'
    ),
    path: '/about',
    body: '<div class="static-page about-page"><h1>About The Centennial Ledger</h1>' + content + '</div>',
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
  localHubPage,
  localRegionPage,
  articlePage,
  satirePage,
  subscribePage,
  checkoutPage,
  searchPage,
  staticPage,
  aboutPage,
  simplePage,
};
