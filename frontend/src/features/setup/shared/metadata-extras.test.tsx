import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_NOTICE_TYPES,
  EMPTY_QUICK_EXTRAS,
  NoticeDropdown,
  TorboxSourcesField,
  quickExtrasChips,
} from '@/features/setup/full/MetadataExtras';
import { pruneConfig } from '@/features/setup/shared/config-contract';

describe('stream notices dropdown', () => {
  it('renders one checkbox per notice type with a live count', () => {
    const html = renderToStaticMarkup(
      <NoticeDropdown notices noticeTypes={['none']} onNotices={() => {}} onToggleType={() => {}} />,
    );
    expect(html).toContain('Choose notices');
    expect(html).toContain('1 of 3 on');
    expect(html).toContain('No streams found');
    expect(html).toContain('Provider rate limit');
    expect(html).toContain('Digital release not found');
    expect(html.match(/type="checkbox"/g)?.length ?? 0).toBe(4);
  });

  it('reads Off when the master switch is off', () => {
    const html = renderToStaticMarkup(
      <NoticeDropdown notices={false} noticeTypes={[]} onNotices={() => {}} onToggleType={() => {}} />,
    );
    expect(html).toContain('Off');
  });

  it('sends nothing when Quick extras are untouched', () => {
    expect(pruneConfig({
      searchScope: EMPTY_QUICK_EXTRAS.searchScope,
      libraryIdMode: 'torbox',
      hideAnime: EMPTY_QUICK_EXTRAS.hideAnime,
      torboxSources: EMPTY_QUICK_EXTRAS.torboxSources,
      streamNotices: 'on',
      streamNoticeTypes: [...DEFAULT_NOTICE_TYPES],
    })).toEqual({});
  });

  it('sends Quick extras only when changed', () => {
    expect(pruneConfig({
      searchScope: 'library',
      libraryIdMode: 'tt',
      hideAnime: true,
      streamNotices: 'off',
      streamNoticeTypes: ['none'],
    })).toEqual({
      searchScope: 'library',
      libraryIdMode: 'tt',
      hideAnime: true,
      streamNotices: 'off',
      streamNoticeTypes: ['none'],
    });
  });
});

describe('TorBox sources field', () => {
  it('offers torrents, usenet and web downloads, all on by default', () => {
    const html = renderToStaticMarkup(<TorboxSourcesField value={undefined} onChange={() => {}} />);
    expect(html).toContain('TorBox sources');
    expect(html).toContain('Torrents');
    expect(html).toContain('Usenet');
    expect(html).toContain('Web downloads');
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(3);
    expect(html).not.toContain('disabled');
  });

  it('keeps the last source on', () => {
    const html = renderToStaticMarkup(<TorboxSourcesField value={['usenet']} onChange={() => {}} />);
    expect(html.match(/checked=""/g)?.length ?? 0).toBe(1);
    expect(html.match(/disabled=""/g)?.length ?? 0).toBe(1);
  });

  it('shows a Quick Look chip only when the library is limited', () => {
    expect(quickExtrasChips(EMPTY_QUICK_EXTRAS).some((chip) => chip.key === 'torbox-sources')).toBe(false);
    const chip = quickExtrasChips({ ...EMPTY_QUICK_EXTRAS, torboxSources: ['usenet'] }).find((entry) => entry.key === 'torbox-sources');
    expect(chip?.text).toBe('TorBox: Usenet');
  });
});
