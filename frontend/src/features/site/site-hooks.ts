import { useEffect, useState } from 'react';
import { fetchStatus, normalizeStatus, type StatusResponse } from '@/api/status';
import { fetchFeatures, normalizeFeatures, type Features } from '@/api/features';

// Boot data the server ships inside the page (backend/src/platform/boot-html.ts):
// the feature flags and the latest provider status, so the menu and the status
// pill are right on the first paint. The prerender sets the same shape on
// globalThis. The newest fetched values are kept here too, so a page that
// mounts later starts from them instead of blank.
interface Boot { features?: unknown; status?: unknown }
let bootCache: Boot | null | undefined;
function readBoot(): Boot | null {
  if (bootCache !== undefined) return bootCache;
  if (typeof document === 'undefined') {
    return ((globalThis as { __LL_BOOT__?: Boot }).__LL_BOOT__ ?? null);
  }
  try {
    const text = document.getElementById('ll-boot')?.textContent;
    bootCache = text ? (JSON.parse(text) as Boot) : null;
  } catch {
    bootCache = null;
  }
  return bootCache;
}
let latestFeatures: Features | null = null;
let latestStatus: StatusResponse | null = null;
function initialFeatures(): Features | null {
  if (latestFeatures) return latestFeatures;
  const boot = readBoot();
  return boot?.features ? normalizeFeatures(boot.features) : null;
}
function initialStatus(): StatusResponse | null {
  if (latestStatus) return latestStatus;
  const boot = readBoot();
  return boot?.status ? normalizeStatus(boot.status) : null;
}

// Hamburger / mobile menu state shared by every site page.
export function useMenu() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((value) => !value), close: () => setOpen(false) };
}

// The legacy pages reset a pinch-out zoom on double-tap; keep the behaviour.
export function useTouchZoomReset() {
  useEffect(() => {
    let lastTouchEnd = 0;
    function onTouchEnd(event: TouchEvent) {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
        document.body.style.zoom = '1';
      }
      lastTouchEnd = now;
    }
    document.addEventListener('touchend', onTouchEnd, false);
    return () => document.removeEventListener('touchend', onTouchEnd, false);
  }, []);
}

// Scroll reveal: observe the page's reveal selectors and add the visible
// classes exactly like the legacy IntersectionObserver did.
export function useReveal(selector: string, extraClass?: string) {
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          if (extraClass) entry.target.classList.add(extraClass);
        }
      }
    }, { threshold: 0.12 });
    const elements = Array.from(document.querySelectorAll(selector));
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [selector, extraClass]);
}

// Server-advertised hosted-only capabilities. null while unknown (hidden), so
// an unreachable flag never shows a link that the server would 404. This is the
// single feature-flag mechanism shared by the nav and the route guard.
export function useFeatures(): Features | null {
  const [features, setFeatures] = useState<Features | null>(initialFeatures);
  useEffect(() => {
    let cancelled = false;
    fetchFeatures()
      .then((value) => { latestFeatures = value; if (!cancelled) setFeatures(value); })
      // Keep what the page already knows rather than blanking the menu.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return features;
}

export interface SectionPosition {
  id: string;
  /** Distance from the top of the viewport, as measured at scroll time. */
  top: number;
}

// The heading the reader is currently inside: the last one whose top has crossed
// the offset line under the sticky header. Before any heading reaches the line
// the first one is current, so the nav is never empty.
export function pickActiveSection(entries: SectionPosition[], offsetPx: number): string {
  if (!entries.length) return '';
  let active = entries[0]!.id;
  for (const entry of entries) {
    if (entry.top <= offsetPx) active = entry.id;
  }
  return active;
}

// Scroll-spy for an in-page table of contents. Measuring on scroll rather than
// with an IntersectionObserver band keeps the bottom of the page correct: the
// last section stays active once it is the only one above the line.
export function useActiveSection(ids: string[], offsetPx = 96): string {
  const [active, setActive] = useState(() => ids[0] ?? '');
  const key = ids.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const entries: SectionPosition[] = [];
      for (const id of list) {
        const element = document.getElementById(id);
        if (element) entries.push({ id, top: element.getBoundingClientRect().top });
      }
      const next = pickActiveSection(entries, offsetPx);
      setActive((previous) => (previous === next ? previous : next));
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
    // The caller passes a module-level id list; the joined key is its stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offsetPx]);

  return active;
}

export function statusClass(status: string): string {
  return status === 'operational' ? 'op'
    : status === 'maintenance' ? 'maintenance'
    : status === 'degraded' ? 'deg'
    : status === 'down' ? 'down'
    : 'unknown';
}

export function statusLabel(status: string): string {
  const es = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('es');
  return status === 'operational' ? (es ? 'Operativo' : 'Operational')
    : status === 'maintenance' ? (es ? 'Mantenimiento' : 'Maintenance')
    : status === 'degraded' ? (es ? 'Degradado' : 'Degraded')
    : status === 'down' ? (es ? 'Caído' : 'Down')
    : (es ? 'Desconocido' : 'Unknown');
}

// Provider status pill data: fetched once, then re-polled when pollMs is set
// (the legacy pages polled every 60s). Failures read as null, never throw.
export function useProviderStatus(pollMs: number | null): StatusResponse | null {
  const [status, setStatus] = useState<StatusResponse | null>(initialStatus);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchStatus(AbortSignal.timeout(15000));
        latestStatus = data;
        if (!cancelled) setStatus(data);
      } catch {
        // A failed refresh keeps the last known status instead of flashing
        // back to the placeholder.
      }
    }
    void load();
    if (pollMs === null) return () => { cancelled = true; };
    const timer = setInterval(() => void load(), pollMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pollMs]);
  return status;
}
