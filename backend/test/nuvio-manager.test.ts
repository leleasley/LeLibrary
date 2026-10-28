// @ts-nocheck
// Nuvio manager (5.8): client, projection, operations, backups and routes,
// against an in-memory Nuvio. No network, no real accounts.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createFakeNuvio, createFakeBackupPool, SECRET_URL } = require('./helpers/fake-nuvio.ts');
const { createNuvioClient } = require('../src/nuvio/client.ts');
const projection = require('../src/nuvio/projection.ts');
const { createNuvioService, validAddonUrl } = require('../src/nuvio/service.ts');
const backups = require('../src/nuvio/backups.ts');
const { mountSetupNuvioRoutes } = require('../src/routes/setup-nuvio.ts');
const { createEditSessionStore } = require('../src/setup/edit-sessions.ts');

const UUID = '00000000-0000-4000-8000-000000000001';
const OWN = { origin: 'https://lelibrary.example', uuid: UUID };
const KEY = crypto.randomBytes(32);

function setup(options = {}) {
  const nuvio = createFakeNuvio(options);
  const pool = createFakeBackupPool();
  const store = backups.createBackupStore({ pool, key: KEY });
  let saved = null;
  const client = createNuvioClient({
    uuid: UUID,
    connection: { nuvioToken: options.token || 'access-0', nuvioRefresh: 'refresh-0' },
    http: nuvio.http,
    persist: async (conn) => { saved = conn; },
  });
  const service = createNuvioService({ client, backups: store, own: OWN, fetchManifestName: options.fetchManifestName || (async () => 'Cool Addon') });
  return { nuvio, pool, store, client, service, saved: () => saved };
}

