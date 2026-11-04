import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  createCatalogLoader, createDraftCatalogLoader, createMetaLoader, defaultMode, fetchDraftPreview, fetchSetupPreview, fitScale,
  gridColumns, platformFor, previewNav, previewSourceMode, tvLayout,
  type CatalogLoader, type MetaLoader, type PreviewAction, type PreviewDraft, type PreviewMode, type PreviewPlatform,
  type PreviewScreen, type PreviewSourceMode, type SetupPreview,
} from '@/features/setup/preview/preview-model';
import { PreviewContext, SkeletonCards, type PreviewContextValue, type PreviewStreamStyle } from '@/features/setup/preview/PreviewScreens';
import { NuvioMobile } from '@/features/setup/preview/NuvioMobile';
import { NuvioTv, TV_HEIGHT, TV_WIDTH } from '@/features/setup/preview/NuvioTv';
import { NuvioPhoneTv, phoneTvTitle } from '@/features/setup/preview/NuvioPhoneTv';
import { StremioBoard } from '@/features/setup/preview/StremioBoard';
import './nuvio-preview.css';

// The setup Preview: a full-screen modal that IS the player's screen for the
// setup on the page. Nuvio TV (scaled 1280x720 stage; laid out at phone
// width in a narrow modal), Nuvio Mobile (a
// 390x844 phone on wide screens, the whole modal on a phone) or Stremio's
// board, with the real Home order, posters, collections and folders. It is
// the one Preview on every setup page (the dock's Preview button): live from
// the draft while creating, the saved setup when nothing is unsaved, the
// draft layout with the real library when there are unsaved edits.
// Read-only: it never pushes, saves or writes a setting.

export const PHONE_WIDTH = 390;
// Nuvio's own wordmark (NuvioMedia/NuvioTV, GPL-3.0), white text on clear.
export const NUVIO_WORDMARK = '/preview/nuvio-wordmark.png';
export const PHONE_HEIGHT = 844;

export interface PreviewModalInitial {
  mode?: PreviewMode | undefined;
  previews?: Partial<Record<PreviewPlatform, SetupPreview>> | undefined;
  stack?: PreviewScreen[] | undefined;
  failed?: boolean | undefined;
  size?: { width: number; height: number } | undefined;
}

export interface SavedPreviewSetup {
  uuid: string;
  editToken: string | null;
  installToken: string | null;
}

