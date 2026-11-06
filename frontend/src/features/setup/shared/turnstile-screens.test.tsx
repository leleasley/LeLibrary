import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The visible Turnstile widget on both password screens: the create flow's
// password step (TierInstall, finish in the shell footer) and the edit page's
// unlock modal. Placed below the password field(s) and above the submit;
// submit disabled until there is a token; nothing at all when unconfigured.
const api = vi.hoisted(() => ({
  get: vi.fn(() => new Promise(() => {})),
  post: vi.fn(() => new Promise(() => {})), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

const { TierInstall } = await import('@/features/setup/shared/tier/TierInstall');
const { TierShell } = await import('@/features/setup/shared/tier/TierShell');
const { UnlockModal } = await import('@/features/setup/SetupEditPage');
const { useTurnstile } = await import('@/features/setup/shared/TurnstileCheck');
const { TURNSTILE_OFF } = await import('@/features/setup/shared/turnstile');
type TurnstileControl = import('@/features/setup/shared/turnstile').TurnstileControl;

// Cloudflare's documented always-pass test site key (never a real key).
const TEST_SITE_KEY = '1x00000000000000000000AA';

function control(phase: 'waiting' | 'solved' | 'expired' | 'error', token: string | null = null, errorCode: string | null = null): TurnstileControl {
  return { enabled: true, state: { phase, token, errorCode }, slotRef: () => {}, reset: () => {} };
}

function render(node: ReactNode) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function install(turnstile?: TurnstileControl, active?: boolean) {
  return render(
    <TierInstall
      password="a-password" confirmation="a-password" error={null}
      onPassword={() => {}} onConfirmation={() => {}} onSubmit={() => {}}
      turnstile={turnstile} active={active}
    />,
  );
}

function unlock(turnstile?: TurnstileControl, password = 'a-password') {
  return render(
    <UnlockModal
      uuid="11111111-2222-3333-4444-555555555555" tier="quick"
      busy={false} loading={false} error={null} leaving={false}
      password={password} onPassword={() => {}} onSubmit={() => {}}
      turnstile={turnstile}
    />,
  );
}

const lastIndexOf = (html: string, needle: string) => html.lastIndexOf(needle);

describe('create flow password step', () => {
  it('renders the widget below both password fields', () => {
    const html = install(control('waiting'));
    const widget = html.indexOf('ll-turnstile-widget');
    expect(widget).toBeGreaterThan(-1);
    expect(widget).toBeGreaterThan(lastIndexOf(html, 'type="password"'));
    expect(html).toContain('Complete the check above');
    expect(html).toContain('data-turnstile-state="waiting"');
  });

  it('shows no widget on a wizard step that is not on screen yet', () => {
    expect(install(control('waiting'), false)).not.toContain('ll-turnstile');
  });

  it('is unchanged when Turnstile is not configured', () => {
    expect(install()).not.toContain('ll-turnstile');
    expect(install(TURNSTILE_OFF)).not.toContain('ll-turnstile');
  });

  it('expired or failed: friendly line, code only in a data attribute', () => {
    const expired = install(control('expired'));
    expect(expired).toContain('The check expired. Complete it again.');
    const failed = install(control('error', null, '300030'));
    expect(failed).toContain('The check could not finish. Try again.');
    expect(failed).toContain('data-turnstile-error="300030"');
    expect(failed.replace(/data-turnstile-error="300030"/, '')).not.toContain('300030');
    expect(failed).toContain('ll-turnstile-retry');
  });

  it('the footer finish stays disabled while the check is pending', () => {
    const footer = (blocked: string | null) => render(
      <TierShell
        tierLabel="Quick Look" name="" editing={false}
        steps={[{ id: 'password', label: 'Create your install link' }]}
        onPreview={() => {}} sidebar={null}
        footer={{
          reset: { label: 'Start over', onClick: () => {} },
          finish: { label: 'Create my setup', form: 'tier-install-form' },
          blocked,
        }}
      >
        <div />
      </TierShell>,
    );
    const pending = footer('Complete the check above');
    expect(pending).toMatch(/<button[^>]*class="ts-foot-next ts-finish"[^>]*disabled=""/);
    expect(pending).toContain('Complete the check above');
    const done = footer(null);
    expect(done).toMatch(/class="ts-foot-next ts-finish is-ready"/);
    expect(done).not.toMatch(/ts-finish[^>]*disabled/);
  });
});

describe('edit page unlock modal', () => {
  it('renders the widget below the password and above Unlock, which waits for a token', () => {
    const html = unlock(control('waiting'));
    const password = html.indexOf('type="password"');
    const widget = html.indexOf('ll-turnstile-widget');
    const button = html.indexOf('edit-unlock-btn');
    expect(password).toBeGreaterThan(-1);
    expect(widget).toBeGreaterThan(password);
    expect(button).toBeGreaterThan(widget);
    expect(html).toMatch(/<button type="submit" class="qs-cta is-ready edit-unlock-btn" disabled=""/);
    expect(html).toContain('Complete the check above');
  });

  it('enables Unlock once the widget has a token, and disables it again on expiry', () => {
    expect(unlock(control('solved', 'tok'))).not.toMatch(/edit-unlock-btn" disabled/);
    expect(unlock(control('expired'))).toMatch(/edit-unlock-btn" disabled/);
  });

  it('unconfigured: no widget, Unlock enabled as before', () => {
    const html = unlock(undefined);
    expect(html).not.toContain('ll-turnstile');
    expect(html).not.toMatch(/edit-unlock-btn" disabled/);
  });
});

describe('useTurnstile', () => {
  function Harness({ siteKey }: { siteKey: string }) {
    const check = useTurnstile('unlock', { siteKey });
    return (
      <UnlockModal
        uuid="11111111-2222-3333-4444-555555555555" tier="quick"
        busy={false} loading={false} error={null} leaving={false}
        password="a-password" onPassword={() => {}} onSubmit={() => {}}
        turnstile={check}
      />
    );
  }

  it('a shipped site key shows the widget and holds the button', () => {
    const html = render(<Harness siteKey={TEST_SITE_KEY} />);
    expect(html).toContain('ll-turnstile-widget');
    expect(html).toMatch(/edit-unlock-btn" disabled/);
  });

  it('no site key: inert', () => {
    const html = render(<Harness siteKey="" />);
    expect(html).not.toContain('ll-turnstile');
    expect(html).not.toMatch(/edit-unlock-btn" disabled/);
  });
});
