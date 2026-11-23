'use strict';

/**
 * src/scores.js — the homepage rail's Sports score strip (owner
 * order, 2026-11-23): extremely brief scores for Colorado's pro
 * teams and major college teams, plain text only — the box links
 * nowhere and expands into nothing.
 *
 * Data comes from ESPN's public scoreboard JSON. Results are
 * cached in memory for ten minutes; a stale cache is served while
 * a refresh runs in the background, and when no fetch has ever
 * succeeded the strip is simply absent — the homepage never
 * breaks or waits long on scores.
 */

const TZ = 'America/Denver';
const CACHE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const LEAGUES = {
  nfl: BASE + '/football/nfl/scoreboard',
  nba: BASE + '/basketball/nba/scoreboard',
  nhl: BASE + '/hockey/nhl/scoreboard',
  mlb: BASE + '/baseball/mlb/scoreboard',
  mls: BASE + '/soccer/usa.1/scoreboard',
  cfb: BASE + '/football/college-football/scoreboard?groups=80&limit=400',
  mbb: BASE + '/basketball/mens-college-basketball/scoreboard?groups=50&limit=400',
};
// The NFL and college-football default scoreboards already cover
// the whole week; the day-based leagues are fetched for a window
// of Denver days (three back, four ahead) so a team's most recent
// final and its next start both appear even across a few off days
// — a ±1-day window silently dropped the Avalanche entirely.
const WEEK_LEAGUES = ['nfl', 'cfb'];
const DATED_LEAGUES = ['nba', 'nhl', 'mlb', 'mls', 'mbb'];

// Display order: the five pro teams, then college football, then
// men's college basketball.
const TEAMS = [
  { league: 'nfl', abbr: 'DEN', label: 'Broncos' },
  { league: 'nba', abbr: 'DEN', label: 'Nuggets' },
  { league: 'nhl', abbr: 'COL', label: 'Avalanche' },
  { league: 'mlb', abbr: 'COL', label: 'Rockies' },
  { league: 'mls', abbr: 'COL', label: 'Rapids' },
  { league: 'cfb', abbr: 'COLO', label: 'Colorado' },
  { league: 'cfb', abbr: 'CSU', label: 'Colorado St.' },
  { league: 'cfb', abbr: 'AF', label: 'Air Force' },
  { league: 'mbb', abbr: 'COLO', label: 'Colorado' },
  { league: 'mbb', abbr: 'CSU', label: 'Colorado St.' },
  { league: 'mbb', abbr: 'AF', label: 'Air Force' },
  { league: 'mbb', abbr: 'DEN', label: 'Denver' },
  { league: 'mbb', abbr: 'UNCO', label: 'N. Colorado' },
];

const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
});
const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short',
});

