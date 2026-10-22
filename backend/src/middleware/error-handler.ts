// Terminal error handler. Async rejections land here via the auto-wrapper;
// without it Express 4's default would leak a stack trace as HTML. JSON for API
// routes, plain text otherwise, and never an internal message.
//
// Over-limit bodies get a plain-English 413: the pre-push save carries pasted
// collections imports and used to fail here as an opaque "Internal error" with
// no hint what to trim.
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import type { RequestLoggerApi } from './request-logger.ts';

const { maskSensitivePath } = require('./request-logger.ts') as RequestLoggerApi;

export interface ErrorHandlerApi {
  errorHandler: ErrorRequestHandler;
}

interface BodyError {
  status?: number;
  type?: string;
  message?: string;
  stack?: string;
}

function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) return;
  const error = (err ?? {}) as BodyError;
  const tooLarge = Boolean(err) && (error.status === 413 || error.type === 'entity.too.large');
  const status = tooLarge ? 413 : 500;
  const len = req.headers['content-length'] || '?';
  console.error(`[Error] ${req.method} ${maskSensitivePath(req.path)} -> ${status}: ${tooLarge ? (error.message || String(err)) : (error.stack || error.message)} (body ${len}B)`);
  const wantsJson = req.path.endsWith('.json') || req.path.startsWith('/api/');
  res.status(status);
  if (tooLarge) {
    const msg = 'Configuration too large to save. Try removing a pasted collections import or custom streams, then push again.';
    if (wantsJson) { res.json({ error: msg }); return; }
    res.type('text').send(msg);
    return;
  }
  if (wantsJson) res.json({ error: 'Internal error' });
  else res.type('text').send('Internal error');
}

module.exports = { errorHandler } satisfies ErrorHandlerApi;
