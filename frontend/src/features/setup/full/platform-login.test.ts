import { describe, expect, it, vi, afterEach } from 'vitest';
import { refreshNuvioConnection } from '@/features/setup/full/platform-login';

// The profile list on an imported connection is a snapshot of whatever the old
// setup stored. Refreshing it is what lets a profile created since then be
// picked, so these pin the merge rules.
function stubProfiles(rows: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => rows,
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('refreshing a nuvio connection', () => {
  it('replaces the imported snapshot with the live profile list', async () => {
    stubProfiles([
      { profile_index: 1, name: 'Lewis', uses_primary_addons: true },
      { profile_index: 2, name: 'Main2', uses_primary_addons: false },
    ]);
    const refreshed = await refreshNuvioConnection({
      platform: 'nuvio',
      nuvioToken: 'tok',
      nuvioProfiles: [{ profile_index: 1, name: 'Lewis', uses_primary_addons: true }],
      nuvioSelectedProfile: 1,
    });
    expect(refreshed.nuvioProfiles?.map((p) => p.name)).toEqual(['Lewis', 'Main2']);
    expect(refreshed.nuvioSelectedProfile).toBe(1);
  });

  it('keeps a selection that still exists and moves to the visible first option when it does not', async () => {
    stubProfiles([
      { profile_index: 1, name: 'Lewis', uses_primary_addons: true },
      { profile_index: 2, name: 'Main2', uses_primary_addons: false },
    ]);
    const kept = await refreshNuvioConnection({
      platform: 'nuvio', nuvioToken: 'tok', nuvioSelectedProfile: 2,
    });
    expect(kept.nuvioSelectedProfile).toBe(2);

    // Chosen profile gone (or never resolvable): the picker shows profile 1,
    // so the draft must say profile 1 rather than something invisible.
    const moved = await refreshNuvioConnection({
      platform: 'nuvio', nuvioToken: 'tok', nuvioSelectedProfile: 9,
    });
    expect(moved.nuvioSelectedProfile).toBe(1);

    const never = await refreshNuvioConnection({ platform: 'nuvio', nuvioToken: 'tok' });
    expect(never.nuvioSelectedProfile).toBe(1);
  });

  it('hands back a connection nothing can be refreshed from, untouched', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const stremio = await refreshNuvioConnection({ platform: 'stremio', stremioAuth: 'x' });
    expect(stremio.platform).toBe('stremio');
    const tokenless = await refreshNuvioConnection({ platform: 'nuvio', nuvioProfiles: [] });
    expect(tokenless.nuvioProfiles).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces a rejected session instead of pretending the list is fine', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ message: 'JWT expired' }) })));
    await expect(refreshNuvioConnection({ platform: 'nuvio', nuvioToken: 'stale' }))
      .rejects.toThrow(/JWT expired/);
  });
});
