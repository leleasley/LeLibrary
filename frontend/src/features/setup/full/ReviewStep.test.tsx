import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ReviewStep } from '@/features/setup/full/ReviewStep';

// The "your setup is live" modal builds links from the page address.
(globalThis as { window?: unknown }).window ??= { location: { origin: 'https://lelibrary.example' } };

function render(created: { uuid: string; installToken: string } | null) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ReviewStep
        password="secret-pass" confirmation="secret-pass" busy={false} error={null} backTo="/configure"
        onPassword={() => {}} onConfirmation={() => {}} onSubmit={() => {}}
        created={created} name="TV" platform="nuvio" pushConn={null}
        collections={[]} onImportCollections={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('Move In after creating', () => {
  it('the finished page waits behind the "your setup is live" modal and links to the edit page', () => {
    const html = render({ uuid: '00000000-0000-4000-8000-000000000001', installToken: 'u.s' });
    expect(html).toContain('created-done is-waiting');
    expect(html).toContain('href="/00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('Open your setup');
    // The finished page only pushes: nothing is left unsaved by then.
    expect(html).not.toContain('Save and push to Nuvio</');
  });

  it('before creating, it is the password step', () => {
    expect(render(null)).toContain('Create my setup');
  });
});
