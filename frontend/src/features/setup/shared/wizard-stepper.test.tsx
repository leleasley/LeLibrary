import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TierProgress } from '@/features/setup/shared/tier/TierProgress';
import { FULL_SECTIONS } from '@/features/setup/full/FullSetupPage';
import { PARTIAL_SECTIONS } from '@/features/setup/partial/PartialSetupPage';

const toSteps = (sections: readonly { id: string; title: string }[]) =>
  sections.map((section) => ({ id: section.id, label: section.title }));

// The stepped tiers (Settle In, Move In) run on the shared progress rail in
// wizard mode: one clickable stop per step, earlier steps ticked.
describe('progress rail in wizard mode', () => {
  it('renders one clickable stop per step, numbered, with the active one current', () => {
    const html = renderToStaticMarkup(
      <TierProgress steps={toSteps(FULL_SECTIONS)} unsaved={false} wizard={{ active: 0, onStep: () => {} }} />,
    );
    expect(html.match(/class="qs-rail-step( |")/g)?.length ?? 0).toBe(FULL_SECTIONS.length);
    expect(html).toContain('aria-current="step"');
    for (const step of FULL_SECTIONS) expect(html).toContain(step.title);
  });

  it('ticks earlier steps and marks the active one', () => {
    const html = renderToStaticMarkup(
      <TierProgress steps={toSteps(PARTIAL_SECTIONS)} unsaved={false} wizard={{ active: 2, onStep: () => {} }} />,
    );
    expect(html.match(/is-done/g)?.length ?? 0).toBe(2);
    expect(html).toContain('is-active');
    expect(html).toContain('✓');
  });

  it('covers every section of both stepped tiers, whatever they hold', () => {
    for (const sections of [FULL_SECTIONS, PARTIAL_SECTIONS]) {
      const html = renderToStaticMarkup(
        <TierProgress steps={toSteps(sections)} unsaved={false} wizard={{ active: 0, onStep: () => {} }} />,
      );
      expect(html.match(/class="qs-rail-step( |")/g)?.length ?? 0).toBe(sections.length);
    }
  });
});
