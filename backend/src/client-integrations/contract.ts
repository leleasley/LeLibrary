export interface ClientAdapterCapabilities {
  resources?: string[];
  types?: string[];
}

export interface ClientAdapter {
  id: string;
  label: string;
  status?: string;
  manifest: (...args: any[]) => unknown;
  capabilities?: ClientAdapterCapabilities;
  requestPolicy?: Record<string, unknown>;
  deepLinkScheme?: string;
  [key: string]: unknown;
}

export interface ContractApi {
  freezeAdapter: (adapter: unknown) => ClientAdapter;
}

const RESOURCE_NAMES = new Set(['catalog', 'meta', 'stream', 'subtitles']);

function freezeAdapter(adapter: unknown): ClientAdapter {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Client adapter must be an object');
  const record = adapter as Record<string, unknown>;
  const id = String(record.id || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) throw new TypeError('Client adapter id is invalid');
  if (!record.label || typeof record.label !== 'string') throw new TypeError(`Client adapter ${id} needs a label`);
  if (typeof record.manifest !== 'function') throw new TypeError(`Client adapter ${id} needs a manifest projector`);
  const resources = Array.isArray((record.capabilities as ClientAdapterCapabilities | undefined)?.resources)
    ? ((record.capabilities as ClientAdapterCapabilities).resources as string[])
    : [];
  if (resources.some((resource) => !RESOURCE_NAMES.has(resource))) throw new TypeError(`Client adapter ${id} has an unknown resource`);
  return Object.freeze({
    ...record,
    id,
    capabilities: Object.freeze({ ...((record.capabilities as Record<string, unknown>) || {}), resources: Object.freeze(resources.slice()) }),
    requestPolicy: Object.freeze({ ...((record.requestPolicy as Record<string, unknown>) || {}) }),
  }) as ClientAdapter;
}

module.exports = { freezeAdapter } satisfies ContractApi;
