import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ReviewStep } from '@/features/setup/full/ReviewStep';

// The finished page waits hidden (visibility:hidden) behind the "your setup is
// live" modal. The modal used to sit inside that hidden page, so it was hidden
// too and creating a Move In setup ended on an empty screen.
describe('Move In end screen', () => {
  it('renders the created modal beside the waiting page, not inside it', () => {
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = 'window' in g;
    if (!hadWindow) g.window = { location: { origin: 'https://dev.example' } };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ReviewStep
          password="correct-horse-battery" confirmation="correct-horse-battery" busy={false} error={null} backTo="/configure"
          onPassword={() => {}} onConfirmation={() => {}} onSubmit={() => {}}
          created={{ uuid: '11111111-2222-4333-8444-555555555555', installToken: '11111111-2222-4333-8444-555555555555.secret' }}
          name="test" platform="nuvio" pushConn={null} collections={[]} onImportCollections={() => {}}
        />
      </MemoryRouter>,
    );
    const waiting = html.indexOf('is-waiting');
    const modal = html.indexOf('created-modal');
    expect(waiting).toBeGreaterThan(-1);
    expect(modal).toBeGreaterThan(-1);
    // Everything from the waiting div's opening tag to its matching close.
    const start = html.lastIndexOf('<div', waiting);
    let depth = 0;
    let end = start;
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = start;
    for (let m = tag.exec(html); m; m = tag.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { end = m.index; break; }
    }
    expect(modal > end, 'the modal must not be inside the hidden waiting page').toBe(true);
    if (!hadWindow) delete g.window;
  });
});
