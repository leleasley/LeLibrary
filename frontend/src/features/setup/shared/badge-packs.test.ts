import { describe, expect, it } from 'vitest';
import { matchBadges, packGallery } from '@/features/setup/shared/BadgePackPicker';

const PACK = {
  groups: [{ id: 'gq', color: '#27C04F' }],
  filters: [
    { name: 'Q', pattern: '2160p', imageURL: 'https://x.test/q.png', groupId: 'gq', borderColor: '#FF858283', tagColor: '#00000000', tagStyle: 'filled and bordered' },
    { name: 'A', pattern: 'nomatch-glyph-♛', imageURL: 'https://x.test/a.png', groupId: 'gq' },
    { name: 'Dup', pattern: '2160p', imageURL: 'https://x.test/q.png', groupId: 'gq' },
    { name: 'Bad', pattern: '2160p', imageURL: 'ftp://x.test/bad.png', groupId: 'gq' },
  ],
};

describe('badge matcher', () => {
  it('falls back to the group colour for transparent fills', () => {
    const [first] = matchBadges(PACK, 'https://x.test/pack.json');
    expect(first?.tagColor).toBe('#27C04F');
    expect(first?.borderColor).toBe('#858283FF');
  });

  it('lists the full set as a gallery, deduplicated', () => {
    const gallery = packGallery(PACK, 'https://x.test/pack.json');
    expect(gallery.map((item) => item.imageURL)).toEqual([
      'https://x.test/q.png',
      'https://x.test/a.png',
    ]);
  });
});
