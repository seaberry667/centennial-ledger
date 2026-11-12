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
  // Colorado Life was retired as a section (owner order,
  // 2026-11-08); its subjects land in Local News now.
  life: 'local',
  'colorado life': 'local',
  'colorado-life': 'local',
  sports: 'local',
  outdoors: 'local',
  'sports & outdoors': 'local',
  history: 'local',
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
// The shifted value may be stored bare or with a time attached.
const EXPLAINED_REVIEW_SHIFTED = '2026-11-07';

// Owner-ordered backdates (2026-11-08): the first two Colorado
// Explained articles move to Nov 3 and Nov 6 — publication date
// and last-reviewed date together, so each piece reads
// consistently. Both backends apply only while the stored
// publication date is still Nov 8.
const BACKDATE_EXPLAINED_2026 = {
  'how-colorados-tabor-law-actually-works': { publishedAt: '2026-11-03T17:00:00.000Z', lastReviewed: '2026-11-03' },
  'who-owns-colorados-water': { publishedAt: '2026-11-06T17:00:00.000Z', lastReviewed: '2026-11-06' },
};
// Owner-ordered restructure (2026-11-08): Part Two of the
// Engineered series was published in podcast-script form — a run
// of one-sentence paragraphs. These sections keep the owner's
// sentences and voice, merged into developed op-ed paragraphs
// under his original headings. Both backends swap them in only
// while the stored article still has the fragment structure
// (more than 40 paragraphs in total).
const PART_TWO_SLUG = 'colorado-wasnt-just-flipped-it-was-engineered-part-two';
const PART_TWO_SECTIONS = [{"heading": "Part Two: The Progressive Paradise Comes With a Bill", "lead": "For years, Colorado Democrats have presented themselves as the party of competent government, affordability, environmental responsibility, and public investment. They've had ample opportunity to demonstrate those virtues.", "paragraphs": ["And after years of Democratic control, ordinary Coloradans have an increasingly reasonable question: **If this is what successful progressive government looks like, why is everything so expensive, and why does the state keep running into fiscal trouble?** Let's examine the results."]}, {"heading": "The $46.8 Billion Budget That Still Wasn't Enough", "lead": "In May 2026, Gov. Jared Polis signed Colorado's budget for the 2026–27 fiscal year. It exceeded **$46.8 billion**, nearly $4 billion larger than the previous year's budget.", "paragraphs": ["That sounds like a substantial amount of money. Apparently, it wasn't substantial enough. Lawmakers also faced an approximately **$1.5 billion shortfall** between available resources and the projected cost of maintaining programs at existing levels, and the state reduced spending in several areas, including a 2% reimbursement-rate cut for many Medicaid providers.", "To appreciate the absurdity, consider the political optics. The state adopts a budget approaching $47 billion, substantially larger than the previous year's, while simultaneously announcing painful fiscal cuts.", "There is an explanation: total-funds spending includes federal money and other dedicated revenue, while the shortfall concerned resources available for particular obligations. Rising Medicaid costs were an important driver. But understanding the accounting doesn't eliminate the central problem: Colorado's existing government commitments had become expensive enough that lawmakers struggled to finance them.", "Colorado Public Radio reported that Medicaid costs had increased approximately 86% since the 2018–19 fiscal year, substantially faster than growth in the state's TABOR revenue cap over that period. Healthcare costs, enrollment, benefit decisions, and federal policy all contributed.", "This is precisely why fiscal conservatives worry about expanding recurring government obligations. A program can be popular. It can have sympathetic beneficiaries. It can even accomplish something useful. None of that guarantees the state can afford its growing costs indefinitely.", "Yet Colorado's political culture has developed an unfortunate habit of treating every proposed expansion of government as an expression of compassion and every question about its cost as a suspicious ideological deficiency. Eventually, the arithmetic gets a vote. And arithmetic has no interest in anybody's political intentions.", "The 2026 budget was not proof that Colorado had run out of money. It was evidence that maintaining existing commitments had become substantially more difficult. After years of Democratic government, that's not a footnote. It's a governing record."]}, {"heading": "Colorado's Housing Crisis: Congratulations, Nobody Can Afford Your Paradise", "lead": "Colorado is an extraordinarily beautiful state. Unfortunately, living here increasingly requires an extraordinarily beautiful bank account.", "paragraphs": ["The Colorado Housing and Finance Authority's 2025 report documented the scale of the affordability problem. Between 2000 and 2023, Colorado's median rent increased from $1,188 to $1,824 in inflation-adjusted 2023 dollars. That's a **53.5% increase even after accounting for inflation**. The report also placed Colorado ninth nationally in estimated housing underproduction. In other words, Colorado hasn't built enough homes to satisfy demand, and residents have paid for that failure through higher housing costs.", "This didn't begin with Jared Polis, and it certainly wasn't created by four donors sitting around a table in 2004. But Colorado's governing class has had plenty of time to recognize the problem. Instead, housing policy has often combined new regulations, subsidies, tenant protections, affordability programs, and increasingly elaborate state intervention.", "Consider House Bill 24-1098. Signed in April 2024, the law established new requirements limiting when residential landlords can evict tenants. It includes specific permitted causes and exceptions. Supporters portray it as protection from arbitrary displacement. But property owners have legitimate concerns about the growing legal and administrative obligations of providing rental housing. Those obligations deserve consideration alongside the interests of tenants.", "Or consider House Bill 24-1313, also enacted in 2024. That legislation directed certain transit-oriented communities to increase their zoning capacity for residential development. It was, at least in part, an acknowledgment that Colorado needs more housing. Fair enough. But after years of deteriorating affordability, the state was still working through the rather elementary realization that making it easier to build homes might help alleviate a shortage of homes.", "Housing prices are influenced by national interest rates, construction costs, population growth, land availability, and local zoning. No honest analysis can assign every increase to Democratic legislation. That doesn't excuse the governing majority from explaining how its policies affect housing supply and costs.", "The question isn't whether Democrats have produced an impressive collection of housing initiatives. It's whether those initiatives have made housing meaningfully more attainable for ordinary working families. A policy announcement is not a house. A grant program is not a house. A press conference describing the urgent need for more housing is, remarkably, also not a house. Colorado needs more actual homes."]}, {"heading": "Proposition HH: When Voters Read the Fine Print", "lead": "One of the clearest examples of the divide between Colorado's governing establishment and its electorate came in 2023. Gov. Polis and legislative Democrats championed Proposition HH.", "paragraphs": ["The measure was promoted as property-tax relief. And yes, it would have reduced certain property-tax obligations. But it also would have changed Colorado's TABOR revenue limits, allowing the state to retain additional money that otherwise could have been returned to taxpayers. According to *The Colorado Sun*, the proposal could have permitted the government to spend as much as $2.2 billion in additional revenue annually by 2032. Most of that additional revenue was intended for K–12 education.", "This was a complicated arrangement to present to voters as tax relief. Colorado homeowners were dealing with rising property taxes. The proposed solution involved providing some relief while giving state government considerably more long-term financial flexibility.", "Voters weren't impressed. On November 7, 2023, approximately **60% voted against Proposition HH**. The measure failed even with support from the Democratic governor and legislative leadership.", "Polis subsequently acknowledged that the proposal had become too complicated. A fair observation. But complexity wasn't the entire objection. The measure asked voters to accept a longer-term increase in the state's capacity to retain and spend tax revenue in exchange for a particular property-tax arrangement. Many voters decided that was a poor bargain.", "That election demonstrated something important about Colorado's political landscape. Even in a state where Democrats comfortably controlled the legislature, voters could reject the governing majority's fiscal priorities when given a direct choice. The people who built Colorado's progressive political apparatus were exceptionally good at winning elections. Fortunately, they never acquired a monopoly on the ballot box."]}, {"heading": "Energy Policy: Regulate First, Ask About Costs Later", "lead": "Colorado's progressive transformation has also significantly affected energy policy. In 2019, Democrats enacted Senate Bill 181, a major restructuring of oil-and-gas regulation. The legislation shifted the regulatory framework toward prioritizing public health, safety, welfare, and environmental protection, while expanding local governments' authority over aspects of development. That same year, House Bill 1261 established ambitious statewide greenhouse-gas-reduction targets. Neither law was merely symbolic. They changed the framework within which energy producers, regulators, utilities, and other businesses operate.", "paragraphs": ["Environmental protection is a legitimate government responsibility. So is providing an environment in which businesses can invest, employ workers, and produce essential goods at competitive prices. Colorado's energy industry supports jobs, local tax bases, royalty payments, and economic activity. Oil and natural gas are also used in industries and households across the political spectrum—including by people who support policies intended to restrict their production. That creates an obvious tension.", "Government can impose increasingly ambitious requirements on energy production, but it cannot simply wish away the economic consequences of complying with those requirements. Some environmental regulations deliver benefits worth their costs. Others may impose substantial burdens for modest gains. The correct question is whether particular policies deliver measurable results that justify those burdens.", "But Colorado's governing majority has repeatedly shown considerable enthusiasm for additional regulatory authority. It should be equally enthusiastic about demonstrating that the resulting obligations are proportionate, effective, and affordable. A climate target is not an economic analysis. And a press release announcing an ambitious goal does not make its implementation free."]}];

