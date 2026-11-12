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
const FETCH_TIMEOUT_MS = 3000;
const EXCERPT_CHARS = 240;

/* The newest episode parsed from the feed:
 * { title, publishedAt, excerpt, image } — null until the first
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

/**
 * Plain text from a feed description: tags out first, entities
 * decoded, whitespace collapsed; then trimmed to about
 * EXCERPT_CHARS at a word boundary, with an ellipsis when cut.
 */
function excerptOf(html) {
  const text = decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.lastIndexOf(' ', EXCERPT_CHARS);
  return text.slice(0, cut > 0 ? cut : EXCERPT_CHARS).trim() + '…';
}

/**
 * Parse the Anchor RSS: the newest <item> (the feed lists newest
 * first) plus the channel's artwork (an episode's own image is the
 * fallback). Returns null on anything unusable, so a malformed
 * feed keeps the last good episode.
 */
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
  return {
    title,
    publishedAt: when.toISOString(),
    excerpt: excerptOf(tagText(item, 'description')),
    image: imageHref(channel) || imageHref(item),
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
