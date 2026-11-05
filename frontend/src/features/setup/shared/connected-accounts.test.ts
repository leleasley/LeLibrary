import { describe, expect, it } from 'vitest';
import { providerConfigured, visibleConnectCards } from '@/features/setup/shared/connected-accounts';
import { parseWatchlistConfig, type WatchlistProvider, type WatchlistServerConfig } from '@/features/setup/resolver/api';

const CONFIG: WatchlistServerConfig = { simkl: true, trakt: true, anilist: false, traktLegacy: false };
const none = () => false;
const only = (...providers: WatchlistProvider[]) => (provider: WatchlistProvider) => providers.includes(provider);

describe('connect card visibility', () => {
  it('blanks out providers the server has not configured (pre-creation)', () => {
    const visible = visibleConnectCards({ precreation: true, config: { ...CONFIG, trakt: false }, status: null, connected: none });
    expect(visible).toEqual(['simkl', 'anilist']);
  });

  it('keeps everything while the capability check is in flight', () => {
    expect(visibleConnectCards({ precreation: true, config: null, status: null, connected: none }))
      .toEqual(['simkl', 'trakt', 'anilist']);
  });

  it('blanks out unconfigured providers post-creation too', () => {
    const both = visibleConnectCards({
      precreation: false, config: null, connected: only('simkl'),
      status: { simkl: { connected: true, configured: true }, trakt: { connected: false, configured: true } },
    });
    // Neither reports configured:false, so both stay (only an explicit false hides).
    expect(both).toContain('trakt');
    const hidden = visibleConnectCards({
      precreation: false, config: null, connected: none,
      status: { simkl: { connected: false, configured: true }, trakt: { connected: false, configured: false } },
    });
    expect(hidden).toEqual(['simkl', 'anilist']);
  });

  // Trakt costs a VIP account to run: new setups are not offered it once the
  // server marks it legacy, but a setup already connected keeps its card.
  it('hides Trakt for new setups when the server marks it legacy', () => {
    const legacy = { ...CONFIG, traktLegacy: true };
    expect(visibleConnectCards({ precreation: true, config: legacy, status: null, connected: none })).not.toContain('trakt');
    expect(visibleConnectCards({
      precreation: false, config: legacy, connected: none,
      status: { simkl: { connected: false, configured: true }, trakt: { connected: false, configured: true } },
    })).not.toContain('trakt');
  });

  it('shows Trakt when the setup is connected, legacy or not', () => {
    const legacy = { ...CONFIG, traktLegacy: true };
    expect(visibleConnectCards({
      precreation: false, config: legacy, connected: only('trakt'),
      status: { simkl: { connected: false, configured: true }, trakt: { connected: true, configured: true } },
    })).toContain('trakt');
    expect(visibleConnectCards({ precreation: true, config: legacy, status: null, connected: only('trakt') })).toContain('trakt');
  });

  it('always shows AniList: the username needs no server app', () => {
    expect(visibleConnectCards({ precreation: true, config: CONFIG, status: null, connected: none })).toContain('anilist');
  });
});

describe('server connect config', () => {
  it('reads an old server as no AniList and Trakt not legacy', () => {
    expect(parseWatchlistConfig({ simkl: true, trakt: true })).toEqual({ simkl: true, trakt: true, anilist: false, traktLegacy: false });
  });

  it('reads what the server sends: anilist and traktLegacy', () => {
    expect(parseWatchlistConfig({ simkl: true, trakt: true, anilist: true, traktLegacy: true }))
      .toEqual({ simkl: true, trakt: true, anilist: true, traktLegacy: true });
    expect(parseWatchlistConfig({ trakt: true, legacy: true }).traktLegacy).toBe(false);
    expect(parseWatchlistConfig(null)).toEqual({ simkl: false, trakt: false, anilist: false, traktLegacy: false });
  });

  it('answers configured from the setup status first, then the server config', () => {
    const status = { simkl: { connected: false, configured: false }, trakt: { connected: false, configured: true } };
    expect(providerConfigured('simkl', { precreation: false, config: CONFIG, status })).toBe(false);
    expect(providerConfigured('anilist', { precreation: false, config: { ...CONFIG, anilist: true }, status })).toBe(true);
    expect(providerConfigured('simkl', { precreation: true, config: null, status: null })).toBe(null);
  });
});
