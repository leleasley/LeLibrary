// Shared server/client lifetime for indexed library catalog projections.
// Keep the client freshness hint aligned with the engine's result-cache TTL.
export function libraryCatalogTtl(env: Record<string, string | undefined> = process.env): number {
  return Math.max(10, parseInt(env.LIBRARY_CATALOG_TTL || '', 10) || 300);
}
