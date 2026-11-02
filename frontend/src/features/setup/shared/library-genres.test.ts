import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIBRARY_GENRES } from '@/features/setup/shared/collection-doc';

// The picker's genre list must match the server's (slugs are saved in
// catalogue ids; a slug only the browser knows would be a dead row).
describe('Your genres list', () => {
  it('matches backend/src/library/genres.ts', () => {
    const server = readFileSync(new URL('../../../../../backend/src/library/genres.ts', import.meta.url), 'utf8');
    const rows = [...server.matchAll(/\{ slug: '([a-z]+)', name: '([^']+)', movie: \[([^\]]*)\], tv: \[([^\]]*)\](?:, tvName: '([^']+)')? \}/g)]
      .map(([, slug, name, movie, tv, tvName]) => ({ slug, name, movie: movie!.trim() !== '', tv: tv!.trim() !== '', ...(tvName ? { tvName } : {}) }));
    expect(rows.length).toBeGreaterThan(10);
    expect(LIBRARY_GENRES).toEqual(rows);
  });
});
