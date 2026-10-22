import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CLIENT_COPY, CLIENT_LOGOS, PublishPanel, publishActionFor } from '@/features/setup/shared/PublishPanel';

// The end of every tier is one surface: ready header, publish desk, both
// install files, player links, sharing, the other client integrations and
// manual controls. These tests pin
// the parts a user is promised, not the styling.

function render(overrides: Partial<Parameters<typeof PublishPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <PublishPanel
      installToken="uuid.secret"
      uuid="12345678-90ab-cdef-1234-567890abcdef"
      tierLabel="Move In"
      name="Main2"
      platform="nuvio"
      counts={{ homeRows: 2, collections: 3, folders: 14, lang: 'en-US' }}
      hasCollections
      action={{ label: 'Save and push to Nuvio', onClick: () => {} }}
      secondaryAction={{ label: 'Clear my edits', onClick: () => {} }}
      {...overrides}
    />,
  );
}

describe('publish panel', () => {
  it('names the setup and reports what it holds', () => {
    const html = render();
    expect(html).toContain('Main2 is ready');
    expect(html).toContain('2 home rows · 3 collections · 14 folders · en-US');
  });

  it('offers both install files inside manual setup, and nowhere twice', () => {
    const html = render();
    // Manual setup is the one place the files live: a second copyable block
    // above it was pure duplication.
    expect(html).toContain('Manual setup');
    expect(html).toContain('uuid.secret/manifest.json');
    expect(html).toContain('uuid.secret/collections.json');
    // One copyable field each, and no second "Your manifest.json" block.
    expect(html.match(/aria-label="Manifest URL"/g)?.length).toBe(1);
    expect(html.match(/aria-label="Collections JSON URL"/g)?.length).toBe(1);
    expect(html).not.toContain('Your manifest.json');
    expect(html).not.toContain('Your collections.json');
  });

  it('leaves collections.json out of the tiers that build no collections', () => {
    // Quick Look and Settle In never publish a collections document, so showing
    // one (and a share link to it) would promise something that does not exist.
    const settleIn = render({ tierLabel: 'Settle In', hasCollections: false, action: null });
    expect(settleIn).not.toContain('collections.json');
    expect(settleIn).not.toContain('Share this setup');
    expect(settleIn).not.toContain('Download profile JSON');
    expect(settleIn).toContain('uuid.secret/manifest.json');
    // The desk must not claim to push collections either.
    expect(settleIn).not.toContain('Home rows and collections');
  });

  it('shows the single publish action it was given', () => {
    const html = render();
    expect(html).toContain('class="publish-desk"');
    expect(html).toContain('Publish to Nuvio');
    expect(html).toContain('Save and push to Nuvio');
    expect(html).toContain('Clear my edits');
  });

  it('keeps the PUBLISH DESK label', () => {
    // The label is a CSS pseudo-element, so a
    // rename of the class or the copy would silently drop it.
    const css = readFileSync(new URL('../setup.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.publish-desk::before\s*\{[^}]*content:\s*'PUBLISH DESK'/);
  });

  it('renders the profile picker for a Nuvio connection with profiles', () => {
    const html = render({
      profilePicker: {
        profiles: [{ profile_index: 0, name: 'Lewis' }, { profile_index: 1, name: 'Main2' }],
        value: 1,
        onChange: () => {},
      },
    });
    expect(html).toContain('Lewis');
    expect(html).toContain('Main2');
    expect(html).toContain('aria-label="Nuvio profile"');
  });

  it('falls back to the install path when the setup has no player login', () => {
    const html = render({ action: null, counts: { homeRows: 3, lang: 'en-US' } });
    expect(html).not.toContain('Save and push');
    expect(html).toContain('Open in Stremio');
    expect(html).toContain('3 home rows · en-US');
    // A tier without a collections studio must not report empty ones.
    expect(html).not.toContain('0 collections');
  });

  it('keeps sharing, the other clients and manual controls reachable', () => {
    const html = render();
    expect(html).toContain('Add to Stremio');
    expect(html).toContain('Share this setup');
    expect(html).toContain('Download profile JSON');
    expect(html).toContain('More client integrations');
    expect(html).toContain('Manual setup');
    expect(html).toContain('Clear cached data');
  });

  it('renders extra actions a tier adds, beside the primary', () => {
    // Settle In has no player login, so its publish desk offers the install
    // path plus "Open your setup" rather than a push button.
    const html = render({ action: null, actionsExtra: <a className="setup-secondary" href="/uuid">Open your setup</a> });
    expect(html).toContain('Open your setup');
    expect(html).toContain('Open in Stremio');
    expect(html).not.toContain('Save and push');
  });
});

describe('client integration contract', () => {
  // The backend exposes one adapter per id; a renamed adapter must not silently
  // disappear from the list.
  it('covers exactly the adapters the addon publishes, each with copy and a logo', () => {
    const ids = ['strmr', 'fusion', 'vidi', 'wuplay'];
    expect(Object.keys(CLIENT_COPY).sort()).toEqual([...ids].sort());
    expect(Object.keys(CLIENT_LOGOS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(CLIENT_COPY[id]?.[0]).toBeTruthy();
      expect(CLIENT_COPY[id]?.[1]).toContain('compatible manifest');
      expect(CLIENT_LOGOS[id]).toContain(`/client-logos/${id}.`);
    }
  });
});

describe('the single action at the end of a setup', () => {
  const base = {
    dirty: false, pushing: null, saving: false, pushAvailable: true, platformName: 'Nuvio',
  };

  it('pushes alone when everything is already saved', () => {
    const action = publishActionFor({ ...base, onSaveAndPush: () => {}, onSave: () => {} });
    expect(action.label).toBe('Push to Nuvio');
    expect(action.label).not.toContain('Save');
    expect(action.hint).toContain('Everything is saved');
  });

  it('saves and pushes when there are unsaved edits', () => {
    const action = publishActionFor({ ...base, dirty: true, onSaveAndPush: () => {}, onSave: () => {} });
    expect(action.label).toBe('Save and push to Nuvio');
    expect(action.hint).toContain('edits save first');
  });

  it('reports push progress instead of a button that looks idle', () => {
    const action = publishActionFor({ ...base, pushing: 'Pushing to Nuvio…', onSaveAndPush: () => {}, onSave: () => {} });
    expect(action.label).toBe('Pushing to Nuvio…');
    expect(action.busy).toBe(true);
  });

  it('saves without pushing when this setup has no player login', () => {
    const onSave = vi.fn();
    const action = publishActionFor({ ...base, dirty: true, pushAvailable: false, onSaveAndPush: () => {}, onSave });
    expect(action.label).toBe('Save changes');
    expect(action.hint).toContain('Connect Nuvio on the Destination step');
    action.onClick();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('does not offer a pointless save when a login-less setup is already saved', () => {
    const action = publishActionFor({ ...base, pushAvailable: false, onSaveAndPush: () => {}, onSave: () => {} });
    expect(action.disabled).toBe(true);
  });
});
