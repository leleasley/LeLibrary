// Cloudflare Turnstile on the password endpoints (unlock and create).
//
// The server verifies a token only where it ships a site key: the key arrives
// in the boot data only when the site key, secret and hostnames are all set
// and the request is not localhost-exempt. No key means no script, no widget,
// no token, buttons enabled and byte-identical requests (self-hosters, dev
// Playwright on localhost).
//
// With a key, the password screens render the visible managed widget
// (`appearance: 'always'`) below the password fields. The submit buttons stay
// disabled until its callback hands over a token. Tokens are single-use and
// expire after ~5 minutes: an expiry/error clears the token, and every submit
// resets the widget so the next attempt gets a fresh one.
//
// Pure pieces live here (site key, options, state, submit wrapper) so they are
// testable without a DOM; the hook and component are in TurnstileCheck.tsx.

export interface TurnstileApi {
  render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// The request field the server verifies.
export const TURNSTILE_FIELD = 'cf-turnstile-response';
// Shown until the widget has produced a token (footer + below the widget).
export const TURNSTILE_HINT = 'Complete the check above';
export const TURNSTILE_EXPIRED = 'The check expired. Complete it again.';
export const TURNSTILE_FAILED = 'The check could not finish. Try again.';

export type TurnstileAction = 'unlock' | 'create-setup';

let scriptLoading: Promise<boolean> | null = null;

// Boot data is the single source: it is injected on every page by the server.
export function turnstileSiteKey(): string {
  if (typeof document === 'undefined') return '';
  try {
    const text = document.getElementById('ll-boot')?.textContent;
    if (!text) return '';
    const boot = JSON.parse(text) as { features?: { turnstileSiteKey?: unknown } };
    const key = boot?.features?.turnstileSiteKey;
    return typeof key === 'string' ? key.trim() : '';
  } catch {
    return '';
  }
}

export function loadTurnstileScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(Boolean(window.turnstile)));
    script.addEventListener('error', () => {
      // Let a retry fetch it again (a blocker or a network blip).
      scriptLoading = null;
      script.remove();
      resolve(false);
    });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return scriptLoading;
}

export interface TurnstileHandlers {
  onToken: (token: string) => void;
  onExpired: () => void;
  onError: (code: string) => void;
  onTimeout: () => void;
}

// The render options: visible managed widget, dark, fills the form's width,
// and the action the server checks ('unlock' / 'create-setup').
export function turnstileWidgetOptions(siteKey: string, action: TurnstileAction, handlers: TurnstileHandlers): Record<string, unknown> {
  return {
    sitekey: siteKey,
    action,
    appearance: 'always',
    theme: 'dark',
    size: 'flexible',
    callback: (token: string) => handlers.onToken(token),
    'expired-callback': () => handlers.onExpired(),
    // Returning true tells Turnstile the error is handled (no console throw).
    'error-callback': (code?: unknown) => { handlers.onError(String(code ?? 'error')); return true; },
    'timeout-callback': () => handlers.onTimeout(),
  };
}

export type TurnstilePhase = 'off' | 'loading' | 'waiting' | 'solved' | 'expired' | 'error';

export interface TurnstileState {
  phase: TurnstilePhase;
  token: string | null;
  // Cloudflare's error code, for a data attribute only (never shown).
  errorCode: string | null;
}

export type TurnstileEvent =
  | { type: 'loading' }
  | { type: 'rendered' }
  | { type: 'token'; token: string }
  | { type: 'expired' }
  | { type: 'error'; code: string }
  | { type: 'reset' }
  | { type: 'unmounted' };

export function initialTurnstileState(enabled: boolean): TurnstileState {
  return { phase: enabled ? 'loading' : 'off', token: null, errorCode: null };
}

export function turnstileReducer(state: TurnstileState, event: TurnstileEvent): TurnstileState {
  if (state.phase === 'off') return state;
  switch (event.type) {
    case 'loading': return { phase: 'loading', token: null, errorCode: null };
    case 'rendered': return state.token ? state : { ...state, phase: 'waiting' };
    case 'token': return { phase: 'solved', token: event.token, errorCode: null };
    case 'expired': return { phase: 'expired', token: null, errorCode: null };
    case 'error': return { phase: 'error', token: null, errorCode: event.code };
    case 'reset': return { phase: 'waiting', token: null, errorCode: null };
    case 'unmounted': return { phase: 'loading', token: null, errorCode: null };
    default: return state;
  }
}

// What a password screen needs from the widget.
export interface TurnstileControl {
  // A site key was shipped: the widget is shown and its token is required.
  enabled: boolean;
  state: TurnstileState;
  // Callback ref for the widget's container.
  slotRef: (element: HTMLDivElement | null) => void;
  // Clear the token and ask Cloudflare for a fresh challenge.
  reset: () => void;
}

// Unconfigured (or no Turnstile at all): never blocks anything.
export const TURNSTILE_OFF: TurnstileControl = {
  enabled: false,
  state: initialTurnstileState(false),
  slotRef: () => {},
  reset: () => {},
};

export function turnstileReady(control: TurnstileControl | null | undefined): boolean {
  return !control || !control.enabled || Boolean(control.state.token);
}

// One submit through the widget: refuse without a token when one is needed,
// send it, and reset the widget afterwards whatever happened (success, wrong
// password, 403), because a token is single-use.
export async function submitWithTurnstile<T>(
  control: TurnstileControl | null | undefined,
  send: (token: string | null) => Promise<T>,
): Promise<T> {
  if (!turnstileReady(control)) throw new Error(TURNSTILE_HINT);
  const token = control?.enabled ? control.state.token : null;
  try {
    return await send(token);
  } finally {
    if (control?.enabled) control.reset();
  }
}
