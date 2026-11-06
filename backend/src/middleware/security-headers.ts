// Additive security headers.
//
// Every response gets nosniff and a referrer policy. HTML documents (any
// response whose Content-Type is text/html: the SPA shell, the prerendered
// home page, server-rendered and static pages, error pages, redirect bodies)
// also get:
//   - enforced anti-framing: X-Frame-Options SAMEORIGIN plus an enforcing
//     CSP that carries frame-ancestors 'self' and nothing else;
//   - the full policy in report-only mode, with its violations reported to
//     POST /api/csp-report (routes/csp-report.ts) while we tune it.
// The decision is made when the headers are written, from the real
// Content-Type, so no path list has to be kept in step with the router.
// Addon JSON, images and scripts never get any of these: Stremio/Nuvio
// responses stay byte-compatible.
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface SecurityHeadersApi {
  securityHeaders: RequestHandler;
  CSP_DIRECTIVES: readonly string[];
  CSP_REPORT_PATH: string;
  FRAME_ANCESTORS_POLICY: string;
  REPORT_ONLY_POLICY: string;
  isHtmlContentType: (value: unknown) => boolean;
}

const CSP_REPORT_PATH = '/api/csp-report';

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

// Enforced today: only anti-framing. Our own pages may frame each other;
// Turnstile's iframe is a child of our page, which frame-ancestors ignores.
const FRAME_ANCESTORS_POLICY = "frame-ancestors 'self'";
// report-uri for browsers without the Reporting API, report-to for the rest.
const REPORT_ONLY_POLICY = [...CSP_DIRECTIVES, `report-uri ${CSP_REPORT_PATH}`, 'report-to csp'].join('; ');

function isHtmlContentType(value: unknown): boolean {
  const text = Array.isArray(value) ? String(value[0] || '') : String(value || '');
  return /^\s*text\/html\b/i.test(text);
}

// writeHead may also receive the headers inline (object or flat raw array).
function inlineContentType(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === 'content-type') return headers[i + 1];
    }
    return undefined;
  }
  if (headers && typeof headers === 'object') {
    for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
      if (name.toLowerCase() === 'content-type') return value;
    }
  }
  return undefined;
}

function applyDocumentHeaders(res: Response): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', FRAME_ANCESTORS_POLICY);
  res.setHeader('Content-Security-Policy-Report-Only', REPORT_ONLY_POLICY);
  res.setHeader('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`);
}

function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Every way of sending headers (res.send, sendFile/express.static, a bare
  // res.end) goes through writeHead, so this sees the final Content-Type.
  const original = res.writeHead;
  (res as any).writeHead = function writeHead(this: Response, ...args: any[]) {
    try {
      const headerArg = typeof args[1] === 'string' ? args[2] : args[1];
      const type = res.getHeader('Content-Type') ?? inlineContentType(headerArg);
      if (!res.headersSent && isHtmlContentType(type)) applyDocumentHeaders(res);
    } catch { /* never break a response over a header */ }
    return (original as any).apply(this, args);
  };
  next();
}

module.exports = {
  securityHeaders,
  CSP_DIRECTIVES,
  CSP_REPORT_PATH,
  FRAME_ANCESTORS_POLICY,
  REPORT_ONLY_POLICY,
  isHtmlContentType,
} satisfies SecurityHeadersApi;
