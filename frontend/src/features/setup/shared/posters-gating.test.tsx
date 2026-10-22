import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EMPTY_POSTERS, PosterPreview, PostersSection } from '@/features/setup/shared/PostersSection';

// BetterPosters stays selectable, but LeLibrary can only ask btttr for artwork
// once it knows each title's IMDb id, which comes from TMDB's external_ids
// under the user's own key. Until then the preview must not load btttr at all.
describe('betterposters preview needs a TMDB key', () => {
  it('offers the provider regardless of the key', () => {
    const html = renderToStaticMarkup(
      <PostersSection
        draft={EMPTY_POSTERS}
        keys={{}}
        onDraft={() => {}}
        onKeys={() => {}}
        hidePreview
      />,
    );
    expect(html).toContain('BetterPosters');
  });

  it('never loads btttr for the preview without a key', () => {
    const html = renderToStaticMarkup(
      <PosterPreview provider="betterposter" keys={{}} draft={EMPTY_POSTERS} />,
    );
    expect(html).not.toContain('btttr.cc/poster');
    expect(html).toContain('BetterPosters needs it to render.');
  });

  it('previews normally with a key', () => {
    const html = renderToStaticMarkup(
      <PosterPreview provider="betterposter" keys={{ tmdbApiKey: 'a-key' }} draft={EMPTY_POSTERS} />,
    );
    expect(html).toContain('poster-skeleton');
    expect(html).not.toContain('needs it to render');
  });

  it('treats a whitespace-only key as no key', () => {
    const html = renderToStaticMarkup(
      <PosterPreview provider="betterposter" keys={{ tmdbApiKey: '   ' }} draft={EMPTY_POSTERS} />,
    );
    expect(html).toContain('BetterPosters needs it to render.');
  });
});
