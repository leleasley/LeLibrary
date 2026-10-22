import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  forgetSetup,
  isSetupUuid,
  loadSetupHistory,
  rememberSetup,
  setupLabel,
  uuidFromInput,
} from '@/features/setup/shared/setup-history';
import { TierPicker } from '@/features/setup/shared/TierPicker';

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '223e4567-e89b-12d3-a456-426614174001';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

// The history module must survive environments without localStorage (SSR,
// private mode) by degrading to an empty list instead of throwing.
describe('setup-history storage', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('validates UUIDs and extracts them from pasted links', () => {
    expect(isSetupUuid(UUID_A)).toBe(true);
    expect(isSetupUuid(UUID_A.toUpperCase())).toBe(true);
    expect(isSetupUuid('not-a-uuid')).toBe(false);
    expect(isSetupUuid('')).toBe(false);
    expect(uuidFromInput(UUID_A)).toBe(UUID_A);
    expect(uuidFromInput(UUID_A.toUpperCase())).toBe(UUID_A);
    expect(uuidFromInput(`https://example.com/${UUID_A}`)).toBe(UUID_A);
    expect(uuidFromInput(`https://example.com/${UUID_A}/?foo=1`)).toBe(UUID_A);
    expect(uuidFromInput('garbage')).toBe('');
    expect(uuidFromInput('')).toBe('');
  });

  it('extracts the UUID from the links people actually save', () => {
    // Install link (uuid.secret) and its manifest URL.
    expect(uuidFromInput(`${UUID_A}.abc123`)).toBe(UUID_A);
    expect(uuidFromInput(`https://example.com/${UUID_A}.abc123/manifest.json`)).toBe(UUID_A);
    // Edit link, with and without a password-configured install token.
    expect(uuidFromInput(`https://example.com/${UUID_A}/configure`)).toBe(UUID_A);
    expect(uuidFromInput(`https://example.com/${UUID_A}.abc123/configure`)).toBe(UUID_A);
    expect(uuidFromInput(`https://example.com/${UUID_A}/manifest.json?x=1`)).toBe(UUID_A);
    // Still rejects anything that is not a setup.
    expect(uuidFromInput('https://example.com/not-a-setup/manifest.json')).toBe('');
    expect(uuidFromInput('https://example.com/configure')).toBe('');
  });

  it('returns an empty list with no storage available', () => {
    expect(loadSetupHistory()).toEqual([]);
    // Without storage the entry only lives for the session, but the call
    // still reports what it did instead of throwing.
    expect(rememberSetup({ uuid: UUID_A })).toHaveLength(1);
    expect(setupLabel({ uuid: UUID_A, savedAt: 0 })).toBe('Setup 123e4567\u2026');
  });

  it('remembers, dedupes, caps and forgets entries', () => {
    (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
    expect(rememberSetup({ uuid: UUID_A, name: 'Living room', tier: 'quick' })).toHaveLength(1);
    // Re-remembering the same setup refreshes it instead of duplicating it.
    const again = rememberSetup({ uuid: UUID_A.toUpperCase(), name: 'Renamed', tier: 'quick' });
    expect(again).toHaveLength(1);
    expect(again[0]!.name).toBe('Renamed');
    rememberSetup({ uuid: UUID_B });
    expect(loadSetupHistory().map((entry) => entry.uuid)).toEqual([UUID_B, UUID_A]);
    expect(setupLabel(loadSetupHistory()[1]!)).toBe('Renamed');
    expect(forgetSetup(UUID_B).map((entry) => entry.uuid)).toEqual([UUID_A]);
    // Junk in the slot never surfaces and never throws.
    (globalThis as { window?: unknown }).window = {
      localStorage: { getItem: () => '{nope', setItem: () => {}, removeItem: () => {} },
    };
    expect(loadSetupHistory()).toEqual([]);
  });

  it('never stores install secrets or passwords', () => {
    (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
    const stored = rememberSetup({ uuid: UUID_A, name: 'x', tier: 'quick' });
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0] as object).sort()).toEqual(['name', 'savedAt', 'tier', 'uuid']);
  });
});

describe('tier picker previous setups (issue #4)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  function renderPicker() {
    // The picker reads the features flag through TanStack Query; a bare client
    // keeps this test focused on browser history (the server list is covered
    // in saved-setups-render.test.tsx).
    return renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <TierPicker />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it('keeps the three tier cards and offers a manual setup-id field', () => {
    const html = renderPicker();
    expect(html).toContain('Quick Look');
    expect(html).toContain('Settle In');
    expect(html).toContain('Move In');
    expect(html).toContain('Paste a setup id');
    expect(html).not.toContain('Back to a previous setup');
  });

  it('lists remembered setups as pills', () => {
    (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
    rememberSetup({ uuid: UUID_A, name: 'Living room', tier: 'quick' });
    const html = renderPicker();
    expect(html).toContain('Back to a previous setup');
    expect(html).toContain('Living room');
    // The badge shows the friendly tier name, not the stored id.
    expect(html).toContain('Quick Look');
    expect(html).toContain('setup-history-pill');
  });
});
