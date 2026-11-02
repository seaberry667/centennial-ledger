'use strict';
/**
 * Data store for The Centennial Ledger live site.
 *
 * Two backends behind one async interface:
 *  - Postgres, when DATABASE_URL is set (production on Render).
 *  - A local JSON file store (data/db.json), when it is not. This exists so
 *    the site runs in a plain workspace with zero setup for testing.
 *
 * Articles are append-only from the outside: insertArticle() reports
 * 'skipped' for a slug that already exists and never updates or deletes.
 * The single exception is backfillImageIfMissing(): an article's image
 * may be filled in once, after the fact, when the stored article has
 * none — no other field is ever changed by it.
 */

const fs = require('fs');
const path = require('path');

const SECTIONS = [
  { slug: 'politics', name: 'Politics' },
  { slug: 'rights', name: 'Rights' },
  { slug: 'taxes', name: 'Taxes' },
  { slug: 'energy', name: 'Energy' },
  { slug: 'schools', name: 'Schools' },
  { slug: 'local', name: 'Local' },
  // Opinion and Satire are placeholder nav sections for now: their pages
  // render (empty), but nothing is written or ingested into them yet —
  // SECTION_ALIASES intentionally has no route into either slug.
  { slug: 'opinion', name: 'Opinion' },
  { slug: 'satire', name: 'Satire' },
];

// Parts of the state, used by the Local dropdown nav and region pages.
const REGIONS = [
  { slug: 'denver-metro', name: 'Denver Metro' },
  { slug: 'northern-colorado', name: 'Northern Colorado' },
  { slug: 'southern-colorado', name: 'Southern Colorado' },
  { slug: 'western-slope', name: 'Western Slope' },
  { slug: 'southwest', name: 'Southwest' },
  { slug: 'mountains', name: 'Mountains' },
  { slug: 'eastern-plains', name: 'Eastern Plains' },
  { slug: 'san-luis-valley', name: 'San Luis Valley' },
];

// Legacy / newsroom topic names collapse into the live sections.
const SECTION_ALIASES = {
  politics: 'politics',
  capitol: 'politics',
  governor: 'politics',
  elections: 'politics',
  opinion: 'politics',
  rights: 'rights',
  'second amendment': 'rights',
  taxes: 'taxes',
  'taxes & tabor': 'taxes',
  'taxes-rights': 'taxes',
  'taxes & rights': 'taxes',
  tabor: 'taxes',
  energy: 'energy',
  schools: 'schools',
  education: 'schools',
  local: 'local',
  counties: 'local',
  'local & schools': 'local',
  'local-schools': 'local',
};

// Coverage the owner has dropped entirely: ingest skips these stories.
const DROPPED_SECTION_KEYS = new Set([
  'sports',
  'outdoors',
  'sports & outdoors',
  'sports-outdoors',
]);

/**
 * Resolve an incoming section value to a live section slug.
 * Returns null for dropped coverage (Sports & Outdoors), which ingest
 * counts as skipped and never inserts.
 */
function normalizeSection(input) {
  if (!input) return 'politics';
  const key = String(input).trim().toLowerCase();
  if (DROPPED_SECTION_KEYS.has(key)) return null;
  return SECTION_ALIASES[key] || 'politics';
}

function sectionName(slug) {
  const s = SECTIONS.find((x) => x.slug === slug);
  return s ? s.name : 'Politics';
}

/** Slug for a stored free-text region value, e.g. "Northern Colorado" -> "northern-colorado". */
function regionSlug(name) {
  return slugify(name);
}

function regionName(slug) {
  const r = REGIONS.find((x) => x.slug === slug);
  return r ? r.name : '';
}

const SPOTLIGHTS = ['gop_positive', 'dem_negative'];

function normalizeSpotlight(input) {
  return SPOTLIGHTS.includes(input) ? input : null;
}

/**
 * Optional article art. House style: black-and-white 19th-century American
 * newspaper engraving illustrations only (produced by the newsroom; the
 * live site just stores and renders what it is given). Shape:
 * { url, alt, caption } — url may be absolute or a site-relative path.
 */
