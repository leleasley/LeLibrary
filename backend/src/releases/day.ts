// TV day-view assembly, shared by the single-day route and the week strip. Both
// have to agree on what "a show that day" means and on the Notable rule, so the
// grouping, the facets and the filters live here once and the routes only
// decide which rows to hand over.
//
// Pure: no I/O, no database, no HTTP.

const { isGenericEpisodeName: isGenericName } = require('./episode-label.ts') as {
  isGenericEpisodeName: (name: unknown) => boolean;
};

/** One row from the episode index, joined to its show. */
export interface DayRow {
  tmdb_id: number;
  show_tmdb_id: number;
  season: number;
  episode: number;
  name: string | null;
  air_date: string;
  is_series_premiere: boolean;
  is_season_premiere: boolean;
  is_finale: boolean;
  show_name: string;
  show_poster: string | null;
  show_status: string | null;
  show_networks: string[] | null;
  show_popularity: number | null;
  show_type: string | null;
  show_language: string | null;
}

export interface DayEpisode {
  id: number;
  season: number;
  episode: number;
  name: string | null;
  airDate: string;
  badges: { seriesPremiere: boolean; seasonPremiere: boolean; finale: boolean };
}

export interface DayShow {
  type: 'tv';
  id: number;
  title: string;
  poster: string | null;
  status: string | null;
  network: string | null;
  popularity: number | null;
  showType: string | null;
  language: string | null;
  premiereDay: boolean;
  episodes: DayEpisode[];
}

export interface DayFilters {
  language?: string | null;
  types?: string[];
  notable?: boolean;
  minPopularity?: number;
}

export interface DayFacets {
  types: Record<string, number>;
  languages: Record<string, number>;
}

export interface DayApi {
  posterUrl: (path: unknown) => string | null;
  groupDayRows: (rows: DayRow[]) => DayShow[];
  dayFacets: (shows: DayShow[]) => DayFacets;
  filterDayShows: (shows: DayShow[], filters: DayFilters) => DayShow[];
  sortDayShows: (shows: DayShow[], sort: string) => DayShow[];
  notableShow: (show: DayShow, minPopularity: number) => boolean;
}

function posterUrl(path: unknown): string | null {
  return typeof path === 'string' && path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

function firstNetwork(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
}

// "Notable" for the default TV view: anything with a premiere/finale that day,
// plus scripted/miniseries/documentary/video shows above the popularity
// threshold. Soaps, reality, talk and news are excluded unless they have a
// premiere/finale. The type string comes from TMDB.
function notableShow(show: DayShow, minPopularity: number): boolean {
  if (show.premiereDay) return true;
  const type = String(show.showType || '');
  const scripted = !type || /scripted|miniseries|documentary|video/i.test(type);
  return scripted && (Number(show.popularity) || 0) >= minPopularity;
}

// Group episode rows into shows. Order is preserved from the rows; callers sort.
function groupDayRows(rows: DayRow[]): DayShow[] {
  const groups = new Map<number, DayShow>();
  for (const row of rows) {
    let group = groups.get(row.show_tmdb_id);
    if (!group) {
      group = {
        type: 'tv',
        id: row.show_tmdb_id,
        title: row.show_name,
        poster: posterUrl(row.show_poster),
        status: row.show_status || null,
        network: firstNetwork(row.show_networks),
        popularity: typeof row.show_popularity === 'number' ? row.show_popularity : null,
        showType: row.show_type || null,
        language: row.show_language || null,
        premiereDay: false,
        episodes: [],
      };
      groups.set(row.show_tmdb_id, group);
    }
    group.episodes.push({
      id: row.tmdb_id,
      season: row.season,
      episode: row.episode,
      name: isGenericName(row.name) ? null : row.name,
      airDate: row.air_date,
      badges: {
        seriesPremiere: !!row.is_series_premiere,
        seasonPremiere: !!row.is_season_premiere,
        finale: !!row.is_finale,
      },
    });
  }
  const all = [...groups.values()];
  for (const show of all) {
    show.premiereDay = show.episodes.some(
      (episode) => episode.badges.seriesPremiere || episode.badges.seasonPremiere || episode.badges.finale,
    );
  }
  return all;
}

// Facets describe the whole day, before any filter, so the chips always add up.
function dayFacets(shows: DayShow[]): DayFacets {
  const types: Record<string, number> = {};
  const languages: Record<string, number> = {};
  for (const show of shows) {
    const type = show.showType || 'Unknown';
    types[type] = (types[type] || 0) + 1;
    const language = show.language || 'unknown';
    languages[language] = (languages[language] || 0) + 1;
  }
  return { types, languages };
}

function filterDayShows(shows: DayShow[], filters: DayFilters): DayShow[] {
  let out = shows;
  if (filters.language) out = out.filter((show) => show.language === filters.language);
  if (filters.types && filters.types.length) {
    const wanted = filters.types;
    out = out.filter((show) => !!show.showType && wanted.includes(show.showType));
  }
  if (filters.notable) {
    const threshold = filters.minPopularity || 0;
    out = out.filter((show) => notableShow(show, threshold));
  }
  return out;
}

function sortDayShows(shows: DayShow[], sort: string): DayShow[] {
  return [...shows].sort(sort === 'name'
    ? (a, b) => a.title.localeCompare(b.title)
    : (a, b) => (b.popularity || 0) - (a.popularity || 0) || a.title.localeCompare(b.title));
}

module.exports = {
  posterUrl,
  groupDayRows,
  dayFacets,
  filterDayShows,
  sortDayShows,
  notableShow,
} satisfies DayApi;
