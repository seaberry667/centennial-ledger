'use strict';
/**
 * The Centennial Ledger - live public site.
 *
 * Server-rendered Express app. It does NOT write or cull stories; it
 * receives finished stories from the Muse newsroom through the
 * append-only ingest API and serves them to the public.
 */

const express = require('express');
const path = require('path');
const sharp = require('sharp');
const { createStore, SECTIONS, REGIONS, normalizeArticle, isSatire, sectionName } = require('./store');
const render = require('./render');
const newsletter = require('./newsletter');
const mailer = require('./mailer');
const { startWeatherUpdates } = require('./weather');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false }));

// Static brand assets (the masthead artwork) from public/, cached
// for a week: these files change only with a redesign. Registered
// before the store-ready middleware so images serve immediately.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
);

let store;
const ready = createStore().then((s) => {
  store = s;
  console.log(
    'Store ready: ' + (process.env.DATABASE_URL ? 'Postgres' : 'local file store (data/db.json)')
  );
});
app.use(async (req, res, next) => {
  try {
    await ready;
    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ API ------------------------------ */

app.get('/api/health', async (req, res) => {
  const n = await store.countArticles();
  res.json({ ok: true, site: 'The Centennial Ledger', articles: n });
});

/**
 * POST /api/ingest
 * Header: x-ingest-secret must match INGEST_SECRET.
 * Body: a single article object, or { articles: [ ... ] }.
 * APPEND-ONLY: a slug that already exists is skipped; its text is never
 * updated. Two narrow fill-only exceptions: when the stored article has
 * no image and the incoming one carries a valid image, the image alone
 * is filled in (counted as "imaged"); and when the incoming source list
 * is longer than the stored one, the sources alone are replaced
 * (counted as "sourced"). One further exception, Opinion articles
 * only (owner instruction, 2026-11-03): their source lists were
 * restructured in the newsroom, so a differing incoming list replaces
 * the stored one outright, even when it is shorter. One more, any
 * section (owner instruction, 2026-11-04): when the payload article
 * carries imageReplace: true, which the newsroom sets only after the
 * owner orders a published plate replaced, the stored image alone is
 * replaced by the incoming one (counted as "reimaged").
 * Returns { received, inserted, skipped, imaged, sourced, reimaged },
 * where skipped counts items that were neither inserted nor filled.
 */
app.post('/api/ingest', async (req, res) => {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return res.status(500).json({ error: 'INGEST_SECRET is not configured' });
  if (req.get('x-ingest-secret') !== secret) {
    return res.status(401).json({ error: 'invalid or missing x-ingest-secret' });
  }
  const body = req.body || {};
  const items = Array.isArray(body) ? body : Array.isArray(body.articles) ? body.articles : [body];
  let inserted = 0;
  let imaged = 0;
  let sourced = 0;
  let reimaged = 0;
  let skipped = 0;
  for (const raw of items) {
    const article = normalizeArticle(raw);
    if (!article) {
      skipped += 1;
      continue;
    }
    const result = await store.insertArticle(article);
    if (result === 'inserted') {
      inserted += 1;
      continue;
    }
    // Existing slug: the stored text stays untouched, but an image may
    // be filled in once if the article live has none, and a fuller
    // source list replaces a shorter stored one.
    let filled = false;
    // Owner-ordered plate replacement: only when the payload flags
    // this article (imageReplace: true on the raw item; the flag is
    // not a stored field). Checked before the fill-only backfill.
    if (
      raw &&
      raw.imageReplace === true &&
      article.image &&
      (await store.replaceImage(article.slug, article.image))
    ) {
      reimaged += 1;
      filled = true;
    } else if (article.image && (await store.backfillImageIfMissing(article.slug, article.image))) {
      imaged += 1;
      filled = true;
    }
    if (await store.backfillSourcesIfFewer(article.slug, article.sources)) {
      sourced += 1;
      filled = true;
    }
    // Breaking-flag fill (2026-11-08): a story the newsroom flags
    // breaking after it is already live gains the flag, so the
    // breaking news ticker can pick it up.
    if (article.breaking && (await store.markBreaking(article.slug))) {
      filled = true;
    }
    // Last-reviewed fill (2026-11-08): an explainer's recorded
    // review date follows the newsroom's value when the stored one
    // differs (the inaugural three arrived shifted by a day).
    if (
      article.lastReviewed &&
      (await store.fillLastReviewed(article.slug, article.lastReviewed))
    ) {
      filled = true;
    }
    // Opinion pieces: the newsroom's restructured list replaces the
    // stored one whenever it differs (see the route comment above).
    if (
      article.section === 'opinion' &&
      (await store.replaceSourcesIfDifferent(article.slug, article.sources))
    ) {
      sourced += 1;
      filled = true;
    }
    if (!filled) skipped += 1;
  }
  res.json({ received: items.length, inserted, skipped, imaged, sourced, reimaged });
});

/* --------------------------- Public pages ------------------------- */

// Colorado Explained series membership (owner directive,
// 2026-11-08): an article carries the series designation in
// addition to its one primary section.
const isExplained = (a) =>
  // Series renamed "How Colorado Works" (owner order, 2026-11-08);
  // membership accepts the old stored name too (boot migration
  // renames stored rows; stragglers still count as members).
  ['colorado explained', 'how colorado works'].includes(
    String((a && a.series) || '').trim().toLowerCase());

// Breaking news ticker (owner request, 2026-11-08): before any
// public page renders, refresh the ticker contents from the store
// — the six most recent stories, newest first (owner instruction,
// 2026-11-08). News stories only: no Opinion/editorial pieces, no
// satire, and no Colorado Explained explainers ever appears in it
// (owner instructions, 2026-11-08; cartoons are likewise never
// listed among the site's article listings). The ticker is
// decorative: a failure here must never block a page.
app.use(async (req, res, next) => {
  if (
    req.method !== 'GET' ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/img/') ||
    req.path.endsWith('.xml') ||
    req.path.endsWith('.txt')
  ) {
    return next();
  }
  try {
    const pool = (await store.listArticles({ limit: 60 })).filter(
      (a) => a.section !== 'opinion' && !isSatire(a) && !isExplained(a)
    );
    render.setTickerItems({
      label: 'BREAKING',
      items: pool.slice(0, 6).map((a) => ({ slug: a.slug, headline: a.headline })),
    });
  } catch (err) {
    /* keep the previous ticker contents */
  }
  next();
});

app.get('/', async (req, res) => {
  // Fetch 32: the lead, second and third features, and the pool the
  // rail rows and Latest cards draw from. (The per-section rail picks
  // and the Local & Statewide list are fetched separately, below.)
  // Satire pieces are never featured or listed among the homepage
  // articles (owner instruction, 2026-11-02): they live on the
  // Opinion page and are reached from there, so they are
  // filtered out of the homepage pool before anything is picked.
  const articles = (await store.listArticles({ limit: 32 })).filter(
    (a) => !isSatire(a)
  );
  // The three featured spots (lead, second and third feature) are
  // news only: Opinion pieces never take them (owner instruction,
  // 2026-11-02). Opinion reaches the homepage through the Editorial
  // Desk strip below, and Satire is already filtered out of the pool
  // above. The features are simply the three most recent news
  // stories, newest first (owner instruction, 2026-11-08,
  // superseding the 2026-11-02 different-section rule), each shown
  // directly under the last in the same format. All are pulled out
  // of the shared pool so no story appears twice on the front page.
  // Colorado Explained explainers never take the featured spots
  // either (owner instruction, 2026-11-08): on the homepage they
  // appear only in their own module below.
  const newsPool = articles.filter(
    (a) => a.section !== 'opinion' && !isExplained(a)
  );
  const lead = newsPool[0] || null;
  const second = newsPool[1] || null;
  const third = newsPool[2] || null;
  const featuredSlugs = new Set(
    [lead, second, third].filter(Boolean).map((a) => a.slug)
  );
  const rest = articles.filter((a) => !featuredSlugs.has(a.slug));
  // Rail groups (owner instruction, 2026-11-02): the right column
  // groups the five subject sections — Politics, Business, Energy
  // & Environment, Education & Health and Colorado Life, in that
  // order (2026-11-08 restructure) — with the TWO most recent stories
  // from each section under that section's heading, excluding the
  // features. A section whose newest stories are features
  // contributes its next stories instead; a section with nothing
  // left has no group.
  const featureSlugs = new Set([lead, second, third].filter(Boolean).map((a) => a.slug));
  const railGroups = [];
  for (const slug of ['politics', 'business', 'energy-environment', 'education-health']) {
    const inSection = await store.listArticles({ section: slug, limit: 6 });
    const picks = inSection
      .filter((a) => !featureSlugs.has(a.slug) && !isExplained(a))
      .slice(0, 2);
    if (picks.length) railGroups.push({ section: slug, articles: picks });
  }
  const railTop = railGroups.flatMap((g) => g.articles);
  // "Latest from Colorado" grid (spec 3.10): the three most recent
  // stories after the features, also skipping anything the
  // rail rows already use, so features, rail rows and Latest cards
  // are all disjoint on the front page.
  const usedSlugs = new Set(
    [...featureSlugs, ...railTop.map((a) => a.slug)]
  );
  const latestRow = rest
    .filter((a) => !usedSlugs.has(a.slug) && !isExplained(a))
    .slice(0, 3);
  // Local & Statewide (design addendum): the eight most recently
  // published Local stories across all eight regions, newest first.
  const localStories = await store.listArticles({ section: 'local', limit: 8 });
  // The newest Opinion EDITORIAL feeds the "From Our Editorial
  // Desk" strip — never a satire piece (owner instruction,
  // 2026-11-08: cartoons live under Opinion since the restructure
  // but must not take the featured editorial spot). Null while the
  // store holds no editorial, and the strip is then absent.
  const opinion =
    (await store.listArticles({ section: 'opinion', limit: 10 })).find(
      (a) => !isSatire(a)
    ) || null;
  // Colorado Explained homepage module (owner directive,
  // 2026-11-08): curated, not a newest-first feed — the TABOR
  // flagship features, and the supporting set is picked so no two
  // adjacent cards share a section while alternatives remain.
  const explainedAll = (await store.listArticles({ limit: 100 })).filter(isExplained);
  let explained = null;
  if (explainedAll.length) {
    const featured =
      explainedAll.find((a) => a.slug === 'how-colorados-tabor-law-actually-works') ||
      explainedAll[0];
    const pool = explainedAll.filter((a) => a.slug !== featured.slug);
    const items = [];
    while (items.length < 4 && pool.length) {
      const lastSection = items.length
        ? items[items.length - 1].section
        : featured.section;
      let idx = pool.findIndex((a) => a.section !== lastSection);
      if (idx < 0) idx = 0;
      items.push(pool.splice(idx, 1)[0]);
    }
    explained = { featured, items };
  }
  res.type('html').send(
    render.homePage({
      lead: lead || null,
      second,
      third,
      latest: rest.slice(0, 12),
      railGroups,
      latestRow,
      localStories,
      opinion,
      explained,
      briefingThanks: req.query.briefing === 'thanks',
    })
  );
});

// Retired section URLs (owner restructure, 2026-11-08): permanent
// redirects to the replacement category pages, so existing links
// and search results keep their equity.
const SECTION_REDIRECTS = {
  rights: 'politics',
  taxes: 'business',
  energy: 'energy-environment',
  schools: 'education-health',
  // Colorado Life retired as a section (owner order, 2026-11-08);
  // its one article moved to Local News.
  'colorado-life': 'local',
};

app.get('/section/:slug', async (req, res) => {
  // Opinion and Satire are not public (owner order, 2026-11-08):
  // their section URLs go home, and their articles 404 at the
  // store's read layer.
  if (req.params.slug === 'opinion' || req.params.slug === 'satire') {
    return res.redirect(301, '/');
  }
  const redirect = SECTION_REDIRECTS[req.params.slug];
  if (redirect) return res.redirect(301, '/section/' + redirect);
  const section = SECTIONS.find((s) => s.slug === req.params.slug);
  if (!section) return res.status(404).type('html').send(notFound());
  const articles = await store.listArticles({ section: section.slug, limit: 60 });
  if (section.slug === 'local') {
    return res.type('html').send(render.localHubPage({ articles }));
  }
  res.type('html').send(render.sectionPage({ section: section.slug, articles }));
});

app.get('/local/:region', async (req, res) => {
  const region = REGIONS.find((r) => r.slug === req.params.region);
  if (!region) return res.status(404).type('html').send(notFound());
  // Region pages list every story carrying the region, whatever its
  // primary category (owner restructure, 2026-11-08): a statewide
  // subject story keeps its regional association, and the region
  // page is where that association shows.
  const articles = await store.listArticles({ region: region.slug, limit: 60 });
  res.type('html').send(render.localRegionPage({ region, articles }));
});

/* Article plate images at a real URL, so social platforms can fetch
   them for link previews (og:image points here). Plates are stored
   inline as data URIs; this decodes and serves the bytes. An article
   whose image is already an http(s) URL redirects to it. Stored
   plates arrive as WebP, which Facebook's preview crawler will not
   process, so anything that is not already PNG/JPEG/GIF is converted
   to PNG on first request (falling back to a quality JPEG if the
   PNG is unexpectedly huge) and cached in memory. */
const shareImageCache = new Map();
/* Resized display variants for page rendering: /img/<slug>?w=<n>
   (no filename suffix) serves the plate resized to width n as
   WebP, so pages no longer inline full-size plates as data URIs.
   Keyed by slug+width, bounded like the share-image cache. */
const resizedImageCache = new Map();
app.get('/img/:slug', async (req, res) => {
  // Accept an optional .png/.jpg suffix: a conventional image
  // filename is the safest shape for scrapers, and the suffix also
  // gives format changes a fresh URL for their caches.
  const hasSuffix = /\.(png|jpe?g)$/i.test(req.params.slug);
  const slug = req.params.slug.replace(/\.(png|jpe?g)$/i, '');
  const article = await store.getArticle(slug);
  if (!article || !article.image || !article.image.url) {
    return res.status(404).type('text').send('Not found');
  }
  const url = article.image.url;
  if (/^https?:\/\//i.test(url)) return res.redirect(302, url);
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (!m) return res.status(404).type('text').send('Not found');
  const storedType = (m[1] || '').toLowerCase();
  if (!/^image\//.test(storedType)) {
    return res.status(404).type('text').send('Not found');
  }
  const raw = m[2]
    ? Buffer.from(m[3], 'base64')
    : Buffer.from(decodeURIComponent(m[3]));
  // Resized display variant (page rendering only): a bare slug
  // with a sane width parameter gets a WebP at that width, never
  // upscaled beyond the stored source. The suffixed share-image
  // path below is untouched and ignores w entirely.
  const wParam = parseInt(req.query && req.query.w, 10);
  if (!hasSuffix && Number.isFinite(wParam)) {
    const w = Math.min(1600, Math.max(50, wParam));
    const key = slug + '?w=' + w;
    let variant = resizedImageCache.get(key);
    if (!variant) {
      try {
        const buf = await sharp(raw)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        variant = { type: 'image/webp', buf };
      } catch (err) {
        console.error('Image resize failed for', slug, err);
        return res.status(502).type('text').send('Image unavailable');
      }
      resizedImageCache.set(key, variant);
      if (resizedImageCache.size > 64) {
        resizedImageCache.delete(resizedImageCache.keys().next().value);
      }
    }
    res.set('Cache-Control', 'public, max-age=86400');
    return res.type(variant.type).send(variant.buf);
  }
  let out = shareImageCache.get(slug);
  if (!out) {
    if (['image/png', 'image/jpeg', 'image/gif'].includes(storedType)) {
      out = { type: storedType, buf: raw };
    } else {
      try {
        let buf = await sharp(raw).png().toBuffer();
        let type = 'image/png';
        if (buf.length > 4500000) {
          buf = await sharp(raw).jpeg({ quality: 90 }).toBuffer();
          type = 'image/jpeg';
        }
        out = { type, buf };
      } catch (err) {
        console.error('Image conversion failed for', slug, err);
        return res.status(502).type('text').send('Image unavailable');
      }
    }
    shareImageCache.set(slug, out);
    if (shareImageCache.size > 16) {
      shareImageCache.delete(shareImageCache.keys().next().value);
    }
  }
  res.set('Cache-Control', 'public, max-age=86400');
  return res.type(out.type).send(out.buf);
});

app.get('/article/:slug', async (req, res) => {
  const article = await store.getArticle(req.params.slug);
  if (!article) return res.status(404).type('html').send(notFound());
  // Satire pieces get their own bare page (owner instruction,
  // 2026-11-02): just the comic and its long caption, with
  // previous/next buttons to move between comics. Neighbors come
  // from the Satire list, newest first: "previous" is the older
  // comic, "next" is the newer one.
  if (isSatire(article)) {
    const comics = (await store.listArticles({ section: 'opinion', limit: 60 })).filter(isSatire);
    const idx = comics.findIndex((c) => c.slug === article.slug);
    const newer = idx > 0 ? comics[idx - 1] : null;
    const older = idx >= 0 && idx < comics.length - 1 ? comics[idx + 1] : null;
    return res.type('html').send(render.satirePage(article, older, newer));
  }
  const related = (await store.listArticles({ section: article.section, limit: 4 })).filter(
    (a) => a.slug !== article.slug
  );
  // Local & Statewide (design addendum): the eight most recently
  // published Local stories across all eight regions, newest first —
  // the same sidebar component the homepage uses.
  const localStories = await store.listArticles({ section: 'local', limit: 8 });
  // Colorado Explained pieces link to fellow explainers at the end
  // (owner directive, 2026-11-08), same-section explainers first.
  let explainedRelated = [];
  if (isExplained(article)) {
    explainedRelated = (await store.listArticles({ limit: 100 }))
      .filter((x) => isExplained(x) && x.slug !== article.slug)
      .sort(
        (x, y) =>
          (y.section === article.section ? 1 : 0) -
          (x.section === article.section ? 1 : 0)
      )
      .slice(0, 3);
  }
  res.type('html').send(
    render.articlePage(article, related.slice(0, 3), localStories, explainedRelated)
  );
});

// Colorado Explained series archive (owner directive, 2026-11-08).
// NOT a navigation item; reached from the homepage module and from
// explainer article pages. The category chips are an archive
// filter, not new sections.
app.get('/explained', async (req, res) => {
  const all = (await store.listArticles({ limit: 200 })).filter(isExplained);
  const cat = String(req.query.category || '');
  const valid = SECTIONS.some((s) => s.slug === cat);
  const cats = SECTIONS.filter((s) =>
    all.some((a) => a.section === s.slug)
  ).map((s) => ({ slug: s.slug, name: s.name }));
  const filtered = valid ? all.filter((a) => a.section === cat) : all;
  const featured =
    !valid && filtered.length
      ? filtered.find((a) => a.slug === 'how-colorados-tabor-law-actually-works') ||
        filtered[0]
      : null;
  const articles = featured
    ? filtered.filter((a) => a.slug !== featured.slug)
    : filtered;
  res.type('html').send(
    render.explainedPage({ articles, featured, category: valid ? cat : '', cats })
  );
});

app.get('/subscribe', (req, res) => {
  res.type('html').send(
    render.subscribePage({
      sent: req.query.sent === '1',
      error: req.query.error || '',
      email: String(req.query.email || ''),
    })
  );
});

// The paid tiers are retired; the free subscription lives at
// /subscribe. The old checkout URL redirects there permanently.
app.get('/subscribe/checkout', (req, res) => {
  res.redirect(301, '/subscribe');
});

app.get('/about', (req, res) => {
  res.type('html').send(render.aboutPage());
});

app.get('/privacy', (req, res) => {
  res.type('html').send(render.staticPage('privacy'));
});

app.get('/terms', (req, res) => {
  res.type('html').send(render.staticPage('terms'));
});

app.get('/signin', (req, res) => {
  res.type('html').send(
    render.simplePage(
      'Sign in: reader accounts for Colorado news subscribers',
      'Sign In',
      'Reader accounts are coming soon. Subscribers will sign in here once checkout is live; in the meantime, The Colorado Briefing and the front page are open to everyone.',
      '/signin',
      'Sign in to your reader account for Colorado political news: manage your subscription, saved stories and briefing preferences once checkout opens. Read the news.'
    )
  );
});

app.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const results = q ? await store.listArticles({ search: q, limit: 30 }) : [];
  res.type('html').send(render.searchPage(q, results));
});

/* --------------------------- Newsletter --------------------------- */

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function safeSource(raw, fallback) {
  const s = String(raw || '').toLowerCase();
  return /^[a-z0-9-]{1,40}$/.test(s) ? s : fallback;
}

function safeReturnPath(raw) {
  const s = String(raw || '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

/**
 * The legacy briefing signup keeps its exact redirect contract
 * (/?briefing=thanks / /?briefing=invalid) but now writes into the
 * unified subscriber system: a pending Daily Brief subscriber plus
 * a confirmation email (double opt-in).
 */
app.post('/briefing', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  if (!newsletter.isValidEmail(email)) {
    return res.redirect('/?briefing=invalid');
  }
  await newsletter.subscribeSignup(store, mailer, {
    email,
    dailyBrief: true,
    source: safeSource(req.body && req.body.source, 'briefing-box'),
    ip: req.ip,
  });
  res.redirect('/?briefing=thanks');
});

/** The full subscription form on /subscribe. */
app.post('/subscribe', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  if (!newsletter.isValidEmail(email)) {
    return res.redirect('/subscribe?error=invalid');
  }
  await newsletter.subscribeSignup(store, mailer, {
    email,
    firstName: b.first_name,
    dailyBrief: b.daily_brief === 'on' || b.daily_brief === 'true',
    topics: asArray(b.topics),
    regions: asArray(b.regions),
    source: 'subscribe-page',
    ip: req.ip,
  });
  res.redirect('/subscribe?sent=1&email=' + encodeURIComponent(email));
});

/**
 * Compact contextual forms (article, section and region modules):
 * email plus preselected topics/regions. The reader lands on a
 * short notice page; customization happens later, from the
 * confirmation email or the preference center, and skipping it
 * never blocks the signup.
 */
app.post('/subscribe-quick', async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim();
  if (!newsletter.isValidEmail(email)) {
    return res.redirect('/subscribe?error=invalid');
  }
  await newsletter.subscribeSignup(store, mailer, {
    email,
    dailyBrief: false,
    topics: asArray(b.topics),
    regions: asArray(b.regions),
    digestFrequency: 'daily',
    source: safeSource(b.source, 'module'),
    ip: req.ip,
  });
  res.type('html').send(
    render.newsletterNoticePage({
      heading: 'Please check your inbox',
      text:
        'We sent a confirmation email to ' + email +
        '. Click the link in that email to finish signing up. You can adjust your topics and regions there, or any time from the preference center.',
      linkHref: safeReturnPath(b.return),
      linkText: 'Back to reading',
    })
  );
});

/** Double opt-in confirmation link from the signup email. */
app.get('/confirm/:token', async (req, res) => {
  const sub = await newsletter.confirmSubscriber(store, req.params.token);
  if (!sub) {
    return res.status(400).type('html').send(
      render.newsletterNoticePage({
        heading: 'That link has expired',
        text: 'Confirmation links work for 7 days. Subscribe again and we will send a fresh one.',
        linkHref: '/subscribe',
        linkText: 'Go to the subscribe page',
      })
    );
  }
  res.type('html').send(
    render.newsletterNoticePage({
      heading: 'Subscription confirmed',
      text:
        'Thank you. Your subscription is active. You can set your topics and regions now, or change them any time.',
      linkHref: newsletter.preferencesUrlFor(sub),
      linkText: 'Set your topics and regions',
    })
  );
});

/** Confirmation link for an email-address change. */
app.get('/confirm-email/:token', async (req, res) => {
  const sub = await newsletter.applyEmailChange(store, req.params.token);
  if (!sub) {
    return res.status(400).type('html').send(
      render.newsletterNoticePage({
        heading: 'That link did not work',
        text: 'The change link may have expired, or the address may already be subscribed. Nothing was changed.',
        linkHref: '/preferences',
        linkText: 'Go to your preferences',
      })
    );
  }
  res.type('html').send(
    render.newsletterNoticePage({
      heading: 'Email address updated',
      text: 'Your Ledger emails will now go to ' + sub.email + '.',
      linkHref: newsletter.preferencesUrlFor(sub),
      linkText: 'Review your preferences',
    })
  );
});

app.get('/preferences', (req, res) => {
  res.type('html').send(
    render.preferencesLandingPage({ sent: req.query.sent === '1' })
  );
});

app.post('/preferences/request', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  if (newsletter.isValidEmail(email)) {
    // The response is the same whether or not the address is on
    // file, so the form cannot be used to probe the subscriber list.
    await newsletter.requestPreferencesLink(store, mailer, email);
  }
  res.redirect('/preferences?sent=1');
});

