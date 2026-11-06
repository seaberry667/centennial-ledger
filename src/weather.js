'use strict';
/**
 * Live weather for the top bar (owner request, 2026-11-05;
 * expanded to a statewide rotation, 2026-11-06).
 *
 * The bar's weather line used to be fixed text for one city. It
 * now pulls Open-Meteo's free current-conditions feed for notable
 * cities all over Colorado in a single batch request, refreshed
 * every 15 minutes, and the bar rotates through the readings every
 * 10 seconds in the same shape it has always used:
 * "CENTENNIAL, COLORADO  49° · Fair". Centennial stays first in the
 * rotation (the owner's standing choice, 2026-11-05).
 *
 * Rendering never waits on the network: pages read the last good
 * readings from memory, and before the first successful fetch (or
 * if the feed is down) the bar falls back to the original fixed
 * Centennial text. A city whose reading is missing is skipped for
 * that cycle rather than breaking the rotation.
 */

/* Notable cities across every Colorado region. Order is the
 * rotation order: Centennial first, then a sweep of the state. */
const CITIES = [
  ['CENTENNIAL', 39.5807, -104.8772],
  ['DENVER', 39.7392, -104.9903],
  ['GOLDEN', 39.7555, -105.2211],
  ['BOULDER', 40.015, -105.2705],
  ['FORT COLLINS', 40.5853, -105.0844],
  ['GREELEY', 40.4233, -104.7091],
  ['ESTES PARK', 40.3772, -105.5217],
  ['STEAMBOAT SPRINGS', 40.485, -106.8317],
  ['CRAIG', 40.5153, -107.5464],
  ['GRAND JUNCTION', 39.0639, -108.5506],
  ['GLENWOOD SPRINGS', 39.5505, -107.3248],
  ['ASPEN', 39.1911, -106.8175],
  ['VAIL', 39.6403, -106.3742],
  ['BRECKENRIDGE', 39.4817, -106.0384],
  ['LEADVILLE', 39.2508, -106.2925],
  ['GUNNISON', 38.5458, -106.9253],
  ['SALIDA', 38.5347, -105.9989],
  ['MONTROSE', 38.4783, -107.8762],
  ['TELLURIDE', 37.9375, -107.8123],
  ['DURANGO', 37.2753, -107.8801],
  ['CORTEZ', 37.3486, -108.5859],
  ['PAGOSA SPRINGS', 37.2695, -107.0098],
  ['ALAMOSA', 37.4692, -105.87],
  ['COLORADO SPRINGS', 38.8339, -104.8214],
  ['PUEBLO', 38.2719, -104.6055],
  ['TRINIDAD', 37.1695, -104.5005],
  ['LAMAR', 38.0872, -102.7879],
  ['BURLINGTON', 39.3061, -102.2693],
  ['STERLING', 40.6255, -103.2077],
];

const FALLBACK_SEGMENT = 'CENTENNIAL, COLORADO &nbsp; 54&deg; &middot; Fair';
const FEED_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=' +
  CITIES.map((c) => c[1]).join(',') +
  '&longitude=' +
  CITIES.map((c) => c[2]).join(',') +
  '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver';
const REFRESH_MS = 15 * 60 * 1000;
const ROTATE_MS = 10000;

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

/* Last good readings, as plain display strings, in rotation order. */
let readings = [];

async function refresh() {
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(FEED_URL, { signal: ctl.signal });
    clearTimeout(to);
    if (!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    const next = [];
    for (let i = 0; i < CITIES.length; i++) {
      const cur = list[i] && list[i].current;
      if (!cur || typeof cur.temperature_2m !== 'number') continue;
      const temp = Math.round(cur.temperature_2m);
      next.push(
        CITIES[i][0] +
          ', COLORADO ' +
          temp +
          '° · ' +
          conditionFor(cur.weather_code)
      );
    }
    if (next.length) readings = next;
  } catch {
    /* Keep the last good readings; the bar never breaks on a feed error. */
  }
}

function htmlSegment(text) {
  return text
    .replace('°', '&deg;')
    .replace('·', '&middot;')
    .replace(/, COLORADO /, ', COLORADO &nbsp; ');
}

function topbarSegment() {
  if (!readings.length) return FALLBACK_SEGMENT;
  const json = JSON.stringify(readings).replace(/</g, '\\u003c');
  return (
    '<span id="wx-rotor">' +
    htmlSegment(readings[0]) +
    '</span>' +
    '<script>(function(){var r=' +
    json +
    ',i=0,e=document.getElementById("wx-rotor");if(!e||r.length<2)return;' +
    'setInterval(function(){i=(i+1)%r.length;e.textContent=r[i];},' +
    ROTATE_MS +
    ');})();</script>'
  );
}

let timer = null;

function startWeatherUpdates() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { topbarSegment, startWeatherUpdates };
