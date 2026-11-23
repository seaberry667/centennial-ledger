'use strict';
/**
 * Latest episode of the Colorado Daily News Brief podcast, for the
 * homepage rail's podcast box (owner request, 2026-11-12).
 *
 * The show is hosted on Spotify; its Anchor RSS feed carries the
 * newest episode's title, date, notes and the show artwork. The
 * box shows those with a Listen on Spotify link. Built on the
 * weather module's pattern: an in-memory cache refreshed in the
 * background every 15 minutes with a short fetch timeout, and
 * rendering NEVER waits on or fails because of the network —
 * before the first successful fetch (or while the feed is down)
 * latestEpisode() returns null and the box renders its standing
 * fallback copy instead. A failed or malformed fetch keeps the
 * last good episode. The XML is read with a small hand-rolled
 * extractor; no new dependencies.
 */

const FEED_URL = 'https://anchor.fm/s/11a0ed790/podcast/rss';
const REFRESH_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;

/* The newest episode parsed from the feed:
 * { title, publishedAt, titles, image } — null until the first
 * successful fetch. */
let latest = null;
let lastFetchAt = 0;
let fetching = false;

/** Unwrap a CDATA section, or return the text as-is. */
function cdata(text) {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text || '');
  return m ? m[1] : (text || '');
}

/** Inner text of the first <tag> in xml (attributes tolerated). */
function tagText(xml, tag) {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>');
  const m = re.exec(xml);
  return m ? cdata(m[1]).trim() : '';
}

/** href of the first <itunes:image ...> in xml, or ''. */
function imageHref(xml) {
  const m = /<itunes:image[^>]*\bhref="([^"]+)"/.exec(xml);
  return m ? m[1] : '';
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)
      ? NAMED_ENTITIES[body]
      : whole;
  });
}

/** One description paragraph as plain text, with <br> line
 * breaks preserved as newlines. */
function paraText(p) {
  return decodeEntities(
    String(p || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  );
}

/** A rundown line that is NOT one of the episode's story
 * subjects: weather, sports, the combined Around Colorado line
 * (its items are not story titles and have no matching story
 * anchor), the full-stories pointer and the production credits. */
function isNonSubject(line) {
  return (
    /^(Weather|Sports|Around Colorado):/i.test(line) ||
    /^Full stories\b/i.test(line) ||
    /produced by The Centennial Ledger/i.test(line) ||
    /^The voices you hear/i.test(line)
  );
}

/** Split a prose paragraph into its sentences, dropping the
 * dateline lead-in and the weather-and-sports roundup. */
function sentencesOf(text) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^Colorado news for [^:]+:\s*/i, '');
  /* Protect abbreviation periods so the sentence split survives
   * "U.S. Senate" and the like. */
  const DOT = '\u0001';
  const protectedText = clean.replace(/\b(?:U\.S\.|D\.C\.|U\.K\.|a\.m\.|p\.m\.)/g, (m) =>
    m.replace(/\./g, DOT)
  );
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.replaceAll(DOT, '.').trim().replace(/[.]$/, ''))
    .filter(
      (s) =>
        s.length > 0 &&
        !/^Plus\b/i.test(s) &&
        !/^(Statewide weather|Colorado sports|In sports|In weather)\b/i.test(s) &&
        !/produced by The Centennial Ledger/i.test(s) &&
        !/^The voices you hear/i.test(s)
    );
}

/**
 * The episode's major story titles for the homepage box (owner
 * request, 2026-11-12: list them all, in full, never truncated;
 * weather and sports excluded).
 *
 * Two description formats exist. The ORIGINAL format carries the
 * rundown as sentences inside the first paragraph: "Colorado
 * news for <date>: <story>. <story>. Plus statewide weather and
 * Colorado sports: ...". The SEO format (episodes from
 * 2026-11-23) opens with a dateline-only paragraph ("Colorado
 * news for Monday, November 23, 2026."), then a prose summary,
 * then a rundown paragraph with one subject per line (the story
 * lines match the companion page's stories, in order, so the
 * box's #story-N anchors line up), then the weather and sports
 * lines. The parser tries, in order: a multi-line rundown
 * paragraph; headline-style one-line paragraphs; the summary
 * paragraph's sentences when the first paragraph is dateline
 * only; and finally the original first-paragraph sentences.
 * Returns [] when nothing usable parses.
 */