// Owner-ordered revision (2026-11-08): "Who Owns Colorado's
// Water?" explained the interstate compacts but never the
// litigation that enforces them. These sections are the full
// revised article — a new section, "When the Promises End Up in
// Court," covers Kansas v. Colorado (Arkansas River), Wyoming v.
// Colorado and the North Platte decree, and Nebraska's 2025
// Supreme Court suit over the South Platte and the Perkins County
// Canal — plus five added sources and a closing addition to What
// to Watch. Both backends swap them in only while the stored
// sections do not yet mention the Perkins County Canal, and set
// the last-reviewed date to the revision date, 2026-11-08. The
// article's backdated publication date (2026-11-06) is untouched.
const WATER_SLUG = 'who-owns-colorados-water';
const WATER_LITIGATION_SECTIONS = [{"heading": "", "lead": "Nobody owns the water in Colorado's rivers. Not the rancher whose family has diverted from the same creek since statehood, and not the city that stores spring runoff behind a high mountain dam. Article XVI of the Colorado Constitution, adopted in 1876, declares the water of every natural stream in the state to be the property of the public, dedicated to the use of the people of the state. What a person, a farm or a city can own is something narrower and, in a dry state, nearly as valuable: a water right, a legally protected right to take a measured amount of the public's water, at a set place, for an approved use.", "paragraphs": ["That distinction explains most of what puzzles newcomers about Colorado water: why a landowner can own both banks of a creek and still have no legal right to pump from it, and why farms planted in the 1880s can take water in a drought while newer suburbs scramble."]}, {"heading": "The Short Answer", "lead": "The water itself belongs to the public. A water right is a right to use part of that public supply, and it works like a place in line. Earliest users, senior rights, are served first; later users, junior rights, take what is left and can be ordered to stop in dry times. Special water courts confirm the rights, state officials enforce the line, and nobody, landowner or not, may legally divert water without a right or a permit.", "paragraphs": []}, {"heading": "A Right to Use, Not a Right to Own", "lead": "Lawyers describe a Colorado water right as usufructuary, a plain idea in a hard word: it is a right of use, not a title to the water itself. Colorado State University's Colorado Water Knowledge project puts it directly: no one owns the stream or the water in it; users hold a right to use water for a beneficial purpose, lasting only while the water is actually used. Several consequences follow:", "paragraphs": ["• A water right is property. It can be bought, sold, inherited and leased, separate from the land, and a sale does not change its priority date.\n• A water right is measured, not open ended. A decree states the amount, source, point of diversion, type of use and place of use.\n• A water right depends on continued use. Under the Division of Water Resources' abandonment rules, ten years or more of nonuse, when water was available, creates a legal presumption that the right has been abandoned.\n• A water right can travel. Water may be diverted in one valley and used in another, even across the Continental Divide, which is how Front Range taps hold Western Slope snowmelt.", "Because the right is a share of a public resource, the state acts as referee. It cannot take a senior right away because a newer use seems more valuable. Changing a right, for example from farm use to city use, requires water court approval and proof that other users will not be injured."]}, {"heading": "First in Time, First in Right", "lead": "Colorado allocates water under the prior appropriation doctrine, written into the state constitution in 1876. Section 6 of Article XVI provides that the right to divert unappropriated water for beneficial uses shall never be denied, and that priority of appropriation gives the better right: first in time, first in right.", "paragraphs": ["Appropriation has three working parts, as the Division of Water Resources explains them. A person must intend to take water, must actually divert it or place it under control, and must apply it to a beneficial use. Beneficial use is the legal measure and limit of every right: irrigation, household and city supply, manufacturing, power, livestock watering and, under modern statutes, keeping water in a stream for fish and recreation. Waste is not a beneficial use, and no one may claim more than the use genuinely requires.", "The priority date is the heart of the right. It decides the right's place in line on its stream. In a wet year the line hardly matters; in a dry year it decides nearly everything."]}, {"heading": "How a Water Right Is Created and Confirmed", "lead": "Unlike most western states, Colorado does not issue water rights through an agency permit counter. Since the Water Right Determination and Administration Act of 1969, water rights are confirmed by courts. The Act divided the state into seven water divisions, drawn on major river basin boundaries, each with its own division engineer and specialized water court. It also joined surface water and tributary groundwater into one system, ending the fiction that a well beside a river had nothing to do with the river. The path from an idea to a working right runs as follows:", "paragraphs": ["• The appropriator forms the intent to take water and takes an open step toward it, such as surveying a ditch line.\n• The appropriator diverts the water and applies it to beneficial use, fixing the claim in fact rather than on paper alone.\n• The appropriator applies in the water court for the division, where the claim is published and any user who fears injury may oppose it.\n• The water judge issues a decree confirming the priority date, amount, source, point of diversion and use.", "Conditional decrees let large projects hold a priority while dams and tunnels are built, but holders must show steady diligence, and rights become absolute only as water is actually put to use."]}, {"heading": "Dry Years and the Call", "lead": "Administration is the daily work of the Division of Water Resources, headed by the State Engineer. The State Engineer and seven division engineers, working through water commissioners in the field, distribute water in priority, as the constitution and section 37-92-501, Colorado Revised Statutes direct.", "paragraphs": ["When a senior user is not receiving the water its decree promises, the senior places a call on the river. Every junior diversion above the senior must then reduce or stop taking water until the senior right is satisfied. There is a narrow safety valve: if water released by shutting a junior could never reach the senior in time to be used, a division engineer may declare the call futile and let the junior keep diverting.", "Example: Two irrigators farm the same creek, which by mid August in a dry year carries about 20 cubic feet of water per second. The senior ditch holds an 1892 priority for 15 cubic feet per second; the junior ditch, a few miles upstream, holds a 1954 priority for 12. Because 15 and 12 add up to more than the creek holds, the junior cannot take a proportional share. When the senior places a call, the commissioner orders the junior headgate cut back so the senior's 15 cubic feet per second passes down the creek first. The junior may divert only what remains, on some days five cubic feet per second, on the worst days nothing. The junior's deed, ditch and headgate are perfectly legal. They are simply late in line, and in Colorado late can mean dry."]}, {"heading": "The Water Underground", "lead": "Groundwater follows three different legal tracks in Colorado, and confusing them causes real trouble for rural land buyers.", "paragraphs": ["• Tributary groundwater is connected to a stream, so pumping it today takes water from the river tomorrow. Since 1969 it has been administered inside the priority system, which is why large wells in the South Platte and Arkansas valleys operate under court approved augmentation plans that replace water owed to seniors.\n• Designated groundwater lies in eight designated basins on the eastern plains, areas with little surface water where farms and towns depend on wells. The Colorado Ground Water Commission, created under the Ground Water Management Act of 1965, administers those basins separately, with local management districts.\n• Nontributary groundwater is so deep and so weakly connected to any stream that the law treats it as effectively separate, under a strict statutory test of how little a century of pumping would deplete a natural stream. Much of the Denver Basin's bedrock water falls in or near this category, allocated based on the land above the aquifer.", "The lesson: a well is never just a well in Colorado. Its paperwork, basin and connection to the nearest creek decide what it may lawfully pump."]}, {"heading": "Where the Water Actually Goes", "lead": "Farming dominates the ledger. According to the Colorado Water Conservation Board's 2023 Colorado Water Plan, agriculture accounts for about 90 percent of the water consumed in Colorado, municipalities about 7 percent and large industry about 3 percent. Two qualifications keep that figure honest. First, it measures consumption, water evaporated, absorbed by crops or not returned; much diverted irrigation water runs back to streams as return flow and is used again downstream. Second, the share reflects history: farms arrived first, so farm rights are usually senior, and growing food in a dry state requires irrigation.", "paragraphs": ["Geography sharpens the competition. Roughly 80 percent of Colorado's precipitation falls west of the Continental Divide, while most people and much of the farmland lie east of it. The engineering answer is the transmountain diversion. The largest, the federally owned Colorado-Big Thompson Project, passes Colorado River headwaters snowmelt through the 13.1 mile Alva B. Adams Tunnel and delivers on average about 200,000 acre-feet a year to more than 1.1 million people and some 550,000 acres of irrigated farmland in northeastern Colorado, according to Northern Water, which operates the project with the United States Bureau of Reclamation. Western Slope communities watch every new diversion proposal with care."]}, {"heading": "Promises Downstream: Compacts and Reserved Rights", "lead": "Colorado is called the Headwaters State, and the title carries obligations. Its rivers flow outward to downstream states and Mexico, and Colorado's use is capped by law before the priority system even begins. As the Colorado Legislative Council Staff summarized in 2025, Colorado is party to nine interstate compacts, two Supreme Court decrees and two international treaties governing its rivers.", "paragraphs": ["The Colorado River Compact of 1922 is the best known. It split the river at Lee Ferry, Arizona, between an Upper Basin (Colorado, New Mexico, Utah and Wyoming) and a Lower Basin (Arizona, California and Nevada), apportioning 7.5 million acre-feet a year of consumptive use to each basin. The Upper Division states also promised not to let the flow at Lee Ferry fall below 75 million acre-feet in total over any ten consecutive years. The Upper Colorado River Basin Compact of 1948 divided the Upper Basin share: 51.75 percent to Colorado, 23 percent to Utah, 14 percent to Wyoming and 11.25 percent to New Mexico, after a fixed 50,000 acre-feet to Arizona. A 1944 treaty separately guarantees water to Mexico. If Colorado users ever took so much that the state could not meet these promises, the result would be a compact call, curtailment imposed above the priority system.", "A second layer of rights sits partly outside state administration. When the federal government reserved land, for tribal reservations, national parks and forests, it also reserved water sufficient for the reservation's purposes, with a priority dating to the reservation's creation. Colorado's two federally recognized tribes, the Southern Ute Indian Tribe and the Ute Mountain Ute Tribe, had their reserved rights quantified in the Colorado Ute Indian Water Rights Final Settlement Agreement of 1986 and the federal settlement act of 1988, which funded the Animas-La Plata Project and Lake Nighthorse in southwestern Colorado."]}, {"heading": "When the Promises End Up in Court", "lead": "A compact is federal law once Congress approves it, and when states disagree about what it means, there is no water court to appeal to. Interstate water cases go straight to the United States Supreme Court, which appoints a special master to hear the evidence and then decides the case itself. Colorado has spent much of the past century in that courtroom, and the decrees entered there bind the state's water officials as tightly as any compact.", "paragraphs": ["The northern fights came first. In Wyoming v. Colorado, decided in 1922, the Supreme Court applied the priority system across a state line: because both states followed prior appropriation, Wyoming's senior users on the Laramie River were entitled to their water ahead of Colorado's newer Laramie-Poudre diversion, which the Court capped at 15,500 acre-feet a year of surplus flow. A later decree in 1957 reset Colorado's allowance at 49,375 acre-feet a year in total. On the North Platte, an eleven-year lawsuit ended with a 1945 decree in Nebraska v. Wyoming that split the river's pivotal reach 75 percent to Nebraska and 25 percent to Wyoming and capped Colorado's own use in Jackson County, limits on irrigated acres and storage that still apply today. Nebraska reopened that case in 1986, and a modified decree in 2001 settled it again.", "The longest fight ran south. The Arkansas River Compact of 1949 did not divide the river by numbers. It promised that future development would not materially deplete the flows Kansas users depended on. Kansas sued in 1985, arguing that post-compact well pumping in Colorado's Arkansas Valley was depleting the river from underground. The Supreme Court agreed in 1995, and after fourteen more years of rulings on damages, interest and compliance, it entered a final judgment in 2009: $34.6 million for depletions of 428,005 acre-feet between 1950 and 1996. The decree capped Colorado's groundwater pumping at its pre-compact level of 15,000 acre-feet a year unless the depletions are replaced, and compliance is still tracked today with a shared computer model over a rolling ten-year accounting. The well rules the State Engineer enforces in the Arkansas Valley, and the replacement plans its well associations operate under, exist because Kansas won.", "The newest fight is over a canal that has waited a century to be built. The South Platte River Compact of 1923 guaranteed Nebraska 120 cubic feet per second past Julesburg in the irrigation season, and in exchange gave Nebraska the right to build the Perkins County Canal: a diversion on the river's south bank near Ovid, entitled to 500 cubic feet per second of winter flow between October 15 and April 1, carrying a December 1921 priority. Nebraska never built it. In 2022 it decided to, authorizing $628 million for a project now designed as about 61 miles of canal feeding two reservoirs in Nebraska, and it began seeking the Colorado land the compact allows it to take, by purchase or by condemnation. Colorado landowners organized against it, and Colorado officials opposed it publicly.", "On July 16, 2025, Nebraska sued Colorado in the Supreme Court. Its complaint says Colorado is shorting the irrigation-season flows owed at Julesburg, that Colorado's system of letting junior wells pump under augmentation plans itself violates the compact, and that Colorado has obstructed the canal. It puts the water taken at as much as 1.3 million acre-feet. Colorado answered in September 2026 that it is meeting its obligations, asked the Court to dismiss part of the case, and counterclaimed that Nebraska wells near the state line are depleting Lodgepole Creek and South Platte flows owed to Colorado. The Court agreed to hear the case in June 2026. Nothing substantive has been decided, and the case is expected to run for years, most likely before a special master. The stakes are concrete: whether Colorado must leave more winter water in the South Platte for a canal on the drawing board since 1921, and how much freedom Colorado keeps in running its own wells."]}, {"heading": "What It Means for Coloradans", "lead": "• Buying land buys no water. A deed to forty acres along a creek conveys the dirt, not a right to divert. Ask for the decrees, well permits and ditch shares before closing.\n• Seniority is value. Two otherwise identical farms can be worth very different sums because one holds an 1890s right and the other a 1960s right a dry August can shut off.\n• Your town's water has a birthday. City supplies are secure in proportion to the age of their rights and the storage behind them, which is why cities buy senior farm rights and build reservoirs.\n• Conservation has legal edges. Water saved through efficiency may not simply be sold or spread to new acres; it historically belonged to the stream and to downstream users.\n• Rivers have legal claims too. Since 1973, the Colorado Water Conservation Board has held instream flow rights that keep water in streams for the environment, administered in priority like other rights, though most carry junior dates.\n• Shortage is shared by rule, not by scramble. The priority system, compacts and reservoir rules decide who cuts back, in an order fixed long before the dry year arrives.", "paragraphs": []}, {"heading": "What to Watch", "lead": "The rules are old, but the numbers underneath them are moving. The operating guidelines for Lake Powell and Lake Mead expire after 2026, and the seven Colorado River Basin states are negotiating what replaces them, with the federal government holding a heavy hand if the states cannot agree. Colorado must defend its 51.75 percent Upper Basin share while facing the possibility that a hotter, drier river cannot fill the promises of 1922. Watch, too, for groundwater legislation for the designated basins and purchases of senior farm rights by growing cities. And watch the Supreme Court: Nebraska's suit over the South Platte and the Perkins County Canal is in its early stages, and where it lands will shape winter water on the South Platte for decades. The water will remain the public's. The contest, as always, is over who may use it, in what order, and on what proof.", "paragraphs": []}];
const WATER_LITIGATION_SOURCES = [
  { name: 'Arkansas River Compact, Colorado Revised Statutes 37-69-101', url: 'https://colorado.public.law/statutes/crs_37-69-101' },
  { name: 'Kansas v. Colorado, 556 U.S. 98 (2009), judgment and decree', url: 'https://static.case.law/us/556/case-pdfs/0098-01.pdf' },
  { name: 'Wyoming v. Colorado, 259 U.S. 419 (1922)', url: 'https://supreme.justia.com/us/259/419/case.html' },
  { name: 'South Platte River Compact, Colorado Revised Statutes 37-65-101', url: 'https://colorado.public.law/statutes/crs_37-65-101' },
  { name: 'U.S. Supreme Court docket, Nebraska v. Colorado, No. 22O161', url: 'https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/22o161.html' },
];

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
  // Retracted 2026-11-10 (owner flagged): a Northern Colorado weekend
  // events guide for Saturday Nov. 7 – Sunday Nov. 8 that the story
  // cycle published on Tuesday Nov. 10 as if the weekend were still
  // ahead. Every event in it had already happened.
  'northern-colorado-families-pack-saturday-with-football-music-free-festivals-93kcl',
]);

