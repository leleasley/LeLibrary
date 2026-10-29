import { apiClient } from '@/api/client';

// Runtime feature flags advertised by the server so the nav and route guards
// match the backend exactly. Hosted-only capabilities are false on self-host.
export interface Features {
  releases: boolean;
  // Self-host only: the instance has an operator secret, so it can list its
  // saved setups. Always false on the hosted deployment.
  savedSetups: boolean;
  // Stream addons the operator turned off because this server cannot reach
  // them (e.g. Torrentio blocks the hosted IP). Empty on most self-hosts.
  unavailableStreamAddons: string[];
  // Self-host only: the operator turned on the WebDAV library source.
  webdavSource: boolean;
}

export function normalizeFeatures(payload: unknown): Features {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    releases: record['releases'] === true,
    savedSetups: record['savedSetups'] === true,
    webdavSource: record['webdavSource'] === true,
    unavailableStreamAddons: Array.isArray(record['unavailableStreamAddons'])
      ? (record['unavailableStreamAddons'] as unknown[]).filter((id): id is string => typeof id === 'string')
      : [],
  };
}

async function loadFeatures(signal?: AbortSignal): Promise<Features> {
  const payload = await apiClient.get<unknown>('/api/features', signal ? { signal } : {});
  return normalizeFeatures(payload);
}

// One request serves every caller for a minute: the nav, the route guard and
// the setup picker each asked separately, three round trips on a page load.
const FEATURES_FRESH_MS = 60_000;
let shared: { at: number; promise: Promise<Features> } | null = null;

export function fetchFeatures(signal?: AbortSignal): Promise<Features> {
  if (signal) return loadFeatures(signal);
  if (shared && Date.now() - shared.at < FEATURES_FRESH_MS) return shared.promise;
  const promise = loadFeatures().catch((error: unknown) => { shared = null; throw error; });
  shared = { at: Date.now(), promise };
  return promise;
}

export function resetFeaturesCache(): void { shared = null; }