const writes = (calls) => calls.filter((c) => c.method !== 'GET' && !/sync_pull_|get_sync_owner|\/auth\//.test(c.url));

// ── Projection ────────────────────────────────────────────────

test('projections never carry links, tokens or PIN state beyond pinEnabled', async () => {
  const { service } = setup();
  const state = await service.profileState(1);
  const text = JSON.stringify(state);
  assert.ok(!text.includes('SECRETKEY123'), 'no addon link');
  assert.ok(!text.includes('s3cr3t'), 'not even our own install secret');
  assert.ok(!/pin_hash|\$2b\$|access-0|refresh-0|"url"/.test(text));
  assert.deepEqual(Object.keys(state.addons[0]).sort(), ['enabled', 'host', 'id', 'isLeLibrary', 'name', 'order']);
  assert.deepEqual(Object.keys(state.profile).sort(), ['avatarUrl', 'color', 'index', 'isPrimary', 'name', 'pinEnabled', 'usesPrimaryAddons']);
  assert.equal(state.addons[0].host, 'torrentio.strem.fun');
  assert.equal(state.addons[1].isLeLibrary, true);
  assert.equal(state.addons[2].name, 'opensubtitles.example', 'no name falls back to the host');
  assert.equal(state.profile.pinEnabled, true);
  assert.equal(state.addonsFrom, 1);
  assert.deepEqual(state.collections.map((c) => [c.id, c.folders, c.isLeLibrary, c.hidden]), [
    ['collection-lelibrary-hub', 2, true, false], ['aiometadata-trending', 0, false, false],
  ]);
  assert.deepEqual(state.home.items.map((i) => i.key), [
    'community.lelibrary:movie:torbox-movies', 'com.other:series:top', 'collection_collection-lelibrary-hub',
  ]);
  assert.equal(state.home.items[1].title, 'Top shows');
  assert.equal(state.home.items[2].title, 'LeLibrary');
  assert.equal(state.settings.values.autoPlayMode, 'FIRST_STREAM');
  assert.equal(state.settings.values.autoPlayTimeout, -1);
  assert.equal(state.settings.values.subtitleLanguage, 'en');
  assert.equal(state.settings.values.hideUnreleased, false);
  assert.deepEqual(state.settings.values.skipSegments, ['intro']);
  assert.deepEqual(state.settings.platforms, { tv: true, mobile: true });
});

test('our own row is the install link of this setup, or LeLibrary on our host', () => {
  assert.equal(projection.isOwnAddon({ url: `https://lelibrary.example/${UUID}.x/manifest.json`, name: 'Whatever' }, OWN), true);
  assert.equal(projection.isOwnAddon({ url: 'https://lelibrary.example/11111111-0000-4000-8000-000000000001.x/manifest.json', name: 'LeLibrary' }, OWN), true);
  assert.equal(projection.isOwnAddon({ url: 'https://evil.example/manifest.json', name: 'LeLibrary' }, OWN), false);
  assert.equal(projection.isOwnAddon({ url: 'https://lelibrary.example/other/manifest.json', name: 'Other' }, OWN), false);
});

test('a profile on the main profile\'s addons reads profile 1\'s list', async () => {
  const { nuvio, service } = setup();
  nuvio.state.profiles[1].uses_primary_addons = true;
  const state = await service.profileState(2);
  assert.equal(state.addonsFrom, 1);
  assert.equal(state.addons.length, 3);
  await assert.rejects(service.addAddon(2, { url: 'https://x.example/manifest.json' }), { code: 'invalid' });
});

// ── Addons ────────────────────────────────────────────────────

test('adding an addon is one single-row insert with the owner id and the next sort order', async () => {
  const { nuvio, service } = setup();
  nuvio.calls.length = 0;
  const { addon } = await service.addAddon(1, { url: 'https://cool.example/abc/manifest.json?x=1' });
  assert.equal(addon.name, 'Cool Addon');
  assert.equal(addon.host, 'cool.example');
  assert.equal(addon.order, 3);
  const w = writes(nuvio.calls);
  assert.equal(w.length, 1);
  assert.equal(w[0].method, 'POST');
  assert.ok(w[0].url.includes('/rest/v1/addons'));
  assert.equal(w[0].data.length, 1);
  assert.deepEqual({ ...w[0].data[0], url: undefined }, { user_id: 'owner-1', profile_id: 1, url: undefined, name: 'Cool Addon', enabled: true, sort_order: 3 });
  assert.ok(!nuvio.calls.some((c) => c.url.includes('sync_push_addons')), 'never the full-list push');
  assert.ok(!nuvio.calls.some((c) => c.url.includes('select=*')), 'never select=*');
  const orders = nuvio.state.addons.filter((a) => a.profile_id === 1).map((a) => a.sort_order);
  assert.equal(new Set(orders).size, orders.length, 'unique sort orders');
});

test('add: a failed manifest fetch still installs with the host as the name; bad links and duplicates are refused', async () => {
  const { service } = setup({ fetchManifestName: async () => null });
  const { addon } = await service.addAddon(1, { url: 'https://quiet.example/manifest.json' });
  assert.equal(addon.name, 'quiet.example');
  await assert.rejects(service.addAddon(1, { url: SECRET_URL.replace('/manifest.json', '/Manifest.json/') }), { code: 'invalid' });
  for (const url of ['http://plain.example/manifest.json', 'https://user:pw@x.example/manifest.json', 'https://x.example/', 'https://x.example/manifest.json#a', `https://x.example/${'a'.repeat(2050)}/manifest.json`, 42]) {
    assert.equal(validAddonUrl(url), null, String(url).slice(0, 40));
  }
  assert.equal(validAddonUrl('https://x.example/a/manifest.json?token=1'), 'https://x.example/a/manifest.json?token=1');
});

test('edit, reorder and remove are single-row requests with unique orders', async () => {
  const { nuvio, service } = setup();
  nuvio.calls.length = 0;
  const { addon } = await service.updateAddon(1, 'a3', { enabled: true, name: 'Subs' });
  assert.equal(addon.enabled, true);
  assert.equal(addon.name, 'Subs');
  let w = writes(nuvio.calls);
  assert.equal(w.length, 1);
  assert.equal(w[0].method, 'PATCH');
  assert.match(w[0].url, /id=eq\.a3&profile_id=eq\.1/);
  assert.deepEqual(w[0].data, { name: 'Subs', enabled: true });

  nuvio.calls.length = 0;
  const { addons } = await service.reorderAddons(1, { ids: ['a3', 'a1', 'a2'] });
  assert.deepEqual(addons.map((a) => [a.id, a.order]), [['a3', 0], ['a1', 1], ['a2', 2]]);
  w = writes(nuvio.calls);
  assert.ok(w.every((c) => c.method === 'PATCH' && Object.keys(c.data).join() === 'sort_order'));
  const orders = nuvio.state.addons.filter((a) => a.profile_id === 1).map((a) => a.sort_order).sort();
  assert.deepEqual(orders, [0, 1, 2]);
  await assert.rejects(service.reorderAddons(1, { ids: ['a3', 'a1'] }), { code: 'nuvio-conflict' });

  nuvio.calls.length = 0;
  await service.deleteAddon(1, 'a3');
  w = writes(nuvio.calls);
  assert.equal(w.length, 1);
  assert.equal(w[0].method, 'DELETE');
  assert.match(w[0].url, /id=eq\.a3&profile_id=eq\.1/);
});

test('LeLibrary\'s own row and the last addon cannot be removed', async () => {
  const { nuvio, service } = setup();
  await assert.rejects(service.deleteAddon(1, 'a2'), { code: 'invalid' });
  await assert.rejects(service.deleteAddon(2, 'b1'), { code: 'invalid', message: /at least one addon/ });
  await assert.rejects(service.deleteAddon(1, 'nope'), { code: 'not-found' });
  assert.equal(nuvio.state.addons.length, 4);
});

// ── Profiles ──────────────────────────────────────────────────

test('creating a profile picks the lowest free index and sends the full list with every field', async () => {
  const { nuvio, service } = setup();
  nuvio.state.profiles.push({ profile_index: 3, name: 'Kid', avatar_color_hex: '#00FF00', uses_primary_addons: true });
  nuvio.calls.length = 0;
  const { profile } = await service.createProfile({ name: 'Guest', color: '#123abc' });
  assert.equal(profile.index, 4);
  assert.equal(profile.color, '#123ABC');
  const [push] = nuvio.calls.filter((c) => c.url.endsWith('/sync_push_profiles'));
  assert.equal(push.data.p_client_max_profiles, 6);
  assert.deepEqual(push.data.p_profiles.map((p) => p.profile_index), [1, 2, 3, 4]);
  const mum = push.data.p_profiles[0];
  assert.equal(mum.avatar_id, 'cat-7', 'the catalog avatar is kept');
  assert.equal('avatar_url' in mum, false, 'an empty avatar_url is not sent (it would clear avatar_id)');
  assert.equal(mum.profile_background_url, 'https://img.example/bg.jpg');
  assert.equal(mum.uses_primary_plugins, false);
  assert.equal(push.data.p_profiles[1].uses_primary_plugins, true, 'every flag passes through');
  assert.ok(!push.data.p_profiles.some((p) => 'pin_enabled' in p || 'pin_hash' in p || 'id' in p));
});

test('profile limit at 6', async () => {
  const { nuvio, service } = setup();
  for (let i = 3; i <= 6; i += 1) nuvio.state.profiles.push({ profile_index: i, name: `P${i}` });
  await assert.rejects(service.createProfile({ name: 'Seven' }), { code: 'profile-limit' });
});

test('a new profile can copy another one', async () => {
  const { nuvio, service } = setup();
  const { profile } = await service.createProfile({ name: 'Copy', copyFrom: { index: 1, parts: ['settings', 'addons', 'collections', 'home'] } });
  assert.equal(profile.index, 3);
  const urls = nuvio.state.addons.filter((a) => a.profile_id === 3).sort((a, b) => a.sort_order - b.sort_order).map((a) => a.url);
  assert.deepEqual(urls, nuvio.state.addons.filter((a) => a.profile_id === 1).sort((a, b) => a.sort_order - b.sort_order).map((a) => a.url));
  assert.deepEqual(nuvio.state.collections[3].items, nuvio.state.collections[1].items);
  assert.deepEqual(nuvio.state.home[3].doc, nuvio.state.home[1].doc);
  assert.deepEqual(nuvio.state.blobs['3:tv'].blob, nuvio.state.blobs['1:tv'].blob);
});

test('rename uses the sparse patch; without it the whole list goes back', async () => {
  const { nuvio, service } = setup();
  nuvio.calls.length = 0;
  const { profile } = await service.patchProfile(2, { name: 'Papa', color: '#00ff00' });
  assert.equal(profile.name, 'Papa');
  assert.equal(profile.color, '#00FF00');
  assert.ok(nuvio.calls.some((c) => c.url.endsWith('/sync_patch_profile') && c.data.p_profile_id === 2));
  assert.ok(!nuvio.calls.some((c) => c.url.endsWith('/sync_push_profiles')));

  const legacy = setup({ missingRpcs: ['sync_patch_profile'] });
  legacy.nuvio.calls.length = 0;
  await legacy.service.patchProfile(2, { usesPrimaryAddons: true });
  const [push] = legacy.nuvio.calls.filter((c) => c.url.endsWith('/sync_push_profiles'));
  assert.deepEqual(push.data.p_profiles.map((p) => [p.profile_index, p.uses_primary_addons, p.name]), [[1, false, 'Mum'], [2, true, 'Dad']]);
  await assert.rejects(service.patchProfile(1, { usesPrimaryAddons: true }), { code: 'invalid' });
});

test('delete refuses profile 1, needs the exact name, and backs up first', async () => {
  const { nuvio, store, service } = setup();
  await assert.rejects(service.deleteProfile(1, { confirmName: 'Mum' }), { code: 'profile-protected' });
  await assert.rejects(service.deleteProfile(2, { confirmName: 'dad' }), { code: 'invalid' });
  assert.ok(!nuvio.calls.some((c) => c.url.endsWith('/sync_delete_profile_data')));
  await service.deleteProfile(2, { confirmName: 'Dad' });
  const del = nuvio.calls.filter((c) => c.url.endsWith('/sync_delete_profile_data'));
  assert.equal(del.length, 1);
  assert.equal(del[0].data.p_profile_id, 2);
  const list = await store.list(UUID, 2);
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, 'delete-profile');
});

