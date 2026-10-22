// Permissive CORS for the public API surface, plus an immediate preflight
// response so OPTIONS never reaches a route handler.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface CorsApi {
  cors: RequestHandler;
}

function cors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
}

module.exports = { cors } satisfies CorsApi;
