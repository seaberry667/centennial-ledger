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
const { createStore, SECTIONS, REGIONS, normalizeArticle } = require('./store');
const render = require('./render');

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
 * updated. One narrow exception: when the stored article has no image
 * and the incoming one carries a valid image, the image alone is filled
 * in and the item is counted as "imaged" instead of skipped.
 * Returns { received, inserted, skipped, imaged }, where skipped counts
 * items that were neither inserted nor imaged.
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
    // be filled in once if the article live has none.
    if (article.image && (await store.backfillImageIfMissing(article.slug, article.image))) {
      imaged += 1;
    } else {
      skipped += 1;
    }
  }
  res.json({ received: items.length, inserted, skipped, imaged });
});

/* --------------------------- Public pages ------------------------- */

app.get('/', async (req, res) => {
  // Fetch 32: the lead, second and third features, and the pool the
  // rail rows and Latest cards draw from. (The per-section rail picks
  // and the Local & Statewide list are fetched separately, below.)
  // Satire pieces are never featured or listed among the homepage
  // articles (owner instruction, 2026-11-02): they live on their
  // own section page and are reached from there, so they are
  // filtered out of the homepage pool before anything is picked.
  const articles = (await store.listArticles({ limit: 32 })).filter(
    (a) => a.section !== 'satire'
  );
  // The three featured spots (lead, second and third feature) are
  // news only: Opinion pieces never take them (owner instruction,
  // 2026-11-02). Opinion reaches the homepage through the Editorial
  // Desk strip below, and Satire is already filtered out of the pool
  // above. The lead is the newest news story; the second feature is
  // the most recent news story from a different section than the
  // lead's, and the third is the most recent from a section
  // different from both (owner instruction, 2026-11-02: three
  // features), each shown directly under the last in the same
  // format. All are pulled out of the shared pool so no story
  // appears twice on the front page. A feature is null when no
  // different-section story exists for its spot (the homepage then
  // renders the features it has, exactly as before).
  const newsPool = articles.filter((a) => a.section !== 'opinion');
  const lead = newsPool[0] || null;
  let second = null;
  let third = null;
  if (lead) {
    second = newsPool.find((a) => a.section !== lead.section) || null;
    if (second) {
      third =
        newsPool.find(
          (a) => a.section !== lead.section && a.section !== second.section
        ) || null;
    }
  }
  const featuredSlugs = new Set(
    [lead, second, third].filter(Boolean).map((a) => a.slug)
  );
  const rest = articles.filter((a) => !featuredSlugs.has(a.slug));
  // Rail groups (owner instruction, 2026-11-02): the right column
  // groups the five news sections — Politics, Rights, Taxes, Energy
  // and Schools, in that order — with the TWO most recent stories
  // from each section under that section's heading, excluding the
  // features. A section whose newest stories are features
  // contributes its next stories instead; a section with nothing
  // left has no group.
  const featureSlugs = new Set([lead, second, third].filter(Boolean).map((a) => a.slug));
  const railGroups = [];
  for (const slug of ['politics', 'rights', 'taxes', 'energy', 'schools']) {
    const inSection = await store.listArticles({ section: slug, limit: 6 });
    const picks = inSection.filter((a) => !featureSlugs.has(a.slug)).slice(0, 2);
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
  const latestRow = rest.filter((a) => !usedSlugs.has(a.slug)).slice(0, 3);
  // Local & Statewide (design addendum): the eight most recently
  // published Local stories across all eight regions, newest first.
  const localStories = await store.listArticles({ section: 'local', limit: 8 });
  // The newest Opinion piece feeds the "From Our Editorial Desk"
  // strip; null while the store holds none, and the strip is then
  // absent from the page.
  const opinion =
    (await store.listArticles({ section: 'opinion', limit: 1 }))[0] || null;
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
      briefingThanks: req.query.briefing === 'thanks',
    })
  );
});

app.get('/section/:slug', async (req, res) => {
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
  const articles = await store.listArticles({ section: 'local', region: region.slug, limit: 60 });
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
app.get('/img/:slug', async (req, res) => {
  // Accept an optional .png/.jpg suffix: a conventional image
  // filename is the safest shape for scrapers, and the suffix also
  // gives format changes a fresh URL for their caches.
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
  if (article.section === 'satire') {
    const comics = await store.listArticles({ section: 'satire', limit: 60 });
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
  res.type('html').send(render.articlePage(article, related.slice(0, 3), localStories));
});

app.get('/subscribe', (req, res) => {
  res.type('html').send(render.subscribePage());
});

app.get('/subscribe/checkout', (req, res) => {
  res.type('html').send(render.checkoutPage(String(req.query.tier || 'patriot')));
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

app.post('/briefing', async (req, res) => {
  const ok = await store.addSubscriber(req.body && req.body.email);
  res.redirect(ok ? '/?briefing=thanks' : '/?briefing=invalid');
});

/* ------------------------------ SEO ------------------------------- */

app.get('/sitemap.xml', async (req, res) => {
  const articles = await store.listArticles({ limit: 5000 });
  const base = render.siteUrl();
  const urls = [
    { loc: base + '/', changefreq: 'hourly', priority: '1.0' },
    ...SECTIONS.map((s) => ({
      loc: base + '/section/' + s.slug,
      changefreq: 'hourly',
      priority: '0.8',
    })),
    ...REGIONS.map((r) => ({
      loc: base + '/local/' + r.slug,
      changefreq: 'hourly',
      priority: '0.7',
    })),
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
    .send('google.com, pub-5686724565796685, DIRECT, f08c47fec0942fa0\n');
});

app.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .send(
      'User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ' + render.siteUrl() + '/sitemap.xml\n' +
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

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('The Centennial Ledger listening on port ' + PORT);
  });
}

module.exports = app;
