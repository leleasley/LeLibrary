// Resolve KNABEN torrent results only after the user selects a stream.
// Search result lists never mutate a user's debrid account.
// @ts-nocheck
const axios = require('axios');

const PROVIDERS = {
  torbox: { field: 'torboxApiKey' },
  realdebrid: { field: 'rdApiKey' },
  alldebrid: { field: 'adApiKey' },
  premiumize: { field: 'pmApiKey' },
};
const inFlight = new Map();
const submittedHashes = new Map();
const VIDEO = /\.(mkv|mp4|m4v|avi|mov|ts|webm|wmv|m2ts|mpg|mpeg)$/i;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function choose(files, name, season, episode) {
  const list = Array.isArray(files) ? files.filter(f => VIDEO.test(String(f.name || f.filename || f.path || ''))) : [];
  if (!list.length) return null;
  const target = `${String(name || '').toLowerCase()} S${String(season || '').padStart(2, '0')}E${String(episode || '').padStart(2, '0')}`;
  const episodeFile = season && episode && list.find(f => {
    const file = String(f.name || f.filename || f.path || '');
    return new RegExp(`S0?${Number(season)}[ ._-]*E0?${Number(episode)}\\b`, 'i').test(file);
  });
  if (season && episode && !episodeFile) return null;
  if (episodeFile) return episodeFile;
  return list.sort((a, b) => (Number(b.size || b.bytes) || 0) - (Number(a.size || a.bytes) || 0))[0];
}

