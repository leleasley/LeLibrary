import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  createCatalogLoader, createMetaLoader, defaultMode, fetchSetupPreview, fitScale, gridColumns, platformFor, previewNav,
  type CatalogLoader, type MetaLoader, type PreviewAction, type PreviewMode, type PreviewPlatform, type PreviewScreen,
  type SetupPreview,
} from '@/features/setup/preview/preview-model';
import { PreviewContext, SkeletonCards, type PreviewContextValue } from '@/features/setup/preview/PreviewScreens';
import { NuvioMobile } from '@/features/setup/preview/NuvioMobile';
import { NuvioTv, TV_HEIGHT, TV_WIDTH } from '@/features/setup/preview/NuvioTv';
import { StremioBoard } from '@/features/setup/preview/StremioBoard';
import './nuvio-preview.css';

// The setup Preview: a full-screen modal that IS the player's screen for the
// saved setup. Nuvio TV (scaled 1280x720 stage), Nuvio Mobile (a 390x844
// phone on wide screens, the whole modal on a phone) or Stremio's board, with
// the real Home order, posters, collections and folders. Read-only: it never
// pushes, saves or writes a setting.

export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 844;

export interface PreviewModalInitial {
  mode?: PreviewMode | undefined;
  previews?: Partial<Record<PreviewPlatform, SetupPreview>> | undefined;
  stack?: PreviewScreen[] | undefined;
  failed?: boolean | undefined;
  size?: { width: number; height: number } | undefined;
}

export interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  uuid: string;
  editToken: string | null;
  installToken: string | null;
  savedPlatform: PreviewPlatform;
  dirty?: boolean | undefined;
  // Tests only: start from fixed data and fixed loaders.
  initial?: PreviewModalInitial | undefined;
  loader?: CatalogLoader | undefined;
  metaLoader?: MetaLoader | undefined;
}

