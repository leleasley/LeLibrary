import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Every dropdown in the setup flow starts closed: people open what they want
// to see (operator's call, 2026-11-01). Only a modal or a collection the user
// just created may open on its own.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('setup dropdowns start closed', () => {
  it('no Setup page accordion opens by itself', () => {
    for (const file of ['partial/PartialSetupPage.tsx', 'full/FullSetupPage.tsx', 'quick/QuickSetupPage.tsx']) {
      expect(read(file), file).not.toMatch(/<Accordion[^>]*defaultOpen/);
    }
  });

  it('no details element is rendered open', () => {
    for (const file of ['partial/FilterMediaSets.tsx', 'full/FilterSets.tsx', 'shared/PublishPanel.tsx', 'shared/SearchOptionsSection.tsx', 'full/MetadataExtras.tsx']) {
      expect(read(file), file).not.toMatch(/<details[^>]*\sopen(\s|>|=\{(?!notices \? undefined : false))/);
    }
  });

  it('Poster Studio and the collections studio open nothing on load', () => {
    expect(read('shared/poster-studio/PosterStudio.tsx')).toContain('useState<Set<string>>(() => new Set())');
    expect(read('full/collections/CollectionStudio.tsx')).toContain('useState<string | null>(defaultOpenId)');
  });
});
