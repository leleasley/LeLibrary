// CSP violation reports from the report-only policy (middleware/security-headers.ts).
//
// Browsers POST either the old report-uri format (application/csp-report,
// {"csp-report": {...}}) or the Reporting API format (application/reports+json,
// an array of {type: "csp-violation", body: {...}}). Each report becomes ONE
// compact log line:
//   [CSP] <directive> blocked <scheme://host | inline | eval | data ...> on <page pattern>
// Reports are anonymous and attacker-controlled, so nothing in them is trusted
// or logged verbatim: query strings and fragments are dropped, blocked URLs are
// cut to scheme + host, page paths are mapped to a pattern so a setup UUID or
// an install token never reaches the log, and script samples are ignored.
// Identical lines are logged once per 10 minutes (with a repeat count), and a
// per-IP and a global budget keep the endpoint from flooding the log. The
// answer is always 204, whether the report was logged, deduplicated, dropped
// or unreadable.
import type { Request, Response } from 'express';

const express = require('express');
const { boundedSet } = require('../runtime/bounded-map.ts');
const { CSP_REPORT_PATH } = require('../middleware/security-headers.ts');

export interface CspReportSummary { directive: string; blocked: string; page: string }

export interface CspReportApi {
  mountCspReportRoutes: (app: any) => void;
  summariseReports: (body: unknown) => CspReportSummary[];
  sanitisePagePath: (value: unknown) => string;
  sanitiseBlocked: (value: unknown) => string;
  resetCspReportState: () => void;
  CSP_REPORT_LIMITS: { perIp: number; global: number; windowMs: number; dedupeMs: number; bodyLimit: string; maxPerRequest: number };
}

const CSP_REPORT_LIMITS = {
  perIp: 30,
  global: 600,
  windowMs: 60_000,
  dedupeMs: 10 * 60_000,
  bodyLimit: '16kb',
  maxPerRequest: 10,
};

interface Window { start: number; count: number }
interface Seen { first: number; repeats: number }

const ipWindows: Map<string, Window> = new Map();
let globalWindow: Window = { start: 0, count: 0 };
const seenLines: Map<string, Seen> = new Map();

function resetCspReportState(): void {
  ipWindows.clear();
  seenLines.clear();
  globalWindow = { start: 0, count: 0 };
}

function allow(ip: string, now: number): boolean {
  const { perIp, global, windowMs } = CSP_REPORT_LIMITS;
  if (now - globalWindow.start > windowMs) globalWindow = { start: now, count: 0 };
  let win = ipWindows.get(ip);
  if (!win || now - win.start > windowMs) {
    win = { start: now, count: 0 };
    boundedSet(ipWindows, ip, win, 5000, (w: Window) => now - w.start > windowMs);
  }
  win.count++;
  if (win.count > perIp) return false;
  globalWindow.count++;
  return globalWindow.count <= global;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\..*)?$/i;
const PLAIN_SEGMENT = /^[A-Za-z0-9_-]{1,24}(?:\.[A-Za-z0-9]{1,8})?$/;
const HEXISH = /^[0-9a-f]{16,}$/i;

function toUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  try { return new URL(value, 'http://report.invalid'); } catch { return null; }
}

// A page URL becomes a path pattern: /{uuid} -> /:setup, any long or unusual
// segment (install tokens, base64 configs, encoded text) -> :token.
function sanitisePagePath(value: unknown): string {
  const url = toUrl(value);
  if (!url) return 'unknown';
  const segments = url.pathname.split('/').filter(Boolean);
  const out = segments.slice(0, 6).map((segment) => {
    if (UUID.test(segment)) return ':setup';
    if (HEXISH.test(segment) || !PLAIN_SEGMENT.test(segment)) return ':token';
    return segment.toLowerCase();
  });
  if (segments.length > 6) out.push('...');
  return '/' + out.join('/');
}

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'self']);

