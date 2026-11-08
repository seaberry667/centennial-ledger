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
  // The seven primary editorial categories (owner restructure,
  // 2026-11-08), in navigation order. Satire and political cartoons
  // are no longer a section of their own: they live under Opinion
  // with format 'satire' on the article record, and their bare
  // presentation is keyed off that format, not the section.
  { slug: 'politics', name: 'Politics' },
  { slug: 'business', name: 'Business & Taxes' },
  { slug: 'energy-environment', name: 'Energy & Environment' },
  { slug: 'education-health', name: 'Education & Health' },
  { slug: 'colorado-life', name: 'Colorado Life' },
  { slug: 'local', name: 'Local News' },
  { slug: 'opinion', name: 'Opinion' },
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

// Newsroom section names collapse into the seven live categories
// (owner restructure, 2026-11-08). The old Rights/Taxes/Energy/
// Schools sections are retired: rights and courts coverage belongs
// to Politics, taxes and budgets to Business & Taxes, energy to Energy &
// Environment, schools and health to Education & Health. Sports,
// outdoors and history now have a home in Colorado Life, so nothing
// is dropped at ingest anymore. 'satire' still maps to Opinion, and
// the satire FORMAT is carried separately (see isSatireInput).
const SECTION_ALIASES = {
  politics: 'politics',
  capitol: 'politics',
  governor: 'politics',
  elections: 'politics',
  rights: 'politics',
  'second amendment': 'politics',
  courts: 'politics',
  opinion: 'opinion',
  satire: 'opinion',
  taxes: 'business',
  'taxes & tabor': 'business',
  'taxes-rights': 'business',
  'taxes & rights': 'business',
  tabor: 'business',
  business: 'business',
  'business & taxes': 'business',
  'business and taxes': 'business',
  money: 'business',
  economy: 'business',
  'money & taxes': 'business',
  energy: 'energy-environment',
  environment: 'energy-environment',
  'energy & environment': 'energy-environment',
  schools: 'education-health',
  education: 'education-health',
  health: 'education-health',
  healthcare: 'education-health',
  'education & health': 'education-health',
  life: 'colorado-life',
  'colorado life': 'colorado-life',
  sports: 'colorado-life',
  outdoors: 'colorado-life',
  'sports & outdoors': 'colorado-life',
  history: 'colorado-life',
  local: 'local',
  'local news': 'local',
  counties: 'local',
  'local & schools': 'local',
  'local-schools': 'local',
};

// No coverage is dropped at ingest under the seven-category system.
const DROPPED_SECTION_KEYS = new Set([]);

/**
 * Resolve an incoming section value to a live section slug.
 * Returns null only for keys in DROPPED_SECTION_KEYS (empty since
 * the 2026-11-08 restructure); ingest counts those as skipped.
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

// Satire / political cartoons are a FORMAT, not a section, since
// the 2026-11-08 restructure: they carry primary category Opinion
// plus format 'satire', which keys their bare presentation.
const SATIRE_INPUT_KEYS = new Set([
  'satire',
  'political cartoon',
  'political cartoons',
  'cartoon',
  'cartoons',
  'editorial cartoon',
  'editorial cartoons',
]);

/** True when an incoming section/format value marks a piece as satire. */
function isSatireInput(input) {
  if (!input) return false;
  return SATIRE_INPUT_KEYS.has(String(input).trim().toLowerCase());
}

/** True when a stored article is a satire piece / political cartoon. */
function isSatire(a) {
  return !!a && (a.format === 'satire' || a.section === 'satire');
}

