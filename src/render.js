'use strict';
/**
 * Server-rendered HTML for The Centennial Ledger live site.
 * Broadsheet styling: navy top bar, blackletter masthead, red rules,
 * serif headlines. All SEO (titles, meta, canonical, OG/Twitter, JSON-LD)
 * is centralized in layout().
 */

const { SECTIONS, REGIONS, sectionName } = require('./store');

const SITE_NAME = 'The Centennial Ledger';
const TAGLINE = 'A Clear View of Colorado';

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
 * image and its caption stay together in the one figure block. An
 * optional extra class lets the homepage lead float the same block;
 * with no extra class the output is exactly as it has always been.
 */
function articleFigure(a, extraClass) {
  if (!a || !a.image || !a.image.url) return '';
  const cap = a.image.caption
    ? '<figcaption>' + esc(a.image.caption) + '</figcaption>'
    : '';
  return (
    '<figure class="art-figure' + (extraClass ? ' ' + extraClass : '') + '"><img src="' + esc(a.image.url) + '" alt="' +
    esc(a.image.alt || '') + '" loading="lazy">' + cap + '</figure>'
  );
}

/**
 * Homepage lead excerpt: the opening of the story itself — the first
 * body section's lead paragraph plus body paragraphs, up to three text
 * blocks in total — so the front page gives readers a real read of the
 * lead story, not just its headline and dek. The excerpt is then
 * shortened by roughly ten rendered lines (about 100–130 words) off
 * the tail: whole blocks are dropped from the end so it always stops
 * at a clean paragraph boundary, never mid-sentence. The lead block
 * itself is always kept, so a short story simply shows its opening
 * block with the tail blocks removed. Returns '' when the story has
 * no body text (the caller then falls back to headline/dek/figure).
 */
function leadExcerpt(a) {
  const first = a && Array.isArray(a.sections) ? a.sections[0] : null;
  if (!first) return '';
  const texts = [];
  if (first.lead) texts.push({ cls: 'lead', text: first.lead });
  for (const p of first.paragraphs || []) {
    if (texts.length >= 3) break;
    texts.push({ cls: '', text: p });
  }
  if (!texts.length) return '';
  const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const total = texts.reduce((n, b) => n + wordCount(b.text), 0);
  const budget = total - 115; // drop ~100–130 words (about ten lines) off the tail
  const kept = [];
  let used = 0;
  for (const b of texts) {
    const w = wordCount(b.text);
    if (kept.length && used + w > budget) break;
    kept.push(b);
    used += w;
  }
  return kept
    .map((b) => '<p' + (b.cls ? ' class="' + b.cls + '"' : '') + '>' + esc(b.text) + '</p>')
    .join('');
}