app.get('/preferences/:token', async (req, res) => {
  const sub = await newsletter.subscriberForPrefsToken(store, req.params.token);
  if (!sub) {
    return res.status(400).type('html').send(
      render.newsletterNoticePage({
        heading: 'That link has expired',
        text: 'Preference links work for 30 days. Enter your email address and we will send a fresh one.',
        linkHref: '/preferences',
        linkText: 'Get a new link',
      })
    );
  }
  res.type('html').send(
    render.preferencesPage({
      sub,
      token: req.params.token,
      saved: req.query.saved === '1',
      error: req.query.error || '',
    })
  );
});

app.post('/preferences/:token', async (req, res) => {
  const sub = await newsletter.subscriberForPrefsToken(store, req.params.token);
  if (!sub) return res.redirect('/preferences');
  const b = req.body || {};
  await newsletter.savePreferences(store, sub, {
    firstName: b.first_name,
    dailyBrief: b.daily_brief === 'on',
    topics: asArray(b.topics),
    regions: asArray(b.regions),
    digestFrequency: b.digest_frequency,
    breakingOptIn: b.breaking === 'on',
    paused: b.paused === 'on',
  });
  res.redirect('/preferences/' + encodeURIComponent(req.params.token) + '?saved=1');
});

app.post('/preferences/:token/change-email', async (req, res) => {
  const sub = await newsletter.subscriberForPrefsToken(store, req.params.token);
  if (!sub) return res.redirect('/preferences');
  const result = await newsletter.startEmailChange(
    store,
    mailer,
    sub,
    req.body && req.body.new_email
  );
  const err = result.ok ? 'email-sent' : result.error;
  res.redirect(
    '/preferences/' + encodeURIComponent(req.params.token) + '?error=' + encodeURIComponent(err)
  );
});

