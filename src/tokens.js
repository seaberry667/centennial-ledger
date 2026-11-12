'use strict';
/**
 * Signed access tokens for subscriber self-service links
 * (confirmation, preference center, unsubscribe, email change).
 *
 * Subscribers have no passwords: every link emailed to them
 * carries an HMAC-SHA256 signed token whose payload names its
 * purpose, the subscriber id, and an expiry. The signing secret
 * comes from SUBSCRIBE_SIGNING_SECRET, falling back to
 * INGEST_SECRET so the feature works with the secret the site
 * already keeps; neither value is ever printed or sent anywhere.
 */

const crypto = require('crypto');

function signingSecret() {
  return (
    process.env.SUBSCRIBE_SIGNING_SECRET ||
    process.env.INGEST_SECRET ||
    'centennial-ledger-dev-signing-secret'
  );
}

const TTL = {
  confirm: 7 * 24 * 60 * 60, // confirmation links: 7 days
  prefs: 30 * 24 * 60 * 60, // preference-center links: 30 days
  unsub: 10 * 365 * 24 * 60 * 60, // unsubscribe links: long-lived
  emailChange: 7 * 24 * 60 * 60, // new-address verification: 7 days
};

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Create a signed token for `purpose` carrying `data` fields. */
function signToken(purpose, data, ttlSeconds) {
  const payload = Object.assign({}, data, {
    p: purpose,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const body = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', signingSecret())
    .update(body)
    .digest();
  return body + '.' + b64url(sig);
}

/**
 * Verify a token for `purpose`. Returns the payload on success,
 * or null for a bad signature, a wrong purpose, or an expired
 * token. Never throws.
 */
function verifyToken(token, purpose) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const expected = crypto
      .createHmac('sha256', signingSecret())
      .update(parts[0])
      .digest();
    const given = fromB64url(parts[1]);
    if (given.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(fromB64url(parts[0]).toString('utf8'));
    if (!payload || payload.p !== purpose) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, TTL };