export interface PreviewModalProps {
  open: boolean;
  onClose: () => void;
  // The player the setup is for (picks the first screen).
  savedPlatform: PreviewPlatform;
  // Edit mode: the saved setup this page edits.
  saved?: SavedPreviewSetup | null | undefined;
  // The page's current non-secret draft (read once, when the modal opens).
  draft?: PreviewDraft | null | undefined;
  dirty?: boolean | undefined;
  // The page's stream style, for the sample streams in details.
  streams?: PreviewStreamStyle | null | undefined;
  // The chosen poster style; draft rows show plain TMDB posters instead.
  posterStyle?: string | undefined;
  // The setup's name, used as the phone-TV Home heading.
  setupName?: string | undefined;
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
// The icon-only switch's accessible names.
const MODE_LABELS: Record<PreviewMode, string> = { tv: 'Nuvio TV', mobile: 'Nuvio Mobile', stremio: 'Stremio' };

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

function PreviewDialog({
  onClose, saved, draft: draftNow, savedPlatform, dirty, streams, posterStyle, setupName, initial, loader: givenLoader, metaLoader: givenMeta,
}: Omit<PreviewModalProps, 'open'>) {
  // The page sits behind the modal: what it holds when the modal opens is
  // what the modal shows.
  const [draft] = useState(draftNow ?? null);
  const uuid = saved?.uuid ?? '';
  const editToken = saved?.editToken ?? null;
  const installToken = saved?.installToken ?? null;
  const source: PreviewSourceMode = previewSourceMode({ saved: Boolean(uuid && editToken), dirty: dirty === true, hasDraft: draft !== null });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<PreviewMode>(() => initial?.mode ?? defaultMode(savedPlatform, typeof window !== 'undefined' ? window.innerWidth : 0));
  const [previews, setPreviews] = useState<Partial<Record<PreviewPlatform, SetupPreview>>>(initial?.previews ?? {});
  const [failed, setFailed] = useState<Partial<Record<PreviewPlatform, boolean>>>(initial?.failed ? { [platformFor(initial?.mode ?? 'tv')]: true } : {});
  const [attempt, setAttempt] = useState(0);
  const [stack, dispatch] = useReducer(previewNav, initial?.stack ?? [{ at: 'home' }]);
  const [bodyRef, size] = useSize<HTMLDivElement>(initial?.size ?? { width: 0, height: 0 });
  const loader = useMemo(() => {
    if (givenLoader) return givenLoader;
    if (source === 'saved') return installToken ? createCatalogLoader(installToken) : null;
    return draft ? createDraftCatalogLoader(draft.config, { installToken: source === 'edited' ? installToken : null }) : null;
  }, [givenLoader, source, installToken, draft]);
  // Full metas come from the addon itself, so only with the install link.
  const metas = useMemo(() => givenMeta ?? (installToken && source !== 'draft' ? createMetaLoader(installToken) : null), [givenMeta, installToken, source]);
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
    if (preview || initial?.previews) return undefined;
    if (source === 'saved' ? !editToken : !draft) return undefined;
    let cancelled = false;
    setFailed((prev) => ({ ...prev, [platform]: false }));
    const load = source === 'saved' && editToken ? fetchSetupPreview(uuid, platform, editToken) : fetchDraftPreview(draft as PreviewDraft, platform);
    load
      .then((data) => { if (!cancelled) setPreviews((prev) => ({ ...prev, [platform]: data })); })
      .catch(() => { if (!cancelled) setFailed((prev) => ({ ...prev, [platform]: true })); });
    return () => { cancelled = true; };
    // `attempt` re-runs the load after an error.
  }, [uuid, platform, editToken, preview, attempt, initial?.previews, source, draft]);

  const switchTo = useCallback((next: PreviewMode) => {
    setMode(next);
    dispatch({ type: 'home' });
  }, []);
  const go = useCallback((action: PreviewAction) => dispatch(action), []);

  // Stage geometry: TV is a 1280x720 design scaled to fit; Mobile fills a
  // phone-sized modal and is a scaled 390x844 phone on anything wider.
  const phoneFill = size.width > 0 && size.width < 600;
  // TV in a narrow modal: the TV home at the modal's width, not a tiny stage.
  const phoneTv = mode === 'tv' && tvLayout(size.width) === 'phone';
  const tvScale = fitScale(size.width, size.height, TV_WIDTH, TV_HEIGHT);
  const phoneScale = Math.min(1, fitScale(size.width - 32, size.height - 32, PHONE_WIDTH, PHONE_HEIGHT));
  const stageWidth = mode === 'tv' ? (phoneTv ? size.width : TV_WIDTH) : mode === 'mobile' ? (phoneFill ? size.width : PHONE_WIDTH) : size.width;
  const stageHeight = mode === 'mobile' && phoneFill ? size.height : PHONE_HEIGHT;

  const context: PreviewContextValue | null = preview ? {
    preview, loader, metas, go, mode, columns: gridColumns(mode === 'stremio' ? Math.max(0, stageWidth - 96) : stageWidth),
    source, streams: streams ?? null, setupName: (setupName ?? '').trim(),
  } : null;

  let screen: ReactNode;
  if (!preview) {
    screen = failed[platform] ? (
      <div className="npv-note is-error is-page">
        <span>The preview could not be loaded.</span>
        <button type="button" className="npv-chip-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    ) : <Loading mode={phoneTv ? 'mobile' : mode} />;
  } else if (phoneTv) {
    screen = <NuvioPhoneTv stack={stack} />;
  } else if (mode === 'tv') {
    screen = <NuvioTv stack={stack} />;
  } else if (mode === 'mobile') {
    screen = <NuvioMobile stack={stack} width={stageWidth} height={stageHeight} />;
  } else {
    screen = <StremioBoard stack={stack} />;
  }
  // Phone-TV folder and "See all" screens: the top bar is their header.
  const subTitle = phoneTv && preview ? phoneTvTitle(preview, stack) : null;
  if (context) screen = <PreviewContext.Provider value={context}>{screen}</PreviewContext.Provider>;

  let stage: ReactNode;
  if (phoneTv) {
    stage = <div className="npv-app npv-ptv is-fill">{screen}</div>;
  } else if (mode === 'tv') {
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
        {subTitle !== null ? (
          <div className="npv-topbar-title">
            <button type="button" className="npv-topbar-back" aria-label="Back" onClick={() => go({ type: 'back' })}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
            </button>
            <h2 data-i18n-preserve>{subTitle}</h2>
          </div>
        ) : mode === 'stremio'
          ? <span className="npv-wordmark is-stremio" data-i18n-preserve>Stremio</span>
          : <img className="npv-wordmark-img" src={NUVIO_WORDMARK} alt="Nuvio" height={22} draggable={false} data-i18n-preserve />}
        {subTitle === null && <span className="npv-topbar-note">
          <span>{source === 'saved' ? 'Preview of your saved setup' : source === 'edited' ? 'Preview of your setup' : 'Live preview of this setup'}</span>
          {source === 'edited' && <em>Showing your unsaved changes.</em>}
          {source === 'saved' && dirty && <em>Save to see your latest changes.</em>}
          {source !== 'saved' && posterStyle ? <em>Posters show in your style once saved.</em> : null}
        </span>}
        <div className="npv-modes" role="group" aria-label="Player">
          {(['tv', 'mobile', 'stremio'] as const).map((id) => (
            <button
              key={id} type="button" aria-pressed={mode === id} aria-label={MODE_LABELS[id]} title={MODE_LABELS[id]}
              className={mode === id ? 'is-active' : ''} onClick={() => switchTo(id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">{MODE_ICONS[id]}</svg>
            </button>
          ))}
        </div>
        <button type="button" className="npv-close" aria-label="Close preview" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      {source !== 'draft' && !installToken && <p className="npv-banner">Posters need your install link. Unlock this setup again to load them.</p>}
      {/* On TV the first arrow key hands focus to the focused card. */}
      <div
        className={`npv-body is-${mode}${(mode === 'mobile' && phoneFill) || phoneTv ? ' is-phone' : ''}`} ref={bodyRef} tabIndex={-1}
        onKeyDown={(event) => {
          if (mode !== 'tv' || phoneTv || event.target !== event.currentTarget || !event.key.startsWith('Arrow')) return;
          const card = event.currentTarget.querySelector<HTMLElement>('[data-pos][tabindex="0"]');
          if (card) { event.preventDefault(); card.focus({ preventScroll: true }); }
        }}
      >
        {stage}
      </div>
    </dialog>
  );
}