app.post('/preferences/:token/unsubscribe', async (req, res) => {
  const sub = await newsletter.subscriberForPrefsToken(store, req.params.token);
  if (!sub) return res.redirect('/preferences');
  await newsletter.unsubscribeSubscriber(store, sub);
  res.type('html').send(
    render.newsletterNoticePage({
      heading: 'You have been unsubscribed',
      text: 'All Ledger email to ' + sub.email + ' has stopped. If this was a mistake, you can subscribe again on the subscribe page.',
      linkHref: '/',
      linkText: 'Back to the front page',
    })
  );
});

app.get('/unsubscribe/:token', async (req, res) => {
  const sub = await newsletter.subscriberForUnsubToken(store, req.params.token);
  if (!sub) {
    return res.status(400).type('html').send(
      render.newsletterNoticePage({
        heading: 'That link did not work',
        text: 'The unsubscribe link could not be verified. You can manage everything from the preference center instead.',
        linkHref: '/preferences',
        linkText: 'Go to your preferences',
      })
    );
  }
  res.type('html').send(render.unsubscribeConfirmPage(req.params.token));
});

/** One-click unsubscribe (also the List-Unsubscribe-Post target). */
app.post('/unsubscribe/:token', async (req, res) => {
  const sub = await newsletter.subscriberForUnsubToken(store, req.params.token);
  if (!sub) {
    return res.status(400).type('html').send(
      render.newsletterNoticePage({
        heading: 'That link did not work',
        text: 'The unsubscribe link could not be verified. You can manage everything from the preference center instead.',
        linkHref: '/preferences',
        linkText: 'Go to your preferences',
      })
    );
  }
  await newsletter.unsubscribeSubscriber(store, sub);
  res.type('html').send(
    render.newsletterNoticePage({
      heading: 'You have been unsubscribed',
      text: 'All Ledger email to ' + sub.email + ' has stopped.',
      linkHref: '/',
      linkText: 'Back to the front page',
    })
  );
});

