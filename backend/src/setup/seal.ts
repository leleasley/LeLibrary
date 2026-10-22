// AES-256-GCM envelope used for everything the config store holds at rest.
const crypto = require('node:crypto') as typeof import('node:crypto');

export interface SealedEnvelope {
  v: number;
  iv: string;
  tag: string;
  ct: string;
}

const IV_BYTES = 12;

function seal(key: Buffer, value: unknown): SealedEnvelope {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  };
}

// Returns null for anything malformed or tampered with. Callers must treat null
// as "unreadable", never as "empty".
function unseal(key: Buffer, envelope: unknown): unknown {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  const { iv, tag, ct } = envelope as Partial<SealedEnvelope>;
  if (typeof iv !== 'string' || typeof tag !== 'string' || typeof ct !== 'string') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

export interface SealApi {
  seal: (key: Buffer, value: unknown) => SealedEnvelope;
  unseal: (key: Buffer, from: unknown) => unknown;
  IV_BYTES: number;
}
module.exports = { seal, unseal, IV_BYTES } satisfies SealApi;
