// Install URL identity: "<uuid>.<secret>". The UUID is the lookup key and the
// secret is the capability that lets a media client read the config. Together
// they occupy the existing single :token path segment, so every addon route
// keeps its current shape.
const crypto = require('node:crypto') as typeof import('node:crypto');

export interface InstallToken {
  uuid: string;
  secret: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;

function newUuid(): string {
  return crypto.randomUUID();
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function newSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function buildInstallToken(uuid: string, secret: string): string {
  return `${uuid}.${secret}`;
}

function parseInstallToken(token: unknown): InstallToken | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  const uuid = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!isUuid(uuid) || !SECRET_RE.test(secret)) return null;
  return { uuid: uuid.toLowerCase(), secret };
}

function secretHash(secret: unknown): string {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

export interface TokenApi {
  newUuid: () => string;
  isUuid: (value: unknown) => value is string;
  newSecret: () => string;
  buildInstallToken: (uuid: string, secret: string) => string;
  parseInstallToken: (token: unknown) => InstallToken | null;
  secretHash: (secret: unknown) => string;
  UUID_RE: RegExp;
  SECRET_RE: RegExp;
}
module.exports = { newUuid, isUuid, newSecret, buildInstallToken, parseInstallToken, secretHash, UUID_RE, SECRET_RE } satisfies TokenApi;