function denverDayKey(d) {
  // 'MM/DD/YYYY' in Denver -> comparable 'YYYY-MM-DD' plus the
  // YYYYMMDD form ESPN's ?dates= parameter takes.
  const parts = {};
  for (const p of dayFmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    key: parts.year + '-' + parts.month + '-' + parts.day,
    espn: parts.year + parts.month + parts.day,
  };
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function oppName(competitor) {
  const t = (competitor && competitor.team) || {};
  return t.shortDisplayName || t.displayName || '';
}

/** One team's briefest line from its candidate events, or null. */
function pickLine(team, events, now) {
  const mine = [];
  for (const e of events) {
    const comp = e && e.competitions && e.competitions[0];
    if (!comp || !Array.isArray(comp.competitors)) continue;
    const me = comp.competitors.find(
      (c) => c.team && c.team.abbreviation === team.abbr
    );
    if (!me) continue;
    const opp = comp.competitors.find((c) => c !== me);
    const state = e.status && e.status.type && e.status.type.state;
    const when = Date.parse(e.date || '');
    if (!opp || !state || Number.isNaN(when)) continue;
    mine.push({ me, opp, state, when, detail: (e.status.type.shortDetail || '').trim() });
  }
  if (!mine.length) return null;

  const live = mine.find((g) => g.state === 'in');
  if (live) {
    const detail = live.detail && live.detail.length <= 18 ? live.detail : 'Live';
    return team.label + ' ' + live.me.score + ', ' + oppName(live.opp) + ' ' +
      live.opp.score + ' · ' + detail;
  }
  const finals = mine
    .filter((g) => g.state === 'post' && now - g.when <= 4 * DAY_MS && g.when <= now)
    .sort((a, b) => b.when - a.when);
  const upcoming = mine
    .filter((g) => g.state === 'pre' && g.when >= now - 60 * 1000 && g.when - now <= 7 * DAY_MS)
    .sort((a, b) => a.when - b.when);
  // A fresh final (last 36 hours) leads; otherwise a game in the
  // next three days outranks an older final.
  const freshFinal = finals.length && now - finals[0].when <= 36 * 60 * 60 * 1000;
  if (!freshFinal && upcoming.length && upcoming[0].when - now <= 3 * DAY_MS) {
    return formatUpcoming(team, upcoming[0], now);
  }
  if (finals.length) {
    const g = finals[0];
    const detail = /^Final/.test(g.detail) ? g.detail : 'Final';
    return team.label + ' ' + g.me.score + ', ' + oppName(g.opp) + ' ' +
      g.opp.score + ' · ' + detail;
  }
  if (upcoming.length) return formatUpcoming(team, upcoming[0], now);
  return null;
}

function formatUpcoming(team, g, now) {
  const d = new Date(g.when);
  const dayKey = denverDayKey(d).key;
  const todayKey = denverDayKey(new Date(now)).key;
  const tomorrowKey = denverDayKey(new Date(now + DAY_MS)).key;
  const dayLabel = dayKey === todayKey
    ? 'Today'
    : dayKey === tomorrowKey
      ? 'Tomorrow'
      : weekdayFmt.format(d);
  const venue = g.me.homeAway === 'home' ? 'vs' : 'at';
  return team.label + ' ' + venue + ' ' + oppName(g.opp) + ' · ' +
    dayLabel + ' ' + timeFmt.format(d);
}

async function refresh() {
  const now = Date.now();
  const urls = [];
  for (const lg of WEEK_LEAGUES) urls.push([lg, LEAGUES[lg]]);
  for (const lg of DATED_LEAGUES) {
    for (const off of [-3, -2, -1, 0, 1, 2, 3, 4]) {
      const sep = LEAGUES[lg].includes('?') ? '&' : '?';
      urls.push([lg, LEAGUES[lg] + sep + 'dates=' + denverDayKey(new Date(now + off * DAY_MS)).espn]);
    }
  }
  const byLeague = {};
  await Promise.allSettled(
    urls.map(async ([lg, url]) => {
      const data = await fetchJson(url);
      if (data && Array.isArray(data.events)) {
        (byLeague[lg] = byLeague[lg] || []).push(...data.events);
      }
    })
  );
  const lines = [];
  for (const team of TEAMS) {
    const line = pickLine(team, byLeague[team.league] || [], now);
    if (line) lines.push(line);
  }
  return lines;
}

let cache = { lines: null, at: 0 };
let fetching = null;

function refreshInBackground() {
  if (fetching) return fetching;
  fetching = refresh()
    .then((lines) => {
      if (Array.isArray(lines)) cache = { lines, at: Date.now() };
      return cache.lines;
    })
    .catch(() => cache.lines)
    .finally(() => { fetching = null; });
  return fetching;
}

/**
 * The current score lines (array of plain-text strings, possibly
 * empty). Serves the cache when fresh; serves a stale cache while
 * refreshing behind the scenes; only the very first call waits
 * for the network.
 */
async function getSportsLines() {
  if (cache.lines && Date.now() - cache.at < CACHE_MS) return cache.lines;
  if (cache.lines) {
    refreshInBackground();
    return cache.lines;
  }
  const lines = await refreshInBackground();
  return lines || [];
}

module.exports = { getSportsLines };
