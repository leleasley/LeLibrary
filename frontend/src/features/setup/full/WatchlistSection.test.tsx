import { describe, expect, it } from 'vitest';
import { WATCHLIST_ACCORDION_DESC, visibleWatchlistProviders } from '@/features/setup/full/WatchlistSection';

const PROVIDERS = [{ key: 'simkl' }, { key: 'trakt' }];

describe('watchlist provider visibility', () => {
  it('blanks out providers the server has not configured (pre-creation)', () => {
    const visible = visibleWatchlistProviders(PROVIDERS, {
      precreation: true,
      configured: { simkl: true, trakt: false },
      status: null,
      uuid: null,
    });
    expect(visible.map((item) => item.key)).toEqual(['simkl']);
  });

  it('keeps everything while the capability check is in flight', () => {
    const visible = visibleWatchlistProviders(PROVIDERS, {
      precreation: true,
      configured: null,
      status: null,
      uuid: null,
    });
    expect(visible).toHaveLength(2);
  });

  it('blanks out unconfigured providers post-creation too', () => {
    const visible = visibleWatchlistProviders(PROVIDERS, {
      precreation: false,
      configured: null,
      status: { simkl: { connected: true, configured: true }, trakt: { connected: false, configured: true } },
      uuid: 'some-uuid',
    });
    // Neither reports configured:false, so both stay (only an explicit
    // false hides).
    expect(visible).toHaveLength(2);
    const hidden = visibleWatchlistProviders(PROVIDERS, {
      precreation: false,
      configured: null,
      status: { simkl: { connected: false, configured: true }, trakt: { connected: false, configured: false } },
      uuid: 'some-uuid',
    });
    expect(hidden.map((item) => item.key)).toEqual(['simkl']);
  });
});

describe('watchlist card copy', () => {
  // The section hides providers this server cannot connect, so the card must not
  // advertise a named provider. Naming Trakt promised a connect button that a
  // server without a Trakt OAuth app never renders.
  it('does not name a specific provider', () => {
    expect(WATCHLIST_ACCORDION_DESC).not.toMatch(/trakt/i);
    expect(WATCHLIST_ACCORDION_DESC).not.toMatch(/simkl/i);
  });

  it('still says what the section does', () => {
    expect(WATCHLIST_ACCORDION_DESC).toMatch(/library rows/i);
    expect(WATCHLIST_ACCORDION_DESC).toMatch(/creation/i);
  });
});