test('copy: settings through the server copy (TV and phone, never credentials), the rest by us', async () => {
  const { nuvio, store, service } = setup();
  const result = await service.copyProfile(1, { target: 2, parts: ['settings', 'addons'] });
  assert.deepEqual(result, { ok: true, copied: ['settings', 'addons'] });
  const [copy] = nuvio.calls.filter((c) => c.url.endsWith('/sync_copy_profile_setup'));
  assert.equal(copy.data.p_copy_tv, true);
  assert.equal(copy.data.p_copy_mobile, true);
  assert.equal(copy.data.p_copy_provider_credentials, false);
  assert.equal(copy.data.p_source_profile_id, 1);
  assert.equal(copy.data.p_target_profile_id, 2);
  const target = nuvio.state.addons.filter((a) => a.profile_id === 2).sort((a, b) => a.sort_order - b.sort_order);
  assert.deepEqual(target.map((a) => a.sort_order), [0, 1, 2]);
  assert.ok(!target.some((a) => a.url.includes('catalog.nuvio.tv')), 'rows not in the source are removed');
  const [backup] = await store.list(UUID, 2);
  assert.deepEqual(backup.parts, ['settings', 'addons']);
  assert.equal(backup.reason, 'copy');
  await assert.rejects(service.copyProfile(1, { target: 1, parts: ['home'] }), { code: 'invalid' });
  await assert.rejects(service.copyProfile(1, { target: 2, parts: ['watch-history'] }), { code: 'invalid' });
});

