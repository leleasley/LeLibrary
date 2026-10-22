import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PosterStudio } from '@/features/setup/shared/poster-studio/PosterStudio';
import { buildSections, shownOffset, storedOffset, type Field } from '@/features/setup/shared/poster-studio/studio-spec';
import type { PictoriumOptionsLib } from '@/features/setup/shared/legacy-libs';

const ROOT = new URL('../../../../../../', import.meta.url);
const OPTIONS_SRC = readFileSync(new URL('backend/src/runtime/pictorium-options.ts', ROOT), 'utf8');

// The keys of the server's DEFAULTS: everything the proxy will forward.
function serverKeys(): string[] {
  const block = OPTIONS_SRC.slice(OPTIONS_SRC.indexOf('const DEFAULTS'), OPTIONS_SRC.indexOf('});', OPTIONS_SRC.indexOf('const DEFAULTS')));
  return [...block.matchAll(/^\s+([a-zA-Z]+):/gm)].map((m) => m[1]!);
}

function keysOf(field: Field): string[] {
  if (field.kind === 'chips') return field.items.map((item) => item.key);
  if (field.kind === 'nudge') return [field.scale, field.x, field.y, ...(field.extra && 'key' in field.extra ? [field.extra.key] : [])];
  return [field.key];
}

const lists = { ratingSources: [['imdb', 'IMDb']] as [string, string][], languages: [['en', 'English']] as [string, string][], regions: [['', 'Automatic']] as [string, string][], videoFormats: [['dv', 'Dolby Vision']] as [string, string][] };

describe('Poster Studio', () => {
  it('has a control for every option the server supports', () => {
    const covered = new Set(buildSections(lists).flatMap((section) => section.fields.flatMap(keysOf)));
    const missing = serverKeys().filter((key) => !covered.has(key));
    expect(missing, `no studio control for: ${missing.join(', ')}`).toEqual([]);
  });

  it('shows the quality badge nudge from Pictorium\'s own default position', () => {
    expect(shownOffset(0, -10)).toBe(0);
    expect(storedOffset(5, -10)).toBe(-5);
    expect(shownOffset(storedOffset(-20, 15), 15)).toBe(-20);
  });

  const DEFAULTS = { bs: 'shadow', rs: 'default', badges: '1', lang: 'en', age: '' };
  const lib: PictoriumOptionsLib = {
    DEFAULTS,
    RATING_SOURCES: lists.ratingSources, LANGUAGES: lists.languages, REGIONS: lists.regions, VIDEO_FORMATS: lists.videoFormats,
    sanitize: (input) => ({ ...DEFAULTS, ...(input as object) }),
    toQuery: () => '',
    fromQuery: () => ({ ...DEFAULTS }),
  };

  it('renders looks, sections and a change count, and asks for a TMDB key for the preview', () => {
    const html = renderToStaticMarkup(
      <PosterStudio lib={lib} initial={{ bs: 'vetro', age: '1' }} previewUrl={null} onSave={() => undefined} onClose={() => undefined} />,
    );
    for (const text of ['Start from a look', 'Classic', 'Glass', 'Badges', 'Rankings and top badges', 'Fine-tune', '2 changes', 'Add your TMDB key to see a live preview.', 'Save posters']) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-modal="true"');
  });

  it('says Defaults when nothing is changed', () => {
    const html = renderToStaticMarkup(
      <PosterStudio lib={lib} initial={{}} previewUrl={null} onSave={() => undefined} onClose={() => undefined} />,
    );
    expect(html).toContain('>Defaults<');
  });
});

import { guessAgeCountry } from '@/features/setup/shared/poster-studio/studio-spec';

describe('age rating country', () => {
  const known: [string, string][] = [['GB', 'United Kingdom'], ['US', 'United States'], ['DE', 'Germany'], ['GLOBAL', 'Worldwide']];
  it('uses the region, then the browser country, then GB (never Pictorium\'s Italian fallback)', () => {
    expect(guessAgeCountry('DE', ['en-US'], known)).toBe('DE');
    expect(guessAgeCountry('GLOBAL', ['en-US', 'en'], known)).toBe('US');
    expect(guessAgeCountry('', ['fr'], known)).toBe('GB');
  });
});
