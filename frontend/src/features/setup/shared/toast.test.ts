import { describe, expect, it } from 'vitest';
import { splitToast } from '@/features/setup/shared/Toast';

describe('toast text', () => {
  it('turns a short leading label into a title', () => {
    expect(splitToast('TorBox: connected as Lewis')).toEqual({ title: 'TorBox', body: 'Connected as Lewis' });
    expect(splitToast('TMDB: key verified')).toEqual({ title: 'TMDB', body: 'Key verified' });
  });

  it('leaves ordinary sentences whole', () => {
    expect(splitToast('Settings backup downloaded')).toEqual({ title: null, body: 'Settings backup downloaded' });
    expect(splitToast('Session expired: unlock again')).toEqual({ title: 'Session expired', body: 'Unlock again' });
    expect(splitToast('This is a long sentence that happens to contain: a colon')).toEqual({ title: null, body: 'This is a long sentence that happens to contain: a colon' });
    expect(splitToast('Saved. Note: done')).toEqual({ title: null, body: 'Saved. Note: done' });
  });
});
