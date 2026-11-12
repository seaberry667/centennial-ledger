'use strict';
/**
 * End-to-end test for the newsletter system (2026-11-12).
 *
 * Boots the real Express app on a scratch port against the LOCAL
 * FILE STORE (DATABASE_URL is cleared, so data/db.json is used).
 * The existing db.json is backed up first and restored at the end,
 * pass or fail. Exercises, over HTTP wherever a route exists:
 *
 *  (a) full-form subscribe -> pending subscriber + confirmation
 *      email waiting in the outbox
 *  (b) confirm via the emailed token -> confirmed
 *  (c) duplicate subscribe -> still one row, still confirmed
 *  (d) preference-center token page loads; topic/region/frequency
 *      changes save
 *  (e) unsubscribe -> suppressed; re-subscribe stays pending until
 *      re-confirmed
 *  (f) legacy POST /briefing keeps its redirects and creates a
 *      subscriber in the new system
 *  (g) brief draft generation yields a campaign with the seeded
 *      articles (seeded through the real ingest endpoint)
 *  (h) digest builder: combined-email rule (brief stories left out
 *      for brief subscribers) and never-send-twice (deliveries)
 *
 * Run: node scripts/test-newsletter.js   (exit 0 = all pass)
 */

const fs = require('fs');
const path = require('path');

// Test environment, set before the app (and its store) load.
delete process.env.DATABASE_URL;
process.env.INGEST_SECRET = 'test-ingest-secret';
process.env.SUBSCRIBE_SIGNING_SECRET = 'test-signing-secret';
process.env.NEWSLETTER_ADMIN_SECRET = 'test-admin-secret';
process.env.NEWSLETTER_TEST_EMAIL = 'editor@example.com';
process.env.SITE_URL = 'http://localhost';
delete process.env.NEWSLETTER_AUTOSEND;

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const backupPath = dbPath + '.newsletter-test-backup';
const hadDb = fs.existsSync(dbPath);
if (hadDb) fs.copyFileSync(dbPath, backupPath);

