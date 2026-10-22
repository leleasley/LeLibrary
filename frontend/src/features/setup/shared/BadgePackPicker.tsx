import { useEffect, useState } from 'react';

// Nuvio badge packs. The picker
// shows every real pack with a live badge preview resolved against the same
// sample stream text Nuvio matching uses, so what renders here is what the
// pack will actually produce.

export interface BadgePack {
  id: string;
  name: string;
  url: string;
  description: string;
  local?: boolean;
}

export const BADGE_PACKS: BadgePack[] = [
  { id: 'lelibrary-premium', name: 'LeLibrary Premium', url: '/api/nuvio-badges/lelibrary-premium.json', local: true, description: 'Original local 4K, REMUX, HDR, audio, codec and language badges.' },
  { id: 'nard-full', name: 'NardBadges Full', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges.json', description: 'Community full set with tier styling.' },
  { id: 'nard-slim', name: 'NardBadges Slim', url: 'https://raw.githubusercontent.com/vowl313/NardBadges/refs/heads/main/NardBadges_Slim.json', description: 'Community set without tier indicators.' },
  { id: 'better-colored', name: 'BetterFormatter Colored', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/colored-bgb-combo-always.json', description: 'Community coloured badge-combo layout.' },
  { id: 'better-mono', name: 'BetterFormatter Mono', url: 'https://raw.githubusercontent.com/9mousaa/BetterFormatter/main/presets/mono-bgb-combo-nodv.json', description: 'Community monochrome badge-combo layout.' },
  { id: 'elite', name: 'Elite Badges', url: 'https://raw.githubusercontent.com/leonevz/Elite-Badges/main/badges.json', description: 'Community premium-styled badge set.' },
  { id: 'minimal-white', name: 'Minimalist White', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-white.json', description: 'Community high-contrast TV-friendly badges.' },
  { id: 'minimal-mixed', name: 'Minimalist Mixed', url: 'https://raw.githubusercontent.com/sweatycab/nuvio-minimalist-badges/main/badges-mixed.json', description: 'Community mixed-colour minimalist badges.' },
  { id: 'custom', name: 'Choose your own', url: '', description: 'Paste any HTTPS badge JSON URL.' },
];

export const DEFAULT_BADGE_PACK = 'lelibrary-premium';

// Nuvio matches a badge when its pattern hits the stream text; same sample.
const SAMPLE_STREAM_TEXT = 'Toy Story 2 1999 2160p BluRay HEVC TrueHD 7.1 Atmos FRDS 2.63 GB';
const LOCAL_SAMPLE = ['res-4k', 'source-remux', 'visual-dv', 'audio-atmos', 'ch-71', 'codec-hevc'];

export interface BadgeMatch {
  name: string;
  imageURL: string;
  borderColor: string;
  tagColor: string;
  bordered: boolean;
}

function cssColor(value: unknown, fallback = '#858283'): string {
  const raw = String(value || '').trim();
  const eight = /^#([0-9a-f]{8})$/i.exec(raw);
  if (eight?.[1]) return `#${eight[1].slice(2)}${eight[1].slice(0, 2)}`; // Nuvio stores AARRGGBB.
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

// AARRGGBB black with a zero alpha byte: the pack explicitly asks for no
// fill. Treated as absent so the group's category colour shows instead —
// otherwise combo packs (BetterFormatter et al) preview as monochrome
// because their colour lives on tier-gated badges our sample never matches.
function transparentBlack(value: unknown): boolean {
  return /^#00[0-9a-f]{6}$/i.test(String(value || '').trim());
}

export function isValidBadgeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

// Filters arrive as { pattern, imageURL, borderColor, ... }; groups carry the
// shared style. Mirrors remoteBadgeMatches() in the legacy picker.
export function matchBadges(data: unknown, manifestUrl: string): BadgeMatch[] {
  const payload = (data ?? {}) as { filters?: unknown; groups?: unknown };
  const groups = Array.isArray(payload.groups) ? payload.groups as Record<string, unknown>[] : [];
  const groupStyles = new Map(groups.map((group) => [String(group['id']), group]));
  const filters = Array.isArray(payload.filters) ? payload.filters as Record<string, unknown>[] : [];
  const seen = new Set<string>();
  const matches: BadgeMatch[] = [];
  for (const filter of filters) {
    const imageURL = String(filter['imageURL'] || filter['imageUrl'] || '');
    const pattern = String(filter['pattern'] || '');
    if (!imageURL || !pattern) continue;
    const group = String(filter['groupId'] || filter['group'] || filter['name'] || imageURL);
    if (seen.has(group)) continue;
    try {
      const expression = pattern.replace(/^\(\?[imsuxU-]+\)/, '');
      if (!new RegExp(expression, 'i').test(SAMPLE_STREAM_TEXT)) continue;
      const resolved = new URL(imageURL, manifestUrl).href;
      if (!isValidBadgeUrl(resolved)) continue;
      seen.add(group);
      const groupStyle = groupStyles.get(String(filter['groupId'])) ?? {};
      const rawTag = filter['tagColor'];
      const tagSource = transparentBlack(rawTag) || !rawTag ? groupStyle['color'] : rawTag;
      matches.push({
        name: String(filter['name'] || 'Badge'),
        imageURL: resolved,
        borderColor: cssColor(filter['borderColor'] || groupStyle['borderColor'] || groupStyle['color']),
        tagColor: cssColor(tagSource, 'transparent'),
        bordered: /border/i.test(String(filter['tagStyle'] || '')),
      });
      if (matches.length === 7) break;
    } catch { /* Nuvio-only regex: skip it in this preview. */ }
  }
  return matches;
}

export interface BadgeGalleryItem {
  name: string;
  imageURL: string;
}

// Everything a pack ships, regardless of matching: the combo packs gate
// their signature artwork behind tier glyphs no plain sample contains, so
// matched-only previews render Colored and Mono identically. The browser
// shows this gallery (labelled as the full set, not matches) so packs stay
// distinguishable.
export function packGallery(data: unknown, manifestUrl: string, limit = 8): BadgeGalleryItem[] {
  const payload = (data ?? {}) as { filters?: unknown };
  const filters = Array.isArray(payload.filters) ? payload.filters as Record<string, unknown>[] : [];
  const items: BadgeGalleryItem[] = [];
  const seen = new Set<string>();
  for (const filter of filters) {
    const imageURL = String(filter['imageURL'] || filter['imageUrl'] || '');
    if (!imageURL || seen.has(imageURL)) continue;
    let resolved = '';
    try {
      resolved = new URL(imageURL, manifestUrl).href;
    } catch {
      continue;
    }
    if (!isValidBadgeUrl(resolved)) continue;
    seen.add(imageURL);
    items.push({ name: String(filter['name'] || 'Badge'), imageURL: resolved });
    if (items.length >= limit) break;
  }
  return items;
}

export interface BadgePreviewState {
  mode: 'local' | 'remote' | 'none';
  loading: boolean;
  badges: BadgeMatch[];
  gallery: BadgeGalleryItem[];
}

// Resolves the selected pack into renderable badges. The local pack ships its
// own PNGs; remote packs go through the SSRF-hardened JSON proxy and are
// matched client-side against the same sample stream text Nuvio uses.
export function useBadgePreview(pack: string, customUrl?: string): BadgePreviewState {
  const preset = BADGE_PACKS.find((entry) => entry.id === pack) ?? BADGE_PACKS[0];
  const isLocal = preset?.local === true;
  const resolvedUrl = pack === 'custom' ? (customUrl ?? '') : (preset?.url ?? '');
  const [state, setState] = useState<BadgePreviewState>({ mode: isLocal ? 'local' : 'none', loading: !isLocal, badges: [], gallery: [] });

  useEffect(() => {
    if (isLocal) { setState({ mode: 'local', loading: false, badges: [], gallery: [] }); return; }
    if (!isValidBadgeUrl(resolvedUrl)) { setState({ mode: 'none', loading: false, badges: [], gallery: [] }); return; }
    let cancelled = false;
    setState({ mode: 'none', loading: true, badges: [], gallery: [] });
    fetch(`/api/import-json?url=${encodeURIComponent(resolvedUrl)}`, { credentials: 'same-origin' })
      .then((response) => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .then((data) => {
        if (cancelled) return;
        const badges = matchBadges(data, resolvedUrl);
        setState({ mode: badges.length > 0 ? 'remote' : 'none', loading: false, badges, gallery: packGallery(data, resolvedUrl) });
      })
      .catch(() => { if (!cancelled) setState({ mode: 'none', loading: false, badges: [], gallery: [] }); });
    return () => { cancelled = true; };
  }, [pack, resolvedUrl, isLocal]);

  return state;
}

export const LOCAL_BADGE_SAMPLE = LOCAL_SAMPLE;
export const LOCAL_BADGE_BASE = '/api/nuvio-badges/lelibrary-premium';