/* --------------------- Newsletter admin --------------------------- */

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

app.use('/admin/newsletter', (req, res, next) => {
  const secret = process.env.NEWSLETTER_ADMIN_SECRET;
  if (!secret) return res.status(404).send('Not found');
  const given = (req.query && req.query.key) || (req.body && req.body.key) || '';
  if (given !== secret) return res.status(403).send('Forbidden');
  next();
});

app.get('/admin/newsletter/export.csv', async (req, res) => {
  const subs = await store.nlListSubscribers();
  const header =
    'email,first_name,status,daily_brief,topics,regions,digest_frequency,breaking,paused,signup_date,source';
  const lines = subs.map((s) =>
    [
      s.email,
      s.firstName,
      s.status,
      s.dailyBrief ? 'yes' : 'no',
      (s.topics || []).join(';'),
      (s.regions || []).join(';'),
      s.digestFrequency,
      s.breakingOptIn ? 'yes' : 'no',
      s.paused ? 'yes' : 'no',
      s.signupDate,
      s.signupSource,
    ]
      .map(csvCell)
      .join(',')
  );
  res
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="ledger-subscribers.csv"')
    .send(header + '\n' + lines.join('\n') + '\n');
});

app.get('/admin/newsletter', async (req, res) => {
  const subs = await store.nlListSubscribers();
  const now = Date.now();
  const todayStr = newsletter.denverDateString(new Date());
  const confirmed = subs.filter((s) => s.status === 'confirmed');
  const stats = {
    total: subs.length,
    confirmed: confirmed.length,
    newToday: subs.filter(
      (s) => newsletter.denverDateString(new Date(s.signupDate)) === todayStr
    ).length,
    new7d: subs.filter((s) => now - Date.parse(s.signupDate) < 7 * 24 * 3600 * 1000).length,
    new30d: subs.filter((s) => now - Date.parse(s.signupDate) < 30 * 24 * 3600 * 1000).length,
    unsubscribed: subs.filter((s) => s.status === 'unsubscribed').length,
  };
  const growthMap = new Map();
  for (let i = 29; i >= 0; i--) {
    growthMap.set(
      newsletter.denverDateString(new Date(now - i * 24 * 3600 * 1000)),
      0
    );
  }
  for (const s of subs) {
    const d = newsletter.denverDateString(new Date(s.signupDate));
    if (growthMap.has(d)) growthMap.set(d, growthMap.get(d) + 1);
  }
  const topicCounts = SECTIONS.map((sec) => ({
    slug: sec.slug,
    name: sec.name,
    count: confirmed.filter((s) => (s.topics || []).includes(sec.slug)).length,
  }));
  const regionCounts = REGIONS.map((r) => ({
    slug: r.slug,
    name: r.name,
    count: confirmed.filter((s) => (s.regions || []).includes(r.slug)).length,
  }));
  const freqCounts = { off: 0, daily: 0, weekly: 0 };
  confirmed.forEach((s) => {
    freqCounts[s.digestFrequency] = (freqCounts[s.digestFrequency] || 0) + 1;
  });
  const campaigns = await store.nlListCampaigns(50);
  for (const c of campaigns) {
    c.recipients = await store.nlCountDeliveries(c.id);
  }
  let preview = null;
  const previewId = Number(req.query.preview || 0);
  const previewCampaign = previewId
    ? await store.nlGetCampaign(previewId)
    : campaigns.find((c) => c.type === 'brief' && c.status === 'draft') || null;
  if (previewCampaign) {
    const rendered = await newsletter.renderCampaignEmail(store, previewCampaign, null);
    preview = { campaign: previewCampaign, html: rendered.html };
  }
  const recent = await store.listArticles({ limit: 30 });
  res.type('html').send(
    render.adminNewsletterPage({
      key: process.env.NEWSLETTER_ADMIN_SECRET,
      msg: String(req.query.msg || ''),
      stats,
      growth: [...growthMap.entries()].map(([date, count]) => ({ date, count })),
      topicCounts,
      regionCounts,
      dailyBriefCount: confirmed.filter((s) => s.dailyBrief).length,
      freqCounts,
      breakingCount: confirmed.filter((s) => s.breakingOptIn).length,
      pausedCount: confirmed.filter((s) => s.paused).length,
      campaigns,
      preview,
      breakingCandidates: recent.map((a) => ({
        slug: a.slug,
        headline: a.headline,
        sectionName: sectionName(a.section),
      })),
      outbox: await store.nlListOutbox(50),
      provider: mailer.providerName(),
      sendTime: process.env.NEWSLETTER_SEND_TIME || '06:00',
      autosend: process.env.NEWSLETTER_AUTOSEND === '1',
      testEmail: process.env.NEWSLETTER_TEST_EMAIL || '',
    })
  );
});

