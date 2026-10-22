// @ts-nocheck
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { seal, unseal } = require('../src/setup/seal.ts');
const { hashPassword, verifyPassword, recordFromRow } = require('../src/setup/password.ts');
const { newUuid, isUuid, newSecret, buildInstallToken, parseInstallToken, secretHash } = require('../src/setup/token.ts');
const { createPasswordLimiter } = require('../src/setup/rate-limit.ts');
const { loadServerKey, keyFromString } = require('../src/setup/keys.ts');
const { createEditSessionStore, bearerToken } = require('../src/setup/edit-sessions.ts');

const KEY = crypto.createHash('sha256').update('unit-test-key').digest();

test('seal round-trips structured values', () => {
  const value = { provider: 'torbox', nested: { list: [1, 2, 3] }, unicode: 'Hello \u2014 caf\u00e9' };
  const sealed = seal(KEY, value);
  assert.deepEqual(unseal(KEY, sealed), value);
});

test('seal envelope never contains the plaintext', () => {
  const sealed = seal(KEY, { torboxApiKey: 'super-secret-key' });
  assert.ok(!JSON.stringify(sealed).includes('super-secret-key'));
  assert.equal(sealed.v, 1);
});

test('unseal rejects tampered ciphertext, wrong key and malformed input', () => {
  const sealed = seal(KEY, { a: 1 });
  const other = crypto.createHash('sha256').update('other-key').digest();
  assert.equal(unseal(other, sealed), null);
  assert.equal(unseal(KEY, { ...sealed, ct: Buffer.from('nope').toString('base64') }), null);
  assert.equal(unseal(KEY, { ...sealed, tag: Buffer.alloc(16).toString('base64') }), null);
  assert.equal(unseal(KEY, null), null);
  assert.equal(unseal(KEY, 'not-an-envelope'), null);
});

test('password hashing salts each record and verifies with timing-safe compare', async () => {
  const first = await hashPassword('correct horse battery');
  const second = await hashPassword('correct horse battery');
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword('correct horse battery', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('', first), false);
});

test('password hashing refuses short passwords', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 8 characters/);
  await assert.rejects(() => hashPassword(''), /at least 8 characters/);
});

test('recordFromRow returns null without a stored password', () => {
  assert.equal(recordFromRow({}), null);
  assert.equal(recordFromRow(null), null);
  const record = recordFromRow({ password_hash: 'aGFzaA==', password_salt: 'c2FsdA==' });
  assert.deepEqual(record, { salt: 'c2FsdA==', hash: 'aGFzaA==', kdf: { N: 16384, r: 8, p: 1, keylen: 64 } });
});

test('uuid helpers validate the canonical form', () => {
  const uuid = newUuid();
  assert.equal(isUuid(uuid), true);
  assert.equal(isUuid(uuid.toUpperCase()), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid('123e4567-e89b-12d3-a456-42661417400'), false);
});

test('install tokens carry the uuid and secret and reject anything else', () => {
  const uuid = newUuid();
  const secret = newSecret();
  const token = buildInstallToken(uuid, secret);
  assert.deepEqual(parseInstallToken(token), { uuid: uuid.toLowerCase(), secret });
  assert.equal(parseInstallToken(`${uuid}.`), null);
  assert.equal(parseInstallToken(`.${secret}`), null);
  assert.equal(parseInstallToken(uuid), null);
  assert.equal(parseInstallToken('short.short'), null);
  assert.equal(parseInstallToken(`${uuid}.bad secret with spaces`), null);
  assert.equal(parseInstallToken(null), null);
});

test('secrets are high entropy and hash deterministically', () => {
  const a = newSecret();
  const b = newSecret();
  assert.notEqual(a, b);
  assert.ok(a.length >= 30);
  assert.equal(secretHash(a), secretHash(a));
  assert.notEqual(secretHash(a), secretHash(b));
});

