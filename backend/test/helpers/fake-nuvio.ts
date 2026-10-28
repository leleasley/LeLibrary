// @ts-nocheck
// In-memory stand-in for Nuvio's sync API (PostgREST RPCs + the addons table)
// and for the Postgres pool the Nuvio backups use. No network.
'use strict';

const SECRET_URL = 'https://torrentio.strem.fun/realdebrid=SECRETKEY123/manifest.json';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createFakeNuvio(options = {}) {
  let seq = 0;
  let clock = Date.parse('2026-10-28T10:00:00Z');
  const stamp = () => new Date(clock += 1000).toISOString();
  const state = {
    owner: 'owner-1',
    accessToken: options.accessToken || 'access-0',
    refreshToken: options.refreshToken || 'refresh-0',
    refreshes: 0,
    refreshDelayMs: options.refreshDelayMs ?? 5,
    missing: new Set(options.missingRpcs || []),
    profiles: options.profiles || [
      { id: 'p-uuid-1', user_id: 'owner-1', profile_index: 1, name: 'Mum', avatar_color_hex: '#1E88E5', uses_primary_addons: false, uses_primary_plugins: false, avatar_id: 'cat-7', avatar_url: null, pin_enabled: true, pin_hash: '$2b$secret', profile_background_url: 'https://img.example/bg.jpg' },
      { id: 'p-uuid-2', user_id: 'owner-1', profile_index: 2, name: 'Dad', avatar_color_hex: '#ff0000', uses_primary_addons: false, uses_primary_plugins: true, pin_enabled: false },
    ],
    addons: options.addons || [
      { id: 'a1', user_id: 'owner-1', profile_id: 1, url: SECRET_URL, name: 'Torrentio', enabled: true, sort_order: 0 },
      { id: 'a2', user_id: 'owner-1', profile_id: 1, url: 'https://lelibrary.example/00000000-0000-4000-8000-000000000001.s3cr3t/manifest.json?integration=nuvio', name: 'LeLibrary', enabled: true, sort_order: 1 },
      { id: 'a3', user_id: 'owner-1', profile_id: 1, url: 'https://opensubtitles.example/manifest.json', name: null, enabled: false, sort_order: 2 },
      { id: 'b1', user_id: 'owner-1', profile_id: 2, url: 'https://catalog.nuvio.tv/manifest.json', name: 'Nuvio Catalog Addon', enabled: true, sort_order: 0 },
    ],
    collections: options.collections || {
      1: { items: [{ id: 'collection-lelibrary-hub', title: 'LeLibrary', folders: [{ id: 'f1' }, { id: 'f2' }], extra: { keep: 1 } }, { id: 'aiometadata-trending', title: 'Trending', folders: [] }], updated_at: stamp() },
    },
    home: options.home || {
      1: { doc: { show_catalog_type: true, hide_unreleased_content: false, unknown_top: 'kept', items: [
        { addon_id: 'community.lelibrary', type: 'movie', catalog_id: 'torbox-movies', enabled: true, order: 0, custom_title: '', is_collection: false, collection_id: '', key: 'community.lelibrary:movie:torbox-movies', extra_field: 7 },
        { addon_id: 'com.other', type: 'series', catalog_id: 'top', enabled: false, order: 1, custom_title: 'Top shows', is_collection: false, collection_id: '' },
        { is_collection: true, collection_id: 'collection-lelibrary-hub', enabled: true, order: 2, key: 'collection_collection-lelibrary-hub' },
      ] }, updated_at: stamp() },
    },
    blobs: options.blobs || {
      '1:tv': { blob: { version: 1, features: {
        player_settings: {
          stream_auto_play_mode: { type: 'string', value: 'FIRST_STREAM' },
          subtitle_preferred_language: { type: 'string', value: 'en' },
          stream_auto_play_timeout_seconds: { type: 'int', value: 2147483647 },
          some_unknown_key: { type: 'string', value: 'keep me' },
        },
        layout_settings: { hide_unreleased_content: { type: 'boolean', value: false }, selected_layout: { type: 'string', value: 'MODERN' } },
        track_preference: { 'sub_lang|tt1': { type: 'string', value: 'en' } },
      } }, updated_at: stamp() },
      '1:mobile': { blob: { version: 4, features: {
        player_settings: {
          preferred_subtitle_language: { type: 'string', value: 'fr' },
          auto_skip_segment_types: { type: 'string_set', value: ['intro', 'movie-credits'] },
        },
        notifications_settings: { episode_release_alerts_enabled: true },
      } }, updated_at: stamp() },
    },
  };
  const calls = [];

  const ok = (data) => ({ status: 200, data });
  const err = (status, code = '') => ({ status, data: { code, message: 'x' } });

  function rpc(name, body) {
    if (state.missing.has(name)) return err(404, 'PGRST202');
    const pid = body.p_profile_id;
    switch (name) {
      case 'get_sync_owner': return ok(state.owner);
      case 'sync_pull_profiles': return ok(clone(state.profiles).map((p) => { delete p.pin_hash; delete p.user_id; return p; }));
      case 'sync_patch_profile': {
        const p = state.profiles.find((row) => row.profile_index === pid);
        if (!p) return err(404, 'P0002');
        if (body.p_name != null) p.name = body.p_name;
        if (body.p_avatar_color_hex != null) p.avatar_color_hex = body.p_avatar_color_hex;
        if (body.p_uses_primary_addons != null) p.uses_primary_addons = body.p_uses_primary_addons;
        return ok(clone(p));
      }
      case 'sync_push_profiles': {
        for (const entry of body.p_profiles) {
          const existing = state.profiles.find((row) => row.profile_index === entry.profile_index);
          if (existing) Object.assign(existing, entry);
          else state.profiles.push({ id: `p-uuid-${entry.profile_index}`, user_id: state.owner, pin_enabled: false, ...entry });
        }
        return ok(null);
      }
      case 'sync_delete_profile_data':
        state.profiles = state.profiles.filter((row) => row.profile_index !== pid);
        state.addons = state.addons.filter((row) => row.profile_id !== pid);
        return ok(null);
      case 'sync_pull_collections': {
        const row = state.collections[pid];
        return ok(row ? [{ profile_id: pid, collections_json: clone(row.items), updated_at: row.updated_at }] : []);
      }
      case 'sync_push_collections':
        state.collections[pid] = { items: clone(body.p_collections_json), updated_at: stamp() };
        return ok(null);
      case 'sync_pull_home_catalog_settings': {
        if (!body.p_platform) return err(300, 'PGRST203');
        const row = state.home[pid];
        return ok(row ? [{ profile_id: pid, settings_json: clone(row.doc), updated_at: row.updated_at, platform: body.p_platform }] : []);
      }
      case 'sync_push_home_catalog_settings':
        if (!body.p_platform) return err(300, 'PGRST203');
        state.home[pid] = { doc: clone(body.p_settings_json), updated_at: stamp() };
        return ok(null);
      case 'sync_pull_profile_settings_blob': {
        if (!body.p_platform) return err(300, 'PGRST203');
        const row = state.blobs[`${pid}:${body.p_platform}`];
        return ok(row ? [{ profile_id: pid, settings_json: clone(row.blob), updated_at: row.updated_at }] : []);
      }
      case 'sync_push_profile_settings_blob_guarded': {
        const key = `${pid}:${body.p_platform}`;
        const row = state.blobs[key];
        if ((row ? row.updated_at : null) !== body.p_expected_updated_at) return err(409, 'PT409');
        if ('p_origin_client_id' in body) return err(404, 'PGRST202');
        state.blobs[key] = { blob: clone(body.p_settings_json), updated_at: stamp() };
        return ok(state.blobs[key].updated_at);
      }
      case 'sync_push_profile_settings_blob':
        state.blobs[`${pid}:${body.p_platform}`] = { blob: clone(body.p_settings_json), updated_at: stamp() };
        return ok(null);
      case 'sync_copy_profile_setup':
        for (const platform of ['tv', 'mobile']) {
          const src = state.blobs[`${body.p_source_profile_id}:${platform}`];
          if (src) state.blobs[`${body.p_target_profile_id}:${platform}`] = { blob: clone(src.blob), updated_at: stamp() };
        }
        return ok([{ tv_status: 'copied', mobile_status: 'copied' }]);
      default:
        return err(404, 'PGRST202');
    }
  }

  function addonsRest(method, url, body) {
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const profile = Number(url.searchParams.get('profile_id')?.replace(/^eq\./, ''));
    const columns = (url.searchParams.get('select') || '').split(',').filter(Boolean);
    const pick = (row) => {
      if (columns.includes('*')) return clone(row);
      const out = {};
      for (const c of columns) if (c in row) out[c] = row[c];
      return out;
    };
    if (method === 'GET') {
      return ok(state.addons.filter((row) => row.profile_id === profile).sort((a, b) => a.sort_order - b.sort_order).map(pick));
    }
    if (method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const created = [];
      for (const row of rows) {
        if (!row.user_id) return err(400, '23502');
        if (state.addons.some((a) => a.profile_id === row.profile_id && a.url === row.url)) return err(409, '23505');
        const stored = { id: `new-${++seq}`, ...row };
        state.addons.push(stored);
        created.push(pick(stored));
      }
      return ok(created);
    }
    if (method === 'PATCH') {
      const row = state.addons.find((a) => a.id === id && a.profile_id === profile);
      if (!row) return ok([]);
      Object.assign(row, body);
      return ok([pick(row)]);
    }
    if (method === 'DELETE') {
      state.addons = state.addons.filter((a) => !(a.id === id && a.profile_id === profile));
      return ok(null);
    }
    return err(405);
  }

  async function http(req) {
    calls.push(clone({ method: req.method, url: req.url, data: req.data, auth: req.headers?.Authorization }));
    const url = new URL(req.url);
    if (url.pathname === '/auth/v1/token') {
      state.refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, state.refreshDelayMs));
      if (req.data?.refresh_token !== state.refreshToken) return err(400);
      state.accessToken = `access-${state.refreshes}`;
      state.refreshToken = `refresh-${state.refreshes}`;
      return ok({ access_token: state.accessToken, refresh_token: state.refreshToken });
    }
    if (req.headers?.Authorization !== `Bearer ${state.accessToken}`) return err(401, 'PGRST301');
    if (url.pathname.startsWith('/rest/v1/rpc/')) return rpc(url.pathname.slice('/rest/v1/rpc/'.length), req.data || {});
    if (url.pathname === '/rest/v1/addons') return addonsRest(req.method, url, req.data);
    return err(404);
  }

  return { state, calls, http, SECRET_URL };
}

