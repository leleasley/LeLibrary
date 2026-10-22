import { apiClient } from '@/api/client';

export interface ProviderStatus {
  id: string;
  name: string;
  status: string;
  latency?: number;
  detail?: string;
  url?: string;
  history?: StatusHistory;
  maintenance?: boolean;
  note?: string;
  services?: ProviderService[];
}

export interface ProviderService {
  section: string;
  name: string;
  status: string;
  detail?: string;
  availability?: number;
}

function normalizeServices(value: unknown): ProviderService[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const services = value.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (typeof item['name'] !== 'string' || typeof item['status'] !== 'string') return [];
    const service: ProviderService = {
      section: typeof item['section'] === 'string' ? item['section'] : '',
      name: item['name'],
      status: item['status'],
    };
    if (typeof item['detail'] === 'string') service.detail = item['detail'];
    if (typeof item['availability'] === 'number' && Number.isFinite(item['availability'])) {
      service.availability = item['availability'];
    }
    return [service];
  });
  return services.length > 0 ? services : undefined;
}

export interface StatusCell {
  t: number;
  status: string;
}

export interface StatusHistory {
  b24: StatusCell[];
  b7: StatusCell[];
  up24?: number | null;
  up7?: number | null;
}

function normalizeCells(value: unknown): StatusCell[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const cell = (entry ?? {}) as Record<string, unknown>;
    if (typeof cell['t'] !== 'number' || typeof cell['status'] !== 'string') return [];
    return [{ t: cell['t'], status: cell['status'] }];
  });
}

function normalizeHistory(value: unknown): StatusHistory | undefined {
  const record = (value ?? {}) as Record<string, unknown>;
  if (typeof value !== 'object' || value === null) return undefined;
  if (!Array.isArray(record['b24']) && !Array.isArray(record['b7'])) return undefined;
  const history: StatusHistory = {
    b24: normalizeCells(record['b24']),
    b7: normalizeCells(record['b7']),
  };
  if (typeof record['up24'] === 'number') history.up24 = record['up24'];
  if (typeof record['up7'] === 'number') history.up7 = record['up7'];
  return history;
}

export interface StatusResponse {
  overall: string;
  updatedAt?: string;
  providers: ProviderStatus[];
}

// Response data is untrusted: normalise the shape before it reaches components.
export function normalizeStatus(payload: unknown): StatusResponse {
  const record = (payload ?? {}) as Record<string, unknown>;
  const providers = Array.isArray(record['providers']) ? record['providers'] : [];
  return {
    overall: typeof record['overall'] === 'string' ? record['overall'] : 'unknown',
    ...(typeof record['updatedAt'] === 'string'
      ? { updatedAt: record['updatedAt'] }
      : typeof record['updatedAt'] === 'number' && Number.isFinite(record['updatedAt'])
        ? { updatedAt: new Date(record['updatedAt']).toISOString() }
        : {}),
    providers: providers.flatMap((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      if (typeof item['id'] !== 'string') return [];
      return [{
        id: item['id'],
        name: typeof item['name'] === 'string' ? item['name'] : item['id'],
        status: typeof item['status'] === 'string' ? item['status'] : 'unknown',
        ...(typeof item['latency'] === 'number' ? { latency: item['latency'] } : {}),
        ...(typeof item['detail'] === 'string' ? { detail: item['detail'] } : {}),
        ...(typeof item['url'] === 'string' ? { url: item['url'] } : {}),
        ...(item['maintenance'] === true ? { maintenance: true } : {}),
        ...(typeof item['note'] === 'string' && item['note'] ? { note: item['note'] } : {}),
        ...(() => {
          const services = normalizeServices(item['services']);
          return services ? { services } : {};
        })(),
        ...(() => {
          const history = normalizeHistory(item['history']);
          return history ? { history } : {};
        })(),
      }];
    }),
  };
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  return normalizeStatus(await apiClient.get<unknown>('/api/status', signal ? { signal } : {}));
}