app.post('/admin/newsletter/generate', async (req, res) => {
  const dateStr = newsletter.denverDateString(new Date());
  await newsletter.buildBriefDraft(store, dateStr);
  res.redirect(
    '/admin/newsletter?key=' + encodeURIComponent(process.env.NEWSLETTER_ADMIN_SECRET) +
      '&msg=' + encodeURIComponent('Daily Brief draft is ready for ' + dateStr + '.')
  );
});

app.post('/admin/newsletter/campaign/:id/send', async (req, res) => {
  const key = encodeURIComponent(process.env.NEWSLETTER_ADMIN_SECRET);
  const campaign = await store.nlGetCampaign(Number(req.params.id));
  if (!campaign) {
    return res.redirect('/admin/newsletter?key=' + key + '&msg=Campaign+not+found.');
  }
  let msg;
  if (campaign.type === 'brief') {
    const result = await newsletter.sendBriefCampaign(store, mailer, campaign);
    const after = await store.nlGetCampaign(campaign.id);
    // Digests follow the brief so the combined-email rule can
    // leave today's brief stories out of brief readers' digests.
    await newsletter.buildAndSendDigests(store, mailer, campaign.sendDate, after);
    msg = result.alreadySent
      ? 'That brief was already sent.'
      : 'Brief sent. Digests built and sent for ' + campaign.sendDate + '.';
  } else if (campaign.type === 'breaking') {
    const result = await newsletter.sendBreakingCampaign(store, mailer, campaign);
    msg = result.alreadySent ? 'That campaign was already sent.' : 'Breaking campaign sent.';
  } else {
    msg = 'Digests send from the brief flow, not on their own.';
  }
  res.redirect('/admin/newsletter?key=' + key + '&msg=' + encodeURIComponent(msg));
});

