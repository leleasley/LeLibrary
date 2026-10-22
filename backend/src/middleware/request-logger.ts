// Request logging that can never print a secret: query strings are dropped and
// long base64url-looking path segments (config tokens) are redacted.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RequestLoggerApi {
  requestLogger: RequestHandler;
  maskSensitivePath: (path: string) => string;
}

function maskSensitivePath(path: string): string {
  return path.split('/').map((segment) => (/^[A-Za-z0-9_-]{16,}$/.test(segment) ? '[token]' : segment)).join('/');
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const url = req.originalUrl || req.url;
  const isAsset = /\.(css|js|png|jpg|jpeg|svg|webp|ico|webmanifest|woff2?|ttf|map)(\?|$)/i.test(url)
    || url.startsWith('/img/');
  if (!isAsset) console.log(`[REQ] ${req.method} ${maskSensitivePath(req.path)}`);
  next();
}

module.exports = { requestLogger, maskSensitivePath } satisfies RequestLoggerApi;
