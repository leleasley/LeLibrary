import { useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { apiErrorCopy } from '@/api/error-copy';
import { i18n } from '@/i18n';
import { setupCopy } from '@/features/setup/shared/setup-copy';
import type { NuvioPart, NuvioProfile } from '@/features/setup/nuvio/api';

// Small building blocks shared by the Nuvio manager's tabs.

export interface WriteOptions<T> {
  /** Profile whose newest automatic backup "Undo last change" restores. */
  undo?: number | null;
  /** What to read again afterwards. Defaults to the open profile. */
  reload?: 'detail' | 'all' | 'none';
  after?: (out: T) => void;
  done?: string;
}

export type RunWrite = <T>(action: () => Promise<T>, options?: WriteOptions<T>) => Promise<T | null>;

export interface NuvioCtx {
  uuid: string;
  editToken: string;
  busy: boolean;
  run: RunWrite;
}

export interface Problem {
  message: string;
  code: string | null;
}

export function problemFrom(error: unknown, fallback = 'That did not work. Try again.'): Problem {
  const code = error instanceof ApiError ? error.code ?? null : null;
  if (code === 'nuvio-session-expired') {
    return { code, message: setupCopy('Sign in to Nuvio again on the Destination step', 'Sign in to Nuvio again on the Destination step') };
  }
  return { code, message: apiErrorCopy(error, setupCopy(fallback, fallback)) };
}

export const PROFILE_COLOURS = [
  '#1E88E5', '#E53935', '#43A047', '#FB8C00', '#8E24AA',
  '#00ACC1', '#F4511E', '#FDD835', '#D81B60', '#546E7A',
] as const;

export const PART_LABELS: Record<NuvioPart, string> = {
  settings: 'Settings',
  addons: 'Addons',
  collections: 'Collections',
  home: 'Home',
};

export function language(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'en';
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function sameOrder(a: readonly { id?: string; key?: string }[], b: readonly { id?: string; key?: string }[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, i) => (item.id ?? item.key) === (b[i]?.id ?? b[i]?.key));
}

export function sortByOrder<T extends { order: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function Switch({ checked, onChange, label, hint, disabled, ariaLabel }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  ariaLabel?: string | undefined;
}) {
  return (
    <label className={`switch-row nv-switch${label ? '' : ' is-bare'}`}>
      {label && (
        <span>
          <strong>{label}</strong>
          {hint && <small>{hint}</small>}
        </span>
      )}
      <input
        type="checkbox" checked={checked} disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

export function ColourDot({ colour }: { colour: string }) {
  const safe = /^#[0-9a-f]{6}$/i.test(colour) ? colour : '#1E88E5';
  return <span className="nv-dot" style={{ background: safe }} aria-hidden="true" />;
}

export function LockIcon() {
  return (
    <svg className="nv-lock" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ColourSwatches({ value, onChange, disabled }: {
  value: string;
  onChange: (colour: string) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="nv-swatches" role="radiogroup" aria-label="Profile colour">
      {PROFILE_COLOURS.map((colour) => (
        <button
          key={colour} type="button" role="radio" disabled={disabled}
          aria-checked={value.toUpperCase() === colour}
          aria-label={setupCopy('Colour {{colour}}', 'Colour {{colour}}', { colour })}
          className={`nv-swatch${value.toUpperCase() === colour ? ' is-active' : ''}`}
          style={{ background: colour }}
          onClick={() => onChange(colour)}
        />
      ))}
    </div>
  );
}

export function PartChecks({ value, onChange, disabled }: {
  value: NuvioPart[];
  onChange: (next: NuvioPart[]) => void;
  disabled?: boolean | undefined;
}) {
  const all: NuvioPart[] = ['settings', 'addons', 'collections', 'home'];
  return (
    <div className="nv-parts" role="group" aria-label="What to copy">
      {all.map((part) => (
        <label key={part} className="nv-check">
          <input
            type="checkbox" disabled={disabled} checked={value.includes(part)}
            onChange={(event) => onChange(event.target.checked ? all.filter((p) => p === part || value.includes(p)) : value.filter((p) => p !== part))}
          />
          <span>{PART_LABELS[part]}</span>
        </label>
      ))}
    </div>
  );
}

export function profileName(profiles: readonly NuvioProfile[], index: number): string {
  return profiles.find((profile) => profile.index === index)?.name ?? setupCopy('Profile {{number}}', 'Profile {{number}}', { number: index });
}

/**
 * A list that reorders by dragging its handle or with the up and down
 * buttons (keyboard and touch). Moves are local until the caller saves.
 */
export function ReorderList<T>({ items, keyOf, nameOf, onMove, disabled, render, className }: {
  items: readonly T[];
  keyOf: (item: T) => string;
  nameOf: (item: T) => string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean | undefined;
  render: (item: T, index: number) => ReactNode;
  className?: string | undefined;
}) {
  const [armed, setArmed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => { setArmed(null); setDragging(null); setOver(null); };
  return (
    <ol className={`nv-list${className ? ` ${className}` : ''}`}>
      {items.map((item, index) => (
        <li
          key={keyOf(item)}
          className={`nv-row${dragging === index ? ' is-dragging' : ''}${over === index && dragging !== index ? ' is-over' : ''}`}
          draggable={!disabled && armed === index}
          onDragStart={(event) => {
            setDragging(index);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            if (over !== index) setOver(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging !== null && dragging !== index) onMove(dragging, index);
            reset();
          }}
          onDragEnd={reset}
        >
          {!disabled && (
            <span
              className="nv-grip" aria-hidden="true"
              onPointerDown={() => setArmed(index)}
              onPointerUp={() => { if (dragging === null) setArmed(null); }}
            >
              <svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg>
            </span>
          )}
          <div className="nv-row-main">{render(item, index)}</div>
          {!disabled && (
            <span className="nv-move">
              <button
                type="button" className="nv-icon-btn" disabled={index === 0}
                aria-label={setupCopy('Move {{name}} up', 'Move {{name}} up', { name: nameOf(item) })}
                onClick={() => onMove(index, index - 1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              <button
                type="button" className="nv-icon-btn" disabled={index === items.length - 1}
                aria-label={setupCopy('Move {{name}} down', 'Move {{name}} down', { name: nameOf(item) })}
                onClick={() => onMove(index, index + 1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function OrderBar({ dirty, busy, onSave, onReset, label }: {
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
  label: string;
}) {
  if (!dirty) return null;
  return (
    <div className="nv-orderbar">
      <span>You have unsaved changes here.</span>
      <span className="nv-orderbar-actions">
        <button type="button" className="setup-secondary" disabled={busy} onClick={onReset}>Discard</button>
        <button type="button" className="setup-primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : label}</button>
      </span>
    </div>
  );
}
