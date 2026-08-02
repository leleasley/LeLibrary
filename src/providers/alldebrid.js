const axios = require('axios');

const AD_BASE = 'https://api.alldebrid.com/v4';

// AllDebrid v4: auth via `Authorization: Bearer <key>`. Responses are
// `{ status: 'success', data: {...} }` or `{ status: 'error', error: { code, message } }`.
// magnet/status, magnet/files and link/unlock are POST endpoints (form body);
// /user is GET.
async function adRequest(apiKey, method, path, form = {}, params = {}) {
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
    const res = await axios({ method, url: `${AD_BASE}${path}`, ...opts });
    const body = res.data || {};
    if (body.status === 'error') {
      return { error: body.error?.message || body.error?.code || 'AllDebrid error', status: res.status };
    }
    return { data: body.data, status: res.status };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.error?.code || err.message;
    return { error: msg, status: err.response?.status };
  }
}

// statusCode 5 == "finished" (fully downloaded). Others are queued/downloading/error.
async function getAlldebridDownloads(apiKey) {
  const { data, error } = await adRequest(apiKey, 'POST', '/v4.1/magnet/status', { ids: 'all' });
  if (error) throw new Error(`[AllDebrid] ${error}`);

  const magnets = Array.isArray(data?.magnets) ? data.magnets : [];
  const items = magnets
    .filter(m => m.statusCode === 5)
    .map(m => ({
      id:                String(m.id),
      name:              m.filename || m.name || '',
      filename:          m.filename || m.name || '',
      size:              m.size || 0,
      source:            'alldebrid',
      download_state:    'completed',
      download_finished: true,
      created_at:        m.uploadDate ? new Date(m.uploadDate * 1000).toISOString() : undefined,
      _adHash:           m.hash || null,
    }))
    .filter(i => i.name);

  console.log(`[AllDebrid] Downloads: ${items.length} items`);
  return items;
}

async function getAlldebridFiles(apiKey, magnetId) {
  const { data, error } = await adRequest(apiKey, 'POST', '/v4/magnet/files', { magnet: magnetId });
  if (error || !Array.isArray(data?.files)) return [];
  return data.files
    .filter(f => !f.error)
    .map(f => ({
      id:   String(f.id),
      name: f.filename || f.n || '',
      size: f.size || f.s || 0,
      link: f.link || f.l || null,
    }));
}

// Hoster links from /magnet/files need unlocking before they can stream.
async function getAlldebridStreamLink(apiKey, magnetId, fileId) {
  const files = await getAlldebridFiles(apiKey, magnetId);
  const file = files.find(f => String(f.id) === String(fileId)) || files[0];
  if (!file?.link) return null;
  const { data, error } = await adRequest(apiKey, 'POST', '/link/unlock', { link: file.link });
  if (error || !data?.link) return null;
  return data.link;
}

// Verification: /user returns account info for a valid key.
async function verifyAlldebridKey(apiKey) {
  const { data, error } = await adRequest(apiKey, 'GET', '/user');
  if (error || !data?.user) return { valid: false, error: error || 'Invalid AllDebrid API key' };
  return { valid: true, username: data.user.username || null, isPremium: !!data.user.isPremium };
}

module.exports = { getAlldebridDownloads, getAlldebridFiles, getAlldebridStreamLink, verifyAlldebridKey };
