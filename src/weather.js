'use strict';
/**
 * Live weather for the top bar (owner request, 2026-11-05;
 * expanded to a statewide rotation, 2026-11-06).
 *
 * The bar's weather line used to be fixed text for one city. It
 * now pulls current conditions for notable cities all over
 * Colorado in a single batch request, refreshed every 15 minutes,
 * and the bar rotates through the readings every 6 seconds in the
 * same shape it has always used: "DENVER 45° · Fair" (the state
 * name was dropped from the segment on 2026-11-21 at the owner's
 * order). Denver leads the rotation and the remaining cities are
 * jumbled at random on every page load (owner, 2026-11-06), so
 * the bar does not sweep region by region.
 *
 * Sources, in order (failover added 2026-11-23 after the live
 * server sat on the fallback text while Open-Meteo requests from
 * the host's network never landed):
 *   1. Open-Meteo's free current-conditions feed (one batch call).
 *   2. The National Weather Service (api.weather.gov): each city's
 *      nearest observation station's latest reading. Station IDs
 *      are resolved once and cached; observations are actual
 *      station measurements, typically updated hourly.
 *
 * Rendering never waits on the network: pages read the last good
 * readings from memory, and before the first successful fetch (or
 * if both feeds are down) the bar falls back to the original fixed
 * Centennial text. A city whose reading is missing is skipped for
 * that cycle rather than breaking the rotation.
 */

/* Notable cities across every Colorado region. Denver is first
 * (it always opens the rotation); the rest are jumbled client-side
 * on each page load, so their listed order here does not matter. */
const CITIES = [
  ['DENVER', 39.7392, -104.9903],
  ['CENTENNIAL', 39.5807, -104.8772],
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

const FALLBACK_SEGMENT = 'DENVER 54&deg; &middot; Fair';
const FEED_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=' +
  CITIES.map((c) => c[1]).join(',') +
  '&longitude=' +
  CITIES.map((c) => c[2]).join(',') +
  '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FDenver';
const REFRESH_MS = 15 * 60 * 1000;
const ROTATE_MS = 6000;

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

/* NWS text descriptions ("Partly Cloudy", "Snow Showers", ...) ->
 * the same short condition words the bar uses. */
function conditionFromText(desc) {
  const d = String(desc || '').toLowerCase();
  if (!d) return 'Fair';
  if (d.includes('thunder')) return 'Thunderstorm';
  if (d.includes('snow')) return d.includes('shower') ? 'Snow showers' : 'Snow';
  if (d.includes('freezing rain')) return 'Freezing rain';
  if (d.includes('freezing drizzle')) return 'Freezing drizzle';
  if (d.includes('drizzle')) return 'Drizzle';
  if (d.includes('fog')) return 'Fog';
  if (d.includes('shower')) return 'Showers';
  if (d.includes('rain')) return 'Rain';
  if (d.includes('partly')) return 'Partly cloudy';
  if (d.includes('cloudy') || d.includes('overcast')) return 'Cloudy';
  return 'Fair';
}

async function fetchJson(url, headers, ms) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms || 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

/* Last good readings, as plain display strings, in rotation order. */
let readings = [];

async function refreshFromOpenMeteo() {
  const data = await fetchJson(FEED_URL, undefined, 8000);
  if (data && data.error) {
    throw new Error('Open-Meteo error: ' + (data.reason || 'unknown'));
  }
  const list = Array.isArray(data) ? data : [data];
  const next = [];
  for (let i = 0; i < CITIES.length; i++) {
    const cur = list[i] && list[i].current;
    if (!cur || typeof cur.temperature_2m !== 'number') continue;
    const temp = Math.round(cur.temperature_2m);
    next.push(
      CITIES[i][0] +
        ' ' +
        temp +
        '° · ' +
        conditionFor(cur.weather_code)
    );
  }
  if (!next.length) throw new Error('Open-Meteo returned no usable readings');
  return next;
}

/* NWS asks API users to identify themselves in the User-Agent. */
const NWS_HEADERS = {
  'User-Agent': 'CentennialLedger/1.0 (centennialledger@gmail.com)',
  Accept: 'application/geo+json',
};
const stationCache = new Map();

async function nwsReading(city) {
  const name = city[0];
  let station = stationCache.get(name);
  if (!station) {
    const points = await fetchJson(
      'https://api.weather.gov/points/' + city[1] + ',' + city[2],
      NWS_HEADERS
    );
    const listUrl =
      points && points.properties && points.properties.observationStations;
    if (!listUrl) return null;
    const stations = await fetchJson(listUrl, NWS_HEADERS);
    const first = stations && stations.features && stations.features[0];
    station = first && first.properties && first.properties.stationIdentifier;
    if (!station) return null;
    stationCache.set(name, station);
  }
  const obs = await fetchJson(
    'https://api.weather.gov/stations/' +
      station +
      '/observations/latest',
    NWS_HEADERS
  );
  const props = obs && obs.properties;
  if (
    !props ||
    !props.temperature ||
    typeof props.temperature.value !== 'number'
  ) {
    return null;
  }
  const tempF = Math.round((props.temperature.value * 9) / 5 + 32);
  return name + ' ' + tempF + '° · ' + conditionFromText(props.textDescription);
}

async function refreshFromNws() {
  const next = [];
  for (let i = 0; i < CITIES.length; i += 8) {
    const chunk = CITIES.slice(i, i + 8);
    const results = await Promise.allSettled(chunk.map(nwsReading));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) next.push(r.value);
    }
  }
  if (!next.length) throw new Error('NWS returned no usable readings');
  return next;
}

async function refresh() {
  try {
    readings = await refreshFromOpenMeteo();
    return;
  } catch (e) {
    console.error(
      '[weather] Open-Meteo refresh failed (' +
        e.message +
        '); falling back to the National Weather Service'
    );
  }
  try {
    readings = await refreshFromNws();
  } catch (e) {
    console.error('[weather] NWS fallback failed (' + e.message + ')');
    /* Keep the last good readings; the bar never breaks on a feed error. */
  }
}

function htmlSegment(text) {
  return text
    .replace('°', '&deg;')
    .replace('·', '&middot;');
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
    'for(var j=r.length-1;j>1;j--){var k=1+Math.floor(Math.random()*j);' +
    'var t=r[j];r[j]=r[k];r[k]=t;}' +
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