// The handful of statements backups.ts runs, on an array.
function createFakeBackupPool() {
  const rows = [];
  async function query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (/^CREATE/.test(text)) return { rows: [], rowCount: 0 };
    if (/^INSERT INTO nuvio_backups/.test(text)) {
      const [id, setup_uuid, profile_index, created_at, reason, parts, sealed] = params;
      rows.push({ id, setup_uuid, profile_index, created_at, reason, parts: JSON.parse(parts), sealed: JSON.parse(sealed) });
      return { rows: [], rowCount: 1 };
    }
    const newestFirst = (list) => list.slice().sort((a, b) => b.created_at - a.created_at);
    if (/^DELETE FROM nuvio_backups WHERE setup_uuid = \$1 AND profile_index = \$2 AND id NOT IN/.test(text)) {
      const scoped = newestFirst(rows.filter((r) => r.setup_uuid === params[0] && r.profile_index === params[1]));
      const keep = new Set(scoped.slice(0, Number(/LIMIT (\d+)/.exec(text)[1])).map((r) => r.id));
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const r = rows[i];
        if (r.setup_uuid === params[0] && r.profile_index === params[1] && !keep.has(r.id)) rows.splice(i, 1);
      }
      return { rows: [], rowCount: before - rows.length };
    }
    if (/^DELETE FROM nuvio_backups WHERE setup_uuid = \$1 AND id = \$2/.test(text)) {
      const i = rows.findIndex((r) => r.setup_uuid === params[0] && r.id === params[1]);
      if (i >= 0) rows.splice(i, 1);
      return { rows: [], rowCount: i >= 0 ? 1 : 0 };
    }
    if (/^DELETE FROM nuvio_backups WHERE setup_uuid = \$1$/.test(text)) {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].setup_uuid === params[0]) rows.splice(i, 1);
      return { rows: [], rowCount: 0 };
    }
    if (/^SELECT id FROM nuvio_backups .* reason = ANY\(\$3\)/.test(text)) {
      const found = newestFirst(rows.filter((r) => r.setup_uuid === params[0] && r.profile_index === params[1] && params[2].includes(r.reason)));
      return { rows: found.slice(0, 1).map((r) => ({ id: r.id })), rowCount: found.length ? 1 : 0 };
    }
    if (/^SELECT id, profile_index, created_at, reason, parts, sealed FROM nuvio_backups/.test(text)) {
      const found = rows.filter((r) => r.setup_uuid === params[0] && r.id === params[1]);
      return { rows: clone(found).map((r, i) => ({ ...r, created_at: found[i].created_at })), rowCount: found.length };
    }
    if (/^SELECT id, profile_index, created_at, reason, parts FROM nuvio_backups/.test(text)) {
      const found = newestFirst(rows.filter((r) => r.setup_uuid === params[0] && (params.length < 2 || r.profile_index === params[1])));
      return { rows: found.map(({ sealed, ...rest }) => rest), rowCount: found.length };
    }
    throw new Error(`fake pool: unexpected SQL ${text}`);
  }
  return { rows, query };
}

module.exports = { createFakeNuvio, createFakeBackupPool, SECRET_URL };
