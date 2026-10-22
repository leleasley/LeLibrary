// Per-IP in-memory buckets for the sensitive routes only. Addon protocol
// routes (catalog/meta/stream) are deliberately not limited here.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

export interface RateLimitApi {
  rateLimit: (options?: RateLimitOptions) => RequestHandler;
  rateLimitBuckets: Map<string, Bucket>;
}

interface Bucket { start: number; count: number }

type BucketStore = Map<string, Bucket>;

const rateLimitBuckets: BucketStore = new Map();

function rateLimit({ windowMs = 60000, max = 30 }: RateLimitOptions = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req as unknown as { ip?: string }).ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    // Buckets are per IP *and* per route: one shared bucket let a busy
    // endpoint (or a retrying user) starve every other sensitive route on
    // the same IP. req.route.path is the matched pattern (stable for
    // parameterised routes), falling back to the raw path.
    const route = req.route as { path?: string | string[] } | undefined;
    const pattern = Array.isArray(route?.path) ? route.path.join(',') : (route?.path || req.path);
    const key = `${ip} ${req.method} ${pattern}`;
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.status(429).json({ error: 'Rate limit exceeded. Please slow down.' });
      return;
    }
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of rateLimitBuckets) { if (b.start < cutoff) rateLimitBuckets.delete(ip); }
}, 300000).unref?.();

module.exports = { rateLimit, rateLimitBuckets } satisfies RateLimitApi;
