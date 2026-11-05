import { describe, expect, it } from 'vitest';
import {
  USER_LIST_GROUPS,
  homeCategoryRank,
  homeRowFromSource,
  mdblistListRows,
  userListBrowserRows,
} from '@/features/setup/shared/collection-doc';
import { pruneConfig } from '@/features/setup/shared/config-contract';
import { mdblistSourceFrom, userListPickerRows, userListServicesFrom } from '@/features/setup/shared/user-lists';

const none = { simkl: false, mdblist: false, anilist: false };

describe('"Your lists" rows in the pickers', () => {
  it('shows a service\'s shelf only when the setup has that service', () => {
    expect(userListBrowserRows(none)).toEqual([]);
    const mdb = userListBrowserRows({ ...none, mdblist: true }).map((row) => row.catalogId);
    expect(mdb).toEqual(['torbox-watchlist-mdblist-movie', 'torbox-watchlist-mdblist-series', 'lelibrary-user-mdblist-upnext-series']);
    const simkl = userListBrowserRows({ ...none, simkl: true });
    expect(simkl.map((row) => row.catalogId)).toEqual([
      'lelibrary-user-simkl-upnext-series', 'lelibrary-user-simkl-airing-series',
      'torbox-watchlist-simkl-movie', 'torbox-watchlist-simkl-series',
      'lelibrary-user-simkl-watching-series',
      'lelibrary-user-simkl-completed-movie', 'lelibrary-user-simkl-completed-series',
    ]);
    expect(new Set(simkl.map((row) => row.category))).toEqual(new Set([USER_LIST_GROUPS.simkl]));
    expect(userListBrowserRows({ ...none, anilist: true })).toHaveLength(6);
    // Trakt: only for a setup already connected.
    expect(userListBrowserRows({ ...none, trakt: false }).length).toBe(0);
    expect(userListBrowserRows({ ...none, trakt: true }).map((row) => row.catalogId)).toEqual(['torbox-watchlist-trakt-movie', 'torbox-watchlist-trakt-series']);
  });

  it('a picked row becomes a Home row keyed by the manifest catalogue id', () => {
    const [upnext] = userListBrowserRows({ ...none, simkl: true });
    const row = homeRowFromSource(upnext!, 3);
    expect(row.source.id).toBe('lelibrary-user-simkl-upnext-series');
    expect(row.source.type).toBe('series');
    expect(row.source.addonId).toBe('');
    expect(row).not.toHaveProperty('service');
    expect(homeCategoryRank(USER_LIST_GROUPS.simkl)).toBeLessThan(homeCategoryRank('Genres'));
  });

  it('MDBList lists: movie lists a movie row, show lists a series row, mixed lists both', () => {
    const rows = mdblistListRows([
      { id: 1, name: 'Films', user_name: 'me', mediatype: 'movie', items: 3, likes: 0, source: 'own' },
      { id: 2, name: 'Shows', user_name: 'me', mediatype: 'show', items: 3, likes: 0, source: 'own' },
      { id: 3, name: 'Mixed', user_name: 'someone', mediatype: '', items: 3, likes: 9, source: 'liked' },
    ]);
    expect(rows.map((row) => [row.catalogId, row.type, row.name])).toEqual([
      ['lelibrary-user-mdblist-list.1-movie', 'movie', 'Films'],
      ['lelibrary-user-mdblist-list.2-series', 'series', 'Shows'],
      ['lelibrary-user-mdblist-list.3-movie', 'movie', 'Mixed (someone)'],
      ['lelibrary-user-mdblist-list.3-series', 'series', 'Mixed (someone)'],
    ]);
    // No MDBList service, no list rows (even if some are loaded).
    expect(userListPickerRows(none, [{ id: 1, name: 'x', user_name: '', mediatype: 'movie', items: 0, likes: 0, source: 'own' }])).toEqual([]);
  });

  it('services come from the draft (create) or the saved setup (edit)', () => {
    expect(userListServicesFrom({}, null)).toEqual({ simkl: false, mdblist: false, anilist: false, trakt: false });
    expect(userListServicesFrom({ mdblistKey: ' typed ', watchlistDraft: { simkl: { access_token: 'synthetic' }, anilist: { access_token: 'synthetic-ani' } } }, null))
      .toEqual({ simkl: true, mdblist: true, anilist: true, trakt: false });
    expect(userListServicesFrom({ savedServices: ['mdblistKey'] }, {
      simkl: { connected: true, configured: true }, trakt: { connected: true, configured: true, legacy: true }, anilist: { connected: false, configured: true },
    })).toEqual({ simkl: true, mdblist: true, anilist: false, trakt: true });
  });

  it('MDBList lists come from the typed key first, else the saved setup', () => {
    expect(mdblistSourceFrom({})).toBeNull();
    expect(mdblistSourceFrom({ mdblistKey: ' k ', savedSetup: { uuid: 'u', editToken: 't' }, savedServices: ['mdblistKey'] })).toEqual({ kind: 'typed', key: 'k' });
    expect(mdblistSourceFrom({ savedSetup: { uuid: 'u', editToken: 't' }, savedServices: ['mdblistKey'] })).toEqual({ kind: 'saved', uuid: 'u', editToken: 't' });
    expect(mdblistSourceFrom({ savedSetup: { uuid: 'u', editToken: null }, savedServices: ['mdblistKey'] })).toBeNull();
  });

  it('an older setup\'s saved public AniList name keeps its shelf; the pages never write one', () => {
    expect(userListServicesFrom({}, {
      simkl: { connected: false, configured: true }, trakt: { connected: false, configured: true }, anilist: { connected: false, configured: false, publicUser: 'Neo_99' },
    }).anilist).toBe(true);
    expect(pruneConfig({ anilistUser: ' Neo_99 ' } as Record<string, unknown>)).not.toHaveProperty('anilistUser');
  });
});