let failures = 0;
let checks = 0;
function check(name, cond, extra) {
  checks += 1;
  if (cond) {
    console.log('PASS  ' + name);
  } else {
    failures += 1;
    console.log('FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

const ADMIN = 'test-admin-secret';
let base = '';

async function req(method, urlPath, opts) {
  const o = opts || {};
  const init = { method, redirect: 'manual', headers: {} };
  if (o.form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(o.form).toString();
  }
  if (o.json) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(o.json);
  }
  if (o.headers) Object.assign(init.headers, o.headers);
  const res = await fetch(base + urlPath, init);
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location') || '', text };
}

function subByEmail(db, email) {
  return (db.nlSubscribers || []).find((s) => s.email === email) || null;
}

async function main() {
  const app = require('../src/server');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = 'http://127.0.0.1:' + server.address().port;

  try {
    /* ---- seed articles through the real ingest endpoint ---- */
    const nowIso = new Date().toISOString();
    const seed = [
      {
        headline: 'State board weighs new property tax guidance for counties',
        dek: 'The state board took up new guidance on how counties value homes. The change could shift tax bills in fast growing areas next year.',
        section: 'Politics',
        region: '',
        publishedAt: nowIso,
        sections: [{ heading: '', lead: 'The state board took up new guidance on how counties value homes.', paragraphs: ['Members said the change could shift tax bills in fast growing areas next year.'] }],
        sources: [{ name: 'State of Colorado', url: 'https://www.colorado.gov' }],
      },
      {
        headline: 'Fort Collins council approves new funding for neighborhood parks',
        dek: 'The Fort Collins City Council voted to add money for neighborhood parks. The plan covers repairs in the north part of the city first.',
        section: 'Local News',
        region: 'Northern Colorado',
        publishedAt: nowIso,
        sections: [{ heading: '', lead: 'The Fort Collins City Council voted to add money for neighborhood parks.', paragraphs: ['The plan covers repairs in the north part of the city first.'] }],
        sources: [{ name: 'City of Fort Collins', url: 'https://www.fcgov.com' }],
      },
      {
        headline: 'Weld County wells draw a new round of state review',
        dek: 'State regulators opened a new review of oil and gas wells in Weld County. Operators say the review could slow permits this winter.',
        section: 'Energy & Environment',
        region: '',
        publishedAt: nowIso,
        sections: [{ heading: '', lead: 'State regulators opened a new review of oil and gas wells in Weld County.', paragraphs: ['Operators say the review could slow permits this winter.'] }],
        sources: [{ name: 'Colorado Energy Office', url: 'https://energyoffice.colorado.gov' }],
      },
    ];
    const ingest = await req('POST', '/api/ingest', {
      json: { articles: seed },
      headers: { 'x-ingest-secret': 'test-ingest-secret' },
    });
    check('seed: ingest accepted', ingest.status === 200, 'status ' + ingest.status);
    const politicsSlug = 'state-board-weighs-new-property-tax-guidance-for-counties';

    /* ---- (a) full-form subscribe ---- */
    const sub1 = await req('POST', '/subscribe', {
      form: {
        email: 'reader@example.com',
        first_name: 'Robin',
        daily_brief: 'on',
        topics: 'politics',
        regions: 'northern-colorado',
        source: 'subscribe-page',
      },
    });
    check('(a) subscribe redirects to sent', sub1.status === 302 && sub1.location.startsWith('/subscribe?sent=1'), sub1.location);
    let db = readDb();
    let reader = subByEmail(db, 'reader@example.com');
    check('(a) subscriber row created, pending', !!reader && reader.status === 'pending');
    check('(a) preferences stored', !!reader && reader.dailyBrief === true && reader.topics.includes('politics') && reader.regions.includes('northern-colorado'));
    check('(a) digest frequency defaults to daily with topics', !!reader && reader.digestFrequency === 'daily');
    const confirmMail = (db.nlOutbox || []).find(
      (o) => o.to === 'reader@example.com' && o.kind === 'confirmation'
    );
    check('(a) confirmation email is in the outbox', !!confirmMail && confirmMail.subject === 'Confirm your subscription to The Centennial Ledger');
    const confirmToken = confirmMail && (confirmMail.html.match(/\/confirm\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/) || [])[1];
    const prefsToken = confirmMail && (confirmMail.html.match(/\/preferences\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/) || [])[1];
    check('(a) confirmation email carries confirm and preferences links', !!confirmToken && !!prefsToken);

    /* ---- (b) confirm via token ---- */
    const conf = await req('GET', '/confirm/' + confirmToken);
    check('(b) confirm page loads', conf.status === 200 && conf.text.includes('Subscription confirmed'));
    db = readDb();
    reader = subByEmail(db, 'reader@example.com');
    check('(b) subscriber is confirmed with a timestamp', !!reader && reader.status === 'confirmed' && !!reader.confirmedAt);

    /* ---- (c) duplicate subscribe ---- */
    await req('POST', '/subscribe', {
      form: { email: 'reader@example.com', first_name: 'Changed', daily_brief: 'on' },
    });
    db = readDb();
    const rowsForReader = (db.nlSubscribers || []).filter((s) => s.email === 'reader@example.com');
    check('(c) duplicate subscribe makes no second row', rowsForReader.length === 1);
    check('(c) confirmed subscriber is untouched by the form', rowsForReader[0].status === 'confirmed' && rowsForReader[0].firstName === 'Robin');

    /* ---- (d) preference center ---- */
    const prefPage = await req('GET', '/preferences/' + prefsToken);
    check('(d) preferences page loads from the token', prefPage.status === 200 && prefPage.text.includes('Your Email Preferences'));
    check('(d) saved topic shows checked', prefPage.text.includes('value="politics" checked'));
    const save = await req('POST', '/preferences/' + prefsToken, {
      form: {
        first_name: 'Robin',
        daily_brief: 'on',
        topics: 'energy-environment',
        regions: 'northern-colorado',
        digest_frequency: 'weekly',
        breaking: 'on',
      },
    });
    check('(d) save redirects back with saved flag', save.status === 302 && save.location.includes('saved=1'), save.location);
    db = readDb();
    reader = subByEmail(db, 'reader@example.com');
    check('(d) changes saved', !!reader && reader.topics.join(',') === 'energy-environment' && reader.digestFrequency === 'weekly' && reader.breakingOptIn === true);

    /* ---- (e) unsubscribe, suppression, re-subscribe ---- */
    const unsub = await req('POST', '/preferences/' + prefsToken + '/unsubscribe');
    check('(e) unsubscribe from the preference center works', unsub.status === 200 && unsub.text.includes('unsubscribed'));
    db = readDb();
    reader = subByEmail(db, 'reader@example.com');
    check('(e) status unsubscribed and suppressed', !!reader && reader.status === 'unsubscribed' && reader.suppressed === true);
    await req('POST', '/subscribe', {
      form: { email: 'reader@example.com', daily_brief: 'on' },
    });
    db = readDb();
    reader = subByEmail(db, 'reader@example.com');
    check('(e) re-subscribe returns to pending, not confirmed', !!reader && reader.status === 'pending' && reader.suppressed === true);

    /* ---- (f) legacy POST /briefing ---- */
    const briefOk = await req('POST', '/briefing', {
      form: { email: 'briefingfan@example.com', source: 'footer' },
    });
    check('(f) valid briefing signup redirects to thanks', briefOk.status === 302 && briefOk.location === '/?briefing=thanks', briefOk.location);
    db = readDb();
    const fan = subByEmail(db, 'briefingfan@example.com');
    check('(f) subscriber created in the new system', !!fan && fan.dailyBrief === true && fan.status === 'pending' && fan.signupSource === 'footer');
    const briefBad = await req('POST', '/briefing', { form: { email: 'not-an-email' } });
    check('(f) invalid briefing signup redirects to invalid', briefBad.status === 302 && briefBad.location === '/?briefing=invalid', briefBad.location);

    /* ---- one-click unsubscribe route (List-Unsubscribe target) ---- */
    const tokens = require('../src/tokens');
    const unsubToken = tokens.signToken('unsub', { sub: fan.id }, tokens.TTL.unsub);
    const unsubPage = await req('GET', '/unsubscribe/' + unsubToken);
    check('unsubscribe GET shows a confirm page', unsubPage.status === 200 && unsubPage.text.includes('Unsubscribe Me'));
    const unsubPost = await req('POST', '/unsubscribe/' + unsubToken, {
      form: { 'List-Unsubscribe': 'One-Click' },
    });
    db = readDb();
    const fanAfter = subByEmail(db, 'briefingfan@example.com');
    check('unsubscribe POST performs the unsubscribe', unsubPost.status === 200 && !!fanAfter && fanAfter.status === 'unsubscribed');

    /* ---- public pages and retired tiers ---- */
    const checkout = await req('GET', '/subscribe/checkout?tier=patriot');
    check('checkout URL 301-redirects to /subscribe', checkout.status === 301 && checkout.location === '/subscribe', checkout.status + ' ' + checkout.location);
    const subscribeGet = await req('GET', '/subscribe');
    check('/subscribe shows the free form heading', subscribeGet.status === 200 && subscribeGet.text.includes('Stay Informed. Stay Colorado.'));
    check('/subscribe no longer shows paid tiers', !subscribeGet.text.includes('Patriot') && !subscribeGet.text.includes('Founding'));
    check('/subscribe form carries topics and regions', subscribeGet.text.includes('name="topics"') && subscribeGet.text.includes('name="regions"'));
    const home = await req('GET', '/');
    check('homepage briefing box posts to the new system', home.status === 200 && home.text.includes('Free Weekday Newsletter') && home.text.includes('name="source" value="homepage"'));
    check('footer carries the compact form and preferences link', home.text.includes('Manage your email preferences') && home.text.includes('name="source" value="footer"'));
    const prefsLanding = await req('GET', '/preferences');
    check('/preferences landing loads', prefsLanding.status === 200 && prefsLanding.text.includes('Manage Your Email Preferences'));
    const privacy = await req('GET', '/privacy');
    check('privacy page names Amazon SES and the no-sale rule', privacy.text.includes('Amazon Simple Email Service') && privacy.text.includes('do not sell or share subscriber email addresses'));

    /* ---- admin gating ---- */
    const noKey = await req('GET', '/admin/newsletter');
    check('admin without the secret is forbidden', noKey.status === 403, 'status ' + noKey.status);
    const csv = await req('GET', '/admin/newsletter/export.csv?key=' + ADMIN);
    check('CSV export lists subscribers', csv.status === 200 && csv.text.includes('email,first_name,last_name,zip_code,status') && csv.text.includes('briefingfan@example.com'));

    /* ---- (g) draft generation ---- */
    const gen = await req('POST', '/admin/newsletter/generate?key=' + ADMIN, { form: {} });
    check('(g) generate action redirects to the dashboard', gen.status === 302, 'status ' + gen.status);
    db = readDb();
    const briefCampaign = (db.nlCampaigns || []).find((c) => c.type === 'brief');
    check('(g) a brief draft campaign exists', !!briefCampaign && briefCampaign.status === 'draft');
    check('(g) the draft holds the seeded stories', !!briefCampaign && briefCampaign.articleIds.length >= 2 && briefCampaign.articleIds.includes(politicsSlug), briefCampaign ? briefCampaign.articleIds.join(',') : 'none');
    const admin = await req('GET', '/admin/newsletter?key=' + ADMIN);
    check('(g) admin preview renders the seeded headline', admin.status === 200 && admin.text.includes('State board weighs new property tax guidance'));

    /* ---- (h) digest rules, driven through the module ---- */
    const { createStore } = require('../src/store');
    const newsletter = require('../src/newsletter');
    const mailer = require('../src/mailer');
    const store2 = await createStore();
    const mkSub = (email, dailyBrief) =>
      store2.nlInsertSubscriber({
        email,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        signupDate: new Date().toISOString(),
        signupSource: 'test',
        dailyBrief,
        topics: ['politics'],
        regions: [],
        digestFrequency: 'daily',
        consent: { at: new Date().toISOString(), source: 'test', ip: '' },
      });
    const digestOnly = await mkSub('digestonly@example.com', false);
    const briefAndDigest = await mkSub('both@example.com', true);
    // Next Monday (UTC math so the digest weekday gate opens).
    const dnow = new Date();
    const addDays = ((8 - dnow.getUTCDay()) % 7) || 7;
    const monday = new Date(Date.UTC(dnow.getUTCFullYear(), dnow.getUTCMonth(), dnow.getUTCDate() + addDays));
    const mondayStr = monday.toISOString().slice(0, 10);
    const fakeBrief = await store2.nlInsertCampaign({
      type: 'brief',
      sendDate: mondayStr,
      subject: 'test brief',
      status: 'sent',
      articleIds: [politicsSlug],
      aroundIds: [],
      stats: {},
    });
    const run1 = await newsletter.buildAndSendDigests(store2, mailer, mondayStr, fakeBrief);
    const d1 = await store2.nlDeliveriesForSubscriber(digestOnly.id);
    const digestDelivery1 = d1.find((x) => x.campaignId === run1.campaign.id);
    check('(h) digest-only subscriber receives the politics story', !!digestDelivery1 && digestDelivery1.articleIds.includes(politicsSlug));
    const d2 = await store2.nlDeliveriesForSubscriber(briefAndDigest.id);
    check('(h) combined-email rule: brief subscriber digest skips the brief story', !d2.some((x) => x.campaignId === run1.campaign.id));
    // Second run on a later Monday, window reopened: only the
    // deliveries record can keep the story out now.
    await store2.nlUpdateSubscriber(digestOnly.id, { lastDigestAt: null });
    const monday2 = new Date(monday.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const run2 = await newsletter.buildAndSendDigests(store2, mailer, monday2, null);
    const d1After = await store2.nlDeliveriesForSubscriber(digestOnly.id);
    check(
      '(h) an article is never sent to the same subscriber twice',
      !d1After.some((x) => x.campaignId === run2.campaign.id)
    );
  } finally {
    server.close();
  }
}

const watchdog = setTimeout(() => {
  console.error('TIMEOUT: test did not finish in 120 seconds');
  process.exit(2);
}, 120000);

main()
  .catch((err) => {
    failures += 1;
    console.error('ERROR', err);
  })
  .finally(() => {
    clearTimeout(watchdog);
    try {
      if (hadDb) {
        fs.copyFileSync(backupPath, dbPath);
        fs.unlinkSync(backupPath);
      } else if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (e) {
      console.error('restore failed:', e.message);
    }
    console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
    process.exit(failures ? 1 : 0);
  });
