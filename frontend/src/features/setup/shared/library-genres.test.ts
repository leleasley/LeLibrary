import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LIBRARY_GENRES } from '@/features/setup/shared/collection-doc';

// The picker's genre list must match the server's (slugs are saved in
// catalogue ids; a slug only the browser knows would be a dead row).
describe('Your genres list', () => {
  it('matches backend/src/library/genres.ts', () => {
    const server = readFileSync(new URL('../../../../../backend/src/library/genres.ts', import.meta.url), 'utf8');
    const rows = server.split('\n').map((line) => line.match(/^\s*\{ slug: '([a-z0-9]+)', name: '([^']+)', group: '(genre|theme|world)'(.*)\},\s*$/)).filter((m): m is RegExpMatchArray => m !== null)
      .map(([, slug, name, group, rest]) => {
        const tvName = rest!.match(/tvName: '([^']+)'/)?.[1];
        return { slug, name, group, movie: /\bmovie: \{/.test(rest!), tv: /\btv: \{/.test(rest!), ...(tvName ? { tvName } : {}) };
      });
    expect(rows.length).toBeGreaterThan(80);
    expect(LIBRARY_GENRES).toEqual(rows);
  });
});
