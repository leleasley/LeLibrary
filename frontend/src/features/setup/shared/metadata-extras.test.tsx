import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_NOTICE_TYPES,
  EMPTY_QUICK_EXTRAS,
  NoticeDropdown,
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
