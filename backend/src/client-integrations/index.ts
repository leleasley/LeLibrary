import type { ClientAdapter, ContractApi } from './contract.ts';

const { freezeAdapter } = require('./contract.ts') as ContractApi;

export interface ClientIntegrationsApi {
  getClientIntegration: (id: unknown, options?: { fallback?: boolean }) => ClientAdapter | null;
  listClientIntegrations: () => Pick<ClientAdapter, 'id' | 'label' | 'status' | 'capabilities'>[];
  clientInstallUrls: (input: { origin: string; token: string; client: string }) => { base: string; manifest: string; deepLink: string } | null;
}

const adapters = ['generic', 'stremio', 'nuvio', 'strmr', 'fusion', 'vidi', 'wuplay']
  .map((name) => freezeAdapter(require(`./adapters/${name}.ts`)));
const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

function getClientIntegration(id: unknown, { fallback = true }: { fallback?: boolean } = {}): ClientAdapter | null {
  return byId.get(String(id || '').toLowerCase()) || (fallback ? byId.get('generic') ?? null : null);
}

function listClientIntegrations(): Pick<ClientAdapter, 'id' | 'label' | 'status' | 'capabilities'>[] {
  return adapters.map((adapter) => ({ id: adapter.id, label: adapter.label, status: adapter.status, capabilities: adapter.capabilities }));
}

function clientInstallUrls({ origin, token, client }: { origin: string; token: string; client: string }) {
  const adapter = getClientIntegration(client, { fallback: false });
  if (!adapter) return null;
  const { installUrls } = require('./install-urls.ts') as {
    installUrls: (input: { origin: string; token: string; client: string; scheme?: string }) => { base: string; manifest: string; deepLink: string };
  };
  return installUrls({ origin, token, client: adapter.id, scheme: (adapter.deepLinkScheme as string | undefined) || '' });
}

module.exports = { getClientIntegration, listClientIntegrations, clientInstallUrls } satisfies ClientIntegrationsApi;
