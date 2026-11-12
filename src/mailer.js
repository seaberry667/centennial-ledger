'use strict';
/**
 * Email provider layer for the newsletter system.
 *
 * Two drivers behind one send():
 *  - Amazon SES, through the SES v2 SendEmail API, signed with
 *    AWS Signature Version 4 using node:crypto only (no SDK, no
 *    new dependencies). It activates only when ALL of SES_REGION,
 *    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and NEWSLETTER_FROM
 *    are set in the environment. Credentials are read from the
 *    environment at send time and are never stored or printed.
 *  - The outbox driver, used automatically whenever the SES
 *    configuration is incomplete: the message is written to the
 *    email_outbox table (status 'queued') and logged, so the whole
 *    system can be exercised end to end before SES exists. The
 *    admin dashboard lists the outbox.
 *
 * Every attempted send is recorded in the outbox table with its
 * outcome, which doubles as the send log the admin page shows.
 */

const crypto = require('crypto');

function sesConfig() {
  const region = String(process.env.SES_REGION || '').trim();
  const accessKeyId = String(process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const from = String(process.env.NEWSLETTER_FROM || '').trim();
  return {
    region,
    accessKeyId,
    secretAccessKey,
    from,
    configured: !!(region && accessKeyId && secretAccessKey && from),
  };
}

function isLive() {
  return sesConfig().configured;
}

function providerName() {
  return isLive() ? 'ses' : 'outbox';
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * Send one message through the SES v2 SendEmail API.
 * msg: { to, subject, html, text, headers: [{name, value}] }
 * Resolves with the SES MessageId; rejects on any failure.
 */
async function sesSend(cfg, msg) {
  const host = 'email.' + cfg.region + '.amazonaws.com';
  const pathName = '/v2/email/outbound-emails';
  const payload = JSON.stringify({
    FromEmailAddress: cfg.from,
    Destination: { ToAddresses: [msg.to] },
    Content: {
      Simple: {
        Subject: { Data: msg.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: msg.html || '', Charset: 'UTF-8' },
          Text: { Data: msg.text || '', Charset: 'UTF-8' },
        },
        Headers: (msg.headers || []).map((h) => ({ Name: h.name, Value: h.value })),
      },
    },
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 'ses';
  const scope = dateStamp + '/' + cfg.region + '/' + service + '/aws4_request';

  const headersToSign = {
    'content-type': 'application/json',
    host,
    'x-amz-date': amzDate,
  };
  const signedHeaderNames = Object.keys(headersToSign).sort();
  const canonicalHeaders = signedHeaderNames
    .map((n) => n + ':' + String(headersToSign[n]).trim() + '\n')
    .join('');
  const canonicalRequest = [
    'POST',
    pathName,
    '',
    canonicalHeaders,
    signedHeaderNames.join(';'),
    sha256Hex(payload),
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const kDate = hmac('AWS4' + cfg.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');
  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + cfg.accessKeyId + '/' + scope +
    ', SignedHeaders=' + signedHeaderNames.join(';') +
    ', Signature=' + signature;

  const res = await fetch('https://' + host + pathName, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: authorization,
    },
    body: payload,
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error('SES SendEmail failed (' + res.status + '): ' + bodyText.slice(0, 300));
  }
  let parsed = {};
  try {
    parsed = JSON.parse(bodyText || '{}');
  } catch {
    parsed = {};
  }
  return parsed.MessageId || '';
}

/**
 * The one send path for the whole newsletter system.
 * store: the site store (for the outbox record).
 * msg: { to, subject, html, text, kind, headers }
 * Returns { provider, id } on success, { provider, error } when
 * the SES driver was configured but the send failed. Never throws
 * for a provider failure; a store failure still throws.
 */
async function send(store, msg) {
  const cfg = sesConfig();
  if (cfg.configured) {
    try {
      const id = await sesSend(cfg, msg);
      await store.nlAddOutbox({
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        kind: msg.kind || 'campaign',
        status: 'sent',
        providerId: id,
      });
      return { provider: 'ses', id };
    } catch (err) {
      console.error('[newsletter] SES send failed for ' + msg.to + ':', err.message);
      await store.nlAddOutbox({
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        kind: msg.kind || 'campaign',
        status: 'failed',
        providerId: '',
      });
      return { provider: 'ses', error: String((err && err.message) || err) };
    }
  }
  const rec = await store.nlAddOutbox({
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    kind: msg.kind || 'campaign',
    status: 'queued',
    providerId: '',
  });
  console.log(
    '[newsletter:outbox] queued ' + (msg.kind || 'campaign') +
    ' to ' + msg.to + ': ' + msg.subject
  );
  return { provider: 'outbox', id: rec ? rec.id : null };
}

module.exports = { send, isLive, providerName, sesConfig };
