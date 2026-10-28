import { describe, expect, it } from 'vitest';
import { playbackFromNuvio, unreleasedFromNuvio } from '@/features/setup/nuvio/prefill';
import { playbackSummary, unreleasedSummary } from '@/features/setup/nuvio/NuvioCurrentNote';

describe('prefill from the Nuvio profile', () => {
  it('builds the playback block from what Nuvio has', () => {
    expect(playbackFromNuvio({ autoPlayMode: 'FIRST_STREAM', nextEpisode: true }, true)).toEqual({
      enabled: true, mode: 'FIRST_STREAM', regex: '', nextEpisode: true, onlyLeLibrary: false,
    });
    expect(playbackFromNuvio({ autoPlayMode: 'FIRST_STREAM' }, false)?.enabled).toBe(false);
  });

  it('never fills in a regex mode without a pattern, and nothing when Nuvio has nothing', () => {
    expect(playbackFromNuvio({ autoPlayMode: 'REGEX_MATCH', autoPlayRegex: '' }, true)?.mode).toBe('MANUAL');
    expect(playbackFromNuvio({ autoPlayMode: 'REGEX_MATCH', autoPlayRegex: '(4k)' }, true)?.mode).toBe('REGEX_MATCH');
    expect(playbackFromNuvio({}, true)).toBeNull();
    expect(playbackFromNuvio({ hideUnreleased: true }, true)).toBeNull();
  });

  it('maps Hide unreleased only when Nuvio has a value', () => {
    expect(unreleasedFromNuvio({ hideUnreleased: true })).toBe('hide');
    expect(unreleasedFromNuvio({ hideUnreleased: false })).toBe('show');
    expect(unreleasedFromNuvio({})).toBeNull();
  });

  it('summarises the profile for the edit page note', () => {
    expect(playbackSummary({ autoPlayMode: 'FIRST_STREAM', nextEpisode: true })).toBe('Auto-play first source · Next episode plays automatically');
    expect(playbackSummary({})).toBeNull();
    expect(unreleasedSummary({ hideUnreleased: false })).toBe('Unreleased titles are shown');
    expect(unreleasedSummary(null)).toBeNull();
  });
});