app.post('/admin/newsletter/campaign/:id/test', async (req, res) => {
  const key = encodeURIComponent(process.env.NEWSLETTER_ADMIN_SECRET);
  const campaign = await store.nlGetCampaign(Number(req.params.id));
  const testEmail = process.env.NEWSLETTER_TEST_EMAIL || '';
  if (!campaign || !testEmail) {
    return res.redirect(
      '/admin/newsletter?key=' + key + '&msg=' +
        encodeURIComponent(
          !campaign ? 'Campaign not found.' : 'Set NEWSLETTER_TEST_EMAIL to send test emails.'
        )
    );
  }
  const rendered = await newsletter.renderCampaignEmail(store, campaign, null);
  await mailer.send(store, {
    to: testEmail,
    subject: '[TEST] ' + campaign.subject,
    html: rendered.html,
    text: rendered.text,
    kind: 'test',
  });
  res.redirect(
    '/admin/newsletter?key=' + key + '&msg=' + encodeURIComponent('Test email sent to ' + testEmail + '.')
  );
});

app.post('/admin/newsletter/campaign/:id/sponsor', async (req, res) => {
  const key = encodeURIComponent(process.env.NEWSLETTER_ADMIN_SECRET);
  const campaign = await store.nlGetCampaign(Number(req.params.id));
  if (campaign && campaign.status === 'draft') {
    const b = req.body || {};
    await store.nlUpdateCampaign(campaign.id, {
      sponsorName: String(b.sponsor_name || '').slice(0, 120),
      sponsorMessage: String(b.sponsor_message || '').slice(0, 400),
      sponsorUrl: String(b.sponsor_url || '').slice(0, 400),
    });
  }
  res.redirect(
    '/admin/newsletter?key=' + key + '&preview=' + req.params.id + '&msg=' +
      encodeURIComponent('Sponsor block saved.')
  );
});

