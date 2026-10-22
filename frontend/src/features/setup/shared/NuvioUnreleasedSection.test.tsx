import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NuvioUnreleasedSection } from '@/features/setup/shared/NuvioUnreleasedSection';

function render(value: 'inherit' | 'hide' | 'show'): string {
  return renderToStaticMarkup(<NuvioUnreleasedSection value={value} onChange={() => {}} />);
}

describe('NuvioUnreleasedSection', () => {
  it('offers leave-unchanged, hide and show', () => {
    const html = render('inherit');
    expect(html).toContain('Unreleased content');
    expect(html).toContain('Leave unchanged');
    expect(html).toContain('Hide unreleased movies and shows');
    expect(html).toContain('Show unreleased titles');
    expect(html).toContain('checked="" value="inherit"');
  });

  it('reflects the explicit choices', () => {
    expect(render('hide')).toContain('checked="" value="hide"');
    expect(render('show')).toContain('checked="" value="show"');
  });

  it('says when the setting is applied', () => {
    expect(render('hide')).toContain('when you push');
  });
});
