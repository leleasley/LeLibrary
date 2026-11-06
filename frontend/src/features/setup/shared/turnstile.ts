// Cloudflare Turnstile on the password endpoints (unlock and create).
//
// The server verifies a token only when it has a secret + hostname list, and
// ignores it entirely when Turnstile is not configured (self-hosters). The
// public site key arrives in the boot data, so a page can stay offline-friendly:
// no key means no script, no widget, no token and no change to the request.
//
// Tokens are single-use and expire in ~5 minutes, so every attempt executes a
// fresh one. The widget is rendered hidden with `execution: 'execute'` and
// `appearance: 'interaction-only'`: it stays out of the way unless Cloudflare
// decides an interaction is needed. Any failure resolves null and the request
// proceeds unchanged; the server answers for itself.

interface TurnstileApi {
  render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 25_000;
let scriptLoading: Promise<boolean> | null = null;

// Boot data is the single source: it is injected on every page by the server.
function turnstileSiteKey(): string {
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

function loadScript(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(Boolean(window.turnstile)));
    script.addEventListener('error', () => resolve(false));
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return scriptLoading;
}

// A fresh token for one action ('unlock' | 'create-setup'), or null when
// Turnstile is not configured or could not produce one.
export async function turnstileToken(action: string): Promise<string | null> {
  const siteKey = turnstileSiteKey();
  if (!siteKey || typeof document === 'undefined') return null;
  if (!(await loadScript()) || !window.turnstile) return null;
  const api = window.turnstile;
  return new Promise<string | null>((resolve) => {
    const host = document.createElement('div');
    host.id = `ll-turnstile-${action}-${Date.now().toString(36)}`;
    // Cloudflare needs the widget in the layout: an interaction slot can only
    // appear if its container is visible. It sits above the modal, shows
    // nothing in the normal case (interaction-only), and is removed after.
    host.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;';
    document.body.appendChild(host);
    let settled = false;
    let widgetId: string | null = null;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { if (widgetId) api.remove(widgetId); } catch { /* widget already gone */ }
      host.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
    try {
      widgetId = api.render(host, {
        sitekey: siteKey,
        action,
        appearance: 'interaction-only',
        callback: (token: string) => finish(token),
        'error-callback': () => finish(null),
        'timeout-callback': () => finish(null),
      });
    } catch {
      finish(null);
    }
  });
}

// The request field the server verifies. Kept here next to the widget so a
// caller cannot invent a different key name.
