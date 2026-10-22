import { describe, expect, it } from 'vitest';
import { pickActiveSection } from '@/features/site/site-hooks';

describe('pickActiveSection', () => {
  it('picks the last heading scrolled past the offset line', () => {
    const entries = [
      { id: 'start', top: -640 },
      { id: 'create', top: -120 },
      { id: 'keys', top: 300 },
    ];
    expect(pickActiveSection(entries, 96)).toBe('create');
  });

  it('picks the first heading before anything crosses the line', () => {
    const entries = [
      { id: 'start', top: 200 },
      { id: 'create', top: 900 },
    ];
    expect(pickActiveSection(entries, 96)).toBe('start');
  });

  it('handles an empty page', () => {
    expect(pickActiveSection([], 96)).toBe('');
  });
});
