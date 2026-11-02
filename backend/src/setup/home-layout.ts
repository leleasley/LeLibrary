'use strict';
// Nuvio Home order for one push (setup/push.ts syncNuvioHomeOrder).
//
// Both Nuvio apps order Home only by the Home settings items' `order`
// (NuvioMobile HomeCatalogSettingsRepository.publish, NuvioTV
// rebuildCatalogOrder; checked 2026-11-02). Collections without an item fall
// to the bottom, so every LeLibrary collection gets an item, and every push
// puts LeLibrary's own entries back in the order the setup chose. Collections
// always lead Home (Move In): LeLibrary's first, in the setup's order, then any
// other collection the profile has. Other addons' catalogue rows keep their
// places among the rows.

export interface LayoutInput {
  // Every key the profile has now, in its current Home order.
  existingKeys: string[];
  // LeLibrary's entries in the order this setup wants them.
  desired: string[];
  // Every key this push owns (desired plus owned-but-unordered, such as
  // manifest catalogues that are off Home).
  managed: Set<string>;
  // Keys that go before everything (collections), in this order.
  lead?: string[];
}

// The places LeLibrary's entries already hold are refilled with them in the
// wanted order; entries this push adds for the first time go after. Keys
// nobody owns keep their exact places. `lead` keys (collections) go first,
// before everything else, in the given order.
function layoutHomeKeys({ existingKeys, desired, managed, lead = [] }: LayoutInput): string[] {
  const seen = new Set<string>();
  const existing = existingKeys.filter((key) => (seen.has(key) ? false : (seen.add(key), true)));
  const leading = new Set(lead);
  const wanted: string[] = [];
  const queued = new Set<string>();
  for (const key of [...desired, ...existing.filter((key) => managed.has(key))]) {
    if (managed.has(key) && !leading.has(key) && !queued.has(key)) { queued.add(key); wanted.push(key); }
  }
  const out: string[] = [];
  let next = 0;
  for (const key of existing) {
    if (leading.has(key)) continue;
    if (managed.has(key)) {
      if (next < wanted.length) out.push(wanted[next++] as string);
    } else {
      out.push(key);
    }
  }
  while (next < wanted.length) out.push(wanted[next++] as string);
  return [...new Set(lead), ...out];
}

// Collections first: the setup's collections in the order of its Collections
// page, Movie Collections at its slot among them (default: first). Then the
// Home rows by their `order`.
function desiredHomeKeys(input: {
  rows: { key: string; order: number }[];
  franchise: { key: string; slot: number | null } | null;
  collectionKeys: string[];
}): { lead: string[]; rows: string[] } {
  const lead = input.collectionKeys.filter((key) => !input.franchise || key !== input.franchise.key);
  if (input.franchise) {
    const slot = Number.isFinite(input.franchise.slot) ? Math.max(0, Math.min(lead.length, Math.floor(Number(input.franchise.slot)))) : 0;
    lead.splice(slot, 0, input.franchise.key);
  }
  const leading = new Set(lead);
  // Stable: rows with the same order keep their list position.
  const rows = input.rows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => !leading.has(row.key))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((row) => row.key);
  return { lead: [...new Set(lead)], rows };
}

export interface HomeLayoutApi {
  layoutHomeKeys: typeof layoutHomeKeys;
  desiredHomeKeys: typeof desiredHomeKeys;
}

module.exports = { layoutHomeKeys, desiredHomeKeys } satisfies HomeLayoutApi;