// ── Settings ──────────────────────────────────────────────────

test('settings: guarded write of both blobs in their own keys, Home flag too', async () => {
  const { nuvio, service } = setup();
  nuvio.calls.length = 0;
  const { settings } = await service.updateSettings(1, { values: { subtitleLanguage: 'de', hideUnreleased: true, stillWatching: true } });
  const guarded = nuvio.calls.filter((c) => c.url.endsWith('/sync_push_profile_settings_blob_guarded'));
  assert.deepEqual(guarded.map((c) => c.data.p_platform).sort(), ['mobile', 'tv']);
  assert.ok(guarded.every((c) => c.data.p_expected_updated_at && !('p_origin_client_id' in c.data)));
  assert.ok(!nuvio.calls.some((c) => c.url.endsWith('/sync_push_profile_settings_blob')), 'no unguarded write');
  const tv = nuvio.state.blobs['1:tv'].blob.features;
  const mobile = nuvio.state.blobs['1:mobile'].blob.features;
  assert.deepEqual(tv.player_settings.subtitle_preferred_language, { type: 'string', value: 'de' });
  assert.deepEqual(tv.player_settings.some_unknown_key, { type: 'string', value: 'keep me' });
  assert.deepEqual(tv.layout_settings.hide_unreleased_content, { type: 'boolean', value: true });
  assert.deepEqual(mobile.player_settings.preferred_subtitle_language, { type: 'string', value: 'de' });
  assert.equal('still_watching_enabled' in mobile.player_settings, false);
  assert.deepEqual(mobile.notifications_settings, { episode_release_alerts_enabled: true });
  const home = nuvio.state.home[1].doc;
  assert.equal(home.hide_unreleased_content, true);
  assert.equal(home.unknown_top, 'kept');
  assert.equal(home.items.length, 3);
  assert.equal(settings.values.subtitleLanguage, 'de');
  assert.equal(settings.values.hideUnreleased, true);
});

