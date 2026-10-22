import { describe, expect, it } from 'vitest';
import { cleanCustomAddons, customAddonKeyField } from '@/features/setup/shared/custom-addons';
import { editSaveBody, snapshotFromSaved } from '@/features/setup/shared/edit-mode';

describe('your own stream addons', () => {
  it('maps slots to sealed key fields and nothing else', () => {
    expect(customAddonKeyField('custom-1')).toBe('customAddon1');
    expect(customAddonKeyField('custom-3')).toBe('customAddon3');
    expect(customAddonKeyField('custom-4')).toBeNull();
    expect(customAddonKeyField('torrentio')).toBeNull();
  });

  it('keeps only valid, unique slots with a display name', () => {
    expect(cleanCustomAddons([
      { id: 'custom-1', name: ' StreamNZB ' }, { id: 'custom-1', name: 'dup' }, { id: 'bad', name: 'x' }, { id: 'custom-2' },
    ])).toEqual([{ id: 'custom-1', name: 'StreamNZB' }, { id: 'custom-2', name: 'Your addon' }]);
  });

  it('the link goes in keys on edit, names in config, and removal clears both', () => {
    const saved = snapshotFromSaved({ customAddons: [{ id: 'custom-1', name: 'Old' }] }, {}, 'Home');
    const added = { ...saved, keys: { customAddon2: 'https://nzb.example/abc/manifest.json' }, customAddons: [...saved.customAddons, { id: 'custom-2', name: 'StreamNZB' }] };
    const body = editSaveBody({ current: added, saved, savedName: 'Home', savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: [] });
    expect(body?.keys).toEqual({ customAddon2: 'https://nzb.example/abc/manifest.json' });
    expect(body?.config).toMatchObject({ customAddons: [{ id: 'custom-1', name: 'Old' }, { id: 'custom-2', name: 'StreamNZB' }] });
    expect(JSON.stringify(body?.config)).not.toContain('nzb.example');

    const removed = { ...saved, customAddons: [] };
    const clear = editSaveBody({ current: removed, saved, savedName: 'Home', savedTier: 'partial', tier: 'partial', providerServices: [], clearKeys: ['customAddon1'] });
    expect(clear?.config).toMatchObject({ customAddons: [] });
  });
});
