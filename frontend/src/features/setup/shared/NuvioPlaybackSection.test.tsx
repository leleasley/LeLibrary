import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NuvioPlaybackSection } from '@/features/setup/shared/NuvioPlaybackSection';
import { EMPTY_NUVIO_PLAYBACK } from '@/features/setup/shared/nuvio-playback';

function render(value = EMPTY_NUVIO_PLAYBACK): string {
  return renderToStaticMarkup(<NuvioPlaybackSection value={value} onChange={() => {}} />);
}

describe('NuvioPlaybackSection', () => {
  it('stays opt-in: no controls until the user asks for them', () => {
    const html = render();
    expect(html).toContain('Set these in Nuvio when I push');
    expect(html).not.toContain('Auto Stream Selection');
    expect(html).not.toContain('Auto-play next episode');
  });

  it('shows the three stream modes and the next-episode toggle when enabled', () => {
    const html = render({ ...EMPTY_NUVIO_PLAYBACK, enabled: true });
    expect(html).toContain('Auto Stream Selection');
    expect(html).toContain('Manual (choose stream)');
    expect(html).toContain('Auto-play first source');
    expect(html).toContain('Auto-play regex match');
    expect(html).toContain('Auto-play next episode');
    // No regex field for the non-regex modes.
    expect(html).not.toContain('Regex pattern');
  });

  it('shows the pattern field and an inline error for an empty regex', () => {
    const html = render({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: '',
      nextEpisode: false,
      onlyLeLibrary: false,
    });
    expect(html).toContain('Regex pattern');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Enter a pattern for regex match.');
  });

  it('accepts a pattern and renders it as an input value, never as markup', () => {
    const html = render({
      enabled: true,
      mode: 'REGEX_MATCH',
      regex: '<script>alert(1)</script>',
      nextEpisode: true,
      onlyLeLibrary: false,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('aria-invalid="true"');
  });
});
