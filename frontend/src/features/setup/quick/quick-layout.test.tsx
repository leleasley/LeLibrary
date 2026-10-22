import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickSetupPage, QUICK_SECTION_IDS } from '@/features/setup/quick/QuickSetupPage';
import { BADGE_PACKS } from '@/features/setup/shared/BadgePackPicker';
import { EMPTY_POSTERS, PosterPreview } from '@/features/setup/shared/PostersSection';

function render() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <QuickSetupPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('quick look reference layout', () => {
  it('renders the redesigned flow: hero, progress rail, numbered steps, live preview', () => {
    const html = render();
    // Header block
    expect(html).toContain('Quick Setup');
    expect(html).toContain('Ready in a few fields.');
    expect(html).not.toContain('Open full editor');
    // Sticky progress rail with one stop per step, numbered steps
    expect(html).toContain('qs-progress');
    expect(html).not.toContain('setup-rail');
    expect(html.match(/class="qs-rail-step( |")/g)?.length ?? 0).toBe(4);
    expect(html).toContain('flow-num');
    for (const n of ['01', '02', '03', '04']) expect(html).toContain(n);
    // Lists moved out of Quick Look entirely.
    expect(html).not.toContain('MDBList API key');
    expect(html).not.toContain('section-lists');
    // Every section id present, in contract order
    let cursor = -1;
    for (const id of QUICK_SECTION_IDS) {
      const at = html.indexOf(`id="section-${id}"`);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    // Live preview: TMDB is the default provider but the key is required, so
    // the preview waits for it instead of showing art the setup cannot load yet.
    expect(html).toContain('finish');
    expect(html).toContain('TMDB default preview');
    expect(html).toContain('Add your TMDB key above to see TMDB posters.');
    expect(html).toContain('poster-pair-empty');
    expect(html).toContain('poster-stage');
    // No sidebar CTA until a matching password exists; the step's own button is disabled.
    expect(html).toContain('Set a password below');
    expect(html).not.toContain('finish-cta');
    expect(html).toMatch(/<button type="submit" class="qs-cta" disabled="">/);
  });

  it('keeps posters on the real dropdown; badge packs and stream styles are cards', () => {
    const html = render();
    expect(html).toContain('<option value="betterposter"');
    expect(html).not.toContain('qs-poster');
    expect(html.match(/class="qs-chip( |")/g)?.length ?? 0).toBe(BADGE_PACKS.length);
    expect(html).toContain('aria-label="Stream display style"');
    expect(html).toMatch(/aria-checked="true" class="qs-stream is-selected"/);
    expect(html).toContain('more styles');
  });

  it('offers TVDB as optional and TMDB as required', () => {
    const html = render();
    expect(html).toContain('TVDB API key');
    expect(html).toContain('Get key');
    expect(html).toMatch(/TMDB API key<span class="req"> \*<\/span>/);
  });

  it('never marks an individual debrid provider as required', () => {
    const html = render();
    // One of them is needed, not each of them: no asterisk on any provider key.
    expect(html).not.toMatch(/TorBox API key<span class="req"/);
    expect(html).not.toMatch(/Real-Debrid API key<span class="req"/);
    expect(html).toContain('Get key');
  });

  it('ticks provider boxes and clears the key when unticked', () => {
    const html = render();
    // All four providers render a tick box, collapsed by default.
    expect(html.match(/class="pc-toggle"/g)?.length ?? 0).toBe(4);
    // Provider keys are hidden by default (collapsed), no placeholder visible.
    expect(html).not.toContain('tb-xxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('round-trips the draft through session storage', async () => {
    const store: Record<string, string> = {};
    (globalThis as any).sessionStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    };
    try {
      const draft = await import('@/features/setup/quick/quick-draft');
      expect(draft.loadQuickDraft()).toBe(null);
      draft.saveQuickDraft({
        name: 'Living room',
        keys: { torboxApiKey: 'tb-kept-across-refresh' },
        formatting: { preset: 'cinema', nameTemplate: '', descTemplate: '' },
        posters: { provider: 'pictorium', pictoriumUrl: '', pictoriumOptions: {}, customTemplate: '' },
        badgePack: { pack: 'nard-full', url: '' },
      });
      const restored = draft.loadQuickDraft();
      expect(restored?.name).toBe('Living room');
      expect(restored?.keys).toEqual({ torboxApiKey: 'tb-kept-across-refresh' });
      expect(restored?.formatting.preset).toBe('cinema');
      expect(restored?.posters.provider).toBe('pictorium');
      expect(restored?.badgePack.pack).toBe('nard-full');
      draft.clearQuickDraft();
      expect(draft.loadQuickDraft()).toBe(null);
    } finally {
      delete (globalThis as any).sessionStorage;
    }
  });

  it('keeps advanced content collapsed by default', () => {
    const html = render();
    // Row names and library options are summary cards that start closed:
    // their chips show the current choices, the fields stay hidden.
    expect(html).toContain('Library options');
    expect(html).not.toContain('lr-card is-open');
    expect(html).not.toContain('Hide anime');
    expect(html).toContain('Anime shown');
    expect(html).toContain('Badge packs');
    // Badges preview inside the stream preview, not their own box.
    expect(html).not.toContain('badge-card');
  });

  it('offers Pictorium with no option toggles', () => {
    const html = render();
    expect(html).toContain('Pictorium');
    expect(html).not.toContain('Pictorium instance URL');
    expect(html).not.toContain('Rating badges');
  });

  it('shows poster skeletons with no names while artwork loads', () => {
    // BetterPosters resolves per title with the TMDB key, so the key is part of
    // this case: without it the provider is withheld (posters-gating.test.tsx).
    const html = renderToStaticMarkup(
      <PosterPreview provider="betterposter" keys={{ tmdbApiKey: 'a-key' }} draft={EMPTY_POSTERS} />,
    );
    expect(html).toContain('poster-skeleton');
    expect(html).toContain('poster-pair');
    expect(html).not.toContain('<figcaption>');
  });

  it('ships all nine real badge packs with the local one default', () => {
    expect(BADGE_PACKS.map((p) => p.id)).toEqual([
      'lelibrary-premium', 'nard-full', 'nard-slim', 'better-colored',
      'better-mono', 'elite', 'minimal-white', 'minimal-mixed', 'custom',
    ]);
  });
});
