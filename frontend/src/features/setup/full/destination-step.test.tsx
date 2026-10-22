import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderKeys } from '@/features/setup/shared/sections';
import { DestinationStep } from '@/features/setup/full/DestinationStep';

// A provider card that holds a key must read as ON. It used to render off even
// with an imported or saved key present, and turning it off deleted that key.
describe('provider card switch', () => {
  it('reads as on when the card holds a key', () => {
    const html = renderToStaticMarkup(
      <ProviderKeys values={{ torboxApiKey: 'tb-imported' }} onChange={() => {}} />,
    );
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Key added');
  });

  it('reads as off but stays clickable when no card holds a key', () => {
    const html = renderToStaticMarkup(<ProviderKeys values={{}} onChange={() => {}} />);
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(0);
    // The switch opens the key form instead of being disabled: clicking it used
    // to do nothing at all.
    expect(html.match(/disabled=""/g)?.length ?? 0).toBe(0);
    for (const provider of ['TorBox', 'Real-Debrid', 'AllDebrid', 'Premiumize']) {
      expect(html).toContain(`aria-label="Use ${provider}"`);
    }
  });
});

// An existing connection is not something to sign in for again: say it is
// already saved and keep the login form behind an explicit choice.
describe('destination step with a saved connection', () => {
  type SavedAccount = NonNullable<Parameters<typeof DestinationStep>[0]['savedAccount']>;
  const step = (savedAccount: SavedAccount | null) =>
    renderToStaticMarkup(
      <DestinationStep
        platform="nuvio" onPlatform={() => {}} connection={null} onConnection={() => {}}
        savedAccount={savedAccount}
      />,
    );

  it('shows the saved account instead of a login form', () => {
    const html = step({
      user: 'me@example.com',
      profiles: [{ profile_index: 1, name: 'Lewis', uses_primary_addons: true }],
      selected: 1,
    });
    expect(html).toContain('Connected');
    expect(html).toContain('me@example.com');
    expect(html).toContain('Already saved on this server');
    expect(html).toContain('Change account');
    expect(html).not.toContain('Nuvio email');
  });

  it('offers a profile picker when the account has more than one', () => {
    const html = step({
      user: 'me@example.com',
      profiles: [
        { profile_index: 1, name: 'Lewis', uses_primary_addons: true },
        { profile_index: 2, name: 'Main2', uses_primary_addons: false },
      ],
      selected: 2,
    });
    expect(html).toContain('Nuvio profile');
    expect(html).toContain('Main2');
  });

  it('still asks for a login when nothing is saved', () => {
    const html = step(null);
    expect(html).toContain('Nuvio email');
    expect(html).not.toContain('Already saved on this server');
  });
});
