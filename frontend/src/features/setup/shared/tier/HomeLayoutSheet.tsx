import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { HomeLayoutItem } from '@/features/setup/shared/home-layout';

// "Home layout": one sheet to set the order of everything on Home. Two
// groups in a fixed order (Nuvio puts collections above Home rows, always),
// each reordered on its own by drag (mouse and touch, pointer events) or the
// up / down buttons. It edits the page's own lists through the callbacks, so
// the Home rows and Collections pages show the same order.

export interface HomeLayoutGroup {
  id: 'collections' | 'rows';
  items: HomeLayoutItem[];
  onMove: (from: number, to: number) => void;
}

const GROUP_TITLE: Record<HomeLayoutGroup['id'], string> = { collections: 'Collections', rows: 'Home rows' };
const KIND_LABEL: Record<HomeLayoutItem['kind'], string> = { collection: 'Collection', library: 'Library', row: 'Row' };

function LayoutGroup({ group }: { group: HomeLayoutGroup }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const draggingRef = useRef<number | null>(null);

  // Live reorder: while the handle is held, crossing another card's middle
  // moves the held card there.
  function onPointerDown(event: ReactPointerEvent<HTMLElement>, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    draggingRef.current = index;
    setDragging(index);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const from = draggingRef.current;
    const list = listRef.current;
    if (from === null || !list) return;
    const cards = Array.from(list.children) as HTMLElement[];
    let to = from;
    cards.forEach((card, at) => {
      const box = card.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      if (at < from && event.clientY < middle) to = Math.min(to, at);
      if (at > from && event.clientY > middle) to = Math.max(to, at);
    });
    if (to !== from) {
      group.onMove(from, to);
      draggingRef.current = to;
      setDragging(to);
    }
  }
  function onPointerEnd() {
    draggingRef.current = null;
    setDragging(null);
  }

  return (
    <section className="hl-group" aria-label={GROUP_TITLE[group.id]}>
      <h4 className="hl-group-title">{GROUP_TITLE[group.id]}</h4>
      <ol className="hl-list" ref={listRef}>
        {group.items.map((item, index) => (
          <li key={item.key} className={`hl-item${dragging === index ? ' is-dragging' : ''}`}>
            <span
              className="hl-handle" aria-hidden="true"
              onPointerDown={(event) => onPointerDown(event, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
            </span>
            <span className={`hl-chip is-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
            <span className="hl-name" data-i18n-preserve>{item.title}</span>
            <span className="hl-moves">
              <button type="button" className="hl-move" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => group.onMove(index, index - 1)}>↑</button>
              <button type="button" className="hl-move" aria-label={`Move ${item.title} down`} disabled={index === group.items.length - 1} onClick={() => group.onMove(index, index + 1)}>↓</button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Collections always come first (Nuvio Home order), whatever order a page
// passes; empty groups are left out.
export function layoutGroupsInOrder(groups: HomeLayoutGroup[]): HomeLayoutGroup[] {
  const rank = (id: HomeLayoutGroup['id']) => (id === 'collections' ? 0 : 1);
  return groups.filter((group) => group.items.length > 0).sort((a, b) => rank(a.id) - rank(b.id));
}

// The sheet's box (no portal), so tests can render it without a document.
export function HomeLayoutBox({ groups, onClose, doneRef }: {
  groups: HomeLayoutGroup[];
  onClose: () => void;
  doneRef?: RefObject<HTMLButtonElement | null> | undefined;
}) {
  const shown = layoutGroupsInOrder(groups);
  return (
    <div className="hl-box">
      <header className="hl-head">
        <div>
          <h3>Home layout</h3>
          <p>Drag catalog rows and collections to set the order they appear on your Nuvio home screen.</p>
        </div>
        <button type="button" className="hl-close" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <div className="hl-body">
        {shown.length === 0 ? (
          <p className="hl-empty">Nothing on Home yet. Add rows on the Home rows page.</p>
        ) : shown.map((group) => <LayoutGroup key={group.id} group={group} />)}
        {shown.length > 1 && <p className="hl-note">Collections always sit above Home rows in Nuvio.</p>}
      </div>
      <footer className="hl-foot">
        <button type="button" className="setup-primary hl-done" ref={doneRef} onClick={onClose}>Done</button>
      </footer>
    </div>
  );
}

export function HomeLayoutSheet({ open, onClose, groups }: {
  open: boolean;
  onClose: () => void;
  groups: HomeLayoutGroup[];
}) {
  const doneRef = useRef<HTMLButtonElement>(null);
  // Pages pass a fresh closure each render; the open/close effect must run
  // once per opening (it moves focus), so it reads the latest through a ref.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    doneRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      restore?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="app-modal hl-sheet" role="dialog" aria-modal="true" aria-label="Home layout" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <HomeLayoutBox groups={groups} onClose={onClose} doneRef={doneRef} />
    </div>,
    document.body,
  );
}
