import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyInput, ProviderKeys } from '@/features/setup/shared/sections';

// On an edit page "Saved" means this setup holds the key, and a blank field
// keeps the stored secret.
describe('a saved key on an edit page', () => {
  const html = () => renderToStaticMarkup(
    <KeyInput
      label="TorBox API key" hint="" value="" onChange={() => {}}
      saved onReveal={async () => 'tb'}
    />,
  );

  it('promises that a blank field keeps the stored key', () => {
    expect(html()).toContain('Leave blank to keep it');
    expect(html()).toContain('Saved ✓');
  });
});

describe('provider card state for a saved key', () => {
  it('is a green "Saved" for the setup\'s own key', () => {
    const html = renderToStaticMarkup(
      <ProviderKeys values={{}} onChange={() => {}} savedServices={['torboxApiKey']} />,
    );
    expect(html).toContain('>Saved<');
    expect(html).toContain('is-verified');
  });
});
