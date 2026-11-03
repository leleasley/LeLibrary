import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { i18n } from '@/i18n';
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
  const initial = initialFeatures();
  const { data } = useQuery({
    queryKey: queryKeys.features,
    queryFn: async () => {
      const value = await fetchFeatures();
      latestFeatures = value;
      return value;
    },
    // Boot data paints first and still counts as stale, so the flags are
    // checked once on mount. A failed check keeps what the page already
    // knows rather than blanking the menu.
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? null;
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

// Providers that count towards "x/y up". One we could not check from the server
// ('unknown', e.g. blocked by Cloudflare) is shown but never counted. Mirrored
// in backend/src/platform/boot-html.ts for the prerendered home page.
export function checkedProviders<T extends { status: string }>(providers: T[]): T[] {
  return providers.filter((p) => p.status !== 'unknown');
}

// Labels live in the always-loaded `common` bundle (statusStates), so the
// banner and footer can use them on every page. English must stay the same
// words as backend/src/platform/boot-html.ts: English visitors hydrate the
// prerendered home page.
const STATUS_STATES = new Set(['operational', 'maintenance', 'degraded', 'down']);
export function statusLabel(status: string): string {
  const key = STATUS_STATES.has(status) ? status : 'unknown';
  return i18n.t(`statusStates.${key}`, { ns: 'common' });
}

// Provider status pill data: fetched on mount, then re-polled when pollMs is
// set (the legacy pages polled every 60s, hidden tab included). Its own key,
// not the Status page's: that page starts from a live check, not boot data.
// Failures keep the last known status instead of flashing back to the
// placeholder; null only while nothing is known.
export function useProviderStatus(pollMs: number | null): StatusResponse | null {
  const initial = initialStatus();
  const { data } = useQuery({
    queryKey: queryKeys.statusPill,
    queryFn: async ({ signal }) => {
      const value = await fetchStatus(signal);
      latestStatus = value;
      return value;
    },
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
    staleTime: 0,
    refetchInterval: pollMs ?? false,
    refetchIntervalInBackground: true,
    retry: false,
  });
  return data ?? null;
}
