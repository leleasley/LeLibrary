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
// In-memory fallback keys (no writable data directory), one per key file.
const memoryKeys = new Map<string, Buffer>();

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
  // SECURITY (5.9.6, audit B5): only a genuinely missing key file is created.
  // An existing file that cannot be read (permissions, I/O) or is empty is
  // never replaced: a new key would silently orphan every sealed setup. The
  // setup routes then report storage as unavailable until it is fixed.
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.error(`[setup] ${file} exists but cannot be read (${code}); not replacing it. Fix its permissions.`);
      return null;
    }
  }
  if (raw !== null) {
    const key = keyFromString(raw);
    if (key) return key;
    console.error(`[setup] ${file} is empty; not replacing it. Restore it from a backup or remove it on purpose.`);
    return null;
  }

  const memory = memoryKeys.get(file);
  if (memory) return memory;
  const generated = crypto.randomBytes(KEY_BYTES);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // 'wx': never overwrite a key another process wrote a moment ago.
    fs.writeFileSync(file, generated.toString('hex'), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return loadServerKey({ ...options, keyFile: file });
    // No writable data directory: keep ONE key in memory for this process.
    // Rows created this way are unreadable after a restart, which is the
    // safer failure; a fresh key per call used to break them immediately.
    memoryKeys.set(file, generated);
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