// Scheme + host only for URLs; CSP's own keywords pass through.
function sanitiseBlocked(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'unknown';
  const text = value.trim().toLowerCase();
  if (KEYWORDS.has(text)) return text;
  const scheme = /^([a-z][a-z0-9+.-]{0,15}):/.exec(text);
  if (!scheme) return 'other';
  const name = scheme[1];
  if (name === 'http' || name === 'https' || name === 'ws' || name === 'wss') {
    try {
      const url = new URL(value.trim());
      const host = url.host.toLowerCase();
      return /^[a-z0-9.:\-\[\]]{1,255}$/.test(host) ? `${name}://${host}` : 'other';
    } catch { return 'other'; }
  }
  return /^(data|blob|filesystem|about|chrome-extension|moz-extension|safari-web-extension)$/.test(name) ? name : 'other';
}

function sanitiseDirective(value: unknown): string {
  const first = typeof value === 'string' ? value.trim().split(/\s+/)[0].toLowerCase() : '';
  return /^[a-z-]{1,40}$/.test(first) ? first : 'unknown';
}

function summariseReports(body: unknown): CspReportSummary[] {
  const out: CspReportSummary[] = [];
  const reports = Array.isArray(body) ? body : [body];
  for (const report of reports.slice(0, CSP_REPORT_LIMITS.maxPerRequest)) {
    if (!report || typeof report !== 'object') continue;
    const r = report as Record<string, any>;
    if (r['csp-report'] && typeof r['csp-report'] === 'object') {
      const c = r['csp-report'];
      out.push({
        directive: sanitiseDirective(c['effective-directive'] || c['violated-directive']),
        blocked: sanitiseBlocked(c['blocked-uri']),
        page: sanitisePagePath(c['document-uri']),
      });
    } else if (r.type === 'csp-violation' && r.body && typeof r.body === 'object') {
      const b = r.body;
      out.push({
        directive: sanitiseDirective(b.effectiveDirective || b.violatedDirective),
        blocked: sanitiseBlocked(b.blockedURL),
        page: sanitisePagePath(b.documentURL || r.url),
      });
    }
  }
  return out;
}

function logSummary(summary: CspReportSummary, now: number): void {
  const line = `[CSP] ${summary.directive} blocked ${summary.blocked} on ${summary.page}`;
  const seen = seenLines.get(line);
  if (seen && now - seen.first <= CSP_REPORT_LIMITS.dedupeMs) { seen.repeats++; return; }
  const repeats = seen ? seen.repeats : 0;
  boundedSet(seenLines, line, { first: now, repeats: 0 }, 1000, (s: Seen) => now - s.first > CSP_REPORT_LIMITS.dedupeMs);
  console.warn(repeats > 0 ? `${line} (+${repeats} repeats in the last 10 min)` : line);
}

function parseBody(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function mountCspReportRoutes(app: any): void {
  const textParser = express.text({
    type: ['application/csp-report', 'application/reports+json', 'application/json', 'text/plain'],
    limit: CSP_REPORT_LIMITS.bodyLimit,
  });
  app.post(CSP_REPORT_PATH, (req: Request, res: Response) => {
    const ip = (req as unknown as { ip?: string }).ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    if (!allow(ip, now)) { res.status(204).end(); return; }
    // Oversized or malformed bodies are dropped quietly: the browser does not
    // care about the answer and the error handler would only add log noise.
    textParser(req, res, (err?: unknown) => {
      if (err) { res.status(204).end(); return; }
      try {
        for (const summary of summariseReports(parseBody(req.body))) logSummary(summary, now);
      } catch { /* never fail a report */ }
      res.status(204).end();
    });
  });
}

module.exports = {
  mountCspReportRoutes,
  summariseReports,
  sanitisePagePath,
  sanitiseBlocked,
  resetCspReportState,
  CSP_REPORT_LIMITS,
} satisfies CspReportApi;
