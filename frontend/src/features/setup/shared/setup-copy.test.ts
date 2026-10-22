import { afterEach, expect, it } from 'vitest';
import { i18n } from '@/i18n';
import { setupCopy } from '@/features/setup/shared/setup-copy';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

it('translates alert copy directly, since the DOM bridge skips role=alert', async () => {
  await i18n.loadNamespaces('setup');
  await i18n.changeLanguage('es');
  expect(setupCopy('Could not load saved setups.', 'fallback')).toBe(
    'No se pudieron cargar las configuraciones guardadas.',
  );
});

it('falls back to the source phrase when the key is missing', () => {
  expect(setupCopy('Not a real key', 'Not a real key')).toBe('Not a real key');
});
