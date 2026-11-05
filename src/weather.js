'use strict';
/**
 * Live weather for the top bar (owner request, 2026-11-05).
 *
 * The bar's weather line used to be fixed text. It now comes from
 * Open-Meteo's free current-conditions feed for Centennial,
 * Colorado, refreshed every 15 minutes, and rendered in exactly the
 * shape the bar has always used: "CENTENNIAL, COLORADO  49° · Fair".
 *
 * Rendering never waits on the network: pages read the last good
 * reading from memory, and before the first successful fetch (or if
 * the feed is down) the bar falls back to the original fixed text.
 */

const LOCATION_LABEL = 'CENTENNIAL, COLORADO';
const FALLBACK_SEGMENT = LOCATION_LABEL + ' &nbsp; 54&deg; &middot; Fair';
const FEED_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=39.5807&longitude=-104.8772' +
  '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver';
const REFRESH_MS = 15 * 60 * 1000;

/* WMO weather codes -> the short condition words the bar uses. */
function conditionFor(code) {
  switch (code) {
    case 0:
    case 1:
      return 'Fair';
    case 2:
      return 'Partly cloudy';
    case 3:
      return 'Cloudy';
    case 45:
    case 48:
      return 'Fog';
    case 51:
    case 53:
    case 55:
      return 'Drizzle';
    case 56:
    case 57:
      return 'Freezing drizzle';
    case 61:
    case 63:
    case 65:
      return 'Rain';
    case 66:
    case 67:
      return 'Freezing rain';
    case 71:
    case 73:
    case 75:
    case 77:
      return 'Snow';
    case 80:
    case 81:
    case 82:
      return 'Showers';
    case 85:
    case 86:
      return 'Snow showers';
    case 95:
    case 96:
    case 99:
      return 'Thunderstorm';
    default:
      return 'Fair';
  }
}

let segment = FALLBACK_SEGMENT;
let timer = null;

async function refresh() {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(FEED_URL, { signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) return;
    const data = await res.json();
    const cur = data && data.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return;
    const temp = Math.round(cur.temperature_2m);
    segment =
      LOCATION_LABEL +
      ' &nbsp; ' +
      temp +
      '&deg; &middot; ' +
      conditionFor(cur.weather_code);
  } catch {
    /* Keep the last good reading; the bar never breaks on a feed error. */
  }
}

function topbarSegment() {
  return segment;
}

function startWeatherUpdates() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { topbarSegment, startWeatherUpdates };