app.post('/admin/newsletter/breaking', async (req, res) => {
  const key = encodeURIComponent(process.env.NEWSLETTER_ADMIN_SECRET);
  const b = req.body || {};
  const articleIds = asArray(b.articles).map(String);
  const subject = String(b.subject || '').trim();
  if (!subject || !articleIds.length) {
    return res.redirect(
      '/admin/newsletter?key=' + key + '&msg=' +
        encodeURIComponent('A breaking campaign needs a subject and at least one story.')
    );
  }
  const campaign = await newsletter.createBreakingCampaign(store, {
    subject,
    articleIds,
  });
  res.redirect(
    '/admin/newsletter?key=' + key + '&preview=' + campaign.id + '&msg=' +
      encodeURIComponent('Breaking draft created. Preview it, then Approve & Send.')
  );
});

/* ------------------------------ SEO ------------------------------- */

app.get('/sitemap.xml', async (req, res) => {
  const articles = await store.listArticles({ limit: 5000 });
  const base = render.siteUrl();
  const urls = [
    { loc: base + '/', changefreq: 'hourly', priority: '1.0' },
    ...SECTIONS.filter((s) => s.slug !== 'opinion').map((s) => ({
      loc: base + '/section/' + s.slug,
      changefreq: 'hourly',
      priority: '0.8',
    })),
    ...REGIONS.map((r) => ({
      loc: base + '/local/' + r.slug,
      changefreq: 'hourly',
      priority: '0.7',
    })),
    { loc: base + '/explained', changefreq: 'weekly', priority: '0.8' },
    { loc: base + '/subscribe', changefreq: 'monthly', priority: '0.5' },
    { loc: base + '/about', changefreq: 'monthly', priority: '0.5' },
    { loc: base + '/privacy', changefreq: 'yearly', priority: '0.2' },
    { loc: base + '/terms', changefreq: 'yearly', priority: '0.2' },
    ...articles.map((a) => ({
      loc: base + '/article/' + a.slug,
      lastmod: a.publishedAt.slice(0, 10),
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          '  <url><loc>' + u.loc + '</loc>' +
          (u.lastmod ? '<lastmod>' + u.lastmod + '</lastmod>' : '') +
          '<changefreq>' + u.changefreq + '</changefreq><priority>' + u.priority + '</priority></url>'
      )
      .join('\n') +
    '\n</urlset>';
  res.type('application/xml').send(xml);
});

/** Escape text for safe inclusion in XML output. */
function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Google News sitemap: only articles published within the last 48 hours
 * (Google News sitemaps carry recent articles only). Each entry uses the
 * news extension: publication name/language, the article's real stored
 * publication date, and its headline. With nothing recent, this returns a
 * valid empty urlset with the news namespace declared.
 */
app.get('/news-sitemap.xml', async (req, res) => {
  const articles = await store.listArticles({ limit: 5000 });
  const base = render.siteUrl();
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recent = articles.filter((a) => {
    const t = new Date(a.publishedAt).getTime();
    return !isNaN(t) && t >= cutoff;
  });
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ' +
    'xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n' +
    recent
      .map(
        (a) =>
          '  <url><loc>' + xmlEscape(base + '/article/' + a.slug) + '</loc>' +
          '<news:news><news:publication>' +
          '<news:name>The Centennial Ledger</news:name>' +
          '<news:language>en</news:language>' +
          '</news:publication>' +
          '<news:publication_date>' + new Date(a.publishedAt).toISOString() + '</news:publication_date>' +
          '<news:title>' + xmlEscape(a.headline) + '</news:title>' +
          '</news:news></url>'
      )
      .join('\n') +
    (recent.length ? '\n' : '') +
    '</urlset>';
  res.type('application/xml').send(xml);
});

/* AdSense seller declaration: names Google as an authorized seller
   of this site's ad inventory under the owner's publisher ID. */
app.get('/ads.txt', (req, res) => {
  res
    .type('text/plain')
    .send('google.com, pub-6645873078235610, DIRECT, f08c47fec0942fa0\n');
});

app.get('/robots.txt', (req, res) => {
  // Owner policy (2026-11-08): the public site is open to readers,
  // search engines, AI search and AI agent crawlers. AI TRAINING
  // crawlers are disallowed by name. Multipurpose crawlers that
  // also power search or answer products (Meta-ExternalAgent,
  // Amazonbot and peers) are NOT listed: their discovery value
  // outweighs the training concern. Disallowing Google-Extended
  // and Applebot-Extended affects only AI training products, not
  // Google Search, AI Overviews, or Apple search results.
  res
    .type('text/plain')
    .send(
      '# The Centennial Ledger: the public site is open to readers, search\n' +
      '# engines, AI search and AI agent crawlers. AI training crawlers are\n' +
      '# not permitted.\n' +
      'User-agent: GPTBot\n' +
      'User-agent: ClaudeBot\n' +
      'User-agent: anthropic-ai\n' +
      'User-agent: CCBot\n' +
      'User-agent: Google-Extended\n' +
      'User-agent: Applebot-Extended\n' +
      'User-agent: cohere-ai\n' +
      'User-agent: Bytespider\n' +
      'Disallow: /\n\n' +
      'User-agent: *\n' +
      'Content-Signal: search=yes, ai-input=yes, ai-train=no\n' +
      'Allow: /\n' +
      'Disallow: /api/\n\n' +
      'Sitemap: ' + render.siteUrl() + '/sitemap.xml\n' +
      'Sitemap: ' + render.siteUrl() + '/news-sitemap.xml\n'
    );
});

function notFound() {
  return render.simplePage(
    'Page not found: Colorado news sections and site search',
    'Page not found',
    'That page is not on the site. Head back to the front page for the latest Colorado stories.',
    '/404',
    'That page is not on this Colorado news site. Head back to the front page, browse the sections or search for the story you wanted. Read the latest Colorado news.'
  );
}

app.use((req, res) => {
  res.status(404).type('html').send(notFound());
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).type('html').send(
    render.simplePage(
      'Something went wrong: Colorado news site error page',
      'Something went wrong',
      'The page could not be loaded. Please try again in a moment.',
      '/error',
      'The page could not be loaded on this Colorado news site. Please try again in a moment, or head to the front page for the latest stories. Read Colorado news today.'
    )
  );
});

/* --------------------- Newsletter scheduler ----------------------- */
/**
 * Once a minute, on weekdays at NEWSLETTER_SEND_TIME (America/Denver,
 * default 06:00), build today's Daily Brief draft if none exists.
 * With NEWSLETTER_AUTOSEND=1 and a live email provider the draft
 * sends at once and the day's digests follow it; otherwise the
 * draft waits for the admin Approve & Send button, which runs the
 * same digest step. Breaking campaigns are never automatic. The
 * tick is cheap: a date comparison, and buildBriefDraft is a no-op
 * once today's campaign exists.
 */
let newsletterSchedulerStarted = false;
function startNewsletterScheduler() {
  if (newsletterSchedulerStarted) return;
  newsletterSchedulerStarted = true;
  setInterval(async () => {
    try {
      const now = new Date();
      const parts = newsletter.denverParts(now);
      if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday)) return;
      const sendTime = process.env.NEWSLETTER_SEND_TIME || '06:00';
      if (parts.hour + ':' + parts.minute < sendTime) return;
      const dateStr = newsletter.denverDateString(now);
      if (await store.nlFindCampaign('brief', dateStr)) return;
      const { campaign } = await newsletter.buildBriefDraft(store, dateStr);
      console.log(
        '[newsletter] Daily Brief draft built for ' + dateStr +
          ' (campaign ' + campaign.id + ')'
      );
      if (process.env.NEWSLETTER_AUTOSEND === '1' && mailer.isLive()) {
        await newsletter.sendBriefCampaign(store, mailer, campaign);
        const after = await store.nlGetCampaign(campaign.id);
        await newsletter.buildAndSendDigests(store, mailer, dateStr, after);
        console.log('[newsletter] Daily Brief sent for ' + dateStr + '; digests followed.');
      }
    } catch (err) {
      console.error('[newsletter] scheduler error:', err && err.message);
    }
  }, 60 * 1000);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  startWeatherUpdates();
  startNewsletterScheduler();
  app.listen(PORT, () => {
    console.log('The Centennial Ledger listening on port ' + PORT);
  });
}

module.exports = app;
