import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishPanel } from '@/features/setup/shared/PublishPanel';
import { CreatingSetup } from '@/features/setup/shared/CreatingSetup';
import { RegenerateLink } from '@/features/setup/shared/RegenerateLink';

// The 5.9 end of a new setup: "Creating your setup..." then the Ready page.
// No post-creation modal any more; push, Stremio, More players and the
// revoke-and-regenerate control all live on the one page.

function render(overrides: Partial<Parameters<typeof PublishPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <PublishPanel
      installToken="uuid.secret"
      uuid="12345678-90ab-cdef-1234-567890abcdef"
      tierLabel="Settle In"
      name="Living room"
      platform="nuvio"
      action={{ label: 'Push to Nuvio', onClick: () => {} }}
      {...overrides}
    />,
  );
}

describe('Ready page', () => {
  it('says who a push lands on, with a way to switch account', () => {
    const html = render({ account: { user: 'me@example.com', onChange: () => {} } });
    expect(html).toContain('Pushing to');
    expect(html).toContain('me@example.com');
    expect(html).toContain('Not you?');
    expect(render({ account: { user: 'me@example.com' } })).not.toContain('Not you?');
    expect(render()).not.toContain('Pushing to');
  });

  it('folds other apps and manual setup under More players', () => {
    const html = render();
    const fold = html.indexOf('More players');
    expect(fold).toBeGreaterThan(-1);
    expect(html.indexOf('Manual setup')).toBeGreaterThan(fold);
    expect(html.indexOf('More client integrations')).toBeGreaterThan(fold);
    // Stremio stays outside the fold.
    expect(html.indexOf('Add to Stremio')).toBeLessThan(fold);
  });

  it('puts revoke and regenerate at the bottom of manual setup only when asked', () => {
    expect(render()).not.toContain('Revoke and regenerate');
    const html = render({ regenerate: { editToken: 'edit', onRotated: () => {} } });
    expect(html.indexOf('Revoke and regenerate')).toBeGreaterThan(html.indexOf('Clear cached data'));
  });

  it('renders a footer under the panel', () => {
    expect(render({ footer: <a href="/">Finish</a> })).toContain('publish-footer');
  });

  it('regenerate is disabled until the page holds an edit token', () => {
    expect(renderToStaticMarkup(<RegenerateLink uuid="u" editToken={null} onRotated={() => {}} />)).toMatch(/<button[^>]*disabled/);
    expect(renderToStaticMarkup(<RegenerateLink uuid="u" editToken="t" onRotated={() => {}} />)).not.toMatch(/<button[^>]*disabled/);
  });

  it('the loader names the setup and announces itself', () => {
    const html = renderToStaticMarkup(<CreatingSetup leaving={false} name="Living room" />);
    expect(html).toContain('Creating your setup');
    expect(html).toContain('Living room');
    expect(html).toContain('role="status"');
    expect(renderToStaticMarkup(<CreatingSetup leaving name={null} />)).toContain('is-leaving');
  });

  it('no tier opens the old post-creation modal', () => {
    for (const file of ['partial/PartialSetupPage.tsx', 'full/ReviewStep.tsx', 'full/FullSetupPage.tsx']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toContain('SetupCreatedModal');
    }
  });
});
