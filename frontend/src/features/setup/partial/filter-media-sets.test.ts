import { describe, expect, it } from 'vitest';
import {
  ALL_AUDIO,
  ALL_CODECS,
  ALL_HDR,
  mediaSummary,
  toggleMediaItem,
} from '@/features/setup/partial/FilterMediaSets';

describe('media filter sets', () => {
  it('treats empty as all included and materializes on first toggle', () => {
    expect(toggleMediaItem([], ALL_CODECS, 'AV1')).toEqual(['HEVC', 'AVC', 'XviD']);
    expect(toggleMediaItem([], ALL_HDR, 'SDR')).toEqual(['Dolby Vision', 'HDR10+', 'HDR10', 'HDR']);
    expect(toggleMediaItem([], ALL_AUDIO, 'AAC')).toHaveLength(ALL_AUDIO.length - 1);
  });

  it('clears back to all when the set becomes full', () => {
    const missingOne = ALL_CODECS.filter((codec) => codec !== 'XviD');
    expect(toggleMediaItem(missingOne, ALL_CODECS, 'XviD')).toEqual([]);
  });

  it('adds back a removed item', () => {
    expect(toggleMediaItem(['AV1'], ALL_CODECS, 'HEVC')).toEqual(['AV1', 'HEVC']);
  });

  it('summarizes the selection', () => {
    expect(mediaSummary([], ALL_CODECS.length)).toBe('All included');
    expect(mediaSummary(['AV1', 'HEVC'], ALL_CODECS.length)).toBe('2 of 4 included');
  });
});
