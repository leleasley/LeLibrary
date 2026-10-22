export interface InstallUrlsInput {
  origin: string;
  token: string;
  client: string;
  scheme?: string;
}

export interface InstallUrls {
  base: string;
  manifest: string;
  deepLink: string;
}

export interface InstallUrlsApi {
  integrationBase: (input: InstallUrlsInput) => string;
  integrationManifestUrl: (input: InstallUrlsInput) => string;
  installUrls: (input: InstallUrlsInput) => InstallUrls;
}

function integrationBase({ origin, token, client }: InstallUrlsInput): string {
  return `${String(origin).replace(/\/$/, '')}/${encodeURIComponent(token)}/i/${encodeURIComponent(client)}`;
}

function integrationManifestUrl(input: InstallUrlsInput): string {
  return `${integrationBase(input)}/manifest.json`;
}

function installUrls({ origin, token, client, scheme = '' }: InstallUrlsInput): InstallUrls {
  const manifest = integrationManifestUrl({ origin, token, client });
  return {
    base: integrationBase({ origin, token, client }),
    manifest,
    deepLink: scheme ? `${scheme}://${manifest.replace(/^https?:\/\//, '')}` : '',
  };
}

module.exports = { integrationBase, integrationManifestUrl, installUrls } satisfies InstallUrlsApi;
