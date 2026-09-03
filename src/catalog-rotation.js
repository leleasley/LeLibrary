// ── Daily catalog rotation ────────────────────────────────────────────────
// Broad TMDB discover rows can use a different, deterministic release window
// each UTC day. This changes the upstream result pool while retaining the
// catalogue's defining provider/genre/studio/theme filters.

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new TypeError('rotation date must be valid');
  return value.toISOString().slice(0, 10);
}

function hash(value) {
  let out = 2166136261;
  for (const char of String(value)) {
    out ^= char.charCodeAt(0);
    out = Math.imul(out, 16777619);
  }
  return out >>> 0;
}

function isReleaseOrRatingRow(definition = {}) {
  const id = String(definition.id || '');
  const sort = String(definition.params?.sort || definition.params?.tmdb?.sort_by || '');
  return /(^|_)latest(_|$)|(^|_)toprated(_|$)|(^|_)top_rated(_|$)/.test(id)
    || sort.startsWith('release_date.') || sort.startsWith('first_air_date.') || sort.startsWith('vote_average.');
}

// Fixed resources should remain predictable. TMDB's live source endpoints
// already change naturally, while MDBList and collections have their own
// editorial/result pools.
function isRotationEligible(definition = {}) {
  if (!definition || isReleaseOrRatingRow(definition)) return false;
  if (definition.group === '📚 Film Collections') return false;
  return ['tmdb_provider', 'tmdb_genre', 'tmdb_company', 'tmdb_network', 'tmdb_keyword'].includes(definition.handler);
}

function releaseWindow(sourceId, day, now = new Date()) {
  const currentYear = now.getUTCFullYear();
  // Each source moves one slot every UTC day, with a source-specific offset.
  // Eighteen overlapping three-year windows span the modern provider era
  // (roughly the last two decades) without producing empty pre-streaming rows.
  const dayIndex = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
  const slot = (hash(sourceId) + dayIndex) % 18;
  const end = currentYear - slot;
  return { start: end - 2, end };
}

function rotationFor(definition, { date = new Date(), now = date } = {}) {
  if (!isRotationEligible(definition)) return null;
  const day = utcDay(date);
  const { start, end } = releaseWindow(definition.id, day, now instanceof Date ? now : new Date(now));
  const apiType = definition.params?.apiType || (definition.type === 'movie' ? 'movie' : 'tv');
  const prefix = apiType === 'tv' ? 'first_air_date' : 'primary_release_date';
  return {
    slot: day,
    filters: {
      [`${prefix}.gte`]: `${start}-01-01`,
      [`${prefix}.lte`]: `${end}-12-31`,
    },
  };
}

function applyRotation(definition, options) {
  const rotation = rotationFor(definition, options);
  if (!rotation) return { definition, rotation: null };
  const params = definition.params || {};
  return {
    definition: { ...definition, params: { ...params, rotation: rotation.filters } },
    rotation,
  };
}

module.exports = { utcDay, isRotationEligible, rotationFor, applyRotation };
