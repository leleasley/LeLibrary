import { useCallback, useRef, useState } from 'react';
import { PreviewModal } from '@/features/setup/preview/PreviewModal';
import { draftKeyServices, draftRequestConfig, type PreviewDraft } from '@/features/setup/preview/preview-model';
import type { PreviewStreamStyle } from '@/features/setup/preview/PreviewScreens';
import { cleanKeys, type SetupKeysDraft } from '@/features/setup/shared/config-contract';
import type { FormattingDraft } from '@/features/setup/shared/FormattingSection';
import type { EditMode, TierId } from '@/features/setup/shared/edit-mode';

// The one Preview on every setup page: the shell's Preview (the sidebar's
// "Open preview", the phone top bar's play button) opens the full-screen
// player replica. Creating, the page
// owns the modal and it shows the live draft; editing, the edit container
// owns it (so the Library, Nuvio and Settings views open the same one) and
// asks the page for its draft when it opens.

// What a page hands the Preview: its create-body config (built by the same
// function creation uses, never its keys) and what the details sheet needs.
export interface TierPreviewInput {
  tier: TierId;
  platform: 'nuvio' | 'stremio';
  config: () => Record<string, unknown>;
  keys: SetupKeysDraft;
  formatting: FormattingDraft;
  badgePack: { pack: string; url: string };
  // The chosen poster provider ('' = plain TMDB).
  posterStyle: string;
  // The setup's name (headings in the Preview).
  name?: string | undefined;
  // Connected list services (Simkl, AniList), by name only: the draft
  // declares their personal rows and shows them as samples. A connection is
  // never a key field, so the key names alone would miss it.
  connected?: readonly string[] | undefined;
}

export interface TierPreviewSource {
  draft: PreviewDraft;
  platform: 'nuvio' | 'stremio';
  streams: PreviewStreamStyle;
  posterStyle: string;
  setupName: string;
}

// The draft as the Preview may see it: secrets stripped from the config, and
// keys reduced to the NAMES of the filled-in ones (plus the saved ones).
export function tierPreviewSource(input: TierPreviewInput, savedServices: readonly string[] = []): TierPreviewSource {
  return {
    draft: {
      tier: input.tier,
      config: draftRequestConfig(input.config()),
      keyServices: draftKeyServices(cleanKeys(input.keys), [...savedServices, ...(input.connected ?? [])]),
    },
    platform: input.platform,
    streams: { formatting: input.formatting, badgePack: input.badgePack },
    posterStyle: input.posterStyle,
    setupName: (input.name ?? '').trim(),
  };
}

// Wires a tier page to the Preview. Edit mode: the page registers how to read
// its draft and the shell asks the container to open. Create mode: the page
// renders the modal itself. `initialOpen` is for tests.
export function useTierPreview(edit: EditMode | undefined, input: TierPreviewInput, initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  const latest = useRef(input);
  latest.current = input;
  const savedServices = edit?.savedServices;
  // Read when the Preview opens, so it always sees the page as it is then.
  if (edit?.previewSource) edit.previewSource.current = () => tierPreviewSource(latest.current, savedServices ?? []);
  const onPreview = edit?.onPreview;
  const openPreview = useCallback(() => { if (onPreview) onPreview(); else setOpen(true); }, [onPreview]);
  const source = !onPreview && open ? tierPreviewSource(input) : null;
  const modal = source ? (
    <PreviewModal
      open onClose={() => setOpen(false)}
      savedPlatform={source.platform} draft={source.draft} streams={source.streams} posterStyle={source.posterStyle} setupName={source.setupName}
    />
  ) : null;
  return { openPreview, modal };
}
