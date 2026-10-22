import { useCallback } from 'react';
import { apiClient } from '@/api/client';
import type { SetupKeysDraft } from '@/features/setup/shared/config-contract';

// "Your own" stream addons (StreamNZB, a personal AIOStreams, ...). The link
// is a secret: it travels and is sealed with the keys (customAddon1..3) and is
// never shown again. The config keeps only { id, name } so the addon can be
// ordered and labelled with the other stream sources.
export interface CustomAddonRef { id: string; name: string }

export const CUSTOM_ADDON_SLOTS = ['custom-1', 'custom-2', 'custom-3'] as const;

export function customAddonKeyField(id: string): keyof SetupKeysDraft | null {
  const match = /^custom-([1-3])$/.exec(id);
  return match ? (`customAddon${match[1]}` as keyof SetupKeysDraft) : null;
}

export function cleanCustomAddons(value: unknown): CustomAddonRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CustomAddonRef[] = [];
  for (const entry of value) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const id = typeof row['id'] === 'string' ? row['id'] : '';
    if (!customAddonKeyField(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: typeof row['name'] === 'string' && row['name'].trim() ? row['name'].trim().slice(0, 60) : 'Your addon' });
  }
  return out;
}

async function verifyAddon(url: string): Promise<{ valid: boolean; name?: string; error?: string }> {
  try {
    return await apiClient.post<{ valid: boolean; name?: string; error?: string }>('/api/verify/addon', { url });
  } catch {
    return { valid: false, error: 'Could not reach that addon. Check the link and try again.' };
  }
}

// Add / remove for a page. Returns an error message, or null on success.
export function useCustomAddonActions({ custom, setCustom, setKeys, addons, setAddons, onRemoveKey }: {
  custom: CustomAddonRef[];
  setCustom: (next: CustomAddonRef[]) => void;
  setKeys: (update: (prev: SetupKeysDraft) => SetupKeysDraft) => void;
  addons: string[];
  setAddons: (next: string[]) => void;
  onRemoveKey?: ((field: keyof SetupKeysDraft) => void) | undefined;
}) {
  const add = useCallback(async (rawUrl: string): Promise<string | null> => {
    const url = rawUrl.trim();
    if (!url) return 'Paste the addon link (its manifest.json).';
    const slot = CUSTOM_ADDON_SLOTS.find((id) => !custom.some((row) => row.id === id));
    if (!slot) return 'You can add up to 3 of your own addons.';
    const result = await verifyAddon(url);
    if (!result.valid) return result.error || 'Could not reach that addon. Check the link and try again.';
    const field = customAddonKeyField(slot)!;
    setKeys((prev) => ({ ...prev, [field]: url }));
    setCustom([...custom, { id: slot, name: (result.name || 'Your addon').slice(0, 60) }]);
    setAddons([...addons.filter((id) => id !== slot), slot]);
    return null;
  }, [custom, setCustom, setKeys, addons, setAddons]);

  const remove = useCallback((id: string) => {
    const field = customAddonKeyField(id);
    if (field) {
      setKeys((prev) => { const next = { ...prev }; delete next[field]; return next; });
      onRemoveKey?.(field);
    }
    setCustom(custom.filter((row) => row.id !== id));
    setAddons(addons.filter((kept) => kept !== id));
  }, [custom, setCustom, setKeys, addons, setAddons, onRemoveKey]);

  return { add, remove };
}
