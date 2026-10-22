import { useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';

interface ToastItem {
  id: number;
  message: string;
  kind: 'ok' | 'error';
}

interface ShownToast extends ToastItem {
  // Bumped when the same message arrives again, to restart its timer.
  version: number;
}

const DURATION = { ok: 4000, error: 7000 } as const;
const MAX_VISIBLE = 3;
// Pixels a toast must travel before a release dismisses it (touch only).
const SWIPE_DISTANCE = 40;

// Global toast bus: any handler calls toast(message) and the host in the
// route shell renders it. Successes leave after 4 s, errors after 7 s.
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  window.dispatchEvent(new CustomEvent('ll-toast', {
    detail: { message, kind, id: Date.now() + Math.random() },
  }));
}

// "TorBox: connected as Lewis" reads better as a title and a line. Only a
// short leading label counts, so ordinary sentences with a colon stay whole.
export function splitToast(message: string): { title: string | null; body: string } {
  const match = /^([^:]{2,24}):\s+(.+)$/s.exec(message);
  if (!match || /[.!?]/.test(match[1]!)) return { title: null, body: message };
  const body = match[2]!;
  return { title: match[1]!, body: body.charAt(0).toUpperCase() + body.slice(1) };
}

function ToastCard({ item, onClose }: { item: ShownToast; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef<number>(DURATION[item.kind]);
  const startedAt = useRef<number>(0);

  // (Re)start on mount and whenever the same message arrives again.
  useEffect(() => { remaining.current = DURATION[item.kind]; }, [item.version, item.kind]);
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(onClose, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, item.version, onClose]);

  // Touch: drag to follow the finger, then a swipe up or sideways past the
  // threshold flings the toast away; anything shorter springs back. Touching
  // also pauses the timer, like hovering does with a mouse.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(event: ReactTouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
    setPaused(true);
  }
  function onTouchMove(event: ReactTouchEvent) {
    const touch = event.touches[0];
    if (!touch || !start.current) return;
    const dx = touch.clientX - start.current.x;
    const dy = Math.min(0, touch.clientY - start.current.y);
    setDrag({ x: dx, y: dy });
  }
  function onTouchEnd() {
    const moved = drag;
    start.current = null;
    setDrag(null);
    setPaused(false);
    if (!moved) return;
    if (moved.y < -SWIPE_DISTANCE || Math.abs(moved.x) > SWIPE_DISTANCE * 1.6) {
      const out = moved.y < -SWIPE_DISTANCE ? { x: 0, y: -160 } : { x: Math.sign(moved.x) * 480, y: 0 };
      setLeaving(out);
      window.setTimeout(onClose, 180);
    }
  }

  const { title, body } = splitToast(item.message);
  const error = item.kind === 'error';
  const offset = leaving ?? drag;
  const style = offset
    ? { transform: `translate(${offset.x}px, ${offset.y}px)`, opacity: leaving ? 0 : Math.max(0.35, 1 - (Math.abs(offset.x) + Math.abs(offset.y)) / 260) }
    : undefined;
  return (
    <div
      className={`toast${error ? ' is-error' : ''}${drag ? ' is-swiping' : ''}${leaving ? ' is-leaving' : ''}`}
      role={error ? 'alert' : 'status'}
      style={style}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <span className="toast-icon" aria-hidden="true">{error ? '!' : '✓'}</span>
      <span className="toast-text">
        {title && <strong>{title}</strong>}
        <span>{body}</span>
      </span>
      <button type="button" className="toast-close" aria-label="Close" onClick={onClose}>✕</button>
      <span
        key={item.version}
        className="toast-timer"
        aria-hidden="true"
        style={{ animationDuration: `${DURATION[item.kind]}ms`, animationPlayState: paused ? 'paused' : 'running' }}
      />
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<ShownToast[]>([]);
  const close = useRef(new Map<number, () => void>());

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent).detail as ToastItem;
      setItems((prev) => {
        const same = prev.find((item) => item.message === detail.message && item.kind === detail.kind);
        if (same) return prev.map((item) => (item === same ? { ...item, version: item.version + 1 } : item));
        return [...prev, { ...detail, version: 0 }].slice(-MAX_VISIBLE);
      });
    }
    window.addEventListener('ll-toast', onToast);
    return () => window.removeEventListener('ll-toast', onToast);
  }, []);

  function closer(id: number) {
    let fn = close.current.get(id);
    if (!fn) {
      fn = () => {
        setItems((prev) => prev.filter((item) => item.id !== id));
        close.current.delete(id);
      };
      close.current.set(id, fn);
    }
    return fn;
  }

  return (
    <div className="toast-host" aria-live="polite">
      {items.map((item) => <ToastCard key={item.id} item={item} onClose={closer(item.id)} />)}
    </div>
  );
}

// Restore notice for pages that boot with a saved draft. Deferred a tick:
// the toast host lives in the route shell and subscribes after page effects
// run, so an immediate toast would be lost. The fired flag flips only when
// the toast actually goes out, so a remount reschedules instead of swallowing.
export function useRestoreToast(restored: boolean) {
  const fired = useRef(false);
  useEffect(() => {
    if (!restored || fired.current) return;
    const timer = window.setTimeout(() => {
      fired.current = true;
      toast('Loaded your setup from browser');
    }, 150);
    return () => window.clearTimeout(timer);
  }, [restored]);
}
