// Additive security headers. The report-only CSP applies to browser documents
// only: addon JSON responses stay untouched and protocol-compatible.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface SecurityHeadersApi {
  securityHeaders: RequestHandler;
  CSP_DIRECTIVES: readonly string[];
}

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self' https://github.com https://accounts.google.com",
  // Cloudflare Turnstile (password screens): its api.js from script-src and
  // its challenge iframe from frame-src, per Cloudflare's CSP reference.
  // connect-src 'self' already covers pre-clearance mode.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://challenges.cloudflare.com https://api.nuvio.tv https://api.strem.io https://api.github.com https://raw.githubusercontent.com https://oauth2.googleapis.com https://openidconnect.googleapis.com",
  "frame-src 'self' https://challenges.cloudflare.com",
];

// The setup edit page lives at /{uuid}; the tier pages at /configure/*.
const SETUP_PAGE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Report CSP violations on browser documents while we tune the policy. Addon
  // JSON responses are deliberately excluded and remain protocol-compatible.
  const requestPath = req.path || '';
  const browserPage = req.method === 'GET'
    && (req.headers.accept || '').includes('text/html')
    && (requestPath === '/' || requestPath === '/privacy' || requestPath === '/status'
      || requestPath === '/configure' || requestPath.startsWith('/configure/') || SETUP_PAGE.test(requestPath)
      || requestPath.startsWith('/account') || requestPath.startsWith('/accounts/')
      || requestPath === '/app' || requestPath.startsWith('/app/'));
  if (browserPage) {
    res.setHeader('Content-Security-Policy-Report-Only', CSP_DIRECTIVES.join('; '));
  }
  next();
}

module.exports = { securityHeaders, CSP_DIRECTIVES } satisfies SecurityHeadersApi;