test('settings: never creates a blob, and a device save in between is a conflict', async () => {
  const { nuvio, service } = setup();
  delete nuvio.state.blobs['1:mobile'];
  await service.updateSettings(1, { values: { forcedSubtitles: true } });
  assert.equal(nuvio.state.blobs['1:mobile'], undefined, 'no mobile blob was created');

  const raced = setup();
  // A device saves the TV blob right after we read it.
  let bumped = false;
  const original = raced.client.pushSettings;
  raced.client.pushSettings = async (...args) => {
    if (!bumped) { bumped = true; raced.nuvio.state.blobs['1:tv'].updated_at = '2030-01-01T00:00:00.000Z'; }
    return original(...args);
  };
  await assert.rejects(raced.service.updateSettings(1, { values: { autoPlayMode: 'MANUAL' } }), { code: 'nuvio-conflict', status: 409 });
});

test('settings: a server without the guarded call falls back to the plain push', async () => {
  const { nuvio, service } = setup({ missingRpcs: ['sync_push_profile_settings_blob_guarded'] });
  await service.updateSettings(1, { values: { autoPlayMode: 'MANUAL' } });
  const plain = nuvio.calls.filter((c) => c.url.endsWith('/sync_push_profile_settings_blob'));
  assert.equal(plain.length, 2);
  assert.ok(plain.every((c) => c.data.p_platform && c.data.p_origin_client_id));
  await assert.rejects(service.updateSettings(1, { values: { autoPlayMode: 'NOPE' } }), { code: 'invalid' });
});

// ── Collections and Home ─────────────────────────────────────

test('collections: hide through Home, reorder keeps objects, delete only LeLibrary\'s own', async () => {
  const { nuvio, service } = setup();
  let { collections } = await service.setCollectionHidden(1, 'collection-lelibrary-hub', { hidden: true });
  assert.equal(collections.find((c) => c.id === 'collection-lelibrary-hub').hidden, true);
  const hubItem = nuvio.state.home[1].doc.items.find((i) => i.collection_id === 'collection-lelibrary-hub');
  assert.equal(hubItem.enabled, false);
  ({ collections } = await service.setCollectionHidden(1, 'aiometadata-trending', { hidden: true }));
  assert.equal(collections.find((c) => c.id === 'aiometadata-trending').hidden, true, 'a missing Home row is added');
  assert.equal(nuvio.state.home[1].doc.items.length, 4);

  ({ collections } = await service.reorderCollections(1, { ids: ['aiometadata-trending', 'collection-lelibrary-hub'] }));
  assert.deepEqual(collections.map((c) => c.id), ['aiometadata-trending', 'collection-lelibrary-hub']);
  assert.deepEqual(nuvio.state.collections[1].items[1].extra, { keep: 1 }, 'unknown fields kept');

  await assert.rejects(service.deleteCollection(1, 'aiometadata-trending'), { code: 'invalid' });
  ({ collections } = await service.deleteCollection(1, 'collection-lelibrary-hub'));
  assert.deepEqual(collections.map((c) => c.id), ['aiometadata-trending']);
});

test('Home: full new order with on/off, other fields kept, stale lists refused', async () => {
  const { nuvio, service } = setup();
  const { home } = await service.setHome(1, { items: [
    { key: 'collection_collection-lelibrary-hub', enabled: true },
    { key: 'com.other:series:top', enabled: true },
    { key: 'community.lelibrary:movie:torbox-movies', enabled: false },
  ] });
  assert.deepEqual(home.items.map((i) => [i.key, i.enabled, i.order]), [
    ['collection_collection-lelibrary-hub', true, 0], ['com.other:series:top', true, 1], ['community.lelibrary:movie:torbox-movies', false, 2],
  ]);
  const doc = nuvio.state.home[1].doc;
  assert.equal(doc.unknown_top, 'kept');
  assert.equal(doc.show_catalog_type, true);
  assert.equal(doc.items[2].extra_field, 7);
  await assert.rejects(service.setHome(1, { items: [{ key: 'com.other:series:top', enabled: true }] }), { code: 'nuvio-conflict' });
});

// ── Backups ───────────────────────────────────────────────────

