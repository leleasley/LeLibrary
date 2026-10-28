import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishPanel } from '@/features/setup/shared/PublishPanel';

(globalThis as { window?: unknown }).window ??= { location: { origin: 'https://lelibrary.example' } };

function render(platform: 'nuvio' | 'stremio', withToggle: boolean) {
  return renderToStaticMarkup(
    <PublishPanel
      installToken="u.s" uuid="00000000-0000-4000-8000-000000000001" tierLabel="Move In" platform={platform}
      action={{ label: 'Push', onClick: () => {} }}
      replaceOthers={withToggle ? { value: false, onChange: () => {} } : null}
    />,
  );
}

describe('remove all other collections', () => {
  it('is offered on a Nuvio push, unticked', () => {
    const html = render('nuvio', true);
    expect(html).toContain('Remove all other collections from this profile');
    expect(html).not.toMatch(/<input type="checkbox" checked=""/);
  });
  it('is never offered for Stremio, or when the page does not ask for it', () => {
    expect(render('stremio', true)).not.toContain('Remove all other collections');
    expect(render('nuvio', false)).not.toContain('Remove all other collections');
  });
});
