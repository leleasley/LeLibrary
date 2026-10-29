import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyInput } from '@/features/setup/shared/sections';

function render(props: Parameters<typeof KeyInput>[0]) {
  return renderToStaticMarkup(<KeyInput {...props} />);
}

// An empty field that the server holds a value for used to say "Saved on the
// server" with an eye that could not show anything. With a reveal wired up, the
// eye is what asks for it, and the copy says so.
describe('saved key reveal affordance', () => {
  it('offers to show the saved value when a reveal is wired up', () => {
    const html = render({
      label: 'TorBox API key', hint: '', value: '', onChange: () => {},
      saved: true, onReveal: async () => 'tb-value',
    });
    expect(html).toContain('Show saved key');
    expect(html).toContain('press the eye to show it');
  });

  it('keeps the plain keep-it-blank wording without a reveal', () => {
    const html = render({
      label: 'TorBox API key', hint: '', value: '', onChange: () => {},
      saved: true,
    });
    expect(html).not.toContain('Show saved key');
    expect(html).toContain('Saved on the server - leave blank to keep it.');
  });

  it('is a plain visibility toggle once the field holds something', () => {
    const html = render({
      label: 'TorBox API key', hint: '', value: 'tb-typed', onChange: () => {},
      saved: true, onReveal: async () => 'tb-value',
    });
    expect(html).toContain('Show key');
    expect(html).not.toContain('Show saved key');
  });

  it('does not offer a reveal for a field the server does not hold', () => {
    const html = render({
      label: 'TorBox API key', hint: '', value: '', onChange: () => {},
      onReveal: async () => 'tb-value',
    });
    expect(html).not.toContain('Show saved key');
    expect(html).not.toContain('Saved ✓');
  });
});
