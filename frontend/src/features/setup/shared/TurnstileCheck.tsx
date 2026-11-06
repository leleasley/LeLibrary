import { useCallback, useReducer, useRef, useState } from 'react';
import {
  TURNSTILE_EXPIRED, TURNSTILE_FAILED, TURNSTILE_HINT,
  initialTurnstileState, loadTurnstileScript, turnstileReducer, turnstileSiteKey, turnstileWidgetOptions,
  type TurnstileAction, type TurnstileControl,
} from '@/features/setup/shared/turnstile';

// The visible Turnstile widget for one password screen. The widget is
// rendered when its slot mounts (the screen shows) and removed when the slot
// goes away. `siteKey` is for tests; pages read the boot data.
export function useTurnstile(action: TurnstileAction, options: { siteKey?: string } = {}): TurnstileControl {
  const [siteKey] = useState(() => options.siteKey ?? turnstileSiteKey());
  const enabled = siteKey.length > 0;
  const [state, dispatch] = useReducer(turnstileReducer, enabled, initialTurnstileState);
  const element = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  const slotRef = useCallback((next: HTMLDivElement | null) => {
    if (element.current === next) return;
    if (widgetId.current) {
      try { window.turnstile?.remove(widgetId.current); } catch { /* already gone */ }
      widgetId.current = null;
    }
    element.current = next;
    if (!enabled) return;
    dispatch({ type: next ? 'loading' : 'unmounted' });
    if (!next) return;
    void loadTurnstileScript().then((loaded) => {
      if (element.current !== next) return;
      const api = window.turnstile;
      if (!loaded || !api) { dispatch({ type: 'error', code: 'script-unavailable' }); return; }
      try {
        widgetId.current = api.render(next, turnstileWidgetOptions(siteKey, action, {
          onToken: (token) => dispatch({ type: 'token', token }),
          onExpired: () => dispatch({ type: 'expired' }),
          onError: (code) => dispatch({ type: 'error', code }),
          onTimeout: () => dispatch({ type: 'error', code: 'timeout' }),
        }));
        dispatch({ type: 'rendered' });
      } catch {
        dispatch({ type: 'error', code: 'render-failed' });
      }
    });
  }, [enabled, siteKey, action]);

  const reset = useCallback(() => {
    if (!enabled) return;
    if (widgetId.current && window.turnstile) {
      dispatch({ type: 'reset' });
      try { window.turnstile.reset(widgetId.current); } catch { /* re-rendered on next mount */ }
      return;
    }
    // The script or the render failed: mount the slot again from scratch.
    const current = element.current;
    element.current = null;
    slotRef(current);
  }, [enabled, slotRef]);

  return { enabled, state, slotRef, reset };
}

// The widget slot plus one short status line. Renders nothing when Turnstile
// is not configured. Placed below the password field(s), above the submit.
export function TurnstileCheck({ control, active = true }: { control: TurnstileControl | null | undefined; active?: boolean }) {
  if (!control?.enabled || !active) return null;
  const { phase, token, errorCode } = control.state;
  const message = phase === 'expired' ? TURNSTILE_EXPIRED
    : phase === 'error' ? TURNSTILE_FAILED
    : TURNSTILE_HINT;
  return (
    <div className="ll-turnstile" data-turnstile-state={phase} data-turnstile-error={errorCode ?? undefined}>
      <div className="ll-turnstile-widget" ref={control.slotRef} data-i18n-preserve />
      {!token && (
        <p className={`ll-turnstile-hint${phase === 'error' || phase === 'expired' ? ' is-error' : ''}`} aria-live="polite">
          <span>{message}</span>
          {phase === 'error' && (
            <button type="button" className="pw-reset-link ll-turnstile-retry" onClick={control.reset}>Try again</button>
          )}
        </p>
      )}
    </div>
  );
}
