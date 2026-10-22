// Server-held key for the config store. This is deliberately NOT the user's
// password: addon reads must work with only the install URL, so the server has
// to be able to open a row on its own. The password is the edit gate; this key
// is what stops a database dump from being readable.
const crypto = require('node:crypto') as typeof import('node:crypto');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

export interface ServerKeyOptions {
  env?: Record<string, string | undefined>;
  allowGenerate?: boolean;
  keyFile?: string;
}

const KEY_BYTES = 32;

// A 64-char hex value is the documented form. Anything else is hashed, so an
// operator can use a passphrase without weakening the cipher.
function keyFromString(value: unknown): Buffer | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw).digest();
}

function keyFilePath(): string {
  const dir = process.env.DATA_DIR || process.env.PICTORIUM_DATA_DIR || '/data';
  return path.join(dir, 'setup.key');
}

// Resolution order: CONFIG_SECRET, then the existing ENCRYPTION_KEY, then a
// generated key file in the data directory. Self-hosters get a working default
// without configuring anything.
function loadServerKey(options: ServerKeyOptions = {}): Buffer | null {
  const env = options.env ?? process.env;
  const fromEnv = keyFromString(env.CONFIG_SECRET) || keyFromString(env.ENCRYPTION_KEY);
  if (fromEnv) return fromEnv;
  if (options.allowGenerate === false) return null;

  const file = options.keyFile ?? keyFilePath();
  try {
    const key = keyFromString(fs.readFileSync(file, 'utf8'));
    if (key) return key;
  } catch { /* create one below */ }

  const generated = crypto.randomBytes(KEY_BYTES);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated.toString('hex'), { mode: 0o600 });
  } catch {
    // No writable data directory: keep working in memory. Rows created this way
    // are unreadable after a restart, which is the safer failure.
  }
  return generated;
}

export interface KeysApi {
  loadServerKey: (options?: ServerKeyOptions) => Buffer | null;
  keyFromString: (value: unknown) => Buffer | null;
  keyFilePath: () => string;
  KEY_BYTES: number;
}
module.exports = { loadServerKey, keyFromString, keyFilePath, KEY_BYTES } satisfies KeysApi;
