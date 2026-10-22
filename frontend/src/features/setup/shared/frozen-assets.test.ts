import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FROZEN_ASSETS, FROZEN_ASSET_VERSION } from '@/features/setup/shared/legacy-libs';

const ROOT = new URL('../../../../../', import.meta.url);
const ROUTES = readFileSync(new URL('backend/src/routes/website.ts', ROOT), 'utf8');
const STATIC_ASSETS = ['custom-streams-editor.js'] as const;
const COMPAT_ASSETS = ['formatter.js', 'token-map.js', 'poster-template.js', 'pictorium-options.js'] as const;

describe('React setup compatibility assets', () => {
  it('version-tags every helper URL used by setup', () => {
    for (const [asset, url] of Object.entries(FROZEN_ASSETS)) {
      expect(url, `${asset} is not in the asset map`).toBe(`/${asset}?v=${FROZEN_ASSET_VERSION}`);
    }
  });

  it('serves isomorphic helpers from the backend TypeScript compatibility map', () => {
    for (const asset of COMPAT_ASSETS) expect(ROUTES).toContain(`'/${asset}'`);
  });

  it('ships the custom stream helper with the Vite public tree', () => {
    for (const asset of STATIC_ASSETS) {
      expect(readFileSync(new URL(`frontend/public/${asset}`, ROOT), 'utf8').length, `${asset} is missing`).toBeGreaterThan(0);
    }
  });
});
