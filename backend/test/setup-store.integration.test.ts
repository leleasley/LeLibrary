// @ts-nocheck
'use strict';
// Real-database coverage for the config store. Skipped unless a test database
// is provided, so the public/CI suite stays self-host safe.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const DATABASE_URL = process.env.SETUP_TEST_DATABASE_URL;
const KEY = crypto.createHash('sha256').update('integration-key').digest();

const skip = DATABASE_URL ? false : 'SETUP_TEST_DATABASE_URL not set';

test('config store creates, resolves, edits and re-keys a row', { skip }, async () => {
  const { Pool } = require('pg');
  const { createConfigStore } = require('../src/setup/config-store.ts');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  const store = createConfigStore({ pool, key: KEY });

  try {
    await pool.query('DROP TABLE IF EXISTS configs');
    await store.migrate();

    const created = await store.create({
      tier: 'partial',
      name: 'Test setup',
      config: { provider: 'torbox', lang: 'en-US', libraryCatalogs: ['lib-trending_movies'] },
      keys: { torboxApiKey: 'synthetic-debrid-key', tmdbApiKey: 'synthetic-tmdb-key' },
      password: 'a-good-password',
    });
    assert.equal(created.tier, 'partial');
    assert.equal(created.installToken, `${created.uuid}.${created.secret}`);

    // Addon read path: install token only, no password.
    const served = await store.resolveByToken(created.installToken);
    assert.ok(served);
    assert.equal(served.uuid, created.uuid);
    assert.equal(served.config.lang, 'en-US');
    assert.equal(served.keys.torboxApiKey, 'synthetic-debrid-key');
    assert.equal(served.hasPassword, true);

    // Wrong secret cannot resolve.
    assert.equal(await store.resolveByToken(`${created.uuid}.${'z'.repeat(32)}`), null);
    assert.equal(await store.resolveByToken('garbage'), null);

    // Password gates editing.
    assert.equal(await store.checkPassword(created.uuid, 'a-good-password'), true);
    assert.equal(await store.checkPassword(created.uuid, 'not-the-password'), false);

    // Editing replaces structure and keys, and does not disturb the secret.
    const saved = await store.save(created.uuid, { config: { provider: 'realdebrid', lang: 'de-DE' } });
    assert.equal(saved.tier, 'partial');
    const afterSave = await store.resolveByToken(created.installToken);
    assert.equal(afterSave.config.provider, 'realdebrid');
    assert.equal(afterSave.keys.tmdbApiKey, 'synthetic-tmdb-key');

    // Engine config merges structure and credentials for the existing engines.
    const engine = store.toEngineConfig(afterSave);
    assert.equal(engine.provider, 'realdebrid');
    assert.equal(engine.tmdbApiKey, 'synthetic-tmdb-key');

    // A rotated secret invalidates the old URL and works with the new one.
    const rotated = await store.rotateSecret(created.uuid);
    assert.equal(await store.resolveByToken(created.installToken), null);
    const rotatedRead = await store.resolveByToken(rotated.installToken);
    assert.equal(rotatedRead.uuid, created.uuid);

    // Changing the password keeps reads working and swaps the gate.
    assert.equal(await store.setPassword(created.uuid, 'another-good-password'), true);
    assert.equal(await store.checkPassword(created.uuid, 'another-good-password'), true);
    assert.equal(await store.checkPassword(created.uuid, 'a-good-password'), false);
    assert.ok(await store.resolveByToken(rotated.installToken));
  } finally {
    await pool.query('DROP TABLE IF EXISTS configs').catch(() => {});
    await pool.end();
  }
});

export interface SetupStoreIntegrationTestTestModule {};