function titlesOf(html) {
  const raw = String(html || '');
  const paras = (raw.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [raw]).map(paraText);
  const tidy = (s) => s.replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
  /* 1. A paragraph of rundown lines (separated by <br> or
   * newlines in the feed markup). */
  for (const para of paras) {
    const lines = para.split('\n').map(tidy).filter(Boolean);
    if (lines.length < 3) continue;
    const subjects = lines.filter((s) => !isNonSubject(s));
    if (subjects.length >= 3) return subjects;
  }
  /* 2. The rundown lines as separate one-line paragraphs
   * (headline style: no terminal punctuation). */
  const headlineParas = paras
    .map((p) => tidy(p.replace(/\n/g, ' ')))
    .filter(
      (s) =>
        s.length > 0 &&
        s.length <= 140 &&
        !/[.!?]$/.test(s) &&
        !/^Colorado (news|history) for\b/i.test(s) &&
        !isNonSubject(s)
    );
  if (headlineParas.length >= 3) return headlineParas;
  const texts = paras.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  /* 3. Dateline-only first paragraph (SEO format): the subjects
   * are the summary paragraph's sentences. */
  if (texts.length > 1 && /^Colorado news for [^.]+\.$/i.test(texts[0])) {
    const fromSummary = sentencesOf(texts[1]);
    if (fromSummary.length) return fromSummary;
  }
  /* 4. Original format: rundown sentences in the first
   * paragraph. */
  return sentencesOf(texts[0] || '');
}

/**
 * Parse the Anchor RSS: the newest <item> (the feed lists newest
 * first) plus the channel's artwork (an episode's own image is the
 * fallback). Returns null on anything unusable, so a malformed
 * feed keeps the last good episode.
 */
/**
 * The Saturday history edition's description opens with a
 * dateline paragraph ("Colorado history for Saturday, ...")
 * followed by a full summary paragraph of what's in the episode.
 * For those episodes the box shows that summary as a blurb
 * instead of a story-title list (owner request, 2026-11-21).
 * Returns '' for anything that is not a history-edition
 * description, so weekday episodes are untouched.
 */
function blurbOf(html) {
  const paras = String(html || '').match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
  if (!paras.length) return '';
  const text = (p) =>
    decodeEntities(p.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!/^Colorado history for\b/i.test(text(paras[0]))) return '';
  const summary = paras.length > 1 ? text(paras[1]) : '';
  if (!summary || /^Next\b/i.test(summary) || /^Disclosure\b/i.test(summary)) return '';
  return summary;
}

function parseFeed(xml) {
  if (!xml || typeof xml !== 'string') return null;
  const itemAt = xml.indexOf('<item');
  const channel = itemAt >= 0 ? xml.slice(0, itemAt) : xml;
  const item =
    itemAt >= 0 ? xml.slice(itemAt, xml.indexOf('</item>', itemAt)) : '';
  const title = tagText(item, 'title');
  const pubDate = tagText(item, 'pubDate');
  const when = pubDate ? new Date(pubDate) : null;
  if (!title || !when || Number.isNaN(when.getTime())) return null;
  const description = tagText(item, 'description');
  const blurb = blurbOf(description);
  const titles = blurb ? [] : titlesOf(description);
  if (!titles.length && !blurb) return null;
  return {
    title,
    publishedAt: when.toISOString(),
    titles,
    blurb,
    /* Saturday history episodes (blurb present) always show the
     * dedicated History cover, served from the site itself (owner
     * directive, 2026-11-21) so the box never depends on the feed
     * carrying per-episode artwork; weekday episodes keep the
     * feed's show artwork. */
    image: blurb
      ? '/images/history-cover.jpg'
      : imageHref(channel) || imageHref(item),
  };
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  lastFetchAt = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(FEED_URL, { signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) return;
    const parsed = parseFeed(await res.text());
    if (parsed) latest = parsed;
  } catch {
    /* Keep the last good episode; the box never breaks on a feed error. */
  } finally {
    fetching = false;
  }
}

/**
 * The newest episode for the podcast box, or null (the box then
 * renders its fallback copy). Never awaits the network: an empty
 * or stale cache only starts a background refresh.
 */
function latestEpisode() {
  if (Date.now() - lastFetchAt > REFRESH_MS) refresh();
  return latest;
}

let timer = null;

function startPodcastUpdates() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { latestEpisode, startPodcastUpdates, parseFeed, FEED_URL };
