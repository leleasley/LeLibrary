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

// Nuvio Mobile writes a Home entry it does not recognise back with the whole
// key in addon_id and an empty type and catalog id (it re-splits the key on
// ":", while these keys use "_"). Neither app can match such an entry to a
// catalogue, and each push used to lengthen its key. Drop the broken entries
// of any LeLibrary install; the push re-adds proper ones for its own
// catalogues. Other addons' entries are never touched.
function dropMalformedHomeItems(items: unknown[]): Record<string, unknown>[] {
  return (Array.isArray(items) ? items : []).filter((raw) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (item['is_collection'] === true || item['isCollection'] === true) return true;
    const addonId = String(item['addon_id'] ?? '');
    const broken = !String(item['catalog_id'] ?? '') && !String(item['type'] ?? '') && /^community\.lelibrary[^_]*_/.test(addonId);
    return !broken;
  }) as Record<string, unknown>[];
}

interface NuvioHomeSettingsApi {
  homeSettingsPayload: (settings: unknown, items: unknown[], hideUnreleased: boolean | null) => Record<string, unknown>;
  dropMalformedHomeItems: (items: unknown[]) => Record<string, unknown>[];
}

module.exports = { homeSettingsPayload, dropMalformedHomeItems } satisfies NuvioHomeSettingsApi;