// One-time recategorization (owner restructure, 2026-11-08): every
// article published under the retired taxonomy, mapped by slug to
// its new primary category — and, for the six cartoons, its satire
// format. Applied once by both store backends at boot; the guards
// (only rewrite while the stored values differ) make later boots
// no-ops. Assignments were made story by story from each article's
// actual subject, per the owner's category definitions; the audit
// lives in the restructure working notes.
const RECATEGORIZE_2026 = {
  '14-san-luis-valley-school-leaders-unite-for-school-money-lower-taxes-1ptrq': ['education-health'],
  'a-real-sheet-show-lauren-boeberts-sex-scandal-goes-limp': ['opinion'],
  'alamosa-approves-2026-pay-plan-holds-line-on-broad-raise-for-city-workers-gcvej': ['local'],
  'alamosa-council-approves-2026-city-pay-plan-skips-broad-raise-u3apc': ['local'],
  'archuleta-county-charts-next-steps-on-growth-water-plans-0m4l7': ['local'],
  'aurora-panel-backs-cutting-murphy-creek-home-cap-by-162-c1han': ['local'],
  'aurora-voters-to-decide-three-new-sales-tax-measures-for-libraries-safety-roads-itgb3': ['local'],
  'boulder-valley-school-closures-move-ahead-colorado-supreme-court-rejects-parents-plea-3cfxz': ['education-health'],
  'breckenridge-rental-owner-takes-756-per-bedroom-fee-fight-to-colorado-top-court-h0pbp': ['local'],
  'colorado-delivery-fee-climbs-to-31-cents-on-orders-with-taxable-goods-3i7j1': ['business'],
  'colorado-gun-buyers-challenge-the-new-state-permit-law-in-federal-court-xe9w2': ['politics'],
  'colorado-gun-buyers-must-get-a-permit-first-and-a-lawsuit-asks-a-judge-to-pause-it-uppg1': ['politics'],
  'colorado-keeps-losing-first-amendment-cases-taxpayers-keep-getting-the-bill': ['opinion'],
  'colorado-lawmakers-pitch-10-years-for-schools-permanent-cut-to-tax-refunds-phv3c': ['business'],
  'colorado-legislature-2026-session-ends-as-critics-target-taxes-tabor-and-bargaining-bills-gbmrf': ['politics'],
  'colorado-made-an-example-of-tina-peters-then-its-own-appeals-court-exposed-the-problem': ['opinion'],
  'colorado-right-to-repair-law-faces-broad-exemption-in-senate-bill-26-090-2im9l': ['politics'],
  'colorado-schoolmistress-teaches-tolerance-all-beliefs-are-equal-some-less-so': ['opinion', 'satire'],
  'colorado-ski-season-lifts-off-as-resorts-open-through-december-401vd': ['colorado-life'],
  'colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l': ['business'],
  'colorado-taxpayers-pick-up-the-tab': ['opinion', 'satire'],
  'colorado-to-take-over-permits-for-carbon-storage-wells-pqkij': ['energy-environment'],
  'colorado-trims-state-test-time-for-grades-3-to-8-fr27r': ['education-health'],
  'colorado-voters-decide-whether-state-keeps-tax-refunds-for-schools-77nfl': ['business'],
  'colorado-voters-face-rival-income-tax-plans-pulling-opposite-ways-xh8ge': ['business'],
  'colorado-voters-head-toward-higher-income-taxes-on-top-earners-cut-for-most-3edtp': ['business'],
  'colorado-voters-to-decide-if-gas-cooking-home-heating-become-state-constitutional-right-7hb0b': ['energy-environment'],
  'colorado-voters-to-decide-tax-cut-for-most-hike-for-wealthiest-alwcn': ['business'],
  'colorado-votes-for-the-story-not-the-state': ['opinion'],
  'colorado-wants-small-businesses-it-just-makes-them-pay-for-the-privilege': ['opinion'],
  'colorado-wasnt-just-flipped-it-was-engineered-part-one': ['opinion'],
  'colorados-bicycle-safety-stop-law-signed-by-polis-in-2022': ['opinion', 'satire'],
  'colorados-supreme-court-loyalty-card-one-more-defeat-and-the-next-appeal-is-free': ['opinion', 'satire'],
  'colorados-war-on-crayons-and-the-catechism': ['opinion'],
  'democratic-bus-tour-arrives-late-in-alamosa-draws-about-100-to-society-hall-sfsn1': ['local'],
  'democratic-trojan-horse-at-the-capitol': ['opinion', 'satire'],
  'denver-can-force-sidewalk-land-deals-with-39-east-colfax-owners-if-talks-fail-s4ma9': ['local'],
  'douglas-county-republicans-pull-page-promising-to-publish-petition-signers-names-e7wjd': ['politics'],
  'fort-collins-boulder-lawmakers-drop-business-tax-break-rollback-after-governor-veto-threat-e6nuj': ['business'],
  'grand-junction-hashes-out-2027-city-spending-monday-before-public-hearing-x327u': ['local'],
  'judge-tosses-pueblo-school-board-secret-pick-for-fifth-seat-pdubc': ['local'],
  'lakewood-police-officer-killed-three-wounded-in-shooting-near-bus-m45e7': ['local'],
  'lakewood-voters-to-scrap-outdated-property-tax-hike-power-in-city-rulebook-ef9mk': ['local'],
  'lamar-council-pulls-plug-on-city-social-media-comments-9xtzb': ['local'],
  'larimer-county-voters-to-pick-seven-local-leaders-who-handle-taxes-budgets-7o0y9': ['local'],
  'logan-county-delays-data-center-rules-as-farmers-defend-prairie-a1szj': ['local'],
  'longmont-council-to-meet-in-private-on-fatal-shooting-of-dariss-yearby-5trzc': ['local'],
  'losing-chaffee-county-sheriff-candidate-pays-4-500-for-election-recount-3gw5c': ['local'],
  'loveland-hunts-nationwide-for-city-manager-to-run-city-hall-bkrs0': ['local'],
  'melat-kiros-is-going-to-congress-that-should-tell-colorado-something': ['opinion'],
  'mesa-county-backs-lease-plan-covering-6-400-local-acres-cm37a': ['energy-environment'],
  'mesa-county-phone-line-helps-voters-track-down-100-refund-checks-14hpf': ['business'],
  'millions-pour-into-pueblo-state-senate-race-candidates-spend-far-less-qbz2n': ['politics'],
  'montrose-council-shuffle-opens-one-seat-to-whole-city-j0jpq': ['local'],
  'montrose-county-fights-bids-to-end-prairie-dog-hunting-ban-lead-ammo-s3uqu': ['local'],
  'nonresidents-sue-denver-argue-handgun-rights-cross-state-lines-xzknj': ['politics'],
  'outside-groups-pour-14-million-into-fight-over-colorado-tax-votes-timwg': ['politics'],
  'pagosa-springs-faces-up-to-100-million-in-damage-from-second-flood-in-a-year-kqnt6': ['local'],
  'parents-warn-poudre-closure-plan-hits-special-needs-students-hardest-r414w': ['education-health'],
  'polis-makes-first-visit-to-southern-ute-gasoline-spill-site': ['opinion', 'satire'],
  'polls-close-phil-weiser-wins-race-for-colorado-governor-sud7h': ['politics'],
  'poudre-school-board-closes-four-schools-in-vote-past-midnight-6xzxi': ['education-health'],
  'pueblo-council-fights-electric-bill-hikes-topping-22-etbk8': ['energy-environment'],
  'pueblo-declares-oct-27-day-for-school-built-around-flexible-diplomas-biqrg': ['local'],
  'pueblo-insiders-climb-aboard-train-tax-push-rail-chief-pay-hinges-on-vote-komrv': ['business'],
  'pueblo-train-plan-ties-manager-pay-to-sales-tax-ballot-push-w4xmb': ['business'],
  'supreme-court-hears-case-of-catholic-families-shut-out-of-colorado-free-preschool-bpkk8': ['politics'],
  'the-weiser-guy-colorados-new-boss-dishing-out-same-old-nonsense': ['opinion'],
  'three-new-colorado-gun-rules-become-law-fourth-barrel-rule-dies-at-capitol-6s6fm': ['politics'],
  'timnath-parents-fight-closure-plan-for-school-at-95-full-7dmuz': ['education-health'],
  'vail-to-cut-4-45-million-from-town-budget-as-low-snow-hurts-winter-sales-gydvm': ['local'],
  'weld-county-clears-oil-lease-transfers-to-vitesse-energy-pk370': ['energy-environment'],
};

