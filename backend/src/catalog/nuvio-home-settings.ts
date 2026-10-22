// One payload builder for Nuvio's Home-catalog settings blob. It carries both
// platforms' Home rows and the hide_unreleased_content choice (verified against
// the TV and mobile HomeCatalogSettingsSyncService).
//
// `hideUnreleased` is tri-state: null leaves whatever the user already has,
// true/false writes the setup's explicit choice.
export interface HomeCatalogSettings {
  show_catalog_type?: unknown;
  hide_unreleased_content?: unknown;
  [key: string]: unknown;
}

function homeSettingsPayload(
  settings: unknown,
  items: unknown[],
  hideUnreleased: boolean | null,
): Record<string, unknown> {
  const source = (settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings
    : {}) as HomeCatalogSettings;
  return {
    show_catalog_type: source.show_catalog_type !== false,
    hide_unreleased_content: hideUnreleased === null
      ? source.hide_unreleased_content === true
      : hideUnreleased,
    items,
  };
}

interface NuvioHomeSettingsApi {
  homeSettingsPayload: (settings: unknown, items: unknown[], hideUnreleased: boolean | null) => Record<string, unknown>;
}

module.exports = { homeSettingsPayload } satisfies NuvioHomeSettingsApi;
