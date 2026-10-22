import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, buildBackup, parseBackup } from '@/features/setup/shared/setup-backup';

describe('settings backup', () => {
  it('never carries anything key-like, even if a config held one', () => {
    const backup = buildBackup({
      tier: 'partial', name: 'Living room',
      config: { lang: 'es-ES', torboxApiKey: 'x', nested: { editToken: 'y', ok: 1 }, rows: [{ password: 'z', title: 'A' }] },
    });
    expect(backup.config).toEqual({ lang: 'es-ES', nested: { ok: 1 }, rows: [{ title: 'A' }] });
    expect(JSON.stringify(backup)).not.toMatch(/"x"|"y"|"z"/);
  });

  it('round-trips through a file', () => {
    const backup = buildBackup({ tier: 'quick', name: 'Kids', config: { catNameMovies: 'Films' } });
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup.tier).toBe('quick');
      expect(parsed.backup.name).toBe('Kids');
      expect(parsed.backup.config).toEqual({ catNameMovies: 'Films' });
    }
  });

  it('rejects other files and newer versions', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, config: {} })).ok).toBe(false);
  });
});