// One stored article carries no region at all: the Chaffee County
// sheriff recount. Chaffee County belongs to the site's Mountains
// region under the established definitions; the backends fill the
// region in only while it is empty (flagged for the owner's review
// in the restructure report).
const REGION_FIX_2026 = {
  'losing-chaffee-county-sheriff-candidate-pays-4-500-for-election-recount-3gw5c': 'Mountains',
};

// The three inaugural Colorado Explained articles were reviewed on
// 2026-11-08 (the date the newsroom holds), but the upload pipeline
// shifted the date one day back in transit, so the live store holds
// 2026-11-07. Both backends restore the recorded date, only while
// the shifted value is what's stored.
const EXPLAINED_REVIEW_FIX = {
  'how-colorados-tabor-law-actually-works': '2026-11-08',
  'who-owns-colorados-water': '2026-11-08',
  'why-are-colorado-property-taxes-so-complicated': '2026-11-08',
};
const EXPLAINED_REVIEW_SHIFTED = '2026-11-07';

// Stories the newsroom had already flagged breaking before the
// live store kept the flag (owner's breaking ticker, 2026-11-08):
// the governor's race call, the Lakewood shooting and the income
// tax result. Both backends set breaking=true for these slugs at
// boot, only where the flag is not already set, so the ticker
// launches with the same items the newsroom shows. Future flags
// arrive through ingest (markBreaking / insert).
const BREAKING_BACKFILL_SLUGS = [
  'polls-close-phil-weiser-wins-race-for-colorado-governor-sud7h',
  'lakewood-police-officer-killed-three-wounded-in-shooting-near-bus-m45e7',
  'colorado-voters-head-toward-higher-income-taxes-on-top-earners-cut-for-most-3edtp',
];

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
 * One-time, idempotent blurb replacement for the Melat Kiros
 * cartoon (owner instruction, 2026-11-05): the stored blurb (the
 * lead of the cartoon's single section) is swapped for the owner's
 * new text, but only while the old blurb is still in place — the
 * marker phrase exists solely in the old text, so after the swap
 * no boot ever matches again.
 */
const KIROS_BLURB_UPDATE = {
  slug: 'colorado-taxpayers-pick-up-the-tab',
  fromMarker: "Melat Kiros's democratic socialist agenda promises",
  toLead: "In the People's Republic of Colorado, everything's on the menu, and apparently everything's on the house. Democratic socialist Melat Kiros is serving up an ambitious buffet of taxpayer-funded benefits, with enough promises to make an all-you-can-eat restaurant blush. There's just one small problem: somebody eventually has to pay the bill. Doctors, teachers, construction workers, and government employees have an irritating habit of expecting actual money for their services. Of course, politicians have a remarkable talent for making expensive things sound free, particularly when they're spending someone else's paycheck. And in this restaurant, the customers don't get separate checks. The taxpayers pick up the tab, whether they ordered anything or not!",
};

/**
 * One-time, idempotent blurb replacement for the schoolmistress
 * cartoon (owner instruction, 2026-11-05): same pattern as
 * KIROS_BLURB_UPDATE — the stored blurb and dek are swapped only
 * while the old blurb is still in place; its marker phrase
 * ("a rather curious exception") exists solely in the old text.
 * The owner's email labeled this text for the Kiros cartoon; he
 * confirmed in chat it belongs to the schoolmistress cartoon.
 */
const SCHOOLMISTRESS_BLURB_UPDATE = {
  slug: 'colorado-schoolmistress-teaches-tolerance-all-beliefs-are-equal-some-less-so',
  fromMarker: 'a rather curious exception for Catholics',
  toLead: "Colorado has unveiled its latest preschool curriculum: tolerance, inclusion, and a curious exception for Catholics. Under its Universal Preschool program, secular schools receive enrollment exemptions for certain groups, while Catholic schools are denied comparable accommodations for their religious beliefs. Apparently, diversity is wonderful, provided nobody takes religion too seriously. Now the Supreme Court is weighing whether Colorado can use supposedly neutral regulations to accomplish what previous rulings prohibit outright: excluding religious schools from public benefits. In Colorado's classroom, every belief deserves respect, every family deserves a choice, and everyone is welcome. Terms and conditions apply, naturally.",
  toDek: "Colorado has unveiled its latest preschool curriculum: tolerance, inclusion, and a curious exception for Catholics.",
};

/**
 * One-time, idempotent caption trim for the schoolmistress
 * cartoon (owner instruction, 2026-11-05, minutes after the v2
 * swap above): the owner resent the caption with one sentence
 * ("Apparently, diversity is wonderful, provided nobody takes
 * religion too seriously.") removed. Applies only while the
 * stored blurb still contains that sentence, which exists
 * solely in the v2 text.
 */
/**
 * One-time, idempotent retitle of the Crayons Opinion piece
 * (owner instruction, 2026-11-05): headline becomes
 * "Pre-K and Prejudice" while the slug (and therefore the URL)
 * stays colorados-war-on-crayons-and-the-catechism. Applies only
 * while the stored headline is still the old title.
 */
const CRAYONS_RETITLE = {
  slug: 'colorados-war-on-crayons-and-the-catechism',
  fromHeadline: "Colorado's War on Crayons and the Catechism",
  toHeadline: 'Pre-K and Prejudice',
};

/**
 * One-time, idempotent accuracy updates to the midterm Opinion
 * piece (owner-approved, 2026-11-05): CD5 was called for Jessica
 * Killin after publication, and Amendment 87's margin widened
 * from about half a point to about two points. Two exact string
 * replacements in the body text; each lands only while its old
 * string is still present, so later boots change nothing.
 */
const MIDTERM_FIX = {
  slug: 'colorado-votes-for-the-story-not-the-state',
  replacements: [
    [
      'Jeff Crank trails in the Fifth, in El Paso County',
      'Jeff Crank has lost the Fifth to Jessica Killin, in El Paso County',
    ],
    [
      'is passing by a whisker, about half a point, on a night',
      'is passing by a whisker, about two points, on a night',
    ],
  ],
};

function applyMidtermFix(article) {
  let changed = false;
  const fix = (v) => {
    if (typeof v !== 'string') return v;
    let out = v;
    for (const pair of MIDTERM_FIX.replacements) {
      if (out.includes(pair[0])) {
        out = out.split(pair[0]).join(pair[1]);
        changed = true;
      }
    }
    return out;
  };
  if (article.dek) article.dek = fix(article.dek);
  const sections = Array.isArray(article.sections) ? article.sections : [];
  for (const sec of sections) {
    if (sec.heading) sec.heading = fix(sec.heading);
    if (sec.lead) sec.lead = fix(sec.lead);
    if (Array.isArray(sec.paragraphs)) sec.paragraphs = sec.paragraphs.map(fix);
  }
  return changed;
}

const SCHOOLMISTRESS_BLURB_V3 = {
  slug: 'colorado-schoolmistress-teaches-tolerance-all-beliefs-are-equal-some-less-so',
  fromMarker: 'provided nobody takes religion too seriously',
  toLead: "Colorado has unveiled its latest preschool curriculum: tolerance, inclusion, and a curious exception for Catholics. Under its Universal Preschool program, secular schools receive enrollment exemptions for certain groups, while Catholic schools are denied comparable accommodations for their religious beliefs. Now the Supreme Court is weighing whether Colorado can use supposedly neutral regulations to accomplish what previous rulings prohibit outright: excluding religious schools from public benefits. In Colorado's classroom, every belief deserves respect, every family deserves a choice, and everyone is welcome. Terms and conditions apply, naturally.",
};

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
  // Satire is a format, not a section (2026-11-08 restructure): a
  // piece the newsroom files as Satire / a political cartoon lands
  // in Opinion with format 'satire'; an explicit format on the
  // payload is honored the same way.
  const format =
    raw.format === 'satire' || isSatireInput(raw.section) || isSatireInput(raw.format)
      ? 'satire'
      : '';
  // Breaking flag (owner request, 2026-11-08): the newsroom marks
  // developing stories breaking; the live site keeps the flag so
  // the breaking news ticker can lead with them.
  const breaking = raw.isBreaking === true || raw.breaking === true;
  // Series designation (Colorado Explained, owner directive
  // 2026-11-08): independent of the primary section — an explainer
  // belongs to exactly one section AND carries the series name.
  // lastReviewed is the evergreen fact-check date (ISO or '').
  const series = String(raw.series || '').trim();
  const lastReviewed = String(raw.lastReviewed || raw.last_reviewed || '').trim();

  const out = {
    slug,
    headline,
    dek: String(raw.dek || '').trim(),
    byline: String(raw.byline || 'News Desk').trim(),
    publishedAt,
    modifiedAt,
    section,
    format,
    breaking,
    series,
    lastReviewed,
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
    // One-time, idempotent Kiros cartoon blurb replacement (see
    // KIROS_BLURB_UPDATE above).
    const kiros = this.data.articles.find(
      (x) => x.slug === KIROS_BLURB_UPDATE.slug
    );
    if (
      kiros &&
      kiros.sections &&
      kiros.sections[0] &&
      String(kiros.sections[0].lead || '').includes(KIROS_BLURB_UPDATE.fromMarker)
    ) {
      kiros.sections[0].lead = KIROS_BLURB_UPDATE.toLead;
      this._save();
    }
    // One-time, idempotent Crayons retitle (see CRAYONS_RETITLE
    // above).
    const crayons = this.data.articles.find(
      (x) => x.slug === CRAYONS_RETITLE.slug
    );
    if (crayons && crayons.headline === CRAYONS_RETITLE.fromHeadline) {
      crayons.headline = CRAYONS_RETITLE.toHeadline;
      this._save();
    }
    // One-time, idempotent midterm Opinion accuracy fixes (see
    // MIDTERM_FIX above).
    const midterm = this.data.articles.find(
      (x) => x.slug === MIDTERM_FIX.slug
    );
    if (midterm && applyMidtermFix(midterm)) this._save();
    // One-time, idempotent recategorization into the seven primary
    // categories (see RECATEGORIZE_2026 above): each article is
    // rewritten only while its stored section/format differ from
    // the mapped values, so later boots change nothing. The one
    // region repair (REGION_FIX_2026) fills an empty region only.
    let recategorized = false;
    for (const a of this.data.articles) {
      const target = RECATEGORIZE_2026[a.slug];
      if (target) {
        const [newSection, newFormat] = target;
        if (a.section !== newSection || (a.format || '') !== (newFormat || '')) {
          a.section = newSection;
          a.format = newFormat || '';
          recategorized = true;
        }
      }
      const regionFix = REGION_FIX_2026[a.slug];
      if (regionFix && !String(a.region || '').trim()) {
        a.region = regionFix;
        recategorized = true;
      }
      const reviewFix = EXPLAINED_REVIEW_FIX[a.slug];
      if (reviewFix && a.lastReviewed === EXPLAINED_REVIEW_SHIFTED) {
        a.lastReviewed = reviewFix;
        recategorized = true;
      }
    }
    if (recategorized) this._save();
    // Breaking-flag backfill (see BREAKING_BACKFILL_SLUGS above):
    // set the flag on the stories the newsroom had already marked
    // breaking, only where it is not already set.
    let breakingFilled = false;
    for (const a of this.data.articles) {
      if (BREAKING_BACKFILL_SLUGS.includes(a.slug) && a.breaking !== true) {
        a.breaking = true;
        breakingFilled = true;
      }
    }
    if (breakingFilled) this._save();
    // One-time, idempotent schoolmistress cartoon blurb
    // replacement (see SCHOOLMISTRESS_BLURB_UPDATE above).
    const mistress = this.data.articles.find(
      (x) => x.slug === SCHOOLMISTRESS_BLURB_UPDATE.slug
    );
    if (
      mistress &&
      mistress.sections &&
      mistress.sections[0] &&
      String(mistress.sections[0].lead || '').includes(
        SCHOOLMISTRESS_BLURB_UPDATE.fromMarker
      )
    ) {
      mistress.sections[0].lead = SCHOOLMISTRESS_BLURB_UPDATE.toLead;
      mistress.dek = SCHOOLMISTRESS_BLURB_UPDATE.toDek;
      this._save();
    }
    // One-time, idempotent schoolmistress caption trim (see
    // SCHOOLMISTRESS_BLURB_V3 above).
    const mistress3 = this.data.articles.find(
      (x) => x.slug === SCHOOLMISTRESS_BLURB_V3.slug
    );
    if (
      mistress3 &&
      mistress3.sections &&
      mistress3.sections[0] &&
      String(mistress3.sections[0].lead || '').includes(
        SCHOOLMISTRESS_BLURB_V3.fromMarker
      )
    ) {
      mistress3.sections[0].lead = SCHOOLMISTRESS_BLURB_V3.toLead;
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

  /**
   * Breaking-flag fill (2026-11-08): when the newsroom flags an
   * already-live story as breaking, the ingest handler calls this
   * so the live record gains the flag. Sets ONLY the breaking
   * field, and only from false to true; returns true when the
   * record changed.
   */
  async markBreaking(slug) {
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing || existing.breaking === true) return false;
    existing.breaking = true;
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
        format TEXT DEFAULT '',
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
        breaking BOOLEAN DEFAULT FALSE,
        series TEXT DEFAULT '',
        last_reviewed TEXT DEFAULT '',
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
    // Migration for databases created before the 2026-11-08
    // restructure split satire out of the section taxonomy into a
    // format flag ('' for ordinary articles, 'satire' for cartoons).
    await this.pool.query(
      "ALTER TABLE articles ADD COLUMN IF NOT EXISTS format TEXT DEFAULT ''"
    );
    // Migration for databases created before the breaking news
    // ticker (2026-11-08): the flag the newsroom sets on developing
    // stories, kept so the ticker can lead with them.
    await this.pool.query(
      'ALTER TABLE articles ADD COLUMN IF NOT EXISTS breaking BOOLEAN DEFAULT FALSE'
    );
    // Migration for databases created before the Colorado Explained
    // series (2026-11-08): the series designation and the evergreen
    // last-reviewed date.
    await this.pool.query(
      "ALTER TABLE articles ADD COLUMN IF NOT EXISTS series TEXT DEFAULT ''"
    );
    await this.pool.query(
      "ALTER TABLE articles ADD COLUMN IF NOT EXISTS last_reviewed TEXT DEFAULT ''"
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_section ON articles(section)'
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC)'
    );
    // One-time, idempotent recategorization into the seven primary
    // categories (see RECATEGORIZE_2026 above): each UPDATE lands
    // only while the stored section/format differ from the mapped
    // values, so later boots change nothing. The one region repair
    // (REGION_FIX_2026) fills an empty region only.
    for (const [slug, target] of Object.entries(RECATEGORIZE_2026)) {
      await this.pool.query(
        `UPDATE articles SET section = $2, format = $3
          WHERE slug = $1 AND (section <> $2 OR COALESCE(format, '') <> $3)`,
        [slug, target[0], target[1] || '']
      );
    }
    for (const [slug, region] of Object.entries(REGION_FIX_2026)) {
      await this.pool.query(
        `UPDATE articles SET region = $2
          WHERE slug = $1 AND (region IS NULL OR region = '')`,
        [slug, region]
      );
    }
    // Restore the recorded review date on the inaugural explainers
    // (see EXPLAINED_REVIEW_FIX above): lands only while the
    // shifted value is what's stored.
    for (const [slug, reviewed] of Object.entries(EXPLAINED_REVIEW_FIX)) {
      await this.pool.query(
        `UPDATE articles SET last_reviewed = $2
          WHERE slug = $1 AND last_reviewed = $3`,
        [slug, reviewed, EXPLAINED_REVIEW_SHIFTED]
      );
    }
    // Breaking-flag backfill (see BREAKING_BACKFILL_SLUGS above):
    // lands only while the flag is unset, so later boots change
    // nothing.
    await this.pool.query(
      `UPDATE articles SET breaking = TRUE
        WHERE slug = ANY($1) AND COALESCE(breaking, FALSE) = FALSE`,
      [BREAKING_BACKFILL_SLUGS]
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
    // One-time, idempotent Crayons retitle (see CRAYONS_RETITLE
    // above): the WHERE guard keeps later boots from re-applying.
    await this.pool.query(
      'UPDATE articles SET headline = $2 WHERE slug = $1 AND headline = $3',
      [CRAYONS_RETITLE.slug, CRAYONS_RETITLE.toHeadline, CRAYONS_RETITLE.fromHeadline]
    );
    // One-time, idempotent midterm Opinion accuracy fixes (see
    // MIDTERM_FIX above): read the row, swap the two strings only
    // while the old text is still in place, write it back.
    const midtermRow = await this.pool.query(
      'SELECT dek, sections FROM articles WHERE slug = $1',
      [MIDTERM_FIX.slug]
    );
    if (midtermRow.rows.length) {
      const probe = {
        dek: midtermRow.rows[0].dek || '',
        sections:
          typeof midtermRow.rows[0].sections === 'string'
            ? JSON.parse(midtermRow.rows[0].sections)
            : midtermRow.rows[0].sections || [],
      };
      if (applyMidtermFix(probe)) {
        await this.pool.query(
          'UPDATE articles SET dek = $2, sections = $3 WHERE slug = $1',
          [MIDTERM_FIX.slug, probe.dek, JSON.stringify(probe.sections)]
        );
      }
    }
    // One-time, idempotent Kiros cartoon blurb replacement (see
    // KIROS_BLURB_UPDATE above): read the row, swap the blurb only
    // while the old text is still in place, write it back.
    const kirosRow = await this.pool.query(
      'SELECT sections FROM articles WHERE slug = $1',
      [KIROS_BLURB_UPDATE.slug]
    );
    if (kirosRow.rows.length) {
      const kSections =
        typeof kirosRow.rows[0].sections === 'string'
          ? JSON.parse(kirosRow.rows[0].sections)
          : kirosRow.rows[0].sections || [];
      if (
        kSections[0] &&
        String(kSections[0].lead || '').includes(KIROS_BLURB_UPDATE.fromMarker)
      ) {
        kSections[0].lead = KIROS_BLURB_UPDATE.toLead;
        await this.pool.query(
          'UPDATE articles SET sections = $2 WHERE slug = $1',
          [KIROS_BLURB_UPDATE.slug, JSON.stringify(kSections)]
        );
      }
    }
    // One-time, idempotent schoolmistress cartoon blurb
    // replacement (see SCHOOLMISTRESS_BLURB_UPDATE above).
    const mistressRow = await this.pool.query(
      'SELECT sections FROM articles WHERE slug = $1',
      [SCHOOLMISTRESS_BLURB_UPDATE.slug]
    );
    if (mistressRow.rows.length) {
      const mSections =
        typeof mistressRow.rows[0].sections === 'string'
          ? JSON.parse(mistressRow.rows[0].sections)
          : mistressRow.rows[0].sections || [];
      if (
        mSections[0] &&
        String(mSections[0].lead || '').includes(
          SCHOOLMISTRESS_BLURB_UPDATE.fromMarker
        )
      ) {
        mSections[0].lead = SCHOOLMISTRESS_BLURB_UPDATE.toLead;
        await this.pool.query(
          'UPDATE articles SET sections = $2, dek = $3 WHERE slug = $1',
          [
            SCHOOLMISTRESS_BLURB_UPDATE.slug,
            JSON.stringify(mSections),
            SCHOOLMISTRESS_BLURB_UPDATE.toDek,
          ]
        );
      }
    }
    // One-time, idempotent schoolmistress caption trim (see
    // SCHOOLMISTRESS_BLURB_V3 above).
    const mistress3Row = await this.pool.query(
      'SELECT sections FROM articles WHERE slug = $1',
      [SCHOOLMISTRESS_BLURB_V3.slug]
    );
    if (mistress3Row.rows.length) {
      const m3Sections =
        typeof mistress3Row.rows[0].sections === 'string'
          ? JSON.parse(mistress3Row.rows[0].sections)
          : mistress3Row.rows[0].sections || [];
      if (
        m3Sections[0] &&
        String(m3Sections[0].lead || '').includes(
          SCHOOLMISTRESS_BLURB_V3.fromMarker
        )
      ) {
        m3Sections[0].lead = SCHOOLMISTRESS_BLURB_V3.toLead;
        await this.pool.query(
          'UPDATE articles SET sections = $2 WHERE slug = $1',
          [SCHOOLMISTRESS_BLURB_V3.slug, JSON.stringify(m3Sections)]
        );
      }
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
      format: r.format || '',
      breaking: r.breaking === true,
      series: r.series || '',
      lastReviewed: r.last_reviewed || '',
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
         (slug, headline, dek, byline, published_at, modified_at, section, format, topic_label, region,
          spotlight, sections, why_it_matters, image, source_name, source_url, sources, seo_title, meta_description, breaking, series, last_reviewed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug`,
      [
        a.slug, a.headline, a.dek, a.byline, a.publishedAt, a.modifiedAt || a.publishedAt,
        a.section, a.format || '', a.topicLabel,
        a.region, a.spotlight, JSON.stringify(a.sections), a.whyItMatters,
        a.image ? JSON.stringify(a.image) : null,
        a.sourceName, a.sourceUrl, JSON.stringify(a.sources || []), a.seoTitle, a.metaDescription,
        a.breaking === true, a.series || '', a.lastReviewed || '',
      ]
    );
    return res.rowCount > 0 ? 'inserted' : 'skipped';
  }

  /**
   * Same contract as the file store's markBreaking: set ONLY the
   * breaking flag, only from false to true. The WHERE clause makes
   * the check-and-set atomic. Returns true when a row changed.
   */
  async markBreaking(slug) {
    const res = await this.pool.query(
      `UPDATE articles SET breaking = TRUE
        WHERE slug = $1 AND COALESCE(breaking, FALSE) = FALSE
        RETURNING slug`,
      [slug]
    );
    return res.rowCount > 0;
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
  isSatire,
  isSatireInput,
  regionSlug,
  regionName,
  normalizeArticle,
  normalizeImage,
  slugify,
};
