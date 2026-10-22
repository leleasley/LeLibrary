'use strict';
// Token -> config resolution. Legacy base64 tokens decode directly; opaque
// install ids (random ids pointing at a saved row) are looked up in Postgres.
// Kept in one place so the addon, the website routes and the setup router all
// resolve installs identically.
import type { TokenModule } from './token.ts';

const { decodeConfig } = require('./token.ts') as TokenModule;
const { parseInstallToken } = require('../setup/token.ts');
const { getSetupStore } = require('../setup/runtime.ts');
const { timeSpan } = require('../middleware/perf-timing.ts') as {
  timeSpan: <T>(trace: unknown, name: string, fn: () => Promise<T> | T) => Promise<T>;
};

// v5.5 removed the hosted account extension; guarded paths degrade to self-host.
const HOSTED = null;

// Resolve a token to a config. Legacy base64 tokens decode directly; opaque
// V5 token ids (random ids pointing at a saved account token) are looked up in
// Postgres, where the user's saved provider keys are folded back in. This keeps
// every install link working across the migration.
function tagConfig(config: Record<string, unknown>, scope: Record<string, unknown>, token: string) {
  Object.defineProperty(config, '__configScope', { value: scope, enumerable: false, configurable: true });
  Object.defineProperty(config, '__pictoriumToken', { value: token, enumerable: false, configurable: true });
  return config;
}

async function resolveConfig(token: unknown, trace?: unknown): Promise<Record<string, unknown> | null> {
  // v5.5 setup: "<uuid>.<secret>". The install URL is the capability, so this
  // path never asks for a password; the store opens the row with the server key.
  if (parseInstallToken(token)) {
    try {
      const store = await getSetupStore();
      if (store) {
        // Postgres read, timed separately from token parsing so the audit can
        // tell secret resolution apart from database latency.
        const opened = await timeSpan(trace, 'pg:setup-resolve', () =>
          store.resolveByToken(typeof token === 'string' ? token : ''));
        if (opened) {
          const engine = store.toEngineConfig(opened);
          return tagConfig(engine, { type: 'config', uuid: opened.uuid, tier: opened.tier }, typeof token === 'string' ? token : '');
        }
      }
    } catch (err: any) {
      console.error('[token] setup resolve failed:', err.message);
    }
    return null;
  }

  const legacy = decodeConfig(token);
  if (legacy) {
    Object.defineProperty(legacy, '__configScope', {
      value: { type: 'legacy' }, enumerable: false, configurable: true,
    });
    Object.defineProperty(legacy, '__pictoriumToken', {
      value: token, enumerable: false, configurable: true,
    });
    return legacy;
  }
  // Account-backed opaque tokens no longer exist: an install URL is either a
  // legacy self-contained token or a v5.5 <uuid>.<secret>.
  return null;

}

module.exports = { resolveConfig };

export interface ResolveConfigApi {
  resolveConfig: (token: unknown, trace?: unknown) => Promise<Record<string, unknown> | null>;
}
module.exports = { resolveConfig } satisfies ResolveConfigApi;
