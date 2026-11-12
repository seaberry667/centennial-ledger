'use strict';
/**
 * Newsletter engine for The Centennial Ledger.
 *
 * Holds everything the routes in server.js should not have to
 * know: the double opt-in signup flow, signed-link handling for
 * confirmation / preferences / unsubscribe / email change, the
 * Daily Brief and personalized digest builders, campaign sending
 * with per-subscriber delivery records, and the email templates.
 *
 * All sends go through src/mailer.js (Amazon SES when configured,
 * the outbox table otherwise). Subscriber identity is one row per
 * email address in the store's subscribers table.
 */

const { SECTIONS, REGIONS, slugify } = require('./store');
const tokens = require('./tokens');
const { siteUrl } = require('./render');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PODCAST_FEED_URL =
  'https://feeds.transistor.fm/the-colorado-morning-brief-u76b2e7cdf766288e';
const POSTAL_PLACEHOLDER = '[MAILING ADDRESS — set NEWSLETTER_POSTAL_ADDRESS]';

const SECTION_SLUGS = new Set(SECTIONS.map((s) => s.slug));
const REGION_SLUGS = new Set(REGIONS.map((r) => r.slug));

function isValidEmail(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function validTopics(input) {
  const arr = Array.isArray(input) ? input : input ? [input] : [];
  return [
    ...new Set(
      arr.map((s) => String(s || '').trim()).filter((s) => SECTION_SLUGS.has(s))
    ),
  ];
}

function validRegions(input) {
  const arr = Array.isArray(input) ? input : input ? [input] : [];
  return [
    ...new Set(
      arr.map((s) => String(s || '').trim()).filter((s) => REGION_SLUGS.has(s))
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Denver time helpers                                                 */
/* ------------------------------------------------------------------ */

function denverParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return parts;
}

/** 'YYYY-MM-DD' for the Denver calendar day containing `date`. */
function denverDateString(date) {
  const p = denverParts(date || new Date());
  return p.year + '-' + p.month + '-' + p.day;
}

/** 'Friday, November 13, 2026' for a Denver date string. */
function denverDateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** 0 (Sunday) to 6 (Saturday) for a Denver date string. */
function denverWeekdayOf(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/* ------------------------------------------------------------------ */
/* Signed links                                                        */
/* ------------------------------------------------------------------ */

function confirmUrlFor(sub) {
  return (
    siteUrl() +
    '/confirm/' +
    tokens.signToken('confirm', { sub: sub.id }, tokens.TTL.confirm)
  );
}

function preferencesUrlFor(sub) {
  return (
    siteUrl() +
    '/preferences/' +
    tokens.signToken('prefs', { sub: sub.id }, tokens.TTL.prefs)
  );
}

function unsubscribeUrlFor(sub) {
  return (
    siteUrl() +
    '/unsubscribe/' +
    tokens.signToken('unsub', { sub: sub.id }, tokens.TTL.unsub)
  );
}

function subscriberLinks(sub) {
  return {
    preferences: preferencesUrlFor(sub),
    unsubscribe: unsubscribeUrlFor(sub),
  };
}

function listUnsubscribeHeaders(links) {
  return [
    { name: 'List-Unsubscribe', value: '<' + links.unsubscribe + '>' },
    { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
  ];
}

/* ------------------------------------------------------------------ */
/* Transactional email shell (confirmations, preference links)         */
/* ------------------------------------------------------------------ */

function postalLine() {
  return process.env.NEWSLETTER_POSTAL_ADDRESS || POSTAL_PLACEHOLDER;
}

function transactionalEmail(heading, bodyHtml, bodyText) {
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background-color:#F8F4EB;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F4EB;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#FFFFFF;border:1px solid #DED7C9;">' +
    '<tr><td style="padding:26px 36px 0;text-align:center;">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:bold;letter-spacing:2px;color:#102438;">THE CENTENNIAL LEDGER</div>' +
    '<div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#AA8548;margin-top:3px;">A Clear View of Colorado</div>' +
    '<div style="border-top:3px solid #981E24;margin:14px 0 0;"></div>' +
    '</td></tr>' +
    '<tr><td style="padding:22px 36px 8px;">' +
    '<h1 style="font-family:Georgia,serif;font-size:22px;color:#102438;margin:0 0 12px;">' +
    esc(heading) +
    '</h1>' +
    bodyHtml +
    '</td></tr>' +
    '<tr><td style="padding:16px 36px 26px;border-top:1px solid #DED7C9;">' +
    '<p style="font-family:Georgia,serif;font-size:12.5px;color:#666666;line-height:1.6;margin:0;">The Centennial Ledger, ' +
    esc(siteUrl().replace(/^https?:\/\//, '')) +
    '<br>' +
    esc(postalLine()) +
    '</p></td></tr>' +
    '</table></td></tr></table></body></html>';
  const text =
    'THE CENTENNIAL LEDGER\nA Clear View of Colorado\n\n' +
    heading +
    '\n\n' +
    bodyText +
    '\n\nThe Centennial Ledger, ' +
    siteUrl() +
    '\n' +
    postalLine() +
    '\n';
  return { html, text };
}

function emailButton(url, label) {
  return (
    '<p style="margin:18px 0;"><a href="' +
    esc(url) +
    '" style="display:inline-block;background-color:#981E24;color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 22px;">' +
    esc(label) +
    '</a></p>'
  );
}

function para(text) {
  return (
    '<p style="font-family:Georgia,serif;font-size:15.5px;line-height:1.55;color:#333333;margin:0 0 12px;">' +
    text +
    '</p>'
  );
}

/* ------------------------------------------------------------------ */
/* Signup, confirmation, preferences, unsubscribe                      */
/* ------------------------------------------------------------------ */

async function sendConfirmationEmail(store, mailer, sub) {
  const confirmUrl = confirmUrlFor(sub);
  const prefsUrl = preferencesUrlFor(sub);
  const greeting = sub.firstName ? 'Hello ' + esc(sub.firstName) + ',' : 'Hello,';
  const bodyHtml =
    para(greeting) +
    para(
      'Thank you for subscribing to The Centennial Ledger. Please confirm your email address so we can start sending your newsletters.'
    ) +
    emailButton(confirmUrl, 'Confirm my subscription') +
    para(
      'You can also set your topics and regions now, or any time later: <a href="' +
        esc(prefsUrl) +
        '" style="color:#981E24;">choose your topics and regions</a>.'
    ) +
    para('The confirmation link works for 7 days. If you did not sign up, you can ignore this email.');
  const bodyText =
    (sub.firstName ? 'Hello ' + sub.firstName + ',' : 'Hello,') +
    '\n\nThank you for subscribing to The Centennial Ledger. Please confirm your email address so we can start sending your newsletters.\n\nConfirm your subscription:\n' +
    confirmUrl +
    '\n\nYou can also set your topics and regions now, or any time later:\n' +
    prefsUrl +
    '\n\nThe confirmation link works for 7 days. If you did not sign up, you can ignore this email.';
  const { html, text } = transactionalEmail(
    'Confirm your subscription',
    bodyHtml,
    bodyText
  );
  return mailer.send(store, {
    to: sub.email,
    subject: 'Confirm your subscription to The Centennial Ledger',
    html,
    text,
    kind: 'confirmation',
  });
}

/**
 * The one signup path behind /subscribe, the compact forms, and
 * the legacy POST /briefing. Creates a pending subscriber (double
 * opt-in) and sends the confirmation email. A confirmed subscriber
 * who signs up again is left untouched (preference changes go
 * through the emailed preference link, so nobody can rewrite
 * someone else's subscription from a public form). An unsubscribed
 * or still-pending address goes back to pending and must confirm
 * again before anything is sent to it.
 */
async function subscribeSignup(store, mailer, opts) {
  const email = String((opts && opts.email) || '').toLowerCase().trim();
  if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
  const now = new Date().toISOString();
  const existing = await store.nlFindSubscriberByEmail(email);
  if (existing && existing.status === 'confirmed') {
    return { ok: true, subscriber: existing, created: false, alreadyConfirmed: true };
  }

  const keepPrefs =
    existing && opts.topics === undefined && opts.regions === undefined;
  const topics = keepPrefs ? existing.topics : validTopics(opts.topics);
  const regions = keepPrefs ? existing.regions : validRegions(opts.regions);
  let digestFrequency;
  if (['daily', 'weekly', 'off'].includes(opts.digestFrequency)) {
    digestFrequency = opts.digestFrequency;
  } else if (keepPrefs) {
    digestFrequency = existing.digestFrequency;
  } else {
    digestFrequency = topics.length || regions.length ? 'daily' : 'off';
  }
  const dailyBrief =
    opts.dailyBrief !== undefined
      ? !!opts.dailyBrief
      : existing
        ? existing.dailyBrief
        : false;
  const firstName =
    opts.firstName != null && String(opts.firstName).trim() !== ''
      ? String(opts.firstName).trim().slice(0, 80)
      : existing
        ? existing.firstName
        : '';
  const lastName =
    opts.lastName != null && String(opts.lastName).trim() !== ''
      ? String(opts.lastName).trim().slice(0, 80)
      : existing
        ? existing.lastName || ''
        : '';
  const zipCode =
    opts.zipCode != null && String(opts.zipCode).trim() !== ''
      ? String(opts.zipCode).trim().slice(0, 10)
      : existing
        ? existing.zipCode || ''
        : '';

  let sub;
  if (existing) {
    sub = await store.nlUpdateSubscriber(existing.id, {
      firstName,
      lastName,
      zipCode,
      status: 'pending',
      dailyBrief,
      topics,
      regions,
      digestFrequency,
      lastPrefUpdate: now,
      consent: { at: now, source: opts.source || 'web', ip: opts.ip || '' },
    });
  } else {
    sub = await store.nlInsertSubscriber({
      email,
      firstName,
      lastName,
      zipCode,
      status: 'pending',
      signupDate: now,
      signupSource: opts.source || 'web',
      dailyBrief,
      topics,
      regions,
      digestFrequency,
      consent: { at: now, source: opts.source || 'web', ip: opts.ip || '' },
    });
  }
  await sendConfirmationEmail(store, mailer, sub);
  return { ok: true, subscriber: sub, created: !existing };
}

/** Confirm a double opt-in. Returns the subscriber, or null. */
async function confirmSubscriber(store, tokenStr) {
  const payload = tokens.verifyToken(tokenStr, 'confirm');
  if (!payload) return null;
  const sub = await store.nlGetSubscriber(payload.sub);
  if (!sub) return null;
  if (sub.status === 'confirmed') return sub;
  return store.nlUpdateSubscriber(sub.id, {
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    suppressed: false,
    unsubscribedAt: null,
  });
}

/** Email a manage-preferences link. Returns false for unknown mail. */
async function requestPreferencesLink(store, mailer, email) {
  const sub = await store.nlFindSubscriberByEmail(
    String(email || '').toLowerCase().trim()
  );
  if (!sub) return false;
  const url = preferencesUrlFor(sub);
  const bodyHtml =
    para('Use the button below to manage your Centennial Ledger email subscriptions.') +
    emailButton(url, 'Manage my preferences') +
    para('The link works for 30 days. If you did not ask for it, you can ignore this email.');
  const bodyText =
    'Use the link below to manage your Centennial Ledger email subscriptions.\n\n' +
    url +
    '\n\nThe link works for 30 days. If you did not ask for it, you can ignore this email.';
  const { html, text } = transactionalEmail(
    'Manage your email preferences',
    bodyHtml,
    bodyText
  );
  await mailer.send(store, {
    to: sub.email,
    subject: 'Manage your Centennial Ledger email preferences',
    html,
    text,
    kind: 'preferences-link',
  });
  return true;
}

/** Resolve a preferences token to its subscriber, or null. */
async function subscriberForPrefsToken(store, tokenStr) {
  const payload = tokens.verifyToken(tokenStr, 'prefs');
  if (!payload) return null;
  return store.nlGetSubscriber(payload.sub);
}

/** Save preference-center changes. Takes effect immediately. */
async function savePreferences(store, sub, fields) {
  return store.nlUpdateSubscriber(sub.id, {
    firstName: String(fields.firstName || '').slice(0, 80),
    lastName: String(fields.lastName || '').slice(0, 80),
    zipCode: String(fields.zipCode || '').trim().slice(0, 10),
    dailyBrief: !!fields.dailyBrief,
    topics: validTopics(fields.topics),
    regions: validRegions(fields.regions),
    digestFrequency: ['off', 'daily', 'weekly'].includes(fields.digestFrequency)
      ? fields.digestFrequency
      : 'off',
    breakingOptIn: !!fields.breakingOptIn,
    paused: !!fields.paused,
    lastPrefUpdate: new Date().toISOString(),
  });
}

/** Unsubscribe a subscriber from everything and suppress the address. */
async function unsubscribeSubscriber(store, sub) {
  return store.nlUpdateSubscriber(sub.id, {
    status: 'unsubscribed',
    suppressed: true,
    unsubscribedAt: new Date().toISOString(),
    lastPrefUpdate: new Date().toISOString(),
  });
}

/** Resolve an unsubscribe token to its subscriber, or null. */
async function subscriberForUnsubToken(store, tokenStr) {
  const payload = tokens.verifyToken(tokenStr, 'unsub');
  if (!payload) return null;
  return store.nlGetSubscriber(payload.sub);
}

/**
 * Start an email-address change: the new address gets a
 * confirmation email and the change applies only when that link
 * is clicked, so the preference center can never be used to move
 * a subscription to an address the person does not control.
 */
async function startEmailChange(store, mailer, sub, newEmail) {
  const email = String(newEmail || '').toLowerCase().trim();
  if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
  if (email === sub.email) return { ok: false, error: 'same-email' };
  const other = await store.nlFindSubscriberByEmail(email);
  if (other && other.id !== sub.id) return { ok: false, error: 'email-in-use' };
  const url =
    siteUrl() +
    '/confirm-email/' +
    tokens.signToken('emailChange', { sub: sub.id, email }, tokens.TTL.emailChange);
  const bodyHtml =
    para('You asked to move your Centennial Ledger subscription to this email address.') +
    emailButton(url, 'Confirm the new address') +
    para('The link works for 7 days. If you did not ask for this change, you can ignore this email and nothing will change.');
  const bodyText =
    'You asked to move your Centennial Ledger subscription to this email address.\n\nConfirm the new address:\n' +
    url +
    '\n\nThe link works for 7 days. If you did not ask for this change, you can ignore this email and nothing will change.';
  const { html, text } = transactionalEmail(
    'Confirm your new email address',
    bodyHtml,
    bodyText
  );
  await mailer.send(store, {
    to: email,
    subject: 'Confirm your new email address for The Centennial Ledger',
    html,
    text,
    kind: 'email-change',
  });
  return { ok: true };
}

/** Apply an email change when the new address confirms. */
async function applyEmailChange(store, tokenStr) {
  const payload = tokens.verifyToken(tokenStr, 'emailChange');
  if (!payload || !payload.email) return null;
  const sub = await store.nlGetSubscriber(payload.sub);
  if (!sub) return null;
  const other = await store.nlFindSubscriberByEmail(payload.email);
  if (other && other.id !== sub.id) return null;
  const patch = {
    email: String(payload.email).toLowerCase(),
    lastPrefUpdate: new Date().toISOString(),
  };
  if (sub.status === 'pending') {
    patch.status = 'confirmed';
    patch.confirmedAt = new Date().toISOString();
    patch.suppressed = false;
    patch.unsubscribedAt = null;
  }
  return store.nlUpdateSubscriber(sub.id, patch);
}

/* ------------------------------------------------------------------ */
/* Article summaries and selection                                     */
/* ------------------------------------------------------------------ */

function plainText(s) {
  return String(s || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One to two plain sentences from the article's dek or lead. */
function summarize(article, maxLen) {
  const limit = maxLen || 280;
  let src = plainText(article.dek);
  if (!src && article.sections && article.sections[0]) {
    src = plainText(article.sections[0].lead);
  }
  if (!src) return '';
  const sentences = src.match(/[^.!?]+[.!?]+/g);
  let out = src;
  if (sentences && sentences.length) {
    out = sentences.slice(0, 2).join(' ').trim();
  }
  if (out.length > limit) {
    out = out.slice(0, limit).replace(/\s+\S*$/, '') + '...';
  }
  return out;
}

function articleUrl(a) {
  return siteUrl() + '/article/' + a.slug;
}

/* ------------------------------------------------------------------ */
/* Podcast feed (Transistor RSS), cached in memory                     */
/* ------------------------------------------------------------------ */

let podcastCache = { at: 0, episode: null };

function xmlTag(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * The newest podcast episode as { title, url, denverDate }, or
 * null. Cached for 15 minutes so the scheduler and admin preview
 * never hammer the feed; a fetch failure simply omits the block.
 */
async function getPodcastEpisode() {
  const now = Date.now();
  if (podcastCache.at && now - podcastCache.at < 15 * 60 * 1000) {
    return podcastCache.episode;
  }
  let episode = null;
  try {
    const res = await fetch(PODCAST_FEED_URL, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'CentennialLedgerNewsletter/1.0' },
    });
    if (res.ok) {
      const xml = await res.text();
      const item = xml.match(/<item>([\s\S]*?)<\/item>/);
      if (item) {
        const title = xmlTag(item[1], 'title');
        const link = xmlTag(item[1], 'link');
        const pub = xmlTag(item[1], 'pubDate');
        const when = pub ? new Date(pub) : null;
        if (when && !isNaN(when.getTime())) {
          episode = {
            title: title || 'The Colorado Daily Brief',
            url: link || siteUrl(),
            denverDate: denverDateString(when),
          };
        }
      }
    }
  } catch {
    episode = null;
  }
  podcastCache = { at: now, episode };
  return episode;
}

/* ------------------------------------------------------------------ */
/* Daily Brief assembly                                                */
/* ------------------------------------------------------------------ */

/**
 * Pick the brief's stories from the last ~36 hours: most recent
 * first, at most two per section (relaxed to three only when that
 * is the only way to reach five stories), five to eight stories,
 * never padded. "Around Colorado" takes up to three stories not
 * already used, most recent first: Local stories plus topic-section
 * stories that carry a region (dual categorization — owner decision
 * 2026-11-12: region-carrying topic stories belong in Around
 * Colorado alongside pure-Local stories).
 */
function selectBriefArticles(articles, nowMs) {
  const cutoff = nowMs - 36 * 60 * 60 * 1000;
  const recent = articles.filter((a) => {
    if (a.format === 'satire') return false; // cartoons are not brief items
    const t = Date.parse(a.publishedAt);
    return !isNaN(t) && t >= cutoff && t <= nowMs + 5 * 60 * 1000;
  });
  const picks = [];
  const counts = {};
  const take = (cap) => {
    for (const a of recent) {
      if (picks.length >= 8) break;
      if (picks.includes(a)) continue;
      if ((counts[a.section] || 0) >= cap) continue;
      counts[a.section] = (counts[a.section] || 0) + 1;
      picks.push(a);
    }
  };
  take(2);
  if (picks.length < 5) take(3);
  const used = new Set(picks.map((a) => a.slug));
  const isLocalish = (a) => a.section === 'local' || !!a.region;
  let around = recent
    .filter((a) => isLocalish(a) && !used.has(a.slug))
    .slice(0, 3);
  if (!around.length) {
    around = articles
      .filter((a) => isLocalish(a) && !used.has(a.slug))
      .slice(0, 3);
  }
  return { picks, around };
}

/**
 * Build today's Daily Brief draft campaign (no-op when one already
 * exists for the date). The podcast block is included only when
 * the feed's newest episode carries today's or yesterday's Denver
 * date.
 */
async function buildBriefDraft(store, dateStr) {
  const existing = await store.nlFindCampaign('brief', dateStr);
  if (existing) return { campaign: existing, created: false };
  const articles = await store.listArticles({ limit: 300 });
  const { picks, around } = selectBriefArticles(articles, Date.now());
  let podcast = null;
  const episode = await getPodcastEpisode();
  if (episode) {
    const yesterday = denverDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (episode.denverDate === dateStr || episode.denverDate === yesterday) {
      podcast = episode;
    }
  }
  const campaign = await store.nlInsertCampaign({
    type: 'brief',
    sendDate: dateStr,
    subject: 'The Colorado Daily Brief — ' + denverDateLabel(dateStr),
    status: 'draft',
    articleIds: picks.map((a) => a.slug),
    aroundIds: around.map((a) => a.slug),
    podcast,
    stats: {},
  });
  return { campaign, created: true };
}

/* ------------------------------------------------------------------ */
/* Campaign email templates                                            */
/* ------------------------------------------------------------------ */

function campaignShell(opts) {
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background-color:#F8F4EB;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F4EB;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background-color:#FFFFFF;border:1px solid #DED7C9;">' +
    '<tr><td style="padding:28px 36px 0;text-align:center;">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:27px;font-weight:bold;letter-spacing:2px;color:#102438;">THE CENTENNIAL LEDGER</div>' +
    '<div style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#AA8548;margin-top:4px;">A Clear View of Colorado</div>' +
    '<div style="border-top:3px solid #981E24;margin:16px 0 0;"></div>' +
    '<div style="border-top:1px solid #AA8548;margin-top:2px;"></div>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 36px 0;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:2px;color:#981E24;text-transform:uppercase;">' +
    esc(opts.kicker) +
    '</div>' +
    (opts.dateLabel
      ? '<div style="font-family:Georgia,serif;font-size:15px;color:#555555;margin-top:4px;">' +
        esc(opts.dateLabel) +
        '</div>'
      : '') +
    '<h1 style="font-family:Georgia,serif;font-size:23px;line-height:1.25;color:#102438;margin:12px 0 6px;">' +
    esc(opts.heading) +
    '</h1>' +
    (opts.intro
      ? '<p style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#333333;margin:0 0 6px;">' +
        esc(opts.intro) +
        '</p>'
      : '') +
    opts.bodyHtml +
    '</td></tr>' +
    '<tr><td style="padding:18px 36px 0;">' +
    '<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#333333;margin:0;">More Colorado news, all day, at <a href="' +
    esc(siteUrl()) +
    '" style="color:#981E24;">centennialledger.com</a>.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:18px 36px 28px;">' +
    '<div style="border-top:1px solid #DED7C9;padding-top:14px;">' +
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#555555;line-height:1.7;margin:0;">' +
    '<a href="' +
    esc(opts.links.preferences) +
    '" style="color:#981E24;">Manage your preferences</a> &nbsp;|&nbsp; ' +
    '<a href="' +
    esc(opts.links.unsubscribe) +
    '" style="color:#981E24;">Unsubscribe</a></p>' +
    '<p style="font-family:Georgia,serif;font-size:12.5px;color:#666666;line-height:1.6;margin:8px 0 0;">You are receiving this email because you subscribed at centennialledger.com.</p>' +
    '<p style="font-family:Georgia,serif;font-size:12.5px;color:#666666;line-height:1.6;margin:4px 0 0;">The Centennial Ledger<br>' +
    esc(postalLine()) +
    '</p>' +
    '</div></td></tr>' +
    '</table></td></tr></table></body></html>';
  const text =
    'THE CENTENNIAL LEDGER\nA Clear View of Colorado\n\n' +
    opts.kicker.toUpperCase() +
    (opts.dateLabel ? '\n' + opts.dateLabel : '') +
    '\n\n' +
    opts.heading +
    (opts.intro ? '\n' + opts.intro : '') +
    '\n' +
    opts.bodyText +
    '\nMore Colorado news, all day, at ' +
    siteUrl() +
    '\n\nManage your preferences: ' +
    opts.links.preferences +
    '\nUnsubscribe: ' +
    opts.links.unsubscribe +
    '\n\nYou are receiving this email because you subscribed at centennialledger.com.\nThe Centennial Ledger\n' +
    postalLine() +
    '\n';
  return { html, text };
}

function itemHtml(a, lead) {
  return (
    '<div style="padding:13px 0;border-top:1px solid #DED7C9;">' +
    '<a href="' +
    esc(articleUrl(a)) +
    '" style="font-family:Georgia,serif;font-size:' +
    (lead ? '21px' : '18px') +
    ';line-height:1.3;font-weight:bold;color:#102438;text-decoration:none;">' +
    esc(a.headline) +
    '</a>' +
    '<p style="font-family:Georgia,serif;font-size:15.5px;line-height:1.55;color:#333333;margin:6px 0 0;">' +
    esc(summarize(a)) +
    '</p></div>'
  );
}

function itemText(a) {
  return (
    a.headline + '\n' + summarize(a) + '\n' + articleUrl(a) + '\n'
  );
}

function sectionHeadHtml(label) {
  return (
    '<h2 style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;color:#981E24;text-transform:uppercase;margin:20px 0 2px;">' +
    esc(label) +
    '</h2>'
  );
}

function sponsorHtml(campaign) {
  if (!campaign.sponsorName || !campaign.sponsorMessage || !campaign.sponsorUrl) {
    return '';
  }
  return (
    '<div style="border:1px solid #DED7C9;background-color:#F8F4EB;padding:14px 16px;margin:18px 0 4px;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:1.5px;color:#777777;">SPONSORED</div>' +
    '<a href="' +
    esc(campaign.sponsorUrl) +
    '" style="font-family:Georgia,serif;font-size:16.5px;font-weight:bold;color:#102438;text-decoration:none;">' +
    esc(campaign.sponsorName) +
    '</a>' +
    '<p style="font-family:Georgia,serif;font-size:14.5px;line-height:1.5;color:#333333;margin:5px 0 0;">' +
    esc(campaign.sponsorMessage) +
    '</p></div>'
  );
}

function sponsorText(campaign) {
  if (!campaign.sponsorName || !campaign.sponsorMessage || !campaign.sponsorUrl) {
    return '';
  }
  return (
    '\nSPONSORED\n' +
    campaign.sponsorName +
    '\n' +
    campaign.sponsorMessage +
    '\n' +
    campaign.sponsorUrl +
    '\n'
  );
}

function renderBriefEmail(campaign, items, around, links) {
  let bodyHtml = sectionHeadHtml("Today's Top Stories");
  items.forEach((a, i) => {
    bodyHtml += itemHtml(a, i === 0);
  });
  if (around.length) {
    bodyHtml += sectionHeadHtml('Around Colorado');
    around.forEach((a) => {
      bodyHtml += itemHtml(a, false);
    });
  }
  if (campaign.podcast) {
    bodyHtml +=
      '<div style="border:1px solid #AA8548;background-color:#F8F4EB;padding:14px 16px;margin:18px 0 4px;">' +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.5px;color:#981E24;">THE COLORADO DAILY BRIEF PODCAST</div>' +
      '<p style="font-family:Georgia,serif;font-size:15.5px;line-height:1.5;color:#333333;margin:6px 0 0;"><a href="' +
      esc(campaign.podcast.url) +
      '" style="color:#981E24;font-weight:bold;">Listen to Today\'s Brief</a>: ' +
      esc(campaign.podcast.title) +
      '</p></div>';
  }
  bodyHtml += sponsorHtml(campaign);

  let bodyText = "\nTODAY'S TOP STORIES\n\n";
  items.forEach((a) => {
    bodyText += itemText(a) + '\n';
  });
  if (around.length) {
    bodyText += '\nAROUND COLORADO\n\n';
    around.forEach((a) => {
      bodyText += itemText(a) + '\n';
    });
  }
  if (campaign.podcast) {
    bodyText +=
      '\nListen to Today\'s Brief: ' +
      campaign.podcast.title +
      '\n' +
      campaign.podcast.url +
      '\n';
  }
  bodyText += sponsorText(campaign);

  return campaignShell({
    kicker: 'The Colorado Daily Brief',
    dateLabel: denverDateLabel(campaign.sendDate),
    heading: 'Good morning, Colorado.',
    intro: 'The leading Colorado stories, from the Capitol to communities across the state.',
    bodyHtml,
    bodyText,
    links,
  });
}

function renderDigestEmail(items, links, dateStr, sub) {
  let bodyHtml = sectionHeadHtml('Picked for your topics and regions');
  items.forEach((a) => {
    bodyHtml += itemHtml(a, false);
  });
  let bodyText = '\nPICKED FOR YOUR TOPICS AND REGIONS\n\n';
  items.forEach((a) => {
    bodyText += itemText(a) + '\n';
  });
  return campaignShell({
    kicker: 'Your Centennial Ledger Digest',
    dateLabel: denverDateLabel(dateStr),
    heading:
      'Good morning' + (sub && sub.firstName ? ', ' + sub.firstName : '') + '.',
    intro: 'Stories matching the topics and regions you follow, since your last digest.',
    bodyHtml,
    bodyText,
    links,
  });
}

function renderBreakingEmail(campaign, items, links) {
  let bodyHtml = '';
  items.forEach((a, i) => {
    bodyHtml += itemHtml(a, i === 0);
  });
  bodyHtml += sponsorHtml(campaign);
  let bodyText = '\n';
  items.forEach((a) => {
    bodyText += itemText(a) + '\n';
  });
  bodyText += sponsorText(campaign);
  return campaignShell({
    kicker: 'Breaking News',
    dateLabel: denverDateLabel(
      denverDateString(new Date(campaign.createdAt || Date.now()))
    ),
    heading: campaign.subject,
    intro: '',
    bodyHtml,
    bodyText,
    links,
  });
}

/* ------------------------------------------------------------------ */
/* Campaign sending                                                    */
/* ------------------------------------------------------------------ */

async function articlesBySlug(store) {
  const all = await store.listArticlesAll({ limit: 600 });
  const map = new Map();
  for (const a of all) map.set(a.slug, a);
  return map;
}

function campaignItems(map, campaign) {
  const pick = (slugs) =>
    (slugs || []).map((s) => map.get(s)).filter(Boolean);
  return { items: pick(campaign.articleIds), around: pick(campaign.aroundIds) };
}

/** Render a brief or breaking campaign for preview or a test send. */
async function renderCampaignEmail(store, campaign, links) {
  const map = await articlesBySlug(store);
  const { items, around } = campaignItems(map, campaign);
  const safeLinks = links || {
    preferences: siteUrl() + '/preferences',
    unsubscribe: siteUrl() + '/unsubscribe',
  };
  if (campaign.type === 'breaking') {
    return renderBreakingEmail(campaign, items, safeLinks);
  }
  return renderBriefEmail(campaign, items, around, safeLinks);
}

async function sendCampaignTo(store, mailer, campaign, recipients, renderFor, kind) {
  let sent = 0;
  let failed = 0;
  const sentArticleIds = (campaign.articleIds || []).concat(
    campaign.aroundIds || []
  );
  for (const sub of recipients) {
    const links = subscriberLinks(sub);
    const rendered = renderFor(links);
    const result = await mailer.send(store, {
      to: sub.email,
      subject: campaign.subject,
      html: rendered.html,
      text: rendered.text,
      kind,
      headers: listUnsubscribeHeaders(links),
    });
    if (result.error) {
      failed += 1;
    } else {
      sent += 1;
      await store.nlInsertDelivery({
        campaignId: campaign.id,
        subscriberId: sub.id,
        articleIds: sentArticleIds,
      });
    }
  }
  return { sent, failed, recipients: recipients.length };
}

async function sendBriefCampaign(store, mailer, campaignRef) {
  const campaign = await store.nlGetCampaign(
    campaignRef && campaignRef.id ? campaignRef.id : campaignRef
  );
  if (!campaign) return { error: 'campaign-not-found' };
  if (campaign.status === 'sent') {
    return { alreadySent: true, stats: campaign.stats };
  }
  await store.nlUpdateCampaign(campaign.id, { status: 'sending' });
  const map = await articlesBySlug(store);
  const { items, around } = campaignItems(map, campaign);
  const recipients = (await store.nlListSubscribers()).filter(
    (s) =>
      s.status === 'confirmed' && s.dailyBrief && !s.paused && !s.suppressed
  );
  const outcome = await sendCampaignTo(
    store,
    mailer,
    campaign,
    recipients,
    (links) => renderBriefEmail(campaign, items, around, links),
    'brief'
  );
  const stats = Object.assign({}, outcome, { at: new Date().toISOString() });
  await store.nlUpdateCampaign(campaign.id, {
    status: outcome.sent || !outcome.failed ? 'sent' : 'failed',
    stats,
    sentAt: new Date().toISOString(),
  });
  return { stats };
}

async function sendBreakingCampaign(store, mailer, campaignRef) {
  const campaign = await store.nlGetCampaign(
    campaignRef && campaignRef.id ? campaignRef.id : campaignRef
  );
  if (!campaign) return { error: 'campaign-not-found' };
  if (campaign.status === 'sent') {
    return { alreadySent: true, stats: campaign.stats };
  }
  await store.nlUpdateCampaign(campaign.id, { status: 'sending' });
  const map = await articlesBySlug(store);
  const { items } = campaignItems(map, campaign);
  const recipients = (await store.nlListSubscribers()).filter(
    (s) =>
      s.status === 'confirmed' &&
      s.breakingOptIn &&
      !s.paused &&
      !s.suppressed
  );
  const outcome = await sendCampaignTo(
    store,
    mailer,
    campaign,
    recipients,
    (links) => renderBreakingEmail(campaign, items, links),
    'breaking'
  );
  const stats = Object.assign({}, outcome, { at: new Date().toISOString() });
  await store.nlUpdateCampaign(campaign.id, {
    status: outcome.sent || !outcome.failed ? 'sent' : 'failed',
    stats,
    sentAt: new Date().toISOString(),
  });
  return { stats };
}

/**
 * A breaking campaign is created by hand in the admin page and is
 * never sent automatically. Its send_date carries the full
 * timestamp because campaigns are unique on (type, send_date) and
 * two breaking stories can land on the same day.
 */
async function createBreakingCampaign(store, input) {
  return store.nlInsertCampaign({
    type: 'breaking',
    sendDate: new Date().toISOString(),
    subject: String((input && input.subject) || '').slice(0, 200),
    status: 'draft',
    articleIds: Array.isArray(input && input.articleIds)
      ? input.articleIds.map(String)
      : [],
    stats: {},
  });
}

/* ------------------------------------------------------------------ */
/* Personalized digests                                                */
/* ------------------------------------------------------------------ */

/**
 * Build and send the day's personalized digests. Runs after the
 * Daily Brief is sent (scheduler autosend or the admin Approve &
 * Send action) so the combined-email rule can leave today's brief
 * stories out of brief subscribers' digests. One digest campaign
 * row covers the date; each recipient gets an individual email
 * and a delivery record. A subscriber whose digest would be empty
 * is skipped silently, and their window stays open so the stories
 * are still there for the next digest.
 */
async function buildAndSendDigests(store, mailer, dateStr, briefCampaign) {
  const weekday = denverWeekdayOf(dateStr);
  const isMonday = weekday === 1;
  const isWeekday = weekday >= 1 && weekday <= 5;
  let campaign = await store.nlFindCampaign('digest', dateStr);
  if (campaign && campaign.status === 'sent') {
    return { campaign, skipped: 'already-sent' };
  }
  if (!campaign) {
    campaign = await store.nlInsertCampaign({
      type: 'digest',
      sendDate: dateStr,
      subject: 'Your Centennial Ledger digest — ' + denverDateLabel(dateStr),
      status: 'draft',
      articleIds: [],
      stats: {},
    });
  }

  const briefIds = new Set();
  if (
    briefCampaign &&
    briefCampaign.status === 'sent' &&
    briefCampaign.sendDate === dateStr
  ) {
    (briefCampaign.articleIds || [])
      .concat(briefCampaign.aroundIds || [])
      .forEach((s) => briefIds.add(s));
  }

  const all = await store.listArticlesAll({ limit: 600 });
  const subs = await store.nlListSubscribers();
  const nowMs = Date.now();
  let sent = 0;
  let skipped = 0;
  const sentIdsUnion = new Set();

  for (const sub of subs) {
    if (sub.status !== 'confirmed' || sub.paused || sub.suppressed) continue;
    const freq = sub.digestFrequency;
    if (freq !== 'daily' && freq !== 'weekly') continue;
    if (freq === 'daily' && !isWeekday) continue;
    if (freq === 'weekly' && !isMonday) continue;
    if (!sub.topics.length && !sub.regions.length) continue;

    const startMs = sub.lastDigestAt
      ? Date.parse(sub.lastDigestAt)
      : nowMs - (freq === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000);
    const deliveries = await store.nlDeliveriesForSubscriber(sub.id);
    const sentBefore = new Set();
    deliveries.forEach((d) =>
      (d.articleIds || []).forEach((s) => sentBefore.add(s))
    );
    const topicSet = new Set(sub.topics);
    const regionSet = new Set(sub.regions);

    const items = [];
    for (const a of all) {
      if (a.format === 'satire') continue; // cartoons are not digest items
      const t = Date.parse(a.publishedAt);
      if (isNaN(t) || t <= startMs || t > nowMs + 5 * 60 * 1000) continue;
      if (sentBefore.has(a.slug)) continue;
      // Combined-email rule: today's brief stories stay out of the
      // digest for subscribers who also receive the brief.
      if (sub.dailyBrief && briefIds.has(a.slug)) continue;
      if (a.section === 'opinion' && !topicSet.has('opinion')) continue;
      const topicMatch = topicSet.has(a.section);
      const regionMatch = a.region && regionSet.has(slugify(a.region));
      if (!topicMatch && !regionMatch) continue;
      items.push(a);
      if (items.length >= 8) break;
    }
    if (!items.length) {
      skipped += 1;
      continue;
    }

    const links = subscriberLinks(sub);
    const rendered = renderDigestEmail(items, links, dateStr, sub);
    const result = await mailer.send(store, {
      to: sub.email,
      subject: campaign.subject,
      html: rendered.html,
      text: rendered.text,
      kind: 'digest',
      headers: listUnsubscribeHeaders(links),
    });
    if (result.error) {
      skipped += 1;
      continue;
    }
    await store.nlInsertDelivery({
      campaignId: campaign.id,
      subscriberId: sub.id,
      articleIds: items.map((a) => a.slug),
    });
    items.forEach((a) => sentIdsUnion.add(a.slug));
    await store.nlUpdateSubscriber(sub.id, {
      lastDigestAt: new Date().toISOString(),
    });
    sent += 1;
  }

  const stats = { recipients: sent, sent, skipped, at: new Date().toISOString() };
  await store.nlUpdateCampaign(campaign.id, {
    status: 'sent',
    stats,
    sentAt: new Date().toISOString(),
    articleIds: [...sentIdsUnion],
  });
  return { campaign: await store.nlGetCampaign(campaign.id), stats };
}

module.exports = {
  EMAIL_RE,
  isValidEmail,
  validTopics,
  validRegions,
  denverDateString,
  denverDateLabel,
  denverWeekdayOf,
  denverParts,
  postalLine,
  confirmUrlFor,
  preferencesUrlFor,
  unsubscribeUrlFor,
  subscriberLinks,
  subscribeSignup,
  sendConfirmationEmail,
  confirmSubscriber,
  requestPreferencesLink,
  subscriberForPrefsToken,
  savePreferences,
  unsubscribeSubscriber,
  subscriberForUnsubToken,
  startEmailChange,
  applyEmailChange,
  getPodcastEpisode,
  selectBriefArticles,
  buildBriefDraft,
  renderCampaignEmail,
  renderDigestEmail,
  sendBriefCampaign,
  sendBreakingCampaign,
  createBreakingCampaign,
  buildAndSendDigests,
};