test('backups are sealed (addon links never readable in the table) and capped at 10 per profile', async () => {
  const { pool, store, service } = setup();
  for (let i = 0; i < 12; i += 1) await service.backupNow(1);
  await service.backupNow(2);
  assert.equal((await store.list(UUID, 1)).length, 10);
  assert.equal((await store.list(UUID, 2)).length, 1);
  assert.equal((await store.list(UUID)).length, 11);
  const raw = JSON.stringify(pool.rows);
  assert.ok(!raw.includes('SECRETKEY123') && !raw.includes('torrentio'), 'links are sealed');
  assert.deepEqual(Object.keys(pool.rows[0].sealed).sort(), ['ct', 'iv', 'tag', 'v']);
  const [newest] = await store.list(UUID, 1);
  const opened = await store.get(UUID, newest.id);
  assert.equal(opened.snapshot.addons[0].url, SECRET_URL, 'the server can open its own backup');
  const otherKey = backups.createBackupStore({ pool, key: crypto.randomBytes(32) });
  assert.equal(await otherKey.get(UUID, newest.id), null, 'unreadable with another key');
  assert.equal(await store.get('22222222-0000-4000-8000-000000000001', newest.id), null, 'scoped to the setup');
});

test('restore puts managed parts back; undo restores the newest automatic backup and steps back', async () => {
  const { nuvio, store, service } = setup();
  const before = JSON.stringify(nuvio.state.addons.filter((a) => a.profile_id === 1).map(({ url, name, enabled, sort_order }) => ({ url, name, enabled, sort_order })).sort((a, b) => a.sort_order - b.sort_order));
  await service.addAddon(1, { url: 'https://one.example/manifest.json' });
  await service.updateAddon(1, 'a1', { enabled: false });
  let result = await service.undo(1);
  assert.deepEqual(result.restored, ['addons']);
  assert.equal(nuvio.state.addons.find((a) => a.id === 'a1').enabled, true, 'last change undone');
  assert.ok(nuvio.state.addons.some((a) => a.url === 'https://one.example/manifest.json'), 'the earlier change stays');
  result = await service.undo(1);
  const after = JSON.stringify(nuvio.state.addons.filter((a) => a.profile_id === 1).map(({ url, name, enabled, sort_order }) => ({ url, name, enabled, sort_order })).sort((a, b) => a.sort_order - b.sort_order));
  assert.equal(after, before, 'back to the start');
  await assert.rejects(service.undo(1), { code: 'not-found' });
  const reasons = (await store.list(UUID, 1)).map((b) => b.reason);
  assert.deepEqual(reasons, ['undo', 'undo'], 'undos keep a backup of what they replaced and are never undone themselves');

  // Settings, collections and Home from a manual backup, into another profile.
  const { backup } = await service.backupNow(1);
  nuvio.state.blobs['2:tv'] = { blob: { version: 1, features: { player_settings: {} } }, updated_at: '2026-10-28T09:00:00.000Z' };
  const restored = await service.restore(backup.id, { target: 2 });
  assert.deepEqual(restored.restored, ['settings', 'addons', 'collections', 'home']);
  assert.equal(backup.reason, 'manual');
  assert.equal((await store.list(UUID, 2))[0].reason, 'restore');
  assert.deepEqual(nuvio.state.blobs['2:tv'].blob, nuvio.state.blobs['1:tv'].blob);
  assert.deepEqual(nuvio.state.collections[2].items, nuvio.state.collections[1].items);
  assert.ok(!nuvio.calls.some((c) => /restore_account_backup|sync_push_addons/.test(c.url)));
});

// ── Client: tokens ────────────────────────────────────────────

test('two concurrent 401s share one refresh, and the rotated token is saved', async () => {
  const nuvio = createFakeNuvio({ accessToken: 'access-new' });
  nuvio.state.refreshToken = 'refresh-0';
  nuvio.state.refreshDelayMs = 20;
  let saves = 0;
  let saved = null;
  const make = () => createNuvioClient({
    uuid: UUID,
    connection: { nuvioToken: 'access-old', nuvioRefresh: 'refresh-0' },
    http: nuvio.http,
    persist: async (conn) => { saves += 1; saved = conn; },
  });
  const a = make();
  const b = make();
  const [pa, pb] = await Promise.all([a.pullProfiles(), b.pullProfiles()]);
  assert.equal(pa.length, 2);
  assert.equal(pb.length, 2);
  assert.equal(nuvio.state.refreshes, 1, 'one refresh for both');
  assert.equal(saves, 1);
  assert.equal(saved.nuvioToken, 'access-1');
  assert.equal(saved.nuvioRefresh, 'refresh-1');
  assert.equal(a.connection().nuvioToken, 'access-1');
});

