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
 * Two narrow exceptions, both fill-only: backfillImageIfMissing() sets
 * an article's image when the stored article has none, and
 * backfillSourcesIfFewer() replaces the stored source list when the
 * incoming list is longer (the newsroom carries every source; the live
 * store once kept only the primary one). One further exception, only
 * when the ingest payload explicitly flags the article
 * (imageReplace: true, set by the newsroom after the owner orders a
 * plate replaced): replaceImage() swaps the stored image for the
 * incoming one. No other field is ever changed by any of these.
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
  // Opinion is a live section: the owner lifted the hold on 2026-11-01
  // and Opinion pieces are ingested under their own slug. Satire became
  // a live section on 2026-11-02: the owner is publishing one-frame
  // political cartoons with a short blurb there, ingested as
  // article-shaped items under their own slug.
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
  opinion: 'opinion',
  satire: 'satire',
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
/**
 * Owner-pulled stories (retractions): the append-only store never
 * deletes rows, so a pulled story is hidden at the read layer
 * instead — every read path treats these slugs as nonexistent (the
 * article page 404s and the story leaves the homepage, sections,
 * search and sitemaps). Reversible: remove a slug here and the
 * story returns exactly as stored. uploadtolive excludes the same
 * stories on the newsroom side so they are never re-sent.
 * - The El Paso County party vote story (newsroom ID 62): pulled by
 *   the owner on 2026-11-03 — its events are from 2021 but were
 *   written as current.
 */
const RETRACTED_SLUGS = new Set([
  'el-paso-county-party-vote-stands-state-republicans-scrap-do-over-despite-sham-warning-q4pxl',
]);

/**
 * Owner-ordered Satire display swap (2026-11-05): on the Satire page
 * the gasoline-spill comic sits in the middle and the bicycle comic
 * at the very bottom, reversing the two launch comics' publication
 * order. Both were published an hour apart on 2026-11-02; swapping
 * their stored publication times is the whole change — the section
 * listing and the Previous/Next navigation both sort by publication
 * time, and satire pages show no dates. One-time and idempotent:
 * each side applies only while the comic still carries its original
 * timestamp, so later boots change nothing. The newsroom store makes
 * the matching swap (fixsatireorder) so its records agree.
 */
const SATIRE_ORDER_SWAP = [
  {
    slug: 'polis-makes-first-visit-to-southern-ute-gasoline-spill-site',
    from: '2026-11-02T21:00:00.000Z',
    to: '2026-11-02T22:00:00.000Z',
  },
  {
    slug: 'colorados-bicycle-safety-stop-law-signed-by-polis-in-2022',
    from: '2026-11-02T22:00:00.000Z',
    to: '2026-11-02T21:00:00.000Z',
  },
];

/**
 * The full source list as the newsroom stores it: entries with a
 * title/name and an http(s) URL. Cleaned, de-duplicated by URL and
 * capped; anything else is dropped. Returns [] when the payload
 * carries no usable list.
 */
function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const url = String(s.url || s.href || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ name: String(s.title || s.name || s.domain || url).trim(), url });
    // The cap sits at 40 (raised from 12 on 2026-11-03): an Opinion
    // piece's full documentation list — the Engineered series'
    // finale carries 20 sources — must fit whole.
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Opinion pieces carry their sources in the stored sources list,
 * rendered as the regular Sources section — never as bracketed
 * number references in the text and never as a typed-out sources
 * section at the end of the body (owner instruction, 2026-11-03,
 * superseding the earlier bottom-of-piece citations format). This
 * strips the bracketed numeric markers from an Opinion article's
 * body text and drops a trailing typed Sources section. The
 * structured source entries themselves arrive through ingest's
 * sources list (and the sources fill for existing articles); this
 * only cleans the body. Mutates and returns the article, and
 * reports whether anything changed.
 */