// Owner order (2026-11-08): Opinion and Satire are removed from
// public view. Every Opinion-section article — editorials and
// satire-format pieces alike — is hidden at the read layer,
// exactly like a retracted slug: its page 404s and it leaves the
// homepage, sections, search and sitemaps. The records stay
// stored and ingest is unaffected; removing this check restores
// them exactly as stored.
function isHiddenArticle(a) {
  return RETRACTED_SLUGS.has(a.slug) || a.section === 'opinion';
}

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
 * One-time, idempotent Why It Matters for the owner's
 * donor-problem article (owner instruction, 2026-11-08): the
 * piece was published without one, so the blurb lands only
 * while the stored field is still empty.
 */
const DONOR_WHY_2026 = {
  slug: 'colorados-nonpartisan-newsrooms-have-a-democratic-donor-problem',
  whyItMatters:
    "Colorado's nonprofit newsrooms ask readers to trust them as nonpartisan while taking six-figure checks from foundations built by the donors who flipped this state, and from a network that accepted dark money. Readers who know who pays for the coverage can judge for themselves how neutral it is.",
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

/**
 * Internal cross-links (owner order, 2026-11-09): in-text links
 * from an article to earlier Ledger coverage of the same
 * subject, stored as [anchor](/article/slug) in the body
 * text, which the renderer turns into a link. Each entry
 * wraps the FIRST occurrence of its anchor phrase in the
 * named article's section text. Idempotent: an entry is
 * skipped once its link is present, so later boots change
 * nothing. At most 4 internal links per article, counting
 * the explainer cross-links already in the text when this ran.
 */
const INTERNAL_LINKS_2026_11_09 = [
  {
    slug: "colorado-gun-buyers-challenge-the-new-state-permit-law-in-federal-court-xe9w2",
    anchor: "Colorado State Shooting Association",
    target: "colorado-gun-buyers-must-get-a-permit-first-and-a-lawsuit-asks-a-judge-to-pause-it-uppg1",
  },
  {
    slug: "breckenridge-rental-owner-takes-756-per-bedroom-fee-fight-to-colorado-top-court-h0pbp",
    anchor: "Colorado's Taxpayer's Bill of Rights",
    target: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
  },
  {
    slug: "weld-county-clears-oil-lease-transfers-to-vitesse-energy-pk370",
    anchor: "the Mesa County lease plan",
    target: "mesa-county-backs-lease-plan-covering-6-400-local-acres-cm37a",
  },
  {
    slug: "logan-county-delays-data-center-rules-as-farmers-defend-prairie-a1szj",
    anchor: "Taxpayer's Bill of Rights (TABOR)",
    target: "colorado-voters-decide-whether-state-keeps-tax-refunds-for-schools-77nfl",
  },
  {
    slug: "denver-can-force-sidewalk-land-deals-with-39-east-colfax-owners-if-talks-fail-s4ma9",
    anchor: "condemnation under Colorado law",
    target: "logan-county-delays-data-center-rules-as-farmers-defend-prairie-a1szj",
  },
  {
    slug: "colorado-river-water-shortage-forces-rethink-of-how-west-shares-water-r8rm2",
    anchor: "The Colorado River Compact of 1922",
    target: "who-owns-colorados-water",
  },
  {
    slug: "colorado-river-water-shortage-forces-rethink-of-how-west-shares-water-r8rm2",
    anchor: "growth and water plans",
    target: "archuleta-county-charts-next-steps-on-growth-water-plans-0m4l7",
  },
  {
    slug: "pueblo-insiders-climb-aboard-train-tax-push-rail-chief-pay-hinges-on-vote-komrv",
    anchor: "a 0.333% sales and use tax",
    target: "pueblo-train-plan-ties-manager-pay-to-sales-tax-ballot-push-w4xmb",
  },
  {
    slug: "polls-close-phil-weiser-wins-race-for-colorado-governor-sud7h",
    anchor: "the race for Colorado governor",
    target: "democratic-bus-tour-arrives-late-in-alamosa-draws-about-100-to-society-hall-sfsn1",
  },
  {
    slug: "colorados-nonpartisan-newsrooms-have-a-democratic-donor-problem",
    anchor: "The Colorado Times Recorder presents",
    target: "douglas-county-republicans-pull-page-promising-to-publish-petition-signers-names-e7wjd",
  },
  {
    slug: "timnath-parents-fight-closure-plan-for-school-at-95-full-7dmuz",
    anchor: "Poudre closure plan hits special needs students hardest",
    target: "parents-warn-poudre-closure-plan-hits-special-needs-students-hardest-r414w",
  },
  {
    slug: "poudre-school-board-closes-four-schools-in-vote-past-midnight-6xzxi",
    anchor: "Timnath parents fought the closure plan",
    target: "timnath-parents-fight-closure-plan-for-school-at-95-full-7dmuz",
  },
  {
    slug: "poudre-school-board-closes-four-schools-in-vote-past-midnight-6xzxi",
    anchor: "the closure plan hits special needs students hardest",
    target: "parents-warn-poudre-closure-plan-hits-special-needs-students-hardest-r414w",
  },
  {
    slug: "14-san-luis-valley-school-leaders-unite-for-school-money-lower-taxes-1ptrq",
    anchor: "jointly asked voters to support Amendment 87",
    target: "colorado-voters-to-decide-tax-cut-for-most-hike-for-wealthiest-alwcn",
  },
  {
    slug: "boulder-valley-school-closures-move-ahead-colorado-supreme-court-rejects-parents-plea-3cfxz",
    anchor: "Oct. 27, 2026, school closure decision",
    target: "poudre-school-board-closes-four-schools-in-vote-past-midnight-6xzxi",
  },
  {
    slug: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
    anchor: "the Taxpayer's Bill of Rights",
    target: "colorado-legislature-2026-session-ends-as-critics-target-taxes-tabor-and-bargaining-bills-gbmrf",
  },
  {
    slug: "colorado-lawmakers-pitch-10-years-for-schools-permanent-cut-to-tax-refunds-phv3c",
    anchor: "Senate Bill 26-135",
    target: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
  },
  {
    slug: "colorado-voters-to-decide-tax-cut-for-most-hike-for-wealthiest-alwcn",
    anchor: "flat 4.4% state income tax",
    target: "colorado-voters-face-rival-income-tax-plans-pulling-opposite-ways-xh8ge",
  },
  {
    slug: "colorado-voters-to-decide-tax-cut-for-most-hike-for-wealthiest-alwcn",
    anchor: "$817 million cut in refunds",
    target: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
  },
  {
    slug: "fort-collins-boulder-lawmakers-drop-business-tax-break-rollback-after-governor-veto-threat-e6nuj",
    anchor: "House Bills 1221 and 1222",
    target: "colorado-legislature-2026-session-ends-as-critics-target-taxes-tabor-and-bargaining-bills-gbmrf",
  },
  {
    slug: "colorado-voters-decide-whether-state-keeps-tax-refunds-for-schools-77nfl",
    anchor: "Senate Bill 135",
    target: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
  },
  {
    slug: "outside-groups-pour-14-million-into-fight-over-colorado-tax-votes-timwg",
    anchor: "raise school funding by about $500 million a year",
    target: "colorado-voters-decide-whether-state-keeps-tax-refunds-for-schools-77nfl",
  },
  {
    slug: "outside-groups-pour-14-million-into-fight-over-colorado-tax-votes-timwg",
    anchor: "Proposition 136",
    target: "colorado-voters-face-rival-income-tax-plans-pulling-opposite-ways-xh8ge",
  },
  {
    slug: "how-colorados-tabor-law-actually-works",
    anchor: "Referendum C, approved in 2005",
    target: "colorado-taxpayers-face-817-million-cut-in-refunds-under-november-ballot-plan-kh94l",
  },
  {
    slug: "colorado-voters-head-toward-higher-income-taxes-on-top-earners-cut-for-most-3edtp",
    anchor: "Initiative 232, or Proposition 136",
    target: "colorado-voters-face-rival-income-tax-plans-pulling-opposite-ways-xh8ge",
  },
  {
    slug: "colorado-voters-head-toward-higher-income-taxes-on-top-earners-cut-for-most-3edtp",
    anchor: "flat personal and corporate income tax rates",
    target: "colorado-voters-to-decide-tax-cut-for-most-hike-for-wealthiest-alwcn",
  },
  {
    slug: "mesa-county-phone-line-helps-voters-track-down-100-refund-checks-14hpf",
    anchor: "Colorado's Taxpayer's Bill of Rights (TABOR)",
    target: "how-colorados-tabor-law-actually-works",
  },
];

function applyInternalLinks(article) {
  if (!article || !Array.isArray(article.sections)) return false;
  let changed = false;
  for (const L of INTERNAL_LINKS_2026_11_09) {
    if (article.slug !== L.slug) continue;
    const marker = '](/article/' + L.target + ')';
    const cells = [];
    for (const sec of article.sections) {
      if (!sec) continue;
      if (typeof sec.lead === 'string') cells.push([sec, 'lead']);
      if (Array.isArray(sec.paragraphs)) {
        for (let i = 0; i < sec.paragraphs.length; i++) cells.push([sec.paragraphs, i]);
      }
    }
    let already = false;
    for (const cell of cells) {
      if (String(cell[0][cell[1]]).includes(marker)) { already = true; break; }
    }
    if (already) continue;
    for (const cell of cells) {
      const t = String(cell[0][cell[1]]);
      const at = t.indexOf(L.anchor);
      if (at >= 0) {
        cell[0][cell[1]] = t.slice(0, at) + '[' + L.anchor + '](/article/' + L.target + ')' + t.slice(at + L.anchor.length);
        changed = true;
        break;
      }
    }
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

/* ------------------------------------------------------------------ */
/* Newsletter records (2026-11-12)                                     */
/* One subscriber database behind both backends: a single row per     */
/* email address carries the Daily Brief flag, topic and region        */
/* subscriptions, digest frequency, and the consent/suppression        */
/* record. Campaigns, per-subscriber deliveries (so an article is      */
/* never sent to the same subscriber twice), and the email outbox      */
/* (send log, and the delivery mechanism until Amazon SES is            */
/* configured) live alongside. All schema changes are additive and     */
/* idempotent; see the boot migrations in each backend's init().       */
/* ------------------------------------------------------------------ */

function nextNumericId(rows) {
  return (
    rows.reduce((max, r) => Math.max(max, Number(r && r.id) || 0), 0) + 1
  );
}

function normalizeSubscriberRecord(input, id) {
  const src = input && typeof input === 'object' ? input : {};
  const freq = ['off', 'daily', 'weekly'].includes(src.digestFrequency)
    ? src.digestFrequency
    : 'off';
  const status = ['pending', 'confirmed', 'unsubscribed'].includes(src.status)
    ? src.status
    : 'pending';
  return {
    id: id != null ? id : src.id != null ? src.id : null,
    email: String(src.email || '').toLowerCase().trim(),
    firstName: String(src.firstName || ''),
    lastName: String(src.lastName || ''),
    zipCode: String(src.zipCode || ''),
    status,
    confirmedAt: src.confirmedAt || null,
    signupDate: src.signupDate || new Date().toISOString(),
    signupSource: String(src.signupSource || 'web'),
    lastPrefUpdate: src.lastPrefUpdate || null,
    dailyBrief: !!src.dailyBrief,
    topics: Array.isArray(src.topics) ? src.topics.map(String) : [],
    regions: Array.isArray(src.regions) ? src.regions.map(String) : [],
    digestFrequency: freq,
    breakingOptIn: !!src.breakingOptIn,
    paused: !!src.paused,
    unsubscribedAt: src.unsubscribedAt || null,
    suppressed: !!src.suppressed,
    consent:
      src.consent && typeof src.consent === 'object'
        ? src.consent
        : { at: '', source: '', ip: '' },
    lastDigestAt: src.lastDigestAt || null,
  };
}

function normalizeCampaignRecord(input, id) {
  const src = input && typeof input === 'object' ? input : {};
  const type = ['brief', 'digest', 'breaking', 'test'].includes(src.type)
    ? src.type
    : 'brief';
  const status = ['draft', 'approved', 'sending', 'sent', 'failed'].includes(
    src.status
  )
    ? src.status
    : 'draft';
  return {
    id: id != null ? id : src.id != null ? src.id : null,
    type,
    sendDate: String(src.sendDate || ''),
    subject: String(src.subject || ''),
    status,
    stats: src.stats && typeof src.stats === 'object' ? src.stats : {},
    articleIds: Array.isArray(src.articleIds)
      ? src.articleIds.map(String)
      : [],
    aroundIds: Array.isArray(src.aroundIds)
      ? src.aroundIds.map(String)
      : [],
    podcast:
      src.podcast && typeof src.podcast === 'object' ? src.podcast : null,
    sponsorName: String(src.sponsorName || ''),
    sponsorMessage: String(src.sponsorMessage || ''),
    sponsorUrl: String(src.sponsorUrl || ''),
    createdAt: src.createdAt || new Date().toISOString(),
    sentAt: src.sentAt || null,
  };
}

function pgIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function pgSubscriberRowToRecord(row) {
  if (!row) return null;
  return normalizeSubscriberRecord(
    {
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name || '',
      zipCode: row.zip_code || '',
      status: row.status,
      confirmedAt: pgIso(row.confirmed_at),
      signupDate: pgIso(row.signup_date) || new Date().toISOString(),
      signupSource: row.signup_source,
      lastPrefUpdate: pgIso(row.last_pref_update),
      dailyBrief: !!row.daily_brief,
      topics: Array.isArray(row.topics) ? row.topics : [],
      regions: Array.isArray(row.regions) ? row.regions : [],
      digestFrequency: row.digest_frequency,
      breakingOptIn: !!row.breaking_opt_in,
      paused: !!row.paused,
      unsubscribedAt: pgIso(row.unsubscribed_at),
      suppressed: !!row.suppressed,
      consent:
        row.consent && typeof row.consent === 'object'
          ? row.consent
          : { at: '', source: '', ip: '' },
      lastDigestAt: pgIso(row.last_digest_at),
    },
    row.id
  );
}

function pgCampaignRowToRecord(row) {
  if (!row) return null;
  return normalizeCampaignRecord(
    {
      type: row.type,
      sendDate: row.send_date,
      subject: row.subject,
      status: row.status,
      stats: row.stats && typeof row.stats === 'object' ? row.stats : {},
      articleIds: Array.isArray(row.article_ids) ? row.article_ids : [],
      aroundIds: Array.isArray(row.around_ids) ? row.around_ids : [],
      podcast:
        row.podcast && typeof row.podcast === 'object' ? row.podcast : null,
      sponsorName: row.sponsor_name,
      sponsorMessage: row.sponsor_message,
      sponsorUrl: row.sponsor_url,
      createdAt: pgIso(row.created_at) || new Date().toISOString(),
      sentAt: pgIso(row.sent_at),
    },
    row.id
  );
}

function pgOutboxRowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    html: row.html,
    text: row.text_body,
    kind: row.kind,
    status: row.status,
    providerId: row.provider_id,
    createdAt: pgIso(row.created_at) || new Date().toISOString(),
  };
}

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
    // One-time, idempotent Why It Matters for the donor-problem
    // article (see DONOR_WHY_2026 above).
    const donorWhy = this.data.articles.find(
      (x) => x.slug === DONOR_WHY_2026.slug
    );
    if (donorWhy && !String(donorWhy.whyItMatters || '').trim()) {
      donorWhy.whyItMatters = DONOR_WHY_2026.whyItMatters;
      this._save();
    }
    // One-time, idempotent series rename (owner order, 2026-11-08):
    // "Colorado Explained" became "How Colorado Works"; stored rows
    // are rewritten only while they carry the old name, so later
    // boots change nothing.
    let seriesRenamed = false;
    for (const a of this.data.articles) {
      if (a.series === 'Colorado Explained') {
        a.series = 'How Colorado Works';
        seriesRenamed = true;
      }
    }
    if (seriesRenamed) this._save();
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
      if (
        reviewFix &&
        String(a.lastReviewed || '').startsWith(EXPLAINED_REVIEW_SHIFTED)
      ) {
        a.lastReviewed = reviewFix;
        recategorized = true;
      }
      const backdate = BACKDATE_EXPLAINED_2026[a.slug];
      if (backdate && String(a.publishedAt || '').startsWith('2026-11-08')) {
        a.publishedAt = backdate.publishedAt;
        a.lastReviewed = backdate.lastReviewed;
        recategorized = true;
      }
    }
    if (recategorized) this._save();
    // Part Two restructure (see PART_TWO_SECTIONS above): swap the
    // fragment-structured sections for the owner's restructured
    // text, only while the stored article still has the fragment
    // structure.
    const partTwo = this.data.articles.find((a) => a.slug === PART_TWO_SLUG);
    if (partTwo) {
      const paraCount = (partTwo.sections || []).reduce(
        (n, s) => n + 1 + ((s && s.paragraphs) || []).length,
        0
      );
      if (paraCount > 40) {
        partTwo.sections = JSON.parse(JSON.stringify(PART_TWO_SECTIONS));
        this._save();
      }
    }
    // Water litigation revision (see WATER_LITIGATION_SECTIONS
    // above): swap in the revised sections and sources and set
    // the review date, only while the stored sections do not yet
    // mention the Perkins County Canal.
    const water = this.data.articles.find((a) => a.slug === WATER_SLUG);
    if (water) {
      const text = (water.sections || [])
        .flatMap((s) => [s.heading, s.lead, ...((s && s.paragraphs) || [])])
        .join(' ');
      if (!text.includes('Perkins County Canal')) {
        water.sections = JSON.parse(JSON.stringify(WATER_LITIGATION_SECTIONS));
        const have = new Set((water.sources || []).map((s) => s.url));
        water.sources = (water.sources || []).concat(
          WATER_LITIGATION_SOURCES.filter((s) => !have.has(s.url))
        );
        water.lastReviewed = '2026-11-08';
        this._save();
      }
    }
    // Colorado Life retirement (owner order, 2026-11-08): the
    // section's one article, the ski season story, moves to Local
    // News; its Mountains region is already stored and stays.
    const ski = this.data.articles.find(
      (a) => a.slug === 'colorado-ski-season-lifts-off-as-resorts-open-through-december-401vd'
    );
    if (ski && ski.section === 'colorado-life') {
      ski.section = 'local';
      this._save();
    }
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
    // Internal cross-links (see INTERNAL_LINKS_2026_11_09 above).
    let linksChanged = false;
    for (const a of this.data.articles) {
      if (applyInternalLinks(a)) linksChanged = true;
    }
    if (linksChanged) this._save();
    // Newsletter tables (2026-11-12): ensure the arrays exist, then
    // migrate legacy briefing subscribers once (idempotent: rows
    // already present in nlSubscribers are skipped by email).
    this._ensureNewsletterShape();
    if (this._migrateLegacyBriefingSubscribers()) this._save();
  }

  _ensureNewsletterShape() {
    if (!Array.isArray(this.data.nlSubscribers)) this.data.nlSubscribers = [];
    if (!Array.isArray(this.data.nlCampaigns)) this.data.nlCampaigns = [];
    if (!Array.isArray(this.data.nlDeliveries)) this.data.nlDeliveries = [];
    if (!Array.isArray(this.data.nlOutbox)) this.data.nlOutbox = [];
  }

  // Legacy briefing_subscribers become confirmed Daily Brief
  // subscribers with signup_source 'legacy-briefing'. Returns true
  // when a row was added (caller saves).
  _migrateLegacyBriefingSubscribers() {
    const known = new Set(
      this.data.nlSubscribers.map((s) => String(s.email || '').toLowerCase())
    );
    let added = false;
    for (const legacy of this.data.subscribers || []) {
      const email = String((legacy && legacy.email) || '')
        .toLowerCase()
        .trim();
      if (!email || known.has(email)) continue;
      const at = legacy.createdAt || new Date().toISOString();
      this.data.nlSubscribers.push(
        normalizeSubscriberRecord(
          {
            email,
            status: 'confirmed',
            confirmedAt: at,
            signupDate: at,
            signupSource: 'legacy-briefing',
            dailyBrief: true,
            consent: { at, source: 'legacy-briefing', ip: '' },
          },
          nextNumericId(this.data.nlSubscribers)
        )
      );
      known.add(email);
      added = true;
    }
    return added;
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
   * Series metadata correction (2026-11-08): the ingest handler
   * calls this for an already-live article when the payload carries
   * a lastReviewed date that differs from the stored one, so the
   * newsroom's recorded review date replaces a value mangled in
   * transit. Sets ONLY lastReviewed; returns true on a change.
   */
  async fillLastReviewed(slug, value) {
    const v = String(value || '').trim();
    if (!v) return false;
    const existing = this.data.articles.find((a) => a.slug === slug);
    if (!existing || (existing.lastReviewed || '') === v) return false;
    existing.lastReviewed = v;
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
    const a = this.data.articles.find((x) => x.slug === slug);
    return a && !isHiddenArticle(a) ? a : null;
  }

  async listArticles({ section = null, region = null, spotlight = null, search = null, limit = 50 } = {}) {
    let rows = this.data.articles.filter((a) => !isHiddenArticle(a));
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
    return this.data.articles.filter((a) => !isHiddenArticle(a)).length;
  }

  async addSubscriber(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
    if (this.data.subscribers.some((s) => s.email === e)) return true;
    this.data.subscribers.push({ email: e, createdAt: new Date().toISOString() });
    this._save();
    return true;
  }

  /* -------- Newsletter: subscribers -------- */

  async nlFindSubscriberByEmail(email) {
    const e = String(email || '').toLowerCase().trim();
    return this.data.nlSubscribers.find((s) => s.email === e) || null;
  }

  async nlGetSubscriber(id) {
    return this.data.nlSubscribers.find((s) => s.id === Number(id)) || null;
  }

  async nlInsertSubscriber(rec) {
    const sub = normalizeSubscriberRecord(
      rec,
      nextNumericId(this.data.nlSubscribers)
    );
    this.data.nlSubscribers.push(sub);
    this._save();
    return sub;
  }

  async nlUpdateSubscriber(id, patch) {
    const sub = this.data.nlSubscribers.find((s) => s.id === Number(id));
    if (!sub) return null;
    Object.assign(
      sub,
      normalizeSubscriberRecord(Object.assign({}, sub, patch), sub.id)
    );
    this._save();
    return sub;
  }

  async nlListSubscribers() {
    return this.data.nlSubscribers.slice();
  }

  /* -------- Newsletter: campaigns -------- */

  async nlInsertCampaign(rec) {
    const existing = this.data.nlCampaigns.find(
      (c) => c.type === rec.type && c.sendDate === rec.sendDate
    );
    if (existing) return existing;
    const campaign = normalizeCampaignRecord(
      rec,
      nextNumericId(this.data.nlCampaigns)
    );
    this.data.nlCampaigns.push(campaign);
    this._save();
    return campaign;
  }

  async nlGetCampaign(id) {
    return this.data.nlCampaigns.find((c) => c.id === Number(id)) || null;
  }

  async nlFindCampaign(type, sendDate) {
    return (
      this.data.nlCampaigns.find(
        (c) => c.type === type && c.sendDate === sendDate
      ) || null
    );
  }

  async nlUpdateCampaign(id, patch) {
    const campaign = this.data.nlCampaigns.find((c) => c.id === Number(id));
    if (!campaign) return null;
    Object.assign(
      campaign,
      normalizeCampaignRecord(Object.assign({}, campaign, patch), campaign.id)
    );
    this._save();
    return campaign;
  }

  async nlListCampaigns(limit = 50) {
    return this.data.nlCampaigns
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  /* -------- Newsletter: deliveries -------- */

  async nlInsertDelivery(rec) {
    const delivery = {
      id: nextNumericId(this.data.nlDeliveries),
      campaignId: Number(rec.campaignId),
      subscriberId: Number(rec.subscriberId),
      articleIds: Array.isArray(rec.articleIds)
        ? rec.articleIds.map(String)
        : [],
      sentAt: new Date().toISOString(),
    };
    this.data.nlDeliveries.push(delivery);
    this._save();
    return delivery;
  }

  async nlDeliveriesForSubscriber(subscriberId) {
    return this.data.nlDeliveries.filter(
      (d) => d.subscriberId === Number(subscriberId)
    );
  }

  async nlCountDeliveries(campaignId) {
    return this.data.nlDeliveries.filter(
      (d) => d.campaignId === Number(campaignId)
    ).length;
  }

  /* -------- Newsletter: outbox -------- */

  async nlAddOutbox(rec) {
    const row = {
      id: nextNumericId(this.data.nlOutbox),
      to: String((rec && rec.to) || ''),
      subject: String((rec && rec.subject) || ''),
      html: String((rec && rec.html) || ''),
      text: String((rec && rec.text) || ''),
      kind: String((rec && rec.kind) || 'campaign'),
      status: String((rec && rec.status) || 'queued'),
      providerId: String((rec && rec.providerId) || ''),
      createdAt: new Date().toISOString(),
    };
    this.data.nlOutbox.push(row);
    this._save();
    return row;
  }

  async nlListOutbox(limit = 50) {
    return this.data.nlOutbox
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  /**
   * Every stored article, newest first, without the Opinion part
   * of the hidden-article read filter (retracted stories stay
   * excluded: they must never be emailed). Internal use only
   * (digest matching, where Opinion is included for subscribers
   * who opted into the Opinion topic); public pages keep using
   * listArticles/getArticle.
   */
  async listArticlesAll({ limit = 500 } = {}) {
    return this.data.articles
      .filter((a) => a && !RETRACTED_SLUGS.has(a.slug))
      .slice()
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, limit)
      .map((a) => Object.assign({}, a));
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
    // Newsletter tables (2026-11-12, additive only). One row per
    // email address carries every subscription preference; the
    // unique index on lower(email) keeps the address unique
    // case-insensitively. Campaigns are unique on (type, send_date)
    // so a day's brief or digest can never be created twice.
    // Deliveries record which articles went to which subscriber so
    // no article is ever sent to the same person twice. The outbox
    // is the send log, and the delivery mechanism itself until
    // Amazon SES credentials are configured.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL DEFAULT '',
        last_name TEXT NOT NULL DEFAULT '',
        zip_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        confirmed_at TIMESTAMPTZ,
        signup_date TIMESTAMPTZ NOT NULL DEFAULT now(),
        signup_source TEXT NOT NULL DEFAULT 'web',
        last_pref_update TIMESTAMPTZ,
        daily_brief BOOLEAN NOT NULL DEFAULT false,
        topics JSONB NOT NULL DEFAULT '[]'::jsonb,
        regions JSONB NOT NULL DEFAULT '[]'::jsonb,
        digest_frequency TEXT NOT NULL DEFAULT 'off',
        breaking_opt_in BOOLEAN NOT NULL DEFAULT false,
        paused BOOLEAN NOT NULL DEFAULT false,
        unsubscribed_at TIMESTAMPTZ,
        suppressed BOOLEAN NOT NULL DEFAULT false,
        consent JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_digest_at TIMESTAMPTZ
      )`);
    // Added 2026-11-12: optional last name + ZIP on the subscribe form.
    await this.pool.query(
      "ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''"
    );
    await this.pool.query(
      "ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS zip_code TEXT NOT NULL DEFAULT ''"
    );
    await this.pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_lower_key ON subscribers (lower(email))'
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        send_date TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        stats JSONB NOT NULL DEFAULT '{}'::jsonb,
        article_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        around_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        podcast JSONB,
        sponsor_name TEXT NOT NULL DEFAULT '',
        sponsor_message TEXT NOT NULL DEFAULT '',
        sponsor_url TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        sent_at TIMESTAMPTZ,
        UNIQUE (type, send_date)
      )`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
        article_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS deliveries_subscriber_idx ON deliveries (subscriber_id)'
    );
    await this.pool.query(
      'CREATE INDEX IF NOT EXISTS deliveries_campaign_idx ON deliveries (campaign_id)'
    );
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS email_outbox (
        id SERIAL PRIMARY KEY,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        html TEXT NOT NULL DEFAULT '',
        text_body TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'campaign',
        status TEXT NOT NULL DEFAULT 'queued',
        provider_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // One-time, idempotent migration: legacy briefing_subscribers
    // become confirmed Daily Brief subscribers. Rows already
    // migrated are skipped by the unique index.
    await this.pool.query(`
      INSERT INTO subscribers
        (email, status, confirmed_at, signup_date, signup_source, daily_brief, consent)
      SELECT bs.email, 'confirmed', bs.created_at, bs.created_at,
             'legacy-briefing', true,
             jsonb_build_object('at', bs.created_at, 'source', 'legacy-briefing', 'ip', '')
      FROM briefing_subscribers bs
      ON CONFLICT (lower(email)) DO NOTHING`);
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
          WHERE slug = $1 AND last_reviewed LIKE $3`,
        [slug, reviewed, EXPLAINED_REVIEW_SHIFTED + '%']
      );
    }
    // Owner-ordered backdates (see BACKDATE_EXPLAINED_2026 above):
    // lands only while the stored publication date is still Nov 8.
    for (const [slug, target] of Object.entries(BACKDATE_EXPLAINED_2026)) {
      await this.pool.query(
        `UPDATE articles SET published_at = $2, last_reviewed = $3
          WHERE slug = $1 AND published_at::text LIKE '2026-11-08%'`,
        [slug, target.publishedAt, target.lastReviewed]
      );
    }
    // Part Two restructure (see PART_TWO_SECTIONS above): swap the
    // sections only while the stored article still has the
    // fragment structure (more than 40 paragraphs in total).
    const p2Row = await this.pool.query(
      'SELECT sections FROM articles WHERE slug = $1',
      [PART_TWO_SLUG]
    );
    if (p2Row.rows.length) {
      const secs =
        typeof p2Row.rows[0].sections === 'string'
          ? JSON.parse(p2Row.rows[0].sections)
          : p2Row.rows[0].sections || [];
      const paraCount = secs.reduce(
        (n, s) => n + 1 + ((s && s.paragraphs) || []).length,
        0
      );
      if (paraCount > 40) {
        await this.pool.query(
          'UPDATE articles SET sections = $2 WHERE slug = $1',
          [PART_TWO_SLUG, JSON.stringify(PART_TWO_SECTIONS)]
        );
      }
    }
    // Water litigation revision (see WATER_LITIGATION_SECTIONS
    // above): same guarded swap as the file store's.
    const wRow = await this.pool.query(
      'SELECT sections, sources FROM articles WHERE slug = $1',
      [WATER_SLUG]
    );
    if (wRow.rows.length) {
      const wSecs =
        typeof wRow.rows[0].sections === 'string'
          ? JSON.parse(wRow.rows[0].sections)
          : wRow.rows[0].sections || [];
      const wText = wSecs
        .flatMap((s) => [s.heading, s.lead, ...((s && s.paragraphs) || [])])
        .join(' ');
      if (!wText.includes('Perkins County Canal')) {
        const wSources =
          typeof wRow.rows[0].sources === 'string'
            ? JSON.parse(wRow.rows[0].sources)
            : wRow.rows[0].sources || [];
        const have = new Set(wSources.map((s) => s.url));
        const merged = wSources.concat(
          WATER_LITIGATION_SOURCES.filter((s) => !have.has(s.url))
        );
        await this.pool.query(
          'UPDATE articles SET sections = $2, sources = $3, last_reviewed = $4 WHERE slug = $1',
          [WATER_SLUG, JSON.stringify(WATER_LITIGATION_SECTIONS), JSON.stringify(merged), '2026-11-08']
        );
      }
    }
    // Colorado Life retirement (owner order, 2026-11-08): same
    // one-article move as the file store's.
    await this.pool.query(
      "UPDATE articles SET section = 'local' WHERE slug = $1 AND section = 'colorado-life'",
      ['colorado-ski-season-lifts-off-as-resorts-open-through-december-401vd']
    );
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
    // One-time, idempotent Why It Matters for the donor-problem
    // article (see DONOR_WHY_2026 above): lands only while the
    // stored field is empty, so later boots change nothing.
    await this.pool.query(
      "UPDATE articles SET why_it_matters = $2 WHERE slug = $1 AND COALESCE(why_it_matters, '') = ''",
      [DONOR_WHY_2026.slug, DONOR_WHY_2026.whyItMatters]
    );
    // Internal cross-links (see INTERNAL_LINKS_2026_11_09 above):
    // read each named row, wrap the anchor phrases in its section
    // text, and write back only the rows that changed.
    const linkSlugs = [
      ...new Set(INTERNAL_LINKS_2026_11_09.map((l) => l.slug)),
    ];
    const linkRows = await this.pool.query(
      'SELECT slug, sections FROM articles WHERE slug = ANY($1)',
      [linkSlugs]
    );
    for (const row of linkRows.rows) {
      const probe = {
        slug: row.slug,
        sections:
          typeof row.sections === 'string'
            ? JSON.parse(row.sections)
            : row.sections || [],
      };
      if (applyInternalLinks(probe)) {
        await this.pool.query(
          'UPDATE articles SET sections = $2 WHERE slug = $1',
          [row.slug, JSON.stringify(probe.sections)]
        );
      }
    }
    // One-time, idempotent series rename (owner order, 2026-11-08):
    // "Colorado Explained" became "How Colorado Works"; the WHERE
    // guard keeps later boots from changing anything.
    await this.pool.query(
      "UPDATE articles SET series = 'How Colorado Works' WHERE series = 'Colorado Explained'"
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
   * Same contract as the file store's fillLastReviewed: set ONLY
   * last_reviewed, only when the incoming date differs from the
   * stored one. Returns true when a row changed.
   */
  async fillLastReviewed(slug, value) {
    const v = String(value || '').trim();
    if (!v) return false;
    const res = await this.pool.query(
      `UPDATE articles SET last_reviewed = $2
        WHERE slug = $1 AND COALESCE(last_reviewed, '') <> $2
        RETURNING slug`,
      [slug, v]
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
    const row = this._row(res.rows[0]);
    return row && row.section !== 'opinion' ? row : null;
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
    // Opinion and Satire are not public (owner order, 2026-11-08;
    // see isHiddenArticle above).
    where.push("section <> 'opinion'");
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
      ? await this.pool.query(
          "SELECT COUNT(*)::int AS n FROM articles WHERE slug <> ALL($1) AND section <> 'opinion'",
          [[...RETRACTED_SLUGS]]
        )
      : await this.pool.query("SELECT COUNT(*)::int AS n FROM articles WHERE section <> 'opinion'");
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

  /* -------- Newsletter: subscribers -------- */

  async nlFindSubscriberByEmail(email) {
    const e = String(email || '').toLowerCase().trim();
    const q = await this.pool.query(
      'SELECT * FROM subscribers WHERE lower(email) = $1 LIMIT 1',
      [e]
    );
    return pgSubscriberRowToRecord(q.rows[0]);
  }

  async nlGetSubscriber(id) {
    const q = await this.pool.query('SELECT * FROM subscribers WHERE id = $1', [
      Number(id),
    ]);
    return pgSubscriberRowToRecord(q.rows[0]);
  }

  async nlInsertSubscriber(rec) {
    const r = normalizeSubscriberRecord(rec);
    const q = await this.pool.query(
      `INSERT INTO subscribers
         (email, first_name, last_name, zip_code, status, confirmed_at, signup_date, signup_source,
          last_pref_update, daily_brief, topics, regions, digest_frequency,
          breaking_opt_in, paused, unsubscribed_at, suppressed, consent,
          last_digest_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        r.email,
        r.firstName,
        r.lastName,
        r.zipCode,
        r.status,
        r.confirmedAt,
        r.signupDate,
        r.signupSource,
        r.lastPrefUpdate,
        r.dailyBrief,
        JSON.stringify(r.topics),
        JSON.stringify(r.regions),
        r.digestFrequency,
        r.breakingOptIn,
        r.paused,
        r.unsubscribedAt,
        r.suppressed,
        JSON.stringify(r.consent),
        r.lastDigestAt,
      ]
    );
    return pgSubscriberRowToRecord(q.rows[0]);
  }

  async nlUpdateSubscriber(id, patch) {
    const current = await this.nlGetSubscriber(id);
    if (!current) return null;
    const r = normalizeSubscriberRecord(
      Object.assign({}, current, patch),
      current.id
    );
    const q = await this.pool.query(
      `UPDATE subscribers SET
         email = $1, first_name = $2, last_name = $3, zip_code = $4,
         status = $5, confirmed_at = $6,
         signup_date = $7, signup_source = $8, last_pref_update = $9,
         daily_brief = $10, topics = $11, regions = $12,
         digest_frequency = $13, breaking_opt_in = $14, paused = $15,
         unsubscribed_at = $16, suppressed = $17, consent = $18,
         last_digest_at = $19
       WHERE id = $20
       RETURNING *`,
      [
        r.email,
        r.firstName,
        r.lastName,
        r.zipCode,
        r.status,
        r.confirmedAt,
        r.signupDate,
        r.signupSource,
        r.lastPrefUpdate,
        r.dailyBrief,
        JSON.stringify(r.topics),
        JSON.stringify(r.regions),
        r.digestFrequency,
        r.breakingOptIn,
        r.paused,
        r.unsubscribedAt,
        r.suppressed,
        JSON.stringify(r.consent),
        r.lastDigestAt,
        current.id,
      ]
    );
    return pgSubscriberRowToRecord(q.rows[0]);
  }

  async nlListSubscribers() {
    const q = await this.pool.query('SELECT * FROM subscribers ORDER BY id ASC');
    return q.rows.map(pgSubscriberRowToRecord);
  }

  /* -------- Newsletter: campaigns -------- */

  async nlInsertCampaign(rec) {
    const r = normalizeCampaignRecord(rec);
    const q = await this.pool.query(
      `INSERT INTO campaigns
         (type, send_date, subject, status, stats, article_ids, around_ids,
          podcast, sponsor_name, sponsor_message, sponsor_url, created_at, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (type, send_date) DO NOTHING
       RETURNING *`,
      [
        r.type,
        r.sendDate,
        r.subject,
        r.status,
        JSON.stringify(r.stats),
        JSON.stringify(r.articleIds),
        JSON.stringify(r.aroundIds),
        r.podcast ? JSON.stringify(r.podcast) : null,
        r.sponsorName,
        r.sponsorMessage,
        r.sponsorUrl,
        r.createdAt,
        r.sentAt,
      ]
    );
    if (q.rows[0]) return pgCampaignRowToRecord(q.rows[0]);
    return this.nlFindCampaign(r.type, r.sendDate);
  }

  async nlGetCampaign(id) {
    const q = await this.pool.query('SELECT * FROM campaigns WHERE id = $1', [
      Number(id),
    ]);
    return pgCampaignRowToRecord(q.rows[0]);
  }

  async nlFindCampaign(type, sendDate) {
    const q = await this.pool.query(
      'SELECT * FROM campaigns WHERE type = $1 AND send_date = $2 LIMIT 1',
      [type, sendDate]
    );
    return pgCampaignRowToRecord(q.rows[0]);
  }

  async nlUpdateCampaign(id, patch) {
    const current = await this.nlGetCampaign(id);
    if (!current) return null;
    const r = normalizeCampaignRecord(
      Object.assign({}, current, patch),
      current.id
    );
    const q = await this.pool.query(
      `UPDATE campaigns SET
         type = $1, send_date = $2, subject = $3, status = $4, stats = $5,
         article_ids = $6, around_ids = $7, podcast = $8, sponsor_name = $9,
         sponsor_message = $10, sponsor_url = $11, created_at = $12, sent_at = $13
       WHERE id = $14
       RETURNING *`,
      [
        r.type,
        r.sendDate,
        r.subject,
        r.status,
        JSON.stringify(r.stats),
        JSON.stringify(r.articleIds),
        JSON.stringify(r.aroundIds),
        r.podcast ? JSON.stringify(r.podcast) : null,
        r.sponsorName,
        r.sponsorMessage,
        r.sponsorUrl,
        r.createdAt,
        r.sentAt,
        current.id,
      ]
    );
    return pgCampaignRowToRecord(q.rows[0]);
  }

  async nlListCampaigns(limit = 50) {
    const q = await this.pool.query(
      'SELECT * FROM campaigns ORDER BY id DESC LIMIT $1',
      [limit]
    );
    return q.rows.map(pgCampaignRowToRecord);
  }

  /* -------- Newsletter: deliveries -------- */

  async nlInsertDelivery(rec) {
    const q = await this.pool.query(
      `INSERT INTO deliveries (campaign_id, subscriber_id, article_ids)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        Number(rec.campaignId),
        Number(rec.subscriberId),
        JSON.stringify(
          Array.isArray(rec.articleIds) ? rec.articleIds.map(String) : []
        ),
      ]
    );
    const row = q.rows[0];
    return {
      id: row.id,
      campaignId: row.campaign_id,
      subscriberId: row.subscriber_id,
      articleIds: Array.isArray(row.article_ids) ? row.article_ids : [],
      sentAt: pgIso(row.sent_at) || new Date().toISOString(),
    };
  }

  async nlDeliveriesForSubscriber(subscriberId) {
    const q = await this.pool.query(
      'SELECT * FROM deliveries WHERE subscriber_id = $1 ORDER BY id ASC',
      [Number(subscriberId)]
    );
    return q.rows.map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      subscriberId: row.subscriber_id,
      articleIds: Array.isArray(row.article_ids) ? row.article_ids : [],
      sentAt: pgIso(row.sent_at) || '',
    }));
  }

  async nlCountDeliveries(campaignId) {
    const q = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM deliveries WHERE campaign_id = $1',
      [Number(campaignId)]
    );
    return q.rows[0].n;
  }

  /* -------- Newsletter: outbox -------- */

  async nlAddOutbox(rec) {
    const q = await this.pool.query(
      `INSERT INTO email_outbox
         (to_email, subject, html, text_body, kind, status, provider_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        String((rec && rec.to) || ''),
        String((rec && rec.subject) || ''),
        String((rec && rec.html) || ''),
        String((rec && rec.text) || ''),
        String((rec && rec.kind) || 'campaign'),
        String((rec && rec.status) || 'queued'),
        String((rec && rec.providerId) || ''),
      ]
    );
    return pgOutboxRowToRecord(q.rows[0]);
  }

  async nlListOutbox(limit = 50) {
    const q = await this.pool.query(
      'SELECT * FROM email_outbox ORDER BY id DESC LIMIT $1',
      [limit]
    );
    return q.rows.map(pgOutboxRowToRecord);
  }

  /**
   * Every stored article, newest first, without the Opinion part
   * of the hidden-article read filter (retracted stories stay
   * excluded: they must never be emailed). Internal use only
   * (digest matching, where Opinion is included for subscribers
   * who opted into the Opinion topic); public pages keep using
   * listArticles/getArticle.
   */
  async listArticlesAll({ limit = 500 } = {}) {
    const res = RETRACTED_SLUGS.size
      ? await this.pool.query(
          'SELECT * FROM articles WHERE slug <> ALL($1) ORDER BY published_at DESC LIMIT $2',
          [[...RETRACTED_SLUGS], limit]
        )
      : await this.pool.query(
          'SELECT * FROM articles ORDER BY published_at DESC LIMIT $1',
          [limit]
        );
    return res.rows.map((r) => this._row(r)).filter(Boolean);
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
