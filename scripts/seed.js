'use strict';
/**
 * Manual seed: inserts 3 clearly-marked SAMPLE articles so a local run
 * shows a populated homepage. Run with:  npm run seed
 * Never runs automatically, and never in production deploys.
 * Safe to run twice: the store is append-only, so existing slugs skip.
 */

const { createStore, normalizeArticle } = require('../src/store');

const now = new Date();
const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();

/**
 * Placeholder article art in the house style: black line work and
 * crosshatching on pure white, like a 19th-century newspaper engraving,
 * inlined as an SVG data URI so local testing shows the full layout
 * with no external files. (Pure white background so the plate blends
 * into the site's white page; no sepia or aged-paper tint.)
 */
function engravingUri(inner) {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450' viewBox='0 0 800 450'>" +
    '<defs>' +
    "<pattern id='h' width='6' height='6' patternTransform='rotate(45)' patternUnits='userSpaceOnUse'><rect width='6' height='6' fill='#ffffff'/><line x1='0' y1='0' x2='0' y2='6' stroke='#141414' stroke-width='1.1'/></pattern>" +
    "<pattern id='x' width='7' height='7' patternUnits='userSpaceOnUse'><rect width='7' height='7' fill='#ffffff'/><path d='M0 0L7 7M7 0L0 7' stroke='#141414' stroke-width='0.65'/></pattern>" +
    '</defs>' +
    "<rect width='800' height='450' fill='#ffffff'/>" +
    "<rect x='12' y='12' width='776' height='426' fill='none' stroke='#141414' stroke-width='5'/>" +
    "<rect x='24' y='24' width='752' height='402' fill='none' stroke='#141414' stroke-width='1.5'/>" +
    inner +
    '</svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const GROUND = "<line x1='40' y1='392' x2='760' y2='392' stroke='#141414' stroke-width='3'/>";

const PUMPJACK_SCENE =
  "<circle cx='130' cy='105' r='38' fill='url(#x)' stroke='#141414' stroke-width='2.5'/>" +
  "<g stroke='#141414' stroke-width='6' fill='none'>" +
  "<line x1='330' y1='380' x2='385' y2='175'/>" +
  "<line x1='445' y1='380' x2='385' y2='175'/>" +
  "<line x1='248' y1='150' x2='565' y2='208'/>" +
  "<line x1='248' y1='150' x2='248' y2='218'/>" +
  "<line x1='540' y1='204' x2='540' y2='330'/>" +
  '</g>' +
  "<circle cx='385' cy='175' r='10' fill='#141414'/>" +
  "<rect x='478' y='302' width='112' height='78' fill='url(#x)' stroke='#141414' stroke-width='3'/>" +
  "<g stroke='#141414' stroke-width='2'><line x1='90' y1='404' x2='300' y2='404'/><line x1='430' y1='404' x2='700' y2='404'/><line x1='180' y1='416' x2='560' y2='416'/></g>" +
  GROUND;

const CAPITOL_SCENE =
  "<path d='M308 192 A92 92 0 0 1 492 192 Z' fill='url(#h)' stroke='#141414' stroke-width='3'/>" +
  "<line x1='400' y1='94' x2='400' y2='58' stroke='#141414' stroke-width='3'/>" +
  "<polygon points='400,58 430,67 400,76' fill='#141414'/>" +
  "<rect x='268' y='192' width='264' height='18' fill='url(#x)' stroke='#141414' stroke-width='2.5'/>" +
  "<g stroke='#141414' stroke-width='6'>" +
  [298, 340, 382, 424, 466].map((x) => `<line x1='${x}' y1='214' x2='${x}' y2='330'/>`).join('') +
  '</g>' +
  "<rect x='254' y='330' width='292' height='16' fill='url(#x)' stroke='#141414' stroke-width='2.5'/>" +
  "<rect x='238' y='346' width='324' height='14' fill='none' stroke='#141414' stroke-width='2.5'/>" +
  GROUND;

const MOUNTAINS_SCENE =
  "<circle cx='622' cy='108' r='42' fill='url(#x)' stroke='#141414' stroke-width='2.5'/>" +
  "<polygon points='56,384 262,138 468,384' fill='url(#h)' stroke='#141414' stroke-width='3'/>" +
  "<polygon points='298,384 522,178 744,384' fill='url(#x)' stroke='#141414' stroke-width='3'/>" +
  "<polyline points='216,208 262,138 308,208' fill='none' stroke='#141414' stroke-width='2.5'/>" +
  "<g stroke='#141414' stroke-width='2.5' fill='url(#h)'><polygon points='88,384 114,312 140,384'/><polygon points='636,384 660,322 684,384'/></g>" +
  GROUND;

const SAMPLES = [
  {
    slug: 'sample-weld-county-energy-permits',
    headline: 'Sample Story: Crowd Packs Weld County Hearing on Energy Permits',
    dek: 'This is a sample article used only to test the live site layout. It is not a real Centennial Ledger story.',
    byline: 'News Desk',
    publishedAt: hoursAgo(3),
    section: 'energy',
    topicLabel: 'Energy Permits',
    region: 'Northern Colorado',
    spotlight: 'gop_positive',
    sections: [
      {
        heading: 'Commissioners Hear Both Sides',
        lead: 'Sample lead paragraph: county commissioners heard several hours of public comment on energy permitting at a regular meeting in Greeley.',
        paragraphs: [
          'Sample body paragraph. Residents, landowners, and industry workers described how permit timelines affect jobs, royalties, and county services across Weld County.',
          'Sample body paragraph. The board took no final vote and said staff would return with draft timelines at the next regular session.',
        ],
      },
    ],
    whyItMatters:
      'Sample text: energy permitting decisions shape royalty income, school funding, and road budgets in producing counties, so timelines set locally are felt well beyond the hearing room.',
    image: {
      url: engravingUri(PUMPJACK_SCENE),
      alt: 'Oil pumpjack on the Weld County plains near Greeley, where commissioners are weighing energy permit timelines',
      caption:
        'A pumpjack works the plains outside Greeley, where Weld County commissioners heard hours of testimony on energy permit timelines. S.I.-generated image.',
    },
    sourceName: 'Sample Source (test data)',
    sourceUrl: 'https://centennialledger.com/',
    seoTitle: 'Weld County energy permits: Greeley hearing draws a crowd',
    metaDescription:
      'Weld County commissioners heard hours of public comment on energy permit timelines in Greeley, as landowners and oil and gas workers weighed jobs and royalties.',
  },
  {
    slug: 'sample-denver-budget-shortfall',
    headline: 'Sample Story: Denver Budget Shortfall Puts City Programs Under Review',
    dek: 'This is a sample article used only to test the live site layout. It is not a real Centennial Ledger story.',
    byline: 'News Desk',
    publishedAt: hoursAgo(8),
    section: 'politics',
    topicLabel: 'City Budget',
    region: 'Denver Metro',
    spotlight: 'dem_negative',
    sections: [
      {
        heading: 'Shortfall Puts Programs Under Review',
        lead: 'Sample lead paragraph: a projected budget gap has city departments reviewing program spending line by line ahead of the next budget cycle.',
        paragraphs: [
          'Sample body paragraph. Council members asked for updated revenue figures and a list of programs that grew fastest over the past three budget years.',
          'Sample body paragraph. A finance committee hearing is expected before any reductions are proposed in public session.',
        ],
      },
    ],
    whyItMatters:
      'Sample text: when a city budget runs short, the choices made in committee rooms decide which services residents actually notice, from libraries to road repair.',
    image: {
      url: engravingUri(CAPITOL_SCENE),
      alt: 'Colorado State Capitol in Denver, where city leaders face a budget shortfall and program cuts',
      caption:
        'The Colorado State Capitol in Denver, as city departments review program spending ahead of the next budget cycle. S.I.-generated image.',
    },
    sourceName: 'Sample Source (test data)',
    sourceUrl: 'https://centennialledger.com/',
    seoTitle: 'Denver budget shortfall puts city programs under review',
    metaDescription:
      'A projected Denver budget shortfall has city departments reviewing program spending line by line, as council members weigh which services face cuts next cycle.',
  },
  {
    slug: 'sample-summit-county-rental-caps',
    headline: 'Sample Story: Summit County Planners Weigh Short-Term Rental Caps',
    dek: 'This is a sample article used only to test the live site layout. It is not a real Centennial Ledger story.',
    byline: 'News Desk',
    publishedAt: hoursAgo(26),
    section: 'local',
    topicLabel: 'County Government',
    region: 'Mountains',
    spotlight: null,
    sections: [
      {
        heading: 'What the Draft Would Do',
        lead: 'Sample lead paragraph: county planners are reviewing draft caps on short-term rentals in unincorporated areas, with a public hearing set for next month.',
        paragraphs: [
          'Sample body paragraph. Mountain town officials described pressure on housing for local workers, while property owners asked how existing permits would be treated.',
          'Sample body paragraph. The planning commission took public comment and is expected to send a recommendation to the county commissioners.',
        ],
      },
    ],
    whyItMatters:
      'Sample text: rental rules set by a county reach straight into housing costs, tourism income, and who can afford to live and work in a mountain town year-round.',
    image: {
      url: engravingUri(MOUNTAINS_SCENE),
      alt: 'Summit County mountain town under rental cap review as planners weigh housing for local workers',
      caption:
        'Snowcapped peaks rise over a Summit County town, where planners are reviewing caps on short-term rentals. S.I.-generated image.',
    },
    sourceName: 'Sample Source (test data)',
    sourceUrl: 'https://centennialledger.com/',
    seoTitle: 'Summit County short-term rental caps weighed by planners',
    metaDescription:
      'Summit County planners are reviewing draft caps on short-term rentals in mountain towns, weighing worker housing against property rights. See what comes next.',
  },
];

(async () => {
  const store = await createStore();
  let inserted = 0;
  let skipped = 0;
  for (const raw of SAMPLES) {
    const article = normalizeArticle(raw);
    const result = await store.insertArticle(article);
    if (result === 'inserted') inserted += 1;
    else skipped += 1;
  }
  console.log(`Seed complete: ${inserted} inserted, ${skipped} skipped (already present).`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
