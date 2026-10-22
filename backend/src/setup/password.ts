// The password gates editing only. It is salted and KDF-hashed; it is never
// involved in serving addon reads.
const crypto = require('node:crypto') as typeof import('node:crypto');

export interface KdfParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export interface PasswordRecord {
  salt: string;
  hash: string;
  kdf: KdfParams;
}

const PARAMS: KdfParams = { N: 16384, r: 8, p: 1, keylen: 64 };
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keylen, {
      N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024,
    }, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
}

async function hashPassword(password: unknown, params: KdfParams = PARAMS): Promise<PasswordRecord> {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params);
  return { salt: salt.toString('base64'), hash: hash.toString('base64'), kdf: { ...params } };
}

interface PasswordRow {
  password_hash?: unknown;
  password_salt?: unknown;
  password_kdf?: unknown;
}

function recordFromRow(row: PasswordRow | null | undefined): PasswordRecord | null {
  if (!row || typeof row.password_hash !== 'string' || typeof row.password_salt !== 'string') return null;
  const kdf = (row.password_kdf && typeof row.password_kdf === 'object')
    ? row.password_kdf as Partial<KdfParams>
    : PARAMS;
  return {
    salt: row.password_salt,
    hash: row.password_hash,
    kdf: {
      N: kdf.N ?? PARAMS.N,
      r: kdf.r ?? PARAMS.r,
      p: kdf.p ?? PARAMS.p,
      keylen: kdf.keylen ?? PARAMS.keylen,
    },
  };
}

async function verifyPassword(password: unknown, record: PasswordRecord | null): Promise<boolean> {
  if (!record || typeof password !== 'string') return false;
  const expected = Buffer.from(record.hash, 'base64');
  const actual = await derive(password, Buffer.from(record.salt, 'base64'), record.kdf);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export interface PasswordApi {
  hashPassword: (password: unknown, params?: KdfParams) => Promise<PasswordRecord>;
  verifyPassword: (password: unknown, record: PasswordRecord | null) => Promise<boolean>;
  recordFromRow: (row: PasswordRow | null | undefined) => PasswordRecord | null;
  PARAMS: KdfParams;
}
module.exports = { hashPassword, verifyPassword, recordFromRow, PARAMS } satisfies PasswordApi;
