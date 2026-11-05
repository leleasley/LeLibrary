import { describe, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { copyMapFor, translatePhrase } from '@/i18n/setup-dom-copy';

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

describe('setup copy templates', () => {
  it('a bare placeholder does not shadow later templates (staged connections)', async () => {
    await i18n.loadLanguages('es');
    await i18n.loadNamespaces('setup');
    const es = copyMapFor('es');
    expect(Object.keys(es).length).toBeGreaterThan(100);
    expect(translatePhrase('Connected as Neo_99', es)).toBe('Conectado como Neo_99');
    expect(translatePhrase('Connected as Neo_99 · not saved yet', es)).toBe('Conectado como Neo_99 · sin guardar');
    expect(translatePhrase('Simkl · disconnected, not saved yet', es)).toBe('Simkl · desconectado, sin guardar');
    expect(translatePhrase('Simkl · lewis · not saved yet', es)).toBe('Simkl · lewis · sin guardar');
    expect(translatePhrase('Simkl connected · not saved yet', es)).toBe('Simkl conectado · sin guardar');
  });
});