/** Absolute http(s) image URL for og:image / JSON-LD, or '' if not usable. */
function shareImageUrl(a) {
  if (!a || !a.image || !a.image.url) return '';
  const u = imageAbsUrl(a.image.url);
  return /^https?:\/\//i.test(u) ? u : '';
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
 * Horizontal-format ad unit for the article page's right rail. Same
 * mechanism as adSlot(): a real AdSense unit when ADSENSE_PUBLISHER_ID
 * is set, the labeled placeholder otherwise.
 */
function railAdSlot() {
  const pub = process.env.ADSENSE_PUBLISHER_ID;
  if (pub) {
    return (
      '<div class="ad-slot ad-rail-unit"><ins class="adsbygoogle" style="display:block" ' +
      'data-ad-client="' + esc(pub) + '" data-ad-slot="0000000000" ' +
      'data-ad-format="horizontal" data-full-width-responsive="false"></ins></div>'
    );
  }
  return '<div class="ad-slot ad-placeholder ad-horizontal" aria-hidden="true">Advertisement</div>';
}

/**
 * "Trending in Colorado" box for the article rail, directly under the
 * ads. Plain numbered list with red circles and headline links only:
 * no thumbnails and no same-section logic (that would duplicate the
 * "More in <section>" grid below the article). The caller passes the
 * most recent stories site-wide, already ordered, with the article
 * being read already removed. Returns '' when there is nothing to show.
 */
function trendingRailBox(items) {
  const list = (items || []).filter(Boolean).slice(0, 5);
  if (!list.length) return '';
  return (
    '<section class="trending"><h2>Trending in Colorado</h2><ol>' +
    list
      .map(
        (a, i) =>
          '<li><span class="trend-num">' + (i + 1) + '</span>' +
          '<a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></li>'
      )
      .join('') +
    '</ol></section>'
  );
}

const CSS = `
:root{--navy:#0d2137;--red:#b01e24;--ink:#1a1a1a;--paper:#ffffff;--rule:#d8d2c4}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:Georgia,'Times New Roman',serif;line-height:1.55}
a{color:inherit}
.topbar{background:var(--navy);color:#e8e4d8;font-family:Arial,Helvetica,sans-serif;font-size:.8rem;padding:.45rem 1rem;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.topbar .center{font-style:italic;font-family:Georgia,serif}
.topbar a{color:#fff;text-decoration:none}
.btn-subscribe{background:var(--red);color:#fff!important;padding:.3rem .8rem;border-radius:3px;font-weight:bold}
.masthead{text-align:center;padding:1.4rem 1rem .6rem;background:#fff}
/* Shrink-to-fit wrapper: its width is the rendered width of the logo
   (the widest child), and the tagline row below spans 100% of it, so the
   red rules flanking the tagline end exactly at the logo's edges at
   every viewport width, desktop (75% masthead scale) and mobile alike. */
.masthead-inner{display:inline-block;max-width:100%;vertical-align:top}
.masthead h1{font-family:'UnifrakturMaguntia','Old English Text MT',serif;font-size:clamp(2.4rem,7vw,4.6rem);margin:0;font-weight:400}
.masthead h1 a{text-decoration:none}
/* Desktop masthead runs at 75% of its original size (each clamp term
   scaled by 0.75: 2.4rem->1.8rem, 7vw->5.25vw, 4.6rem->3.45rem). The
   base rule above still governs phones, and the max-width:680px mobile
   query below is unchanged, so the mobile masthead keeps its old size. */
@media (min-width:681px){
  .masthead h1{font-size:clamp(1.8rem,5.25vw,3.45rem)}
}
.tagline{display:flex;align-items:center;gap:.9rem;font-style:italic;font-size:1.15rem;margin-top:.7rem}
.tagline::before,.tagline::after{content:"";flex:1 1 0;height:3px;background:var(--red)}
nav.main{background:#fff;border-top:1px solid var(--rule);border-bottom:2px solid var(--ink)}
nav.main ul{display:flex;justify-content:center;flex-wrap:wrap;gap:.2rem 1.4rem;list-style:none;margin:0;padding:.55rem 1rem}
nav.main a{text-decoration:none;font-size:1.02rem;letter-spacing:.02em}
nav.main a.active{color:var(--red);font-weight:bold}
/* Local dropdown: hover/focus menu on desktop. On mobile it renders as an
   expanded indented sub-list inside the nav (see media query below). */
nav.main li.has-dropdown{position:relative}
nav.main li.has-dropdown>a::after{content:" \\25BE";font-size:.8em}
nav.main ul.dropdown{display:none;position:absolute;top:100%;left:50%;transform:translateX(-50%);background:#fff;border:1px solid var(--rule);border-top:2px solid var(--ink);list-style:none;margin:0;padding:.45rem 0;min-width:230px;z-index:30;flex-direction:column;flex-wrap:nowrap;gap:0;justify-content:flex-start;text-align:left;box-shadow:0 6px 14px rgba(0,0,0,.08)}
nav.main li.has-dropdown:hover ul.dropdown,nav.main li.has-dropdown:focus-within ul.dropdown{display:flex}
nav.main ul.dropdown a{display:block;padding:.35rem 1.1rem;white-space:nowrap;font-size:.96rem}
nav.main ul.dropdown a:hover{background:#f3efe3}
.region-list{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;list-style:none;margin:.7rem 0 1.1rem;padding:.7rem 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.region-list a{text-decoration:none}
.region-list a:hover{text-decoration:underline}
.region-list a.active{color:var(--red);font-weight:bold}
@media (max-width:680px){
  nav.main ul.dropdown{display:flex;position:static;transform:none;border:0;border-top:1px solid var(--rule);box-shadow:none;min-width:0;padding:.35rem 0 .15rem;margin-top:.3rem}
  nav.main ul.dropdown a{font-size:.92rem;padding:.22rem .4rem}
}
.wrap{max-width:1180px;margin:0 auto;padding:1.2rem 1rem 3rem}
.kicker{color:var(--red);text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;font-size:.75rem;font-weight:bold;letter-spacing:.08em}
h2.headline,h1.headline{font-family:'Playfair Display',Georgia,serif;line-height:1.15;margin:.3rem 0}
.dek{font-size:1.15rem;color:#444;font-style:italic}
.byline{font-variant:small-caps;color:#555;font-size:.95rem}
.lead-story{border-bottom:2px solid var(--ink);padding-bottom:1.2rem;margin-bottom:1.2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.2rem}
.card{border-top:3px solid var(--ink);padding-top:.6rem}
.card h3{font-family:'Playfair Display',Georgia,serif;margin:.25rem 0;line-height:1.25}
.card h3 a{text-decoration:none}
.card p{color:#444;font-size:.95rem;margin:.3rem 0}
.meta{font-family:Arial,Helvetica,sans-serif;font-size:.75rem;color:#777;text-transform:uppercase;letter-spacing:.05em}
.briefing{background:#efe9d8;border:1px solid var(--rule);padding:1.1rem 1.2rem;margin:1.4rem 0}
.briefing h2{font-family:'Playfair Display',Georgia,serif;margin:.1rem 0 .4rem}
.briefing form{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem}
.briefing input[type=email]{flex:1;min-width:220px;padding:.55rem;font-size:1rem;border:1px solid #999}
.briefing button{background:var(--red);color:#fff;border:0;padding:.55rem 1.1rem;font-size:1rem;cursor:pointer}
.ad-slot{margin:1.2rem 0;text-align:center}
.ad-placeholder{border:1px dashed #bbb;color:#999;font-family:Arial,Helvetica,sans-serif;font-size:.75rem;text-transform:uppercase;letter-spacing:.15em;padding:1.4rem 0}
article.full h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(1.9rem,4.5vw,3rem);line-height:1.12;margin:.4rem 0}
article.full h2{font-family:'Playfair Display',Georgia,serif;margin:1.5rem 0 .4rem}
article.full p{font-size:1.08rem}
article.full p.lead{font-size:1.15rem}
.why{border-left:4px solid var(--red);background:#f7f3e8;padding:.8rem 1.1rem;margin:1.6rem 0}
.why h2{margin:.1rem 0 .4rem;font-size:1.3rem}
.source{font-family:Arial,Helvetica,sans-serif;font-size:.9rem;color:#555}
.breadcrumb{font-family:Arial,Helvetica,sans-serif;font-size:.8rem;color:#666;margin-bottom:.5rem}
.breadcrumb a{color:#666}
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.2rem;margin-top:1rem}
.tier{border:1px solid var(--rule);background:#fff;padding:1.2rem;text-align:center}
.tier .price{font-size:2rem;font-family:'Playfair Display',Georgia,serif}
.tier button,.tier a.btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;border:0;padding:.6rem 1.3rem;font-size:1rem;cursor:pointer;margin-top:.6rem}
footer{background:var(--navy);color:#cfc9b8;padding:1.6rem 1rem;font-family:Arial,Helvetica,sans-serif;font-size:.85rem}
footer a{color:#fff}
footer .cols{max-width:1180px;margin:0 auto;display:flex;gap:2rem;flex-wrap:wrap;justify-content:space-between}
.searchbox{display:flex;gap:.5rem;margin:1rem 0}
.searchbox input{flex:1;padding:.55rem;font-size:1rem}
.searchbox button{background:var(--navy);color:#fff;border:0;padding:.55rem 1.1rem;cursor:pointer}
.static-page{max-width:760px}
.static-page h1{font-family:'Playfair Display',Georgia,serif}
/* House plate style: every article image gets the identical treatment, so
   all plates look like they came from one 19th-century illustration shop.
   Plates sit on pure white (the artwork's own background is transparent or
   pure white) and blend into the white page: no matte. The frame is a
   thin, solid black border on the image itself, on all four sides; the
   figure carries no border and no padding, so the border sits right up
   against the image with no gap and there is never a double frame. The
   caption sits below the bordered image, outside the border, with its
   own padding. (Global
   border-box sizing keeps the border inside the plate box, so cropped
   card/lead thumbnails show it cleanly on every side.) Card/lead
   thumbnails crop to a fixed 16:9 plate box; article pages show the
   full plate at a standard width. */
figure.art-figure{margin:1.1rem 0;background:#ffffff;padding:0}
figure.art-figure img{display:block;width:100%;height:auto;border:1px solid #000;filter:grayscale(1) contrast(1.06);background:#ffffff}
figure.art-figure figcaption{font-style:italic;font-size:.86rem;color:#444;text-align:center;padding:.45rem .3rem .15rem}
.card figure.art-figure{margin:0 0 .55rem}
.card figure.art-figure img,.lead-story figure.art-figure img{aspect-ratio:16/9;object-fit:cover}
.lead-story figure.art-figure{margin:1rem 0 .3rem}
article.full figure.art-figure{max-width:880px;margin-left:auto;margin-right:auto}
/* Article page layout: story column plus a right rail of horizontal
   AdSense units. The rail is sticky on desktop so the ads stay in view
   while the story scrolls; on narrower screens the layout collapses to
   a single column and the rail stacks below the article body. */
.article-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:2.2rem;align-items:start}
.article-rail{position:sticky;top:1rem}
.article-rail .ad-slot{margin:0 0 1.2rem;text-align:center}
.article-rail .ad-slot:last-child{margin-bottom:0}
.ad-placeholder.ad-horizontal{padding:2.4rem 0}
@media (max-width:900px){
  .article-layout{grid-template-columns:1fr}
  .article-rail{position:static}
}
/* Trending in Colorado box: sits in the article rail under the ads.
   Numbered list with red circles, newspaper trending style. Selection
   is the most recent stories site-wide (the site has no view tracking),
   so the box never claims read counts or "most read". */
.trending{border-top:3px solid var(--ink);padding-top:.7rem}
.trending h2{font-family:'Playfair Display',Georgia,serif;font-size:1.25rem;margin:.1rem 0 .5rem}
.trending ol{list-style:none;margin:0;padding:0}
.trending li{display:flex;gap:.65rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid var(--rule)}
.trending li:last-child{border-bottom:0;padding-bottom:0}
.trending .trend-num{flex:0 0 auto;width:1.55rem;height:1.55rem;border-radius:50%;background:var(--red);color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:.9rem;line-height:1.55rem;text-align:center;margin-top:.1rem}
.trending a{text-decoration:none;font-family:'Playfair Display',Georgia,serif;line-height:1.3}
.trending a:hover{text-decoration:underline}
/* Homepage lead: classic newspaper float. The lead story's plate —
   image and caption together in one figure — floats right and the
   story's opening paragraphs wrap around it, so the front page gives
   a real read of the lead story instead of headline and dek alone.
   The lead-body clearfix keeps the floated plate inside the lead
   block, so whatever follows never rides up beside it. The plate
   keeps the house treatment (pure white figure, thin solid black
   border on the image, grayscale) and the homepage's 16:9 plate crop. */
.lead-story .lead-body::after{content:"";display:block;clear:both}
.lead-story figure.lead-figure{float:right;width:44%;max-width:460px;margin:.4rem 0 1rem 1.6rem}
.lead-story .lead-body p{font-size:1.05rem;margin:.7rem 0}
.lead-story .lead-body p.lead{font-size:1.14rem}
.lead-story .continue-reading{font-family:Arial,Helvetica,sans-serif;font-size:.92rem;font-weight:bold}
.lead-story .continue-reading a{color:var(--red);text-decoration:none}
.lead-story .continue-reading a:hover{text-decoration:underline}
/* Narrow screens: the float drops and the plate stacks full width
   above the story text, so no text column gets squeezed. */
@media (max-width:680px){
  .lead-story figure.lead-figure{float:none;width:auto;max-width:none;margin:1rem 0 .3rem}
}
/* Restyle pass, matching the newsroom dress: the navy top bar carries
   the paper's line on the left and the date line on the right, and the
   account links live at the right end of the nav. */
.topbar .brand-line{font-style:italic;font-family:Georgia,serif}
nav.main li.nav-push{margin-left:auto}
nav.main a.btn-subscribe{padding:.25rem .75rem}
/* Homepage two-column layout under the features: section-grouped card
   grids in the main column; the briefing signup, one advertisement
   and Trending in a sticky 300px right rail. */
.home-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:2.2rem;align-items:start;margin-top:1.6rem}
.home-rail{position:sticky;top:1rem}
.home-rail .briefing{margin:0 0 1.2rem}
.home-rail .ad-slot{margin:0 0 1.2rem}
@media (max-width:900px){
  .home-layout{grid-template-columns:1fr}
  .home-rail{position:static}
}
.latest-heading{font-family:'Playfair Display',Georgia,serif;font-size:1.9rem;margin:.2rem 0 1rem}
.section-group{margin-bottom:1.8rem}
.section-group h3{font-family:'Playfair Display',Georgia,serif;font-size:1.45rem;margin:0 0 .8rem;padding-bottom:.3rem;border-bottom:2px solid var(--ink)}
.section-group h3 a{text-decoration:none}
/* Article page: the plate and the Why It Matters box stack in one
   right-floated column and the opening text wraps around them — the
   same float treatment as the homepage lead — so the box sits
   directly under the illustration caption. The full plate shows (no
   16:9 crop) inside the float, as article plates always have. */
.article-body::after{content:"";display:block;clear:both}
.article-float{float:right;width:44%;max-width:460px;margin:.4rem 0 1rem 1.6rem}
article.full .article-float figure.art-figure{margin:0}
.article-float .why{margin:.7rem 0 0}
@media (max-width:680px){
  .article-float{float:none;width:auto;max-width:none;margin:1rem 0}
}
.sources-block{clear:both;border-top:1px solid var(--rule);margin-top:1.8rem;padding-top:.8rem}
.sources-block h2{font-family:'Playfair Display',Georgia,serif;font-size:1.3rem;margin:.1rem 0 .4rem}
/* Topic-cluster hub box: the last element on article, section and
   Local region pages. */
.hub-box{border:1px solid var(--rule);border-top:3px solid var(--ink);background:#f7f3e8;padding:1rem 1.2rem;margin-top:2rem}
.hub-box h2{font-family:'Playfair Display',Georgia,serif;font-size:1.35rem;margin:.1rem 0 .4rem}
.hub-box p{margin:.2rem 0;color:#444}
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
  const adsense = process.env.ADSENSE_PUBLISHER_ID
    ? '<script async src=https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
      esc(process.env.ADSENSE_PUBLISHER_ID) + ' crossorigin="anonymous"></script>'
    : '';
  const localDropdown =
    '<ul class="dropdown">' +
    REGIONS.map((r) => '<li><a href="/local/' + r.slug + '">' + r.name + '</a></li>').join('') +
    '</ul>';
  const navItems =
    '<li><a href="/">Home</a></li>' +
    SECTIONS.map((s) => {
      const link =
        '<a href="/section/' + s.slug + '"' +
        (activeNav === s.slug ? ' class="active"' : '') + '>' + s.name + '</a>';
      return s.slug === 'local'
        ? '<li class="has-dropdown">' + link + localDropdown + '</li>'
        : '<li>' + link + '</li>';
    }).join('') +
    '<li class="nav-push"><a href="/search">Search</a></li>' +
    '<li><a href="/signin">Sign In</a></li>' +
    '<li><a class="btn-subscribe" href="/subscribe">Subscribe</a></li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
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
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700;900&family=UnifrakturMaguntia&display=swap" rel="stylesheet">
<style>${CSS}</style>
${ld}
${adsense}
</head>
<body>
<div class="topbar">
  <span class="brand-line">Colorado Political News, Reporting, and Analysis</span>
  <span>${esc(fmtDate(new Date().toISOString()))} &middot; Denver, Colorado &middot; Fair, 54&deg;F</span>
</div>
<header class="masthead">
  <div class="masthead-inner">
    <h1><a href="/">${SITE_NAME}</a></h1>
    <div class="tagline">${TAGLINE}</div>
  </div>
</header>
<nav class="main"><ul>${navItems}</ul></nav>
<main class="wrap">
${body}
</main>
<footer>
  <div class="cols">
    <div><strong>${SITE_NAME}</strong><br>${TAGLINE}<br>Denver, Colorado</div>
    <div>
      <a href="/subscribe">Subscribe</a> &middot;
      <a href="/privacy">Privacy Policy</a> &middot;
      <a href="/terms">Terms of Use</a> &middot;
      <a href="/search">Search</a>
    </div>
    <div>&copy; ${new Date().getFullYear()} ${SITE_NAME}. All rights reserved.</div>
  </div>
</footer>
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
 * More-in grids, search results): 16:9 plate thumbnail, red category
 * label, headline, date and read time. No byline and no source line
 * on cards — those live on the article page (owner's standing rule).
 */
function articleCard(a) {
  return (
    '<div class="card">' +
    articleFigure(a) +
    '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<h3><a href="/article/' + esc(a.slug) + '">' + esc(a.headline) + '</a></h3>' +
    '<div class="meta">' + esc(fmtDateShort(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>' +
    '</div>'
  );
}

function briefingBox(thanks) {
  return (
    '<section class="briefing"><h2>The Colorado Briefing</h2>' +
    '<p>The Colorado Daily Briefing arrives Monday through Friday with the stories that matter across the state.</p>' +
    (thanks
      ? '<p><strong>Thank you. You are on the list.</strong></p>'
      : '<form method="post" action="/briefing"><input type="email" name="email" required placeholder="Your email address" aria-label="Email address"><button type="submit">Sign Up Free</button></form>') +
    '</section>'
  );
}

/**
 * One homepage feature block: the full lead treatment for a story —
 * kicker, headline, dek, byline, then the story's opening text with
 * the plate floated beside it and a Continue reading close, or the
 * plain figure when the story has no body text to excerpt. Used for
 * the lead story and for the second feature directly under it (drawn
 * from a different section by the home route), so both features share
 * one format.
 */
function featureStory(a) {
  const excerpt = leadExcerpt(a);
  let s =
    '<section class="lead-story"><div class="kicker">' +
    esc(a.topicLabel || sectionName(a.section)) + ' &middot; ' + esc(sectionName(a.section)) +
    '</div><h1 class="headline" style="font-size:clamp(2rem,5vw,3.4rem)"><a style="text-decoration:none" href="/article/' +
    esc(a.slug) + '">' + esc(a.headline) + '</a></h1>' +
    (a.dek ? '<p class="dek">' + esc(a.dek) + '</p>' : '') +
    '<div class="byline">' + esc(a.byline) + ' &middot; ' + esc(fmtDateShort(a.publishedAt)) + '</div>';
  if (excerpt) {
    // Classic newspaper float: the plate (image + caption as one
    // block) floats beside the story's opening paragraphs and the
    // text wraps around it. With no image the excerpt runs full
    // width; with no body text we skip this block entirely and use
    // the plain figure below, exactly as the homepage always did.
    s +=
      '<div class="lead-body">' + articleFigure(a, 'lead-figure') + excerpt +
      '<p class="continue-reading"><a href="/article/' + esc(a.slug) + '">Continue reading &rarr;</a></p></div>';
  } else {
    s += articleFigure(a);
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

function homePage({ lead, second, latest, briefingThanks }) {
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

  let body = '';
  if (lead) {
    body += featureStory(lead);
    // Second feature, directly under the lead in the same format,
    // from a different section (selected by the home route). Absent
    // when no different-section story exists.
    if (second) body += featureStory(second);
  } else {
    body += '<section class="lead-story"><h1 class="headline">Colorado news, reported plainly.</h1><p class="dek">New stories are on the way.</p></section>';
  }

  if (lead) {
    // Two-column front page under the features: "Latest from
    // Colorado" card grids grouped by section in the main column;
    // the briefing signup, one advertisement and Trending in the
    // right rail. The lead and second feature were pulled out of
    // `latest` by the route, so nothing repeats in the grids.
    // Trending takes the five most recent stories site-wide,
    // features included.
    const trendingPool = [lead, second].concat(latest).filter(Boolean).slice(0, 5);
    let main = '';
    if (latest.length) {
      main += '<h2 class="latest-heading">Latest from Colorado</h2>';
      const grouped = new Map();
      for (const a of latest) {
        if (!grouped.has(a.section)) grouped.set(a.section, []);
        grouped.get(a.section).push(a);
      }
      for (const s of SECTIONS) {
        const items = grouped.get(s.slug);
        if (!items || !items.length) continue;
        grouped.delete(s.slug);
        main +=
          '<section class="section-group"><h3><a href="/section/' + s.slug + '">' +
          s.name + '</a></h3><div class="grid">' +
          items.map(articleCard).join('') + '</div></section>';
      }
      // A section outside SECTIONS still shows, ungrouped, rather
      // than vanishing from the front page.
      const leftovers = [];
      for (const items of grouped.values()) leftovers.push(...items);
      if (leftovers.length) {
        main += '<div class="grid">' + leftovers.map(articleCard).join('') + '</div>';
      }
    }
    body +=
      '<div class="home-layout"><div class="home-main">' + main + '</div>' +
      '<aside class="home-rail" aria-label="Sidebar">' +
      briefingBox(briefingThanks) + adSlot('home-rail') + trendingRailBox(trendingPool) +
      '</aside></div>';
  } else {
    body += briefingBox(briefingThanks);
  }

  return layout({
    title: fitTitle('Colorado politics, taxes, energy, schools and local news', 70),
    description: fitDescription(
      'Colorado political news on taxes and the Taxpayer\'s Bill of Rights, gun rights, energy, schools and local government statewide. Read today\'s top stories.'
    ),
    path: '/',
    jsonLd,
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
  const body =
    '<div class="kicker">' + esc(name) + '</div>' +
    '<h1 class="headline" style="font-size:2.4rem">' + esc(name) + '</h1>' +
    '<p class="dek">' + esc(meta.description) + '</p>' +
    (articles.length
      ? '<div class="grid">' + articles.map(articleCard).join('') + '</div>'
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

function articlePage(a, related, trending) {
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

  let body =
    '<div class="article-layout"><article class="full">' +
    '<div class="breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/section/' + a.section + '">' +
    esc(sectionName(a.section)) + '</a> &rsaquo; ' + esc(a.topicLabel || sectionName(a.section)) + '</div>' +
    '<div class="kicker">' + esc(a.topicLabel || sectionName(a.section)) +
    (a.region ? ' &middot; ' + esc(a.region) : '') + '</div>' +
    '<h1>' + esc(a.headline) + '</h1>' +
    (a.dek ? '<p class="dek">' + esc(a.dek) + '</p>' : '') +
    '<div class="byline">' + esc(a.byline) + ' &middot; ' + esc(fmtDate(a.publishedAt)) +
    ' &middot; ' + readTimeMinutes(a) + ' min read</div>';

  const whyBox = a.whyItMatters
    ? '<div class="why"><h2>Why it matters</h2><p>' + esc(a.whyItMatters) + '</p></div>'
    : '';
  const hasImage = !!(a.image && a.image.url);
  body += '<div class="article-body">';
  if (hasImage) {
    // The plate (image + caption) and the Why It Matters box stack
    // in one right-floated column and the opening text wraps around
    // them — the same float treatment as the homepage lead — so the
    // box sits directly under the illustration caption.
    body += '<div class="article-float">' + articleFigure(a) + whyBox + '</div>';
  }
  a.sections.forEach((s, i) => {
    if (s.heading) body += '<h2>' + esc(s.heading) + '</h2>';
    if (s.lead) body += '<p class="lead">' + esc(s.lead) + '</p>';
    for (const p of s.paragraphs) body += '<p>' + esc(p) + '</p>';
    // With no plate to sit under, the box follows the opening section.
    if (!hasImage && i === 0) body += whyBox;
  });
  if (!hasImage && !a.sections.length) body += whyBox;

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
  body +=
    '<aside class="article-rail" aria-label="Sidebar">' +
    railAdSlot() + railAdSlot() + railAdSlot() +
    trendingRailBox(trending) +
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
  subscribePage,
  checkoutPage,
  searchPage,
  staticPage,
  simplePage,
};