function normalizeImage(input) {
  if (!input || typeof input !== 'object') return null;
  const url = String(input.url || '').trim();
  if (!url) return null;
  return {
    url,
    alt: String(input.alt || '').trim(),
    caption: String(input.caption || '').trim(),
  };
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Validate and normalize an incoming article from the ingest API / seed. */
function normalizeArticle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headline = String(raw.headline || '').trim();
  if (!headline) return null;
  const slug = slugify(raw.slug || headline);
  if (!slug) return null;

  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((s) => ({
          heading: String((s && s.heading) || '').trim(),
          lead: String((s && (s.lead || s.directAnswer)) || '').trim(),
          paragraphs: Array.isArray(s && s.paragraphs)
            ? s.paragraphs.map((p) => String(p)).filter(Boolean)
            : [],
        }))
        .filter((s) => s.heading || s.lead || s.paragraphs.length)
    : [];

  let publishedAt = raw.publishedAt || raw.published_at || null;
  const d = publishedAt ? new Date(publishedAt) : new Date();
  publishedAt = (isNaN(d.getTime()) ? new Date() : d).toISOString();

  let modifiedAt = raw.modifiedAt || raw.modified_at || null;
  const md = modifiedAt ? new Date(modifiedAt) : null;
  modifiedAt = md && !isNaN(md.getTime()) ? md.toISOString() : publishedAt;

  const section = normalizeSection(raw.section);
  // Dropped coverage (Sports & Outdoors): reject so ingest skips it.
  if (!section) return null;
  const spotlight = normalizeSpotlight(raw.spotlight);

  return {
    slug,
    headline,
    dek: String(raw.dek || '').trim(),
    byline: String(raw.byline || 'News Desk').trim(),
    publishedAt,
    modifiedAt,
    section,
    topicLabel: String(raw.topicLabel || raw.topic_label || '').trim(),
    region: String(raw.region || '').trim(),
    spotlight,
    sections,
    whyItMatters: String(raw.whyItMatters || raw.why_it_matters || '').trim(),
    image: normalizeImage(raw.image),
    sourceName: String(raw.sourceName || raw.source_name || '').trim(),
    sourceUrl: String(raw.sourceUrl || raw.source_url || '').trim(),
    seoTitle: String(raw.seoTitle || raw.seo_title || '').trim(),
    metaDescription: String(raw.metaDescription || raw.meta_description || '').trim(),
  };
}

/* ------------------------------------------------------------------ */
/* File store backend                                                  */
/* ------------------------------------------------------------------ */

