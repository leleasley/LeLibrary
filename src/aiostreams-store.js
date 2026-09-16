// AIOStreams connector secret storage (self-host / legacy path).
//
// A configured AIOStreams URL is secret material. Self-hosted instances keep
// only an encrypted record, sealed with a key derived from
// SELFHOST_CONFIGS_SECRET and an explicit context label, addressed by a
// non-secret random reference that may travel in the addon token. Hosted
// accounts store the URL in the account secret vault instead (see
// src/accounts); this module resolves both.
const crypto = require('crypto');
const cache = require('./cache');

const PREFIX = 'aiostreams:ref:';
const CONTEXT = 'lelibrary:aiostreams:v1';
const MEM_TTL = 7 * 24 * 60 * 60;
const MAX_URL_BYTES = 4096;

function selfHostSecret() {
  return String(process.env.SELFHOST_CONFIGS_SECRET || '');
}

// Self-hosted connector is only available when the instance has a secret to
// seal with. Without it the UI must explain that rather than silently dropping
// the setting.
function selfHostEnabled() {
  return selfHostSecret().length > 0;
}

function deriveKey() {
  return crypto.createHash('sha256').update(`${selfHostSecret()}|${CONTEXT}`).digest();
}

function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function unseal(record) {
  if (!record || typeof record !== 'object') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(record.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function newRef() {
  return crypto.randomBytes(9).toString('hex');
}

async function setSelfHost(ref, url) {
  if (!selfHostEnabled()) throw new Error('Self-hosted AIOStreams requires SELFHOST_CONFIGS_SECRET');
  const value = String(url || '').slice(0, MAX_URL_BYTES);
  const record = seal(value);
  const client = cache.getRedisClient();
  // Raw Redis SET with no expiry (operator data, not a cache entry).
  if (client) await client.set(PREFIX + ref, JSON.stringify(record));
  cache.setMem(PREFIX + ref, record, MEM_TTL);
  return true;
}

async function getSelfHost(ref) {
  if (!ref) return null;
  const stored = await cache.get(PREFIX + ref);
  if (!stored) return null;
  const record = typeof stored === 'string' ? JSON.parse(stored) : stored;
  return unseal(record);
}

async function removeSelfHost(ref) {
  if (!ref) return true;
  await cache.del(PREFIX + ref);
  return true;
}

// Resolve the connector URL for a request's config, preferring the account
// vault for opaque account tokens and the sealed self-host reference otherwise.
// Never returns the URL to a browser.
async function resolveAioStreamsUrl(config, token) {
  if (!config) return null;
  if (config.__configScope && config.__configScope.type === 'account') {
    try {
      const HOSTED = require('./hosted');
      if (HOSTED && typeof HOSTED.getAioStreamsUrlForToken === 'function') {
        return await HOSTED.getAioStreamsUrlForToken(token);
      }
    } catch { /* hosted extension absent */ }
    return null;
  }
  if (typeof config.aiostreamsRef === 'string' && config.aiostreamsRef) {
    return getSelfHost(config.aiostreamsRef);
  }
  return null;
}

module.exports = {
  selfHostEnabled,
  newRef,
  setSelfHost,
  getSelfHost,
  removeSelfHost,
  resolveAioStreamsUrl,
  PREFIX,
};