function useSize<T extends HTMLElement>(initial: { width: number; height: number }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setSize((prev) => (prev.width === node.clientWidth && prev.height === node.clientHeight ? prev : { width: node.clientWidth, height: node.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function useTick(...sources: ({ subscribe: (listener: () => void) => () => void } | null)[]) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const stops = sources.map((source) => source?.subscribe(() => setTick((n) => n + 1)));
    return () => { for (const stop of stops) stop?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, sources);
}

const MODE_ICONS: Record<PreviewMode, ReactNode> = {
  tv: <><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>,
  mobile: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>,
  stremio: <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />,
};
const MODE_LABELS: Record<PreviewMode, string> = { tv: 'TV', mobile: 'Mobile', stremio: 'Stremio' };

function Loading({ mode }: { mode: PreviewMode }) {
  return (
    <div className={`npv-loading is-${mode}`} aria-busy="true">
      <span className="npv-art is-loading npv-loading-hero" aria-hidden="true" />
      {[0, 1].map((n) => (
        <div key={n} className="npv-row">
          <span className="npv-skel-line is-title" aria-hidden="true" />
          <div className="npv-strip"><SkeletonCards count={mode === 'mobile' ? 3 : 7} /></div>
        </div>
      ))}
    </div>
  );
}

type ModalDialog = Pick<HTMLDialogElement, 'open' | 'close' | 'setAttribute'> & { showModal?: () => void };
type ModalDocument = { activeElement: Element | null; documentElement: { classList: Pick<DOMTokenList, 'add' | 'remove'> } };

// Opens the dialog as a real modal (top layer, the page behind inert), locks
// the page's scroll, and on the way out closes it, unlocks the page and gives
// focus back to whatever opened it.
export function openAsModal(dialog: ModalDialog, doc: ModalDocument): () => void {
  const opener = doc.activeElement as HTMLElement | null;
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  doc.documentElement.classList.add('npv-locked');
  return () => {
    doc.documentElement.classList.remove('npv-locked');
    if (dialog.open) dialog.close();
    opener?.focus?.({ preventScroll: true });
  };
}

// Escape (the dialog's cancel) closes through the parent, so the parent's
// state and the dialog never disagree.
export function cancelToClose(onClose: () => void) {
  return (event: { preventDefault: () => void }) => { event.preventDefault(); onClose(); };
}

export function PreviewModal({ open, ...rest }: PreviewModalProps) {
  if (!open) return null;
  return <PreviewDialog {...rest} />;
}

function PreviewDialog({ onClose, uuid, editToken, installToken, savedPlatform, dirty, initial, loader: givenLoader, metaLoader: givenMeta }: Omit<PreviewModalProps, 'open'>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<PreviewMode>(() => initial?.mode ?? defaultMode(savedPlatform, typeof window !== 'undefined' ? window.innerWidth : 0));
  const [previews, setPreviews] = useState<Partial<Record<PreviewPlatform, SetupPreview>>>(initial?.previews ?? {});
  const [failed, setFailed] = useState<Partial<Record<PreviewPlatform, boolean>>>(initial?.failed ? { [platformFor(initial?.mode ?? 'tv')]: true } : {});
  const [attempt, setAttempt] = useState(0);
  const [stack, dispatch] = useReducer(previewNav, initial?.stack ?? [{ at: 'home' }]);
  const [bodyRef, size] = useSize<HTMLDivElement>(initial?.size ?? { width: 0, height: 0 });
  const loader = useMemo(() => givenLoader ?? (installToken ? createCatalogLoader(installToken) : null), [givenLoader, installToken]);
  const metas = useMemo(() => givenMeta ?? (installToken ? createMetaLoader(installToken) : null), [givenMeta, installToken]);
  useTick(loader, metas);

  useEffect(() => {
    if (!dialogRef.current) return undefined;
    const close = openAsModal(dialogRef.current, document);
    // showModal focuses the first button (the mode switch): start on the screen.
    bodyRef.current?.focus({ preventScroll: true });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const platform = platformFor(mode);
  const preview = previews[platform] ?? null;
  useEffect(() => {
    if (preview || !editToken || initial?.previews) return undefined;
    let cancelled = false;
    setFailed((prev) => ({ ...prev, [platform]: false }));
    fetchSetupPreview(uuid, platform, editToken)
      .then((data) => { if (!cancelled) setPreviews((prev) => ({ ...prev, [platform]: data })); })
      .catch(() => { if (!cancelled) setFailed((prev) => ({ ...prev, [platform]: true })); });
    return () => { cancelled = true; };
    // `attempt` re-runs the load after an error.
  }, [uuid, platform, editToken, preview, attempt, initial?.previews]);

  const switchTo = useCallback((next: PreviewMode) => {
    setMode(next);
    dispatch({ type: 'home' });
  }, []);
  const go = useCallback((action: PreviewAction) => dispatch(action), []);

  // Stage geometry: TV is a 1280x720 design scaled to fit; Mobile fills a
  // phone-sized modal and is a scaled 390x844 phone on anything wider.
  const phoneFill = size.width > 0 && size.width < 600;
  const tvScale = fitScale(size.width, size.height, TV_WIDTH, TV_HEIGHT);
  const phoneScale = Math.min(1, fitScale(size.width - 32, size.height - 32, PHONE_WIDTH, PHONE_HEIGHT));
  const stageWidth = mode === 'tv' ? TV_WIDTH : mode === 'mobile' ? (phoneFill ? size.width : PHONE_WIDTH) : size.width;
  const stageHeight = mode === 'mobile' && phoneFill ? size.height : PHONE_HEIGHT;

  const context: PreviewContextValue | null = preview ? {
    preview, loader, metas, go, mode, columns: gridColumns(mode === 'stremio' ? Math.max(0, stageWidth - 96) : stageWidth),
  } : null;

  let screen: ReactNode;
  if (!preview) {
    screen = failed[platform] ? (
      <div className="npv-note is-error is-page">
        <span>The preview could not be loaded.</span>
        <button type="button" className="npv-chip-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    ) : <Loading mode={mode} />;
  } else if (mode === 'tv') {
    screen = <NuvioTv stack={stack} />;
  } else if (mode === 'mobile') {
    screen = <NuvioMobile stack={stack} width={stageWidth} height={stageHeight} />;
  } else {
    screen = <StremioBoard stack={stack} />;
  }
  if (context) screen = <PreviewContext.Provider value={context}>{screen}</PreviewContext.Provider>;

  let stage: ReactNode;
  if (mode === 'tv') {
    stage = (
      <div className="npv-tv-frame" style={{ width: TV_WIDTH * tvScale, height: TV_HEIGHT * tvScale }}>
        <div className="npv-app npv-tv" style={{ width: TV_WIDTH, height: TV_HEIGHT, transform: `scale(${tvScale})` }}>{screen}</div>
      </div>
    );
  } else if (mode === 'mobile') {
    stage = phoneFill ? (
      <div className="npv-app npv-phone is-fill">{screen}</div>
    ) : (
      <div className="npv-phone-frame" style={{ width: PHONE_WIDTH * phoneScale, height: PHONE_HEIGHT * phoneScale }}>
        <div className="npv-app npv-phone" style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT, transform: `scale(${phoneScale})` }}>
          {screen}
          <div className="npv-statusbar" aria-hidden="true">
            <span data-i18n-preserve>9:41</span>
            <svg viewBox="0 0 40 12"><path d="M1 10h3M7 8v2M7 10h0M12 5v5M17 2v8" /><rect x="24" y="2" width="14" height="8" rx="2.5" /><path d="M27 6h7" /></svg>
          </div>
        </div>
      </div>
    );
  } else {
    stage = <div className="npv-app npv-st">{screen}</div>;
  }

  return (
    <dialog
      ref={dialogRef} className={`npv-dialog is-${mode}`} aria-label="Preview"
      onCancel={cancelToClose(onClose)}
    >
      <header className="npv-topbar">
        <span className={`npv-wordmark${mode === 'stremio' ? ' is-stremio' : ''}`} data-i18n-preserve>{mode === 'stremio' ? 'Stremio' : 'nuvio'}</span>
        <span className="npv-topbar-note">
          <span>Preview of your saved setup</span>
          {dirty && <em>Save to see your latest changes.</em>}
        </span>
        <div className="npv-modes" role="group" aria-label="Player">
          {(['tv', 'mobile', 'stremio'] as const).map((id) => (
            <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => switchTo(id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{MODE_ICONS[id]}</svg>
              <span>{MODE_LABELS[id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="npv-close" aria-label="Close preview" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {!installToken && <p className="npv-banner">Posters need your install link. Unlock this setup again to load them.</p>}
      {/* On TV the first arrow key hands focus to the focused card. */}
      <div
        className={`npv-body is-${mode}${mode === 'mobile' && phoneFill ? ' is-phone' : ''}`} ref={bodyRef} tabIndex={-1}
        onKeyDown={(event) => {
          if (mode !== 'tv' || event.target !== event.currentTarget || !event.key.startsWith('Arrow')) return;
          const card = event.currentTarget.querySelector<HTMLElement>('[data-pos][tabindex="0"]');
          if (card) { event.preventDefault(); card.focus({ preventScroll: true }); }
        }}
      >
        {stage}
      </div>
    </dialog>
  );
}
