import { describe, expect, it, vi, afterEach } from 'vitest';
import { normalizeStatus } from '@/api/status';
import { fetchStatus } from '@/api/status';
import { apiClient } from '@/api/client';

afterEach(() => vi.restoreAllMocks());

describe('normalizeStatus', () => {
  it('passes maintenance state, notes and service breakdowns through', () => {
    const out = normalizeStatus({
      overall: 'maintenance',
      providers: [{
        id: 'torbox',
        name: 'TorBox',
        status: 'maintenance',
        latency: 689,
        detail: 'GPU transcoding maintenance',
        maintenance: true,
        note: 'GPU transcoding maintenance',
        services: [
          { section: 'Main Resources', name: 'API', status: 'operational', availability: 99.82 },
          { section: 'Main Resources', name: 'Transcoding', status: 'maintenance' },
          { name: 42, status: 'operational' },
        ],
      }],
    });
    const provider = out.providers[0]!;
    expect(out.overall).toBe('maintenance');
    expect(provider.maintenance).toBe(true);
    expect(provider.note).toBe('GPU transcoding maintenance');
    expect(provider.services).toEqual([
      { section: 'Main Resources', name: 'API', status: 'operational', availability: 99.82 },
      { section: 'Main Resources', name: 'Transcoding', status: 'maintenance' },
    ]);
  });

  it('drops malformed services and non-boolean maintenance flags', () => {
    const out = normalizeStatus({
      overall: 'operational',
      providers: [{ id: 'torbox', status: 'operational', maintenance: 'yes', services: 'many' }],
    });
    expect(out.providers[0]!.maintenance).toBeUndefined();
    expect(out.providers[0]!.services).toBeUndefined();
  });
});

describe('fetchStatus', () => {
  it('returns normalized data from the status endpoint', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ overall: 'operational', providers: [] });
    const out = await fetchStatus();
    expect(out.overall).toBe('operational');
    expect(out.providers).toEqual([]);
  });
});
