import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderKeys } from '@/features/setup/shared/sections';

// The provider switch used to be disabled until a key existed, so clicking it
// did nothing at all. It must always be clickable: with no key it opens the
// card so the key can be entered, with a key it toggles the provider.
describe('ProviderKeys switch', () => {
  it('keeps the per-provider switch clickable when no key is set', () => {
    const html = renderToStaticMarkup(<ProviderKeys values={{}} onChange={() => {}} />);
    expect(html).toContain('aria-label="Use TorBox"');
    expect(html).not.toMatch(/aria-label="Use TorBox"[^>]*disabled/);
  });

  it('shows the switch on when a key is present', () => {
    const html = renderToStaticMarkup(
      <ProviderKeys values={{ torboxApiKey: 'synthetic' }} onChange={() => {}} />,
    );
    expect(html).toMatch(/aria-label="Use TorBox"[^>]*checked/);
  });
});
