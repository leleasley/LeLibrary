import { describe, expect, it } from 'vitest';
import {
  EMPTY_NUVIO_PLAYBACK,
  cleanNuvioPlayback,
  nuvioPlaybackForConfig,
  playbackValidation,
} from '@/features/setup/shared/nuvio-playback';

describe('cleanNuvioPlayback', () => {
  it('restores a saved choice and defaults an absent one to off', () => {
    expect(cleanNuvioPlayback({
      mode: 'REGEX_MATCH',
      regex: '(2160p|4k)',
      nextEpisode: true,
      onlyLeLibrary: false,
    })).toEqual({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: '(2160p|4k)',
      nextEpisode: true,
      onlyLeLibrary: false,
    });

    expect(cleanNuvioPlayback(null)).toEqual(EMPTY_NUVIO_PLAYBACK);
    expect(cleanNuvioPlayback({ mode: 'AUTO' })).toEqual(EMPTY_NUVIO_PLAYBACK);
    expect(cleanNuvioPlayback({ mode: 'MANUAL' })).toEqual({
      ...EMPTY_NUVIO_PLAYBACK,
      enabled: true,
    });
  });
});

describe('nuvioPlaybackForConfig', () => {
  it('omits the field entirely when the user did not opt in', () => {
    expect(nuvioPlaybackForConfig(EMPTY_NUVIO_PLAYBACK)).toBeNull();
  });

  it('stores only the values Nuvio reads', () => {
    expect(nuvioPlaybackForConfig({
      enabled: true,
      mode: 'FIRST_STREAM',
      regex: '',
      nextEpisode: true,
      onlyLeLibrary: false,
    })).toEqual({ mode: 'FIRST_STREAM', regex: '', nextEpisode: true, onlyLeLibrary: false });
  });

  it('refuses an invalid regex choice instead of saving a broken setting', () => {
    expect(nuvioPlaybackForConfig({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: '   ',
      nextEpisode: false,
      onlyLeLibrary: false,
    })).toBeNull();
  });
});

describe('playbackValidation', () => {
  it('accepts every mode except an empty regex pattern', () => {
    expect(playbackValidation(EMPTY_NUVIO_PLAYBACK)).toBeNull();
    expect(playbackValidation({ ...EMPTY_NUVIO_PLAYBACK, enabled: true })).toBeNull();
    expect(playbackValidation({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: '',
      nextEpisode: false,
      onlyLeLibrary: false,
    })).toBe('regex-required');
    expect(playbackValidation({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: 'x'.repeat(301),
      nextEpisode: false,
      onlyLeLibrary: false,
    })).toBe('regex-too-long');
  });
});

describe('only LeLibrary auto-play', () => {
  it('is saved with the playback choice and restored from it', () => {
    const draft = cleanNuvioPlayback({ mode: 'FIRST_STREAM', regex: '', nextEpisode: false, onlyLeLibrary: true });
    expect(draft.onlyLeLibrary).toBe(true);
    expect(nuvioPlaybackForConfig(draft)).toEqual({ mode: 'FIRST_STREAM', regex: '', nextEpisode: false, onlyLeLibrary: true });
    expect(cleanNuvioPlayback({ mode: 'FIRST_STREAM' }).onlyLeLibrary).toBe(false);
  });
});
