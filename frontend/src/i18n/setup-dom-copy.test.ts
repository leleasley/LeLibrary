import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { copyMapFor } from '@/i18n/setup-dom-copy';

// main.tsx installs the setup copy observer before i18n has resolved a
// language. Asking i18next for a resource with an undefined language crashed
// with "can't access property includes"; the map must simply be empty until a
// language exists.
describe('setup copy map', () => {
  it('returns no phrases when i18n has no language yet', () => {
    expect(copyMapFor(undefined)).toEqual({});
  });

  it('returns the reviewed setup phrases once a language is available', async () => {
    // init() is async and the setup namespace is lazy-loaded; the browser only
    // reaches this state after the observer's loadNamespaces call resolves.
    await i18n.loadNamespaces('setup');
    expect(copyMapFor('en')['Back to a previous setup']).toBe('Back to a previous setup');
  });
});