test('a token already rotated elsewhere is reused instead of refreshing again', async () => {
  const nuvio = createFakeNuvio({ accessToken: 'access-stored' });
  const client = createNuvioClient({
    uuid: '00000000-0000-4000-8000-0000000000aa',
    connection: { nuvioToken: 'access-old', nuvioRefresh: 'refresh-old' },
    http: nuvio.http,
    reload: async () => ({ nuvioToken: 'access-stored', nuvioRefresh: 'refresh-stored' }),
  });
  await client.pullProfiles();
  assert.equal(nuvio.state.refreshes, 0);
});

test('a refused refresh is a session-expired error', async () => {
  const nuvio = createFakeNuvio({ accessToken: 'access-x', refreshToken: 'refresh-x' });
  const client = createNuvioClient({ uuid: '00000000-0000-4000-8000-0000000000bb', connection: { nuvioToken: 'stale', nuvioRefresh: 'wrong' }, http: nuvio.http });
  await assert.rejects(client.pullProfiles(), { code: 'nuvio-session-expired' });
});

// ── Routes ────────────────────────────────────────────────────

async function withApp(fn, options = {}) {
  const nuvio = createFakeNuvio(options);
  const pool = createFakeBackupPool();
  const backupStore = backups.createBackupStore({ pool, key: KEY });
  const keys = { push: { nuvio: { nuvioToken: 'access-0', nuvioRefresh: 'refresh-0', nuvioUser: { email: 'mum@example.com' }, nuvioSelectedProfile: 1 } } };
  const setupStore = {
    keys: options.noConnection ? {} : keys,
    async resolveByUuid(uuid) { return uuid === UUID ? { uuid, keys: this.keys, config: {}, secret: 's3cr3t' } : null; },
    async resolveByToken() { return null; },
    async save(uuid, input) { this.keys = input.keys; return { uuid }; },
  };
  const sessions = createEditSessionStore();
  const app = express();
  mountSetupNuvioRoutes(app, {
    editSessions: sessions,
    deps: { getStore: async () => setupStore, getBackups: () => backupStore, http: nuvio.http, fetchManifestName: async () => null },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const savedBase = process.env.BASE_URL;
  process.env.BASE_URL = OWN.origin;
  const base = `http://127.0.0.1:${server.address().port}/api/setup/${UUID}/nuvio`;
  const token = sessions.issue(UUID).token;
  const call = async (method, path, body, auth = token) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, nuvio, setupStore, sessions });
  } finally {
    server.close();
    if (savedBase === undefined) delete process.env.BASE_URL; else process.env.BASE_URL = savedBase;
  }
}

test('routes need this setup\'s edit token and answer no-store', async () => {
  await withApp(async ({ call, sessions }) => {
    const other = sessions.issue('11111111-0000-4000-8000-000000000001').token;
    const routes = [
      ['GET', ''], ['GET', '/profiles/1'], ['POST', '/profiles', {}], ['PATCH', '/profiles/2', {}], ['DELETE', '/profiles/2', {}],
      ['POST', '/profiles/1/copy', {}], ['PATCH', '/profiles/1/settings', {}], ['POST', '/profiles/1/addons', {}],
      ['PATCH', '/profiles/1/addons/a1', {}], ['PUT', '/profiles/1/addons/order', {}], ['DELETE', '/profiles/1/addons/a1'],
      ['PATCH', '/profiles/1/collections/x', {}], ['PUT', '/profiles/1/collections/order', {}], ['DELETE', '/profiles/1/collections/x'],
      ['PUT', '/profiles/1/home', {}], ['GET', '/backups?profile=1'], ['POST', '/profiles/1/backups'],
      ['POST', `/backups/${UUID}/restore`, {}], ['POST', '/profiles/1/undo'],
    ];
    for (const [method, path, body] of routes) {
      const none = await call(method, path, body, null);
      assert.equal(none.status, 401, `${method} ${path}`);
      assert.equal(none.cache, 'no-store');
      const wrong = await call(method, path, body, other);
      assert.equal(wrong.status, 401, `${method} ${path} with another setup's token`);
    }
  });
});

