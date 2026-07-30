const axios = require('axios');

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';


const infoCache = new Map();

async function getRealDebridInfoCached(apiKey, itemId) {
  const key = `${apiKey}:${itemId}`;
  if (infoCache.has(key)) return infoCache.get(key);
  const promise = rdGet(`/torrents/info/${itemId}`, apiKey).then(res => {
    setTimeout(() => infoCache.delete(key), 60000);
    return res;
  });
  infoCache.set(key, promise);
  return promise;
}

async function rdGet(path, apiKey, params = {}) {
  try {
    const res = await axios.get(`${RD_BASE}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      params,
      timeout: 20000,
    });
    return { data: res.data };
  } catch (err) {
    return { error: err.response?.data?.error || err.message, status: err.response?.status };
  }
}

async function getRealDebridDownloads(apiKey) {
  // Fetch first page to see if there are more
  const { data: first, error } = await rdGet('/torrents', apiKey, { page: 1, limit: 100 });
  if (error || !Array.isArray(first) || first.length === 0) return [];

  // If first page is already full, fetch additional pages in parallel (up to 10 pages = 1000 items)
  let allPages = [first];
  if (first.length === 100) {
    let page = 2;
    while (page <= 10) {
      const { data } = await rdGet('/torrents', apiKey, { page, limit: 100 });
      if (!Array.isArray(data) || data.length === 0) break;
      allPages.push(data);
      if (data.length < 100) break;
      page++;
    }
  }

  const items = [];
  for (const page of allPages) {
    for (const t of page) {
      if (t.status !== 'downloaded') continue;
      const filename = t.filename || '';

      items.push({
        id:               t.id,
        name:             t.filename,
        filename:         t.filename,
        size:             t.bytes,
        source:           'realdebrid',
        download_state:   'completed',
        download_finished: true,
        created_at:       t.added,
        _rdHash:          t.hash,
      });
    }
  }

  console.log(`[RD] Downloads: ${items.length} items`);
  return items;
}

async function getRealDebridFiles(apiKey, itemId) {
  const { data, error } = await getRealDebridInfoCached(apiKey, itemId);
  if (error || !data) return [];
  return (data.files || [])
    .filter(f => f.selected === 1)
    .map(f => ({ id: f.id, name: f.path?.split('/').pop() || f.path, size: f.bytes }));
}

async function getRealDebridStreamLink(apiKey, itemId, fileId) {
  // 1. Pega links do torrent
  const { data: info, error } = await getRealDebridInfoCached(apiKey, itemId);
  if (error || !info?.links?.length) return null;

  // fileId is 1-based index of selected files
  const selectedFiles = (info.files || []).filter(f => f.selected === 1);
  const fileIndex = selectedFiles.findIndex(f => f.id === fileId);
  const link = info.links[fileIndex >= 0 ? fileIndex : 0];
  if (!link) return null;

  // 2. Unrestrict o link
  const { data: unrestricted } = await axios.post(
    `${RD_BASE}/unrestrict/link`,
    new URLSearchParams({ link }),
    { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  ).catch(() => ({ data: null }));

  return unrestricted?.download || null;
}

module.exports = { getRealDebridDownloads, getRealDebridFiles, getRealDebridStreamLink };
