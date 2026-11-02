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
  // Fetch 24: the lead, a second feature, and the pool the Latest
  // row and Trending draw from.
  const articles = await store.listArticles({ limit: 24 });
  const [lead, ...rest] = articles;
  // Second feature: the most recent story from a different section
  // than the lead's, shown directly under the lead in the same
  // format. It is pulled out of the grid pool so it never appears
  // twice on the front page. Null when every other story shares the
  // lead's section (the homepage then renders the single lead,
  // exactly as before).
  let second = null;
  if (lead) {
    const idx = rest.findIndex((a) => a.section !== lead.section);
    if (idx >= 0) second = rest.splice(idx, 1)[0];
  }
  // Rail rows: the latest story from each of the five news
  // sections, in section order. A section whose latest story is one
  // of the two features contributes its next story instead, so no
  // story appears twice on the front page; a section with no other
  // story simply has no row.
  const featureSlugs = new Set(
    [lead, second].filter(Boolean).map((a) => a.slug)
  );
  const railTop = [];
  for (const slug of ['politics', 'rights', 'taxes', 'energy', 'schools']) {
    const inSection = await store.listArticles({ section: slug, limit: 3 });
    const pick = inSection.find((a) => !featureSlugs.has(a.slug));
    if (pick) railTop.push(pick);
  }
  // The newest Opinion piece feeds the "From Our Editorial Desk"
  // strip; null while the store holds none, and the strip is then
  // absent from the page.
  const opinion =
    (await store.listArticles({ section: 'opinion', limit: 1 }))[0] || null;
  res.type('html').send(
    render.homePage({
      lead: lead || null,
      second,
      latest: rest.slice(0, 12),
      railTop,
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

app.get('/article/:slug', async (req, res) => {
  const article = await store.getArticle(req.params.slug);
  if (!article) return res.status(404).type('html').send(notFound());
  const related = (await store.listArticles({ section: article.section, limit: 4 })).filter(
    (a) => a.slug !== article.slug
  );
  // Trending in Colorado: the most recent stories site-wide (the site
  // has no view tracking), spotlight-flagged stories first within that
  // recency order, the story being read excluded, up to five.
  const recent = (await store.listArticles({ limit: 10 })).filter(
    (a) => a.slug !== article.slug
  );
  const trending = recent
    .filter((a) => a.spotlight)
    .concat(recent.filter((a) => !a.spotlight))
    .slice(0, 5);
  res.type('html').send(render.articlePage(article, related.slice(0, 3), trending));
});

app.get('/subscribe', (req, res) => {
  res.type('html').send(render.subscribePage());
});

app.get('/subscribe/checkout', (req, res) => {
  res.type('html').send(render.checkoutPage(String(req.query.tier || 'patriot')));
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
