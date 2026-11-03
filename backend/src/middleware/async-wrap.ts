// Express 4 does not forward rejected promises from async handlers: one thrown
// error inside an async route used to become an unhandled rejection and kill the
// process. Every handler registered afterwards is wrapped so rejections become
// next(err). Error middleware (4 args) is left alone, and handlers are never
// double-wrapped.
import type { Express } from 'express';

export interface AsyncWrapApi {
  applyAsyncWrap: (app: Express) => void;
}

interface WrappedHandler {
  (req: unknown, res: unknown, next: unknown): unknown;
  _asyncWrapped?: boolean;
  // The handler this one wraps, so route-table checks can see inside a
  // wrapped sub-router.
  _asyncInner?: unknown;
}

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'use', 'all'] as const;

function applyAsyncWrap(app: Express): void {
  const target = app as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of METHODS) {
    const original = target[method]?.bind(app);
    if (!original) continue;
    target[method] = (...args: unknown[]) => original(...args.map((fn) => {
      if (typeof fn !== 'function') return fn;
      const handler = fn as WrappedHandler;
      if (handler.length === 4 || handler._asyncWrapped) return handler;
      const wrapped: WrappedHandler = (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next as (error: unknown) => void);
      wrapped._asyncWrapped = true;
      wrapped._asyncInner = handler;
      return wrapped;
    }));
  }
}

module.exports = { applyAsyncWrap } satisfies AsyncWrapApi;