class FileStore {
  constructor(file) {
    this.file = file;
    this.data = { articles: [], subscribers: [] };
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(this.data.articles)) this.data.articles = [];
        if (!Array.isArray(this.data.subscribers)) this.data.subscribers = [];
      } catch {
        this.data = { articles: [], subscribers: [] };
      }
    } else {
      this._save();
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async insertArticle(article) {
    if (this.data.articles.some((a) => a.slug === article.slug)) return 'skipped';
    this.data.articles.push(article);
    this._save();
    return 'inserted';
  }

  /**
   * The one narrow exception to append-only: if an article with this
   * slug exists and its stored image is null/empty, and the supplied
   * image is a valid normalized image, set ONLY the image field and
   * return true. Otherwise (no such article, image already present, or
   * supplied image invalid) change nothing and return false.
   */
  async backfillImageIfMissing(slug, image) {
    const img = normalizeImage(image);
    if (!img) return false;
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing) return false;
    if (existing.image && existing.image.url) return false;
    existing.image = img;
    this._save();
    return true;
  }

  async getArticle(slug) {
    return this.data.articles.find((a) => a.slug === slug) || null;
  }

  async listArticles({ section = null, region = null, spotlight = null, search = null, limit = 50 } = {}) {
    let rows = [...this.data.articles];
    if (section) rows = rows.filter((a) => a.section === section);
    if (region) rows = rows.filter((a) => slugify(a.region) === region);
    if (spotlight) rows = rows.filter((a) => a.spotlight === spotlight);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((a) =>
        [a.headline, a.dek, a.topicLabel, a.region]
          .concat(a.sections.flatMap((s) => [s.heading, s.lead, ...s.paragraphs]))
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    rows.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return rows.slice(0, limit);
  }

  async countArticles() {
    return this.data.articles.length;
  }

  async addSubscriber(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
    if (this.data.subscribers.some((s) => s.email === e)) return true;
    this.data.subscribers.push({ email: e, createdAt: new Date().toISOString() });
    this._save();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Postgres backend                                                    */
/* ------------------------------------------------------------------ */

class PgStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString,
      ssl: /render\.com|amazonaws\.com/.test(connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        headline TEXT NOT NULL,
        dek TEXT DEFAULT '',
        byline TEXT DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL,
        modified_at TIMESTAMPTZ,
        section TEXT NOT NULL,
        topic_label TEXT DEFAULT '',
        region TEXT DEFAULT '',
        spotlight TEXT,
        sections JSONB DEFAULT '[]'::jsonb,
        why_it_matters TEXT DEFAULT '',
        image JSONB,
        source_name TEXT DEFAULT '',
        source_url TEXT DEFAULT '',
        seo_title TEXT DEFAULT '',
        meta_description TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS briefing_subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )`);
    // Migration for databases created before article images existed.
    await this.pool.query(
      'ALTER TABLE articles ADD COLUMN IF NOT EXISTS image JSONB'
    );
    await this.pool.query(
      'ALTER TABLE articles ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ'
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(section)'
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)'
    );
  }

  _row(r) {
    if (!r) return null;
    return {
      slug: r.slug,
      headline: r.headline,
      dek: r.dek || '',
      byline: r.byline || '',
      publishedAt: new Date(r.published_at).toISOString(),
      modifiedAt: r.modified_at
        ? new Date(r.modified_at).toISOString()
        : new Date(r.published_at).toISOString(),
      section: r.section,
      topicLabel: r.topic_label || '',
      region: r.region || '',
      spotlight: r.spotlight || null,
      sections: typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections || [],
      whyItMatters: r.why_it_matters || '',
      image: normalizeImage(typeof r.image === 'string' ? JSON.parse(r.image) : r.image),
      sourceName: r.source_name || '',
      sourceUrl: r.source_url || '',
      seoTitle: r.seo_title || '',
      metaDescription: r.meta_description || '',
    };
  }

  async insertArticle(a) {
    const res = await this.pool.query(
      `INSERT INTO articles
         (slug, headline, dek, byline, published_at, modified_at, section, topic_label, region,
          spotlight, sections, why_it_matters, image, source_name, source_url, seo_title, meta_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug`,
      [
        a.slug, a.headline, a.dek, a.byline, a.publishedAt, a.modifiedAt || a.publishedAt,
        a.section, a.topicLabel,
        a.region, a.spotlight, JSON.stringify(a.sections), a.whyItMatters,
        a.image ? JSON.stringify(a.image) : null,
        a.sourceName, a.sourceUrl, a.seoTitle, a.metaDescription,
      ]
    );
    return res.rowCount > 0 ? 'inserted' : 'skipped';
  }

  /**
   * Same contract as the file store's: fill in ONLY the image of an
   * existing article whose stored image is null/empty (no 'url' or an
   * empty one), given a valid normalized image. Returns true when a row
   * was updated. The WHERE clause makes the check-and-set atomic, so a
   * stored image is never overwritten.
   */
  async backfillImageIfMissing(slug, image) {
    const img = normalizeImage(image);
    if (!img) return false;
    const res = await this.pool.query(
      `UPDATE articles SET image = $2
        WHERE slug = $1
          AND (image IS NULL OR image->>'url' IS NULL OR image->>'url' = '')
        RETURNING slug`,
      [slug, JSON.stringify(img)]
    );
    return res.rowCount > 0;
  }

  async getArticle(slug) {
    const res = await this.pool.query('SELECT * FROM articles WHERE slug = $1', [slug]);
    return this._row(res.rows[0]);
  }

  async listArticles({ section = null, region = null, spotlight = null, search = null, limit = 50 } = {}) {
    const where = [];
    const params = [];
    if (section) { params.push(section); where.push(`section = $${params.length}`); }
    if (region) {
      // Stored region is free text ("Northern Colorado"); compare slugified.
      params.push(region);
      where.push(`trim(both '-' from regexp_replace(lower(region), '[^a-z0-9]+', '-', 'g')) = $${params.length}`);
    }
    if (spotlight) { params.push(spotlight); where.push(`spotlight = $${params.length}`); }
    if (search) {
      params.push('%' + search + '%');
      where.push(`(headline ILIKE $${params.length} OR dek ILIKE $${params.length} OR topic_label ILIKE $${params.length})`);
    }
    params.push(limit);
    const sql =
      'SELECT * FROM articles' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ` ORDER BY published_at DESC LIMIT $${params.length}`;
    const res = await this.pool.query(sql, params);
    return res.rows.map((r) => this._row(r));
  }

  async countArticles() {
    const res = await this.pool.query('SELECT COUNT(*)::int AS n FROM articles');
    return res.rows[0].n;
  }

  async addSubscriber(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
    await this.pool.query(
      'INSERT INTO briefing_subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
      [e]
    );
    return true;
  }
}

/* ------------------------------------------------------------------ */

async function createStore() {
  const store = process.env.DATABASE_URL
    ? new PgStore(process.env.DATABASE_URL)
    : new FileStore(path.join(__dirname, '..', 'data', 'db.json'));
  await store.init();
  return store;
}

module.exports = {
  createStore,
  SECTIONS,
  REGIONS,
  normalizeSection,
  sectionName,
  regionSlug,
  regionName,
  normalizeArticle,
  normalizeImage,
  slugify,
};