function magnetFor(hash, name, supplied) {
  const parsedHash = String(supplied || '').match(/(?:^|&)xt=urn:btih:([a-f0-9]{40})(?:&|$)/i)?.[1];
  if (String(supplied || '').startsWith('magnet:?') && parsedHash?.toLowerCase() === String(hash).toLowerCase()) return supplied;
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(String(name || hash).slice(0, 180))}`;
}

async function torbox(apiKey, hash, name, season, episode, magnet) {
  const base = 'https://api.torbox.app/v1/api';
  const headers = { Authorization: `Bearer ${apiKey}` };
  const added = await axios.post(`${base}/torrents/createtorrent`, new URLSearchParams({ magnet: magnetFor(hash, name, magnet) }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 });
  const torrent = added.data?.data || {};
  const torrentId = torrent.torrent_id || torrent.id;
  let files = torrent.files;
  if (!Array.isArray(files) || !files.length) {
    const list = await axios.get(`${base}/torrents/mylist`, { headers, params: { id: torrentId, limit: 100, bypass_cache: true }, timeout: 15000 });
    const row = (Array.isArray(list.data?.data) ? list.data.data : []).find(x => String(x.id) === String(torrentId)) || list.data?.data?.[0];
    files = row?.files || [];
  }
  const file = choose(files, name, season, episode);
  if (!torrentId || !file) return null;
  const link = await axios.get(`${base}/torrents/requestdl`, { headers, params: { torrent_id: torrentId, file_id: file.id }, timeout: 20000 });
  return link.data?.data || link.data?.download || null;
}

async function realdebrid(apiKey, hash, name, season, episode, magnetUrl) {
  const base = 'https://api.real-debrid.com/rest/1.0';
  const headers = { Authorization: `Bearer ${apiKey}` };
  const magnet = magnetFor(hash, name, magnetUrl);
  const added = await axios.post(`${base}/torrents/addMagnet`, new URLSearchParams({ magnet }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  const id = added.data?.id;
  if (!id) return null;
  let info;
  for (let i = 0; i < 5; i++) {
    const res = await axios.get(`${base}/torrents/info/${id}`, { headers, timeout: 15000 });
    info = res.data;
    if (Array.isArray(info?.files) && info.files.length) break;
    await wait(800);
  }
  const file = choose(info?.files, name, season, episode);
  if (!file) return null;
  await axios.post(`${base}/torrents/selectFiles/${id}`, new URLSearchParams({ files: String(file.id) }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }).catch(() => {});
  const refreshed = await axios.get(`${base}/torrents/info/${id}`, { headers, timeout: 15000 });
  const selected = refreshed.data?.files?.filter(f => f.selected === 1) || [];
  const target = choose(selected.length ? selected : [file], name, season, episode);
  const link = refreshed.data?.links?.[0];
  if (!link || !target) return null;
  const unlocked = await axios.post(`${base}/unrestrict/link`, new URLSearchParams({ link }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 });
  return unlocked.data?.download || null;
}

async function alldebrid(apiKey, hash, name, season, episode, magnetUrl) {
  const base = 'https://api.alldebrid.com';
  const headers = { Authorization: `Bearer ${apiKey}` };
  const upload = await axios.post(`${base}/v4/magnet/upload`, new URLSearchParams({ magnets: magnetFor(hash, name, magnetUrl) }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  const magnet = upload.data?.data?.magnets?.[0];
  if (!magnet?.id) return null;
  let files = [];
  for (let i = 0; i < 6; i++) {
    const res = await axios.post(`${base}/v4.1/magnet/status`, new URLSearchParams({ id: String(magnet.id) }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    const status = res.data?.data?.magnets?.[0];
    if (status?.statusCode === 4) {
      const fileRes = await axios.post(`${base}/v4/magnet/files`, new URLSearchParams({ magnet: String(magnet.id) }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
      files = fileRes.data?.data?.files || [];
      break;
    }
    if (status?.statusCode > 4) return null;
    await wait(900);
  }
  const flat = [];
  const flatten = items => (items || []).forEach(f => { if (f && typeof f === 'object' && Array.isArray(f)) flatten(f); else if (f && typeof f === 'object') { if (f.link) flat.push({ ...f, name: f.filename || f.n }); flatten(f.e); } });
  flatten(files);
  const file = choose(flat, name, season, episode);
  if (!file?.link) return null;
  const unlocked = await axios.post(`${base}/v4/link/unlock`, new URLSearchParams({ link: file.link }), { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  return unlocked.data?.data?.link || null;
}

async function premiumize(apiKey, hash, name, magnetUrl) {
  // Premiumize resolves the selected magnet through directdl without creating
  // a persistent transfer in the user's cloud.
  const base = 'https://www.premiumize.me/api';
  const res = await axios.post(`${base}/transfer/directdl`, new URLSearchParams({ src: magnetFor(hash, name, magnetUrl) }), { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 45000 });
  const file = choose(res.data?.content, name);
  return file?.link || null;
}

async function resolveKnabenPlayback({ config, provider, hash, name, season, episode, magnet }) {
  if (!/^[a-f0-9]{40}$/i.test(String(hash || ''))) return null;
  const keyField = PROVIDERS[provider]?.field;
  const apiKey = keyField && config[keyField];
  if (!apiKey) return null;
  const lockKey = `${require('../providers/index.ts').getUserKey(config)}:${provider}:${hash}`;
  if (inFlight.has(lockKey)) return inFlight.get(lockKey);
  const pending = (async () => {
    // Reuse a matching download already present in the user's provider cloud
    // before submitting a new magnet. The shared provider snapshot is cached,
    // and contains no credentials in its cache key or diagnostics.
    const providerApi = require('../providers/index.ts');
    const recentlySubmitted = submittedHashes.has(lockKey);
    const downloads = await providerApi.fetchDownloads(config, { only: [provider], useCache: !recentlySubmitted }).catch(() => []);
    const existing = downloads.find(item => String(item.hash || item._rdHash || item._adHash || '').toLowerCase() === String(hash).toLowerCase());
    if (existing) {
      const files = await providerApi.getFiles(config, existing);
      const file = choose(files, name, season, episode);
      if (file) {
        const url = await providerApi.getStreamLink(config, existing, file.id);
        if (url) return url;
      }
      // The provider already has this torrent. Never add a second copy just
      // because the selected episode/file could not be resolved.
      return null;
    }
    submittedHashes.set(lockKey, Date.now());
    if (submittedHashes.size > 2000) {
      const oldest = submittedHashes.keys().next().value;
      if (oldest) submittedHashes.delete(oldest);
    }
    if (provider === 'torbox') return torbox(apiKey, hash, name, season, episode, magnet);
    if (provider === 'realdebrid') return realdebrid(apiKey, hash, name, season, episode, magnet);
    if (provider === 'alldebrid') return alldebrid(apiKey, hash, name, season, episode, magnet);
    if (provider === 'premiumize') return premiumize(apiKey, hash, name, magnet);
    return null;
  })();
  inFlight.set(lockKey, pending);
  try { return await pending; }
  finally { setTimeout(() => { if (inFlight.get(lockKey) === pending) inFlight.delete(lockKey); }, 30_000); }
}

module.exports = { resolveKnabenPlayback };
