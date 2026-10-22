import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIBRARY_ROWS,
  libraryRowsEditConfig,
  libraryRowsFromConfig,
  libraryRowsToConfig,
  withLibraryRowNames,
} from '@/features/setup/shared/library-rows';

describe('library rows', () => {
  it('saves only names and hidden rows that differ from the defaults', () => {
    expect(libraryRowsToConfig(EMPTY_LIBRARY_ROWS)).toEqual({});
    const rows = { ...EMPTY_LIBRARY_ROWS, movies: { name: '  Films ', show: true }, anime: { name: '', show: false } };
    expect(libraryRowsToConfig(rows)).toEqual({ catNameMovies: 'Films', catalogAnime: false });
  });

  it('reads saved names and switches back', () => {
    const rows = libraryRowsFromConfig({ catNameSeries: 'Shows', catalogMovies: false });
    expect(rows.series).toEqual({ name: 'Shows', show: true });
    expect(rows.movies).toEqual({ name: '', show: false });
    expect(rows.anime).toEqual({ name: '', show: true });
  });

  it('edits send only changes, with null clearing a saved value', () => {
    const saved = libraryRowsFromConfig({ catNameMovies: 'Films', catalogAnime: false });
    const current = { ...saved, movies: { name: '', show: true }, anime: { name: '', show: true } };
    expect(libraryRowsEditConfig(current, saved)).toEqual({ catNameMovies: null, catalogAnime: null });
    expect(libraryRowsEditConfig(saved, saved)).toEqual({});
  });

  it('Settle In and Move In save names only, never visibility', () => {
    const rows = { ...EMPTY_LIBRARY_ROWS, series: { name: 'Shows', show: false } };
    expect(withLibraryRowNames(rows, { lang: 'es-ES' })).toEqual({ lang: 'es-ES', catNameSeries: 'Shows' });
  });
});
