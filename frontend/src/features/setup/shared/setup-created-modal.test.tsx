import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupCreatedModal } from '@/features/setup/shared/SetupCreatedModal';
import type { PlatformConnection } from '@/features/setup/full/platform-login';

// The modal reads the origin off window; the node test environment has none.
(globalThis as unknown as { window: unknown }).window = {
  location: { origin: 'https://example.test' },
};

const BASE = {
  open: true,
  uuid: '11111111-2222-3333-4444-555555555555',
  installToken: '11111111-2222-3333-4444-555555555555.secret',
  name: 'Living room',
  password: 'secret-password',
  platform: 'nuvio' as const,
  onClose: () => {},
};

const NUVIO: PlatformConnection = {
  platform: 'nuvio',
  nuvioToken: 'nuvio-token',
  nuvioProfiles: [{ profile_index: 2, name: 'Bedroom', uses_primary_addons: false }],
  nuvioSelectedProfile: 2,
};

describe('post-creation modal', () => {
  it('hands over both links for a setup that holds a platform connection', () => {
    const html = renderToStaticMarkup(<SetupCreatedModal {...BASE} pushConn={NUVIO} />);
    expect(html).toContain('Your setup is live');
    expect(html).toContain('https://example.test/11111111-2222-3333-4444-555555555555.secret/manifest.json');
    expect(html).toContain('https://example.test/11111111-2222-3333-4444-555555555555.secret/collections.json');
    expect(html).toContain('Push to Nuvio');
    // Nuvio pushes to one profile, so the picker rides along.
    expect(html).toContain('Bedroom');
  });

  it('stays useful with no connection at all: links plus the saved-on-the-server note', () => {
    const html = renderToStaticMarkup(
      <SetupCreatedModal {...BASE} platform={null} pushConn={null} />,
    );
    expect(html).toContain('manifest.json');
    expect(html).toContain('collections.json');
    expect(html).not.toContain('Push to Nuvio');
    expect(html).toContain('nothing is lost if you stop here');
  });

  it('prompts Settle In users to choose a player and sign in before they leave the creation modal', () => {
    const html = renderToStaticMarkup(
      <SetupCreatedModal {...BASE} pushConn={null} onConnectPrompt={() => {}} />,
    );
    expect(html).toContain('Choose Stremio or Nuvio and sign in below to push your Home rows');
    expect(html).toContain('Choose a player and sign in');
    expect(html).toContain('manifest link');
  });

  it('renders nothing when closed', () => {
    expect(renderToStaticMarkup(<SetupCreatedModal {...BASE} pushConn={null} open={false} />)).toBe('');
  });
});