test('server key resolution prefers env, then falls back to a generated file', () => {
  const hex = 'a'.repeat(64);
  assert.equal(loadServerKey({ env: { CONFIG_SECRET: hex } }).toString('hex'), hex);
  assert.equal(loadServerKey({ env: { ENCRYPTION_KEY: hex } }).toString('hex'), hex);
  assert.equal(keyFromString('passphrase').length, 32);
  assert.equal(keyFromString(''), null);
});

test('password limiter locks a uuid after repeated failures and clears on success', () => {
  let clock = 1_000_000;
  const limiter = createPasswordLimiter({ now: () => clock, maxPerUuid: 3, lockoutMs: 60_000, maxPerIp: 100 });

  assert.equal(limiter.check('1.2.3.4', 'uuid-a').allowed, true);
  limiter.fail('1.2.3.4', 'uuid-a');
  limiter.fail('1.2.3.4', 'uuid-a');
  const third = limiter.fail('1.2.3.4', 'uuid-a');
  assert.equal(third.locked, true);

  const blocked = limiter.check('1.2.3.4', 'uuid-a');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'lockout');

  // A different config is unaffected by that uuid's lockout.
  assert.equal(limiter.check('1.2.3.4', 'uuid-b').allowed, true);

  clock += 60_001;
  assert.equal(limiter.check('1.2.3.4', 'uuid-a').allowed, true);

  limiter.fail('1.2.3.4', 'uuid-a');
  limiter.succeed('1.2.3.4', 'uuid-a');
  assert.equal(limiter.lockedUntil('uuid-a'), 0);
});

test('password limiter caps attempts per ip even across different uuids', () => {
  let clock = 5_000;
  const limiter = createPasswordLimiter({ now: () => clock, maxPerIp: 2, windowMs: 60_000, maxPerUuid: 99 });
  limiter.fail('9.9.9.9', 'uuid-1');
  limiter.fail('9.9.9.9', 'uuid-2');
  const blocked = limiter.check('9.9.9.9', 'uuid-3');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'ip');
  clock += 60_001;
  assert.equal(limiter.check('9.9.9.9', 'uuid-3').allowed, true);
});

test('edit sessions issue an opaque bearer token and expire', () => {
  let clock = 1_000;
  const store = createEditSessionStore({ now: () => clock, ttlMs: 1_000 });
  const { token, expiresAt } = store.issue('AbC-uuid');
  assert.ok(token.length >= 32);
  assert.equal(expiresAt, 2_000);
  assert.deepEqual(store.verify(token), { uuid: 'abc-uuid' });

  clock = 2_001;
  assert.equal(store.verify(token), null);
});

test('edit sessions reject forged, malformed and revoked tokens', () => {
  const store = createEditSessionStore();
  const { token } = store.issue('uuid-1');
  assert.equal(store.verify('x'.repeat(40)), null);
  assert.equal(store.verify(''), null);
  assert.equal(store.verify(null), null);
  assert.equal(store.verify(token).uuid, 'uuid-1');
  store.revokeUuid('uuid-1');
  assert.equal(store.verify(token), null);
  assert.equal(store.size(), 0);
});

test('edit sessions are scoped to one setup', () => {
  const store = createEditSessionStore();
  const a = store.issue('uuid-a');
  const b = store.issue('uuid-b');
  assert.equal(store.verify(a.token).uuid, 'uuid-a');
  assert.equal(store.verify(b.token).uuid, 'uuid-b');
  store.revokeUuid('uuid-a');
  assert.equal(store.verify(a.token), null);
  assert.equal(store.verify(b.token).uuid, 'uuid-b');
});

test('bearerToken reads only the Authorization header', () => {
  assert.equal(bearerToken({ headers: { authorization: 'Bearer abc123' } }), 'abc123');
  assert.equal(bearerToken({ headers: { authorization: 'bearer   spaced  ' } }), 'spaced');
  assert.equal(bearerToken({ headers: { authorization: 'Basic abc123' } }), null);
  assert.equal(bearerToken({ headers: { cookie: 'edit=abc123' } }), null);
  assert.equal(bearerToken({ headers: {} }), null);
  assert.equal(bearerToken({}), null);
});

export interface SetupCoreTestTestModule {};
