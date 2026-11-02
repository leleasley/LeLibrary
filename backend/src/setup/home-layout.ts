'use strict';
// Nuvio Home order for one push (setup/push.ts syncNuvioHomeOrder).
//
// Both Nuvio apps order Home only by the Home settings items' `order`
// (NuvioMobile HomeCatalogSettingsRepository.publish, NuvioTV
// rebuildCatalogOrder; checked 2026-11-02). Collections without an item fall
// to the bottom, so every LeLibrary collection gets an item, and every push
// puts LeLibrary's own entries back in the order the setup chose. Entries of
// other addons (and the user's own collections) keep the places they have.

export interface LayoutInput {
  // Every key the profile has now, in its current Home order.
  existingKeys: string[];
  // LeLibrary's entries in the order this setup wants them.
  desired: string[];
  // Every key this push owns (desired plus owned-but-unordered, such as
  // manifest catalogues that are off Home).
  managed: Set<string>;
}

// The places LeLibrary's entries already hold are refilled with them in the
// wanted order; entries this push adds for the first time go after. Keys
// nobody owns keep their exact places.
function layoutHomeKeys({ existingKeys, desired, managed }: LayoutInput): string[] {
  const seen = new Set<string>();
  const existing = existingKeys.filter((key) => (seen.has(key) ? false : (seen.add(key), true)));
  const wanted: string[] = [];
  const queued = new Set<string>();
  for (const key of [...desired, ...existing.filter((key) => managed.has(key))]) {
    if (managed.has(key) && !queued.has(key)) { queued.add(key); wanted.push(key); }
  }
  const out: string[] = [];
  let next = 0;
  for (const key of existing) {
    if (managed.has(key)) {
      if (next < wanted.length) out.push(wanted[next++] as string);
    } else {
      out.push(key);
    }
  }
  while (next < wanted.length) out.push(wanted[next++] as string);
  return out;
}

// Wanted order: Home rows by their `order`, with Movie Collections at the place
// its own row holds among them, then the setup's collections in the order of
// its Collections page.
function desiredHomeKeys(input: {
  rows: { key: string; order: number }[];
  franchise: { key: string; order: number | null } | null;
  collectionKeys: string[];
}): string[] {
  const rows = input.rows.slice();
  const franchiseOrder = input.franchise && Number.isFinite(input.franchise.order) ? Number(input.franchise.order) : null;
  if (input.franchise && franchiseOrder !== null) rows.push({ key: input.franchise.key, order: franchiseOrder });
  // Stable: rows with the same order keep their list position.
  const ordered = rows.map((row, index) => ({ ...row, index })).sort((a, b) => a.order - b.order || a.index - b.index).map((row) => row.key);
  const out = [...ordered, ...input.collectionKeys.filter((key) => !ordered.includes(key))];
  if (input.franchise && franchiseOrder === null && !out.includes(input.franchise.key)) out.push(input.franchise.key);
  return out;
}

export interface HomeLayoutApi {
  layoutHomeKeys: typeof layoutHomeKeys;
  desiredHomeKeys: typeof desiredHomeKeys;
}

module.exports = { layoutHomeKeys, desiredHomeKeys } satisfies HomeLayoutApi;
