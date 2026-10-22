import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyInput, ProviderKeys } from '@/features/setup/shared/sections';

// "Saved" means two different things. On an edit page it is this setup, and a
// blank field keeps the stored secret. On a create page with a staged import it
// is the OLD setup: a blank field is not carried over, and creation removes that
// old setup. The UI must not promise the second one as if it were the first.
describe('a saved key on an edit page', () => {
  const html = () => renderToStaticMarkup(
    <KeyInput
      label="TorBox API key" hint="" value="" onChange={() => {}}
      saved savedScope="setup" onReveal={async () => 'tb'}
    />,
  );

  it('promises that a blank field keeps the stored key', () => {
    expect(html()).toContain('Leave blank to keep it');
    expect(html()).toContain('Saved ✓');
  });
});

describe('a key held only by an imported setup', () => {
  const html = () => renderToStaticMarkup(
    <KeyInput
      label="TorBox API key" hint="" value="" onChange={() => {}}
      saved savedScope="import" onReveal={async () => 'tb'}
    />,
  );

  it('says plainly that empty means it will not be carried over', () => {
    const out = html();
    expect(out).toContain('it will not be carried over');
    expect(out).toContain('creating this setup removes the old one');
    expect(out).not.toContain('Leave blank to keep it');
    expect(out).toContain('From import');
    expect(out).not.toContain('Saved ✓');
  });

  it('says nothing once the field actually holds the key', () => {
    const filled = renderToStaticMarkup(
      <KeyInput
        label="TorBox API key" hint="" value="tb-value" onChange={() => {}}
        saved savedScope="import" onReveal={async () => 'tb'}
      />,
    );
    expect(filled).not.toContain('will not be carried over');
  });
});

describe('provider card state for an imported key', () => {
  it('is amber "From import" rather than a green "Saved"', () => {
    const html = renderToStaticMarkup(
      <ProviderKeys values={{}} onChange={() => {}} savedServices={['torboxApiKey']} savedScope="import" />,
    );
    expect(html).toContain('From import');
    expect(html).toContain('is-warn');
  });

  it('is a green "Saved" for the setup\'s own key', () => {
    const html = renderToStaticMarkup(
      <ProviderKeys values={{}} onChange={() => {}} savedServices={['torboxApiKey']} savedScope="setup" />,
    );
    expect(html).toContain('>Saved<');
    expect(html).not.toContain('From import');
  });
});