test('routes: overview, profile state, errors with codes, no links in any response', async () => {
  await withApp(async ({ call, nuvio }) => {
    const overview = await call('GET', '');
    assert.equal(overview.status, 200);
    assert.equal(overview.cache, 'no-store');
    assert.equal(overview.body.user, 'mum@example.com');
    assert.equal(overview.body.selected, 1);
    assert.equal(overview.body.maxProfiles, 6);
    assert.deepEqual(overview.body.profiles.map((p) => p.index), [1, 2]);
    const state = await call('GET', '/profiles/1');
    assert.equal(state.status, 200);
    assert.ok(!JSON.stringify(state.body).includes('SECRETKEY123'));
    assert.ok(typeof state.body.readAt === 'string');
    assert.equal((await call('GET', '/profiles/5')).body.code, 'not-found');
    assert.equal((await call('GET', '/profiles/9')).status, 400);
    const del = await call('DELETE', '/profiles/1', { confirmName: 'Mum' });
    assert.deepEqual([del.status, del.body.code], [409, 'profile-protected']);
    const own = await call('DELETE', '/profiles/1/addons/a2');
    assert.deepEqual([own.status, own.body.code], [400, 'invalid']);
    const added = await call('POST', '/profiles/1/addons', { url: 'https://new.example/manifest.json' });
    assert.equal(added.status, 200);
    assert.equal(added.body.addon.name, 'new.example');
    assert.ok(!JSON.stringify(added.body).includes('https://'));
    const order = await call('PUT', '/profiles/1/addons/order', { ids: ['a3', 'a2', 'a1', added.body.addon.id] });
    assert.deepEqual(order.body.addons.map((a) => a.id), ['a3', 'a2', 'a1', added.body.addon.id]);
    const backupsList = await call('GET', '/backups?profile=1');
    assert.equal(backupsList.body.backups.length, 2);
    const undo = await call('POST', '/profiles/1/undo');
    assert.deepEqual(undo.body, { ok: true, restored: ['addons'] });
    const missing = await call('POST', '/backups/not-a-uuid/restore', {});
    assert.equal(missing.body.code, 'not-found');
  });
});

test('routes: a setup without Nuvio is nuvio-not-connected', async () => {
  await withApp(async ({ call }) => {
    const res = await call('GET', '');
    assert.deepEqual([res.status, res.body.code], [409, 'nuvio-not-connected']);
  }, { noConnection: true });
});

test('routes: a conflict is 409 nuvio-conflict', async () => {
  await withApp(async ({ call, nuvio }) => {
    // Every guarded write sees a newer save than the one read.
    const realBlobs = nuvio.state.blobs;
    let reads = 0;
    Object.defineProperty(nuvio.state, 'blobs', { get() { reads += 1; if (reads > 2) realBlobs['1:tv'].updated_at = `2031-01-01T00:00:${String(reads % 60).padStart(2, '0')}.000Z`; return realBlobs; } });
    const res = await call('PATCH', '/profiles/1/settings', { values: { autoPlayMode: 'MANUAL' } });
    assert.deepEqual([res.status, res.body.code], [409, 'nuvio-conflict']);
  });
});

test('routes: a rotated token is saved back into the sealed connection', async () => {
  await withApp(async ({ call, nuvio, setupStore }) => {
    nuvio.state.accessToken = 'access-rotated-elsewhere';
    const res = await call('GET', '');
    assert.equal(res.status, 200);
    assert.equal(nuvio.state.refreshes, 1);
    assert.equal(setupStore.keys.push.nuvio.nuvioToken, 'access-1');
    assert.equal(setupStore.keys.push.nuvio.nuvioRefresh, 'refresh-1');
    assert.equal(setupStore.keys.push.nuvio.nuvioSelectedProfile, 1, 'the rest of the connection is kept');
    assert.ok(!JSON.stringify(res.body).includes('access-1'));
  });
});

test('create-flow preview reads a profile\'s settings with the browser\'s session, read only', async () => {
  const nuvio = createFakeNuvio({});
  const app = express();
  mountSetupNuvioRoutes(app, { editSessions: createEditSessionStore(), deps: { http: nuvio.http } });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/setup/nuvio/preview-settings`;
    const post = (headers, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const ok = await post({ 'x-nuvio-access-token': 'access-0' }, { profile: 1 });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const { settings } = await ok.json();
    assert.equal(settings.values.autoPlayMode, 'FIRST_STREAM');
    assert.equal(settings.values.hideUnreleased, false);
    assert.deepEqual(settings.platforms, { tv: true, mobile: true });
    assert.equal(writes(nuvio.calls).length, 0, 'nothing written to Nuvio');
    assert.equal((await post({}, { profile: 1 })).status, 401, 'no session, no read');
    assert.equal((await post({ 'x-nuvio-access-token': 'wrong' }, { profile: 1 })).status, 409, 'a stale session says sign in again');
    assert.equal((await post({ 'x-nuvio-access-token': 'access-0' }, { profile: 9 })).status, 400);
  } finally {
    server.close();
  }
});
