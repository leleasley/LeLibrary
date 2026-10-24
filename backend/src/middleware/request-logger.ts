// Request logging that can never print a secret: query strings are dropped and
// long base64url-looking path segments (config tokens) are redacted, including
// v5.5 install tokens ("<uuid>.<secret>", which contain a dot). Owned play
// links end in the file name, which is never logged either.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface RequestLoggerApi {
  requestLogger: RequestHandler;
  maskSensitivePath: (path: string) => string;
}

const LEGACY_TOKEN = /^[A-Za-z0-9_-]{16,}$/;
const INSTALL_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]+$/i;

function maskSensitivePath(path: string): string {
  const segments = path.split('/').map((segment) => (LEGACY_TOKEN.test(segment) || INSTALL_TOKEN.test(segment) ? '[token]' : segment));
  // /:token/play/:source/:itemId/:fileId/:name. A WebDAV file id is the
  // file's path (base64url), so file ids are never logged either.
  const play = segments.indexOf('play');
  if (play > 0) segments[play - 1] = '[token]';
  if (play > 0 && segments.length > play + 3) segments[play + 3] = '[file]';
  if (play > 0 && segments.length > play + 4) segments[play + 4] = '[name]';
  return segments.join('/');
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const url = req.originalUrl || req.url;
  const isAsset = /\.(css|js|png|jpg|jpeg|svg|webp|ico|webmanifest|woff2?|ttf|map)(\?|$)/i.test(url)
    || url.startsWith('/img/');
  if (!isAsset) console.log(`[REQ] ${req.method} ${maskSensitivePath(req.path)}`);
  next();
}

module.exports = { requestLogger, maskSensitivePath } satisfies RequestLoggerApi;