function cleanOpinionBody(article) {
  if (!article || article.section !== 'opinion') return false;
  let changed = false;
  const strip = (s) => {
    const before = String(s || '');
    const after = before
      .replace(/\s*\[(?:\s*\d+(?:\s*[-–,]\s*\d+)*\s*)\]/g, '')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/ {2,}/g, ' ');
    if (after !== before) changed = true;
    return after;
  };
  if (article.dek) article.dek = strip(article.dek);
  const sections = Array.isArray(article.sections) ? article.sections : [];
  for (const s of sections) {
    if (s.lead) s.lead = strip(s.lead);
    if (Array.isArray(s.paragraphs)) s.paragraphs = s.paragraphs.map(strip);
  }
  const last = sections[sections.length - 1];
  if (last && /^sources\b/i.test(String(last.heading || '').trim())) {
    sections.pop();
    changed = true;
  }
  return changed;
}

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

  const out = {
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
    sources: (() => {
      const list = normalizeSources(raw.sources);
      if (list.length) return list;
      const name = String(raw.sourceName || raw.source_name || '').trim();
      const url = String(raw.sourceUrl || raw.source_url || '').trim();
      return url ? [{ name: name || url, url }] : [];
    })(),
    seoTitle: String(raw.seoTitle || raw.seo_title || '').trim(),
    metaDescription: String(raw.metaDescription || raw.meta_description || '').trim(),
  };
  cleanOpinionBody(out);
  return out;
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
    // One-time, idempotent cleanup of stored Opinion bodies
    // (owner instruction, 2026-11-03): strip the bracketed
    // citation markers and drop any typed-out Sources section.
    // After the first pass nothing matches, so later boots
    // change nothing.
    let opinionChanged = false;
    for (const a of this.data.articles) {
      if (cleanOpinionBody(a)) opinionChanged = true;
    }
    if (opinionChanged) this._save();
    // One-time, idempotent Satire order swap (see SATIRE_ORDER_SWAP).
    let satireSwapped = false;
    for (const swap of SATIRE_ORDER_SWAP) {
      const a = this.data.articles.find((x) => x.slug === swap.slug);
      if (a && new Date(a.publishedAt).getTime() === Date.parse(swap.from)) {
        a.publishedAt = swap.to;
        satireSwapped = true;
      }
    }
    if (satireSwapped) this._save();
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

  /**
   * Owner-ordered plate replacement (2026-11-04): the ingest handler
   * calls this ONLY when the payload article carries imageReplace:
   * true, which the newsroom sets after the owner orders a published
   * plate replaced (a defective illustration). Replaces ONLY the
   * image field; returns false when the article is missing, the
   * supplied image is invalid, or the stored image already is the
   * supplied one.
   */
  async replaceImage(slug, image) {
    const img = normalizeImage(image);
    if (!img) return false;
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing) return false;
    if (existing.image && existing.image.url === img.url) return false;
    existing.image = img;
    this._save();
    return true;
  }

  /**
   * Fill-only companion to the image backfill: when the incoming
   * source list is longer than the stored one, replace ONLY the
   * sources field. Returns true when the article was updated.
   */
  async backfillSourcesIfFewer(slug, sources) {
    const list = normalizeSources(sources);
    if (!list.length) return false;
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing) return false;
    const current = Array.isArray(existing.sources) ? existing.sources.length : 0;
    if (list.length <= current) return false;
    existing.sources = list;
    this._save();
    return true;
  }

  /**
   * Opinion-only companion to the sources fill (owner instruction,
   * 2026-11-03): Opinion source lists were restructured in the
   * newsroom — typed citations lifted into the stored list,
   * bracketed prefixes cleaned off the names, and an idea-only
   * entry removed — so for Opinion pieces the newsroom's list is
   * authoritative: replace the stored list whenever the incoming
   * one differs, even when it is shorter. News pieces keep the
   * longer-list-wins fill above. Returns true when updated.
   */
  async replaceSourcesIfDifferent(slug, sources) {
    const list = normalizeSources(sources);
    if (!list.length) return false;
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing) return false;
    const current = normalizeSources(existing.sources);
    const same =
      current.length === list.length &&
      current.every((s, i) => s.name === list[i].name && s.url === list[i].url);
    if (same) return false;
    existing.sources = list;
    this._save();
    return true;
  }

  async getArticle(slug) {
    if (RETRACTED_SLUGS.has(slug)) return null;
    return this.data.articles.find((a) => a.slug === slug) || null;
  }

  async listArticles({ section = null, region = null, spotlight = null, search = null, limit = 50 } = {}) {
    let rows = this.data.articles.filter((a) => !RETRACTED_SLUGS.has(a.slug));
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
    return this.data.articles.filter((a) => !RETRACTED_SLUGS.has(a.slug)).length;
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
        sources JSONB DEFAULT '[]'::jsonb,
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
    // Migration for databases created before the full source list
    // was carried through ingest (only the primary source was kept).
    await this.pool.query(
      "ALTER TABLE articles ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT '[]'::jsonb"
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(section)'
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)'
    );
    // Same one-time, idempotent Opinion body cleanup as the file
    // store's (owner instruction, 2026-11-03): strip bracketed
    // citation markers from stored Opinion bodies and drop any
    // typed-out Sources section at the end of the body.
    const opinionRows = await this.pool.query(
      "SELECT slug, dek, sections FROM articles WHERE section = 'opinion'"
    );
    for (const r of opinionRows.rows) {
      const probe = {
        section: 'opinion',
        dek: r.dek || '',
        sections:
          typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections || [],
      };
      if (cleanOpinionBody(probe)) {
        await this.pool.query(
          'UPDATE articles SET dek = $2, sections = $3 WHERE slug = $1',
          [r.slug, probe.dek, JSON.stringify(probe.sections)]
        );
      }
    }
    // One-time, idempotent Satire order swap (see SATIRE_ORDER_SWAP):
    // each UPDATE lands only while the comic still carries its
    // original publication time, so later boots change nothing.
    for (const swap of SATIRE_ORDER_SWAP) {
      await this.pool.query(
        'UPDATE articles SET published_at = $2 WHERE slug = $1 AND published_at = $3',
        [swap.slug, swap.to, swap.from]
      );
    }
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
      sources: normalizeSources(
        typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources
      ),
      seoTitle: r.seo_title || '',
      metaDescription: r.meta_description || '',
    };
  }

  async insertArticle(a) {
    const res = await this.pool.query(
      `INSERT INTO articles
         (slug, headline, dek, byline, published_at, modified_at, section, topic_label, region,
          spotlight, sections, why_it_matters, image, source_name, source_url, sources, seo_title, meta_description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug`,
      [
        a.slug, a.headline, a.dek, a.byline, a.publishedAt, a.modifiedAt || a.publishedAt,
        a.section, a.topicLabel,
        a.region, a.spotlight, JSON.stringify(a.sections), a.whyItMatters,
        a.image ? JSON.stringify(a.image) : null,
        a.sourceName, a.sourceUrl, JSON.stringify(a.sources || []), a.seoTitle, a.metaDescription,
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

  /**
   * Same owner-ordered replacement contract as the file store's: the
   * ingest handler calls this ONLY for a payload article flagged
   * imageReplace: true. Replaces ONLY the image field. The URL guard
   * in the WHERE clause makes the check-and-set atomic and a no-op
   * when the stored image already is the supplied one.
   */
  async replaceImage(slug, image) {
    const img = normalizeImage(image);
    if (!img) return false;
    const res = await this.pool.query(
      `UPDATE articles SET image = $2
        WHERE slug = $1
          AND COALESCE(image->>'url', '') <> $3
        RETURNING slug`,
      [slug, JSON.stringify(img), img.url]
    );
    return res.rowCount > 0;
  }

  /**
   * Same fill-only contract as the file store's: replace ONLY the
   * sources list when the incoming list is longer than the stored
   * one. The length guard in the WHERE clause makes the
   * check-and-set atomic, so a fuller stored list is never shrunk.
   */
  async backfillSourcesIfFewer(slug, sources) {
    const list = normalizeSources(sources);
    if (!list.length) return false;
    const res = await this.pool.query(
      `UPDATE articles SET sources = $2::jsonb
        WHERE slug = $1
          AND COALESCE(jsonb_array_length(sources), 0) < $3
        RETURNING slug`,
      [slug, JSON.stringify(list), list.length]
    );
    return res.rowCount > 0;
  }

  /**
   * Same Opinion-only contract as the file store's: replace the
   * stored sources list whenever the newsroom's list differs,
   * even when it is shorter. The read-compare-write is not
   * atomic, but ingest is a single trusted writer, so a race is
   * not a practical concern here.
   */
  async replaceSourcesIfDifferent(slug, sources) {
    const list = normalizeSources(sources);
    if (!list.length) return false;
    const cur = await this.pool.query('SELECT sources FROM articles WHERE slug = $1', [slug]);
    if (!cur.rows.length) return false;
    const current = normalizeSources(
      typeof cur.rows[0].sources === 'string'
        ? JSON.parse(cur.rows[0].sources)
        : cur.rows[0].sources
    );
    const same =
      current.length === list.length &&
      current.every((s, i) => s.name === list[i].name && s.url === list[i].url);
    if (same) return false;
    const res = await this.pool.query('UPDATE articles SET sources = $2::jsonb WHERE slug = $1', [
      slug,
      JSON.stringify(list),
    ]);
    return res.rowCount > 0;
  }

  async getArticle(slug) {
    if (RETRACTED_SLUGS.has(slug)) return null;
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
    if (RETRACTED_SLUGS.size) {
      params.push([...RETRACTED_SLUGS]);
      where.push(`slug <> ALL($${params.length})`);
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
    const res = RETRACTED_SLUGS.size
      ? await this.pool.query('SELECT COUNT(*)::int AS n FROM articles WHERE slug <> ALL($1)', [
          [...RETRACTED_SLUGS],
        ])
      : await this.pool.query('SELECT COUNT(*)::int AS n FROM articles');
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
