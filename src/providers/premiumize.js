const axios = require('axios');

const PM_BASE = 'https://www.premiumize.me/api';

// Premiumize: auth via `Authorization: Bearer <key>`. Responses are
// `{ status: 'success', ...fields }` or `{ status: 'error', message, code }`.
// The PIN field may appear on errors when Premiumize demands device
// authorization for a key used from a new IP.
async function pmRequest(apiKey, method, path, params = {}, form = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const opts = { headers, timeout: 30000, validateStatus: s => s < 500 };
    if (method === 'GET') {
      opts.params = params;
    } else {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.params = params;
      opts.data = new URLSearchParams(form).toString();
    }
    const res = await axios({ method, url: `${PM_BASE}${path}`, ...opts });
    const body = res.data || {};
    if (body.status === 'error') {
      let pin = body.pin || null;
      if (!pin && typeof body.message === 'string') {
        const m = body.message.match(/pin[:\s]+([A-Za-z0-9-]+)/i);
        if (m) pin = m[1];
      }
      return { error: body.message || body.code || 'Premiumize error', status: res.status, pin };
    }
    return { data: body, status: res.status };
  } catch (err) {
    return { error: err.response?.data?.message || err.message, status: err.response?.status };
  }
}

// Transfers that are `finished` or `seeding` have their files available.
async function getPremiumizeDownloads(apiKey) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/transfer/list');
  if (error) throw new Error(`[Premiumize] ${error}`);

  const transfers = Array.isArray(data?.transfers) ? data.transfers : [];
  const items = transfers
    .filter(t => t.status === 'finished' || t.status === 'seeding')
    .map(t => ({
      id:                String(t.id),
      name:              t.name || '',
      filename:          t.name || '',
      source:            'premiumize',
      download_state:    t.status === 'seeding' ? 'seeding' : 'completed',
      download_finished: true,
      progress:          1,
    }))
    .filter(i => i.name);

  console.log(`[Premiumize] Downloads: ${items.length} items`);
  return items;
}

// Walk a folder (bounded depth) collecting video-capable file entries.
async function listFolderFiles(apiKey, folderId, depth = 0) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/folder/list', { id: folderId });
  if (error || !Array.isArray(data?.content)) return [];
  let files = [];
  for (const c of data.content) {
    if (c.type === 'file') {
      files.push({ id: String(c.id), name: c.name || '', size: c.size || 0, link: c.link || null });
    } else if (c.type === 'folder' && depth < 2) {
      files = files.concat(await listFolderFiles(apiKey, c.id, depth + 1));
    }
  }
  return files;
}

async function getPremiumizeFiles(apiKey, transferId) {
  const { data, error } = await pmRequest(apiKey, 'GET', '/transfer/list');
  if (error || !Array.isArray(data?.transfers)) return [];
  const t = data.transfers.find(x => String(x.id) === String(transferId));
  if (!t) return [];

  if (t.file_id) {
    const { data: details } = await pmRequest(apiKey, 'GET', '/item/details', { id: t.file_id });
    if (details?.id) {
      return [{ id: String(details.id), name: details.name || '', size: details.size || 0, link: details.link || null }];
    }
    return [];
  }
  if (t.folder_id) {
    return listFolderFiles(apiKey, t.folder_id);
  }
  return [];
}

// Premiumize files carry a direct `link` — streamable with no unlock step.
async function getPremiumizeStreamLink(apiKey, transferId, fileId) {
  const files = await getPremiumizeFiles(apiKey, transferId);
  const file = files.find(f => String(f.id) === String(fileId)) || files[0];
  return file?.link || null;
}

// Verification — PIN-aware: a new-IP device-authorization prompt is surfaced
// as { needPin: true, pin, deviceUrl } so the UI can walk the user through it.
async function verifyPremiumizeKey(apiKey) {
  const { data, error, pin } = await pmRequest(apiKey, 'GET', '/account/info');
  if (error || !data) {
    if (pin) {
      return { valid: false, needPin: true, pin, deviceUrl: 'https://www.premiumize.me/device', error: 'Authorize your Premiumize key' };
    }
    return { valid: false, error: error === 'authentication_failed' ? 'Invalid Premiumize API key' : (error || 'Invalid Premiumize API key') };
  }
  return { valid: true, username: data.customer_id ? String(data.customer_id) : null, premiumUntil: data.premium_until ?? null };
}

module.exports = { getPremiumizeDownloads, getPremiumizeFiles, getPremiumizeStreamLink, verifyPremiumizeKey };
