import { useEffect, useState } from 'react';

// The formatter, token codec, poster-template validator and pictorium option
// contract are backend TypeScript (single source of truth). React setup loads
// type-stripped browser builds from the compat routes in routes/website.ts,
// so the preview and server cannot disagree.

export interface FormatterPreset {
  name: string;
  description: string;
}

export interface FormatterLib {
  render: (template: string, ctx: unknown) => string;
  format: (template: string, ctx: unknown) => string;
  formatStream: (
    nameTemplate: string,
    descTemplate: string,
    filename: string,
    source: string,
    size: number,
    options?: Record<string, unknown>,
  ) => { name: string; description: string };
  buildLeContext: (filename: string, source: string, size: number, options?: Record<string, unknown>) => unknown;
  presets: Record<string, FormatterPreset>;
  compileTemplate: (template: string) => unknown;
}

export interface TokenMapLib {
  encodeConfig: (config: Record<string, unknown>) => string;
  normalizeConfig: (decoded: unknown) => Record<string, unknown> | null;
}

export type PosterValidation =
  | { ok: true; value: string; placeholders: string[] }
  | { ok: false; error: string };

export interface PosterTemplateLib {
  validate: (template: string) => PosterValidation;
  resolve: (template: string, media: Record<string, unknown>) => string | null;
  apply: (row: unknown, template: string) => unknown;
  // Present on servers from 5.8: a Posters+ copied link as a template.
  fromPostersPlus?: (link: string) => PosterValidation;
}

export interface PictoriumOptionsLib {
  DEFAULTS: Record<string, string | number>;
  RATING_SOURCES?: [string, string][];
  LANGUAGES?: [string, string][];
  REGIONS?: [string, string][];
  VIDEO_FORMATS?: [string, string][];
  sanitize: (input: unknown) => Record<string, string | number>;
  toQuery: (input: unknown) => string;
  fromQuery: (query: unknown) => Record<string, string | number>;
}

const cache = new Map<string, Promise<unknown>>();

// Shared browser helpers use immutable static caching. Bump this query version
// whenever one of their implementations changes.
export const FROZEN_ASSET_VERSION = '12';

export const FROZEN_ASSETS = {
  'formatter.js': `/formatter.js?v=${FROZEN_ASSET_VERSION}`,
  'token-map.js': `/token-map.js?v=${FROZEN_ASSET_VERSION}`,
  'poster-template.js': `/poster-template.js?v=${FROZEN_ASSET_VERSION}`,
  'pictorium-options.js': `/pictorium-options.js?v=${FROZEN_ASSET_VERSION}`,
  'custom-streams-editor.js': `/custom-streams-editor.js?v=${FROZEN_ASSET_VERSION}`,
} satisfies Record<string, string>;

function loadScript(url: string, globalName: string): Promise<unknown> {
  const existing = (window as any)[globalName];
  if (existing) return Promise.resolve(existing);
  const pending = cache.get(url);
  if (pending) return pending;
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const value = (window as any)[globalName];
      if (value) resolve(value);
      else reject(new Error(`${url} did not expose ${globalName}`));
    };
    script.onerror = () => reject(new Error(`Could not load ${url}`));
    document.head.appendChild(script);
  });
  cache.set(url, promise);
  return promise;
}

export function loadFormatter(): Promise<FormatterLib> {
  return loadScript(FROZEN_ASSETS['formatter.js'], 'LeFormatter') as Promise<FormatterLib>;
}

export function loadTokenMap(): Promise<TokenMapLib> {
  return loadScript(FROZEN_ASSETS['token-map.js'], 'TOKEN_MAP') as Promise<TokenMapLib>;
}

export function loadPosterTemplate(): Promise<PosterTemplateLib> {
  return loadScript(FROZEN_ASSETS['poster-template.js'], 'LePosterTemplate') as Promise<PosterTemplateLib>;
}

export function loadPictoriumOptions(): Promise<PictoriumOptionsLib> {
  return loadScript(FROZEN_ASSETS['pictorium-options.js'], 'LePictoriumOptions') as Promise<PictoriumOptionsLib>;
}

export interface CustomStreamsEditor {
  render: () => void;
  modeChanged: () => void;
  save: () => void;
  edit: (index: number) => void;
  remove: (index: number) => void;
  reset: () => void;
  verify: () => void;
  importFile: (input: HTMLInputElement) => void;
  exportRows: () => void;
  searchChanged: () => void;
  seasonChanged: () => void;
  selectSearch: (index: number) => void;
  clearSelection: () => void;
}

export interface CustomStreamsEditorLib {
  Editor: new (options: {
    getRows: () => unknown[];
    setRows: (rows: unknown[]) => void;
    toast: (message: string, type?: string) => void;
    changed: () => void;
    escape: (value: unknown) => string;
    accountSearch?: boolean;
    getSearchToken?: () => string;
  }) => CustomStreamsEditor;
}

export function loadCustomStreamsEditor(): Promise<CustomStreamsEditorLib> {
  return loadScript(FROZEN_ASSETS['custom-streams-editor.js'], 'LeCustomStreamsEditor') as Promise<CustomStreamsEditorLib>;
}

export function useLegacyLib<T>(loader: () => Promise<T>): T | null {
  const [lib, setLib] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    loader().then((value) => { if (!cancelled) setLib(value); }).catch(() => { /* preview stays empty */ });
    return () => { cancelled = true; };
  }, [loader]);
  return lib;
}

