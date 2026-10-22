// Password-attempt throttling only. Addon reads (manifest/catalog/meta/stream)
// are never throttled here: they are the normal polling path for every client.
export interface LimiterOptions {
  windowMs?: number;
  maxPerIp?: number;
  maxPerUuid?: number;
  lockoutMs?: number;
  now?: () => number;
}

export interface LimiterDecision {
  allowed: boolean;
  retryAfterMs: number;
  reason: 'lockout' | 'ip' | null;
}

export interface LimiterFailure {
  locked: boolean;
  retryAfterMs: number;
}

export interface PasswordLimiter {
  check(ip: string, uuid: string): LimiterDecision;
  fail(ip: string, uuid: string): LimiterFailure;
  succeed(ip: string, uuid: string): void;
  lockedUntil(uuid: string): number;
}

interface Bucket { start: number; count: number }

const DEFAULTS = {
  windowMs: 60_000,
  maxPerIp: 20,
  maxPerUuid: 5,
  lockoutMs: 5 * 60_000,
};

function createPasswordLimiter(options: LimiterOptions = {}): PasswordLimiter {
  const config = { ...DEFAULTS, ...options };
  const now = config.now ?? (() => Date.now());
  const ipBuckets = new Map<string, Bucket>();
  const uuidBuckets = new Map<string, Bucket>();
  const lockouts = new Map<string, number>();

  function prune(store: Map<string, Bucket>, timestamp: number): void {
    if (store.size < 5000) return;
    for (const [key, value] of store) {
      if (timestamp - value.start > Math.max(config.windowMs, config.lockoutMs)) store.delete(key);
    }
  }

  function bump(store: Map<string, Bucket>, key: string, timestamp: number, windowMs: number): Bucket {
    const existing = store.get(key);
    if (!existing || timestamp - existing.start > windowMs) {
      const fresh: Bucket = { start: timestamp, count: 1 };
      store.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  return {
    // Checked before a password is verified.
    check(ip, uuid) {
      const timestamp = now();
      const lockedUntil = lockouts.get(uuid);
      if (lockedUntil && lockedUntil > timestamp) {
        return { allowed: false, retryAfterMs: lockedUntil - timestamp, reason: 'lockout' };
      }
      const ipBucket = ipBuckets.get(ip);
      if (ipBucket && timestamp - ipBucket.start <= config.windowMs && ipBucket.count >= config.maxPerIp) {
        return { allowed: false, retryAfterMs: config.windowMs - (timestamp - ipBucket.start), reason: 'ip' };
      }
      return { allowed: true, retryAfterMs: 0, reason: null };
    },

    fail(ip, uuid) {
      const timestamp = now();
      bump(ipBuckets, ip, timestamp, config.windowMs);
      const uuidBucket = bump(uuidBuckets, uuid, timestamp, config.lockoutMs);
      prune(ipBuckets, timestamp);
      prune(uuidBuckets, timestamp);
      if (uuidBucket.count >= config.maxPerUuid) {
        lockouts.set(uuid, timestamp + config.lockoutMs);
        uuidBuckets.delete(uuid);
        return { locked: true, retryAfterMs: config.lockoutMs };
      }
      return { locked: false, retryAfterMs: 0 };
    },

    succeed(ip, uuid) {
      uuidBuckets.delete(uuid);
      lockouts.delete(uuid);
      ipBuckets.delete(ip);
    },

    lockedUntil(uuid) {
      return lockouts.get(uuid) ?? 0;
    },
  };
}

export interface RateLimitApi {
  createPasswordLimiter: (options?: LimiterOptions) => PasswordLimiter;
  DEFAULTS: typeof DEFAULTS;
}
module.exports = { createPasswordLimiter, DEFAULTS } satisfies RateLimitApi;
