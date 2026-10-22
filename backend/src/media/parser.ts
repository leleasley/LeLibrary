// @ts-nocheck

const MIN_FILM_YEAR = 1888;
const filmYearPattern = () => `(?:18(?:8[89]|9\\d)|19\\d{2}|20\\d{2})`;

function filmYearCandidates(value) {
  const upperYear = new Date().getFullYear() + 2;
  const pattern = new RegExp(`(?<!\\d)(${filmYearPattern()})(?!\\d)|(?<=[\\p{L}])(${filmYearPattern()})(?=\\s*[([{]|$)`, 'gu');
  const candidates = [];
  for (const match of value.matchAll(pattern)) {
    const year = parseInt(match[1] || match[2], 10);
    if (year >= MIN_FILM_YEAR && year <= upperYear) {
      candidates.push({ year, index: match.index, end: match.index + match[0].length });
    }
  }
  return candidates;
}

function hasFilmYear(value) {
  return filmYearCandidates(value).length > 0;
}

// Edition labels count as release metadata (they cut the title), but the
// release year often follows them: "Hancock EXTENDED 2008 1080p".
const EDITION_BEFORE_YEAR_RE = /^(?:extended|unrated|uncut|remaster(?:ed)?|theatrical|director'?s\s+cut|proper|repack)(?:\s+(?:cut|edition|version))?\s+[([]?$/i;

function selectFilmYear(value, candidates, techCut) {
  if (!candidates.length) return null;
  const beforeTech = value.slice(0, techCut);
  const inRange = candidates.filter(candidate => candidate.end <= techCut);
  if (!inRange.length) {
    const next = candidates.find(candidate => candidate.index >= techCut);
    if (next && EDITION_BEFORE_YEAR_RE.test(value.slice(techCut, next.index).trim() + ' ')) return next;
    return null;
  }
  const last = inRange[inRange.length - 1];
  const trailing = beforeTech.slice(last.end).replace(/[()[\]{}]/g, ' ').replace(/[._-]/g, ' ').trim();
  // A year followed by ordinary words is often a title number (for example,
  // a film title followed by its actual release year). A final year before
  // technical release metadata, or at the end of the name, is the release.
  if (!trailing) {
    return last;
  }
  return inRange[0];
}

const EP_RE = /[Ss](\d{1,2})[Ee](\d{1,2})(?:[-–][Ee]?(\d{1,2})|[Ee](\d{1,2}))?/;

// Scene "1x02" / "2x13-14" numbering (no S/E prefix). The \b guards keep
// resolutions ("1920x1080") and codecs ("x264") out: neither offers a word
// boundary around a short digit-x-digit core, so they cannot match.
const EP_X_RE = /\b(\d{1,2})x(\d{1,2})(?:[-–](\d{1,2}))?\b/;
const EP_SX_RE = /\b[Ss](\d{1,2})[xX](\d{1,2})(?:[-–](\d{1,2}))?\b/;

const SEASON_RANGE_RE = /\b[Ss](\d{1,2})\s*(?:[-–]|to)\s*[Ss]?(\d{1,2})\b/i;
const SEASON_WORD_RANGE_RE = /(?:^|[^\p{L}\p{N}])(?:seasons?|temporadas?|сезон(?:а|ы|ов)?|sezon(?:a|y|ow)?|saisons?|staffeln?|stagioni?)\s*(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})(?=$|[^\p{L}\p{N}])/iu;
const S_RE    = /\b[Ss](\d{1,2})\b(?![Ee\d])/;
// "S1.S9" / "S01 S03 S05 S09": consecutive bare season markers name a pack's
// first and last season (normalize() has already turned the dots into spaces).
// Only an ascending pair counts, and never when an episode marker follows.
const SEASON_PAIR_RE = /\b[Ss](\d{1,2})(?:\s+[Ss]\d{1,2})*\s+[Ss](\d{1,2})\b(?!\s*[Ee]\d)/;
function seasonPairRange(text) {
  const m = text.match(SEASON_PAIR_RE);
  return m && parseInt(m[2], 10) > parseInt(m[1], 10) ? m : null;
}

const SEASON_WORD_RE = /(?:^|[^\p{L}\p{N}])(?:seasons?|temporadas?|сезон(?:а|ы|ов)?|sezon(?:a|y|ow)?|saisons?|staffeln?|stagioni?)\s*(\d{1,2})(?=$|[^\p{L}\p{N}])/iu;
const SEASON_ORD_RE  = /\b(\d{1,2})[aªº°]\s+temporada\b/i;
const PART_RE        = /\b(?:parte?|part)\s*(\d)\b/i;

const ANIME_GROUPS = [
  'SubsPlease','Erai-raws','HorribleSubs','WF','ASW','Yameii','Judas',
  'LostYears','Tsundere-Raws','Nii-sama','Okay-Subs','GS','Asenshi',
  'Commie','FFF','Doki','Kira','GJM','CBM','VCB-Studio','ANE',
  'OZC','Underwater','UTW','NanoSubs','Chihiro','Coalgirls','THORA',
  'BlurayDesuYo','KH','Ohys-Raws','RAW-NIBL','Moozzi2','IrizaRaws',
];
const ANIME_GROUP_RE = new RegExp(`^\\[(${ANIME_GROUPS.join('|')})[^\\]]*\\]`, 'i');

const ANIME_EP_RE  = /\s[-–]\s+(\d{1,3})(?:v\d+)?\s*(?:\[|$)/;
const ANIME_EP2_RE = /^(.+?)\s+(\d{2,3})(?:v\d+)?\s*[\[(]/;

// Absolute-episode anime numbering ("Naruto 12 [1080p]") collides with
// episode-count phrasing in multi-voiceover releases ("Серии 1-6 из 12
// [2025, ...]", "... из 13 (Director, ...)"): the trailing number is a
// total, not an episode. Only accept the pattern when the context does not
// read as a count, otherwise a plain US series lands in the anime catalog.
const COUNT_CONTEXT_RE = /(\d+\s*[-–]\s*\d+|сери[яйию]|серий|эпизод|episodes?)\D{0,16}$/i;
const BRACKET_YEAR_RE = /^(19|20)\d{2}\b/;
function looksLikeEpisodeCount(prefix, afterBracket) {
  if (COUNT_CONTEXT_RE.test(String(prefix || ''))) return true;
  if (BRACKET_YEAR_RE.test(String(afterBracket || '').trim())) return true;
  return false;
}

const SEASON_ORD_EN_RE = /\b(\d+)(?:st|nd|rd|th)\s+season\b/i;

const DATE_RE   = /\b(19[5-9]\d|20[0-3]\d)[\s.\-](0?[1-9]|1[0-2])[\s.\-](0?[1-9]|[12]\d|3[01])\b/;
const DATE_MDY  = /\b(0?[1-9]|[12]\d|3[01])[\s.\-](0?[1-9]|[12]\d|3[01])[\s.\-](19[5-9]\d|20[0-3]\d)\b/;

function mkDate(y, m, d) {
  y = parseInt(y, 10); m = parseInt(m, 10); d = parseInt(d, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const CJK_RE = /[\u3040-\u30FF\u4E00-\u9FFF]/;

const TECH = [
  /\b(2160p|1080p|720p|480p|360p)\b/i,
  /\b(4k|uhd)\b/i,
  /\b(web[-\s]?dl|webdl|web[-\s]?rip|webrip|bluray|blu[-\s]?ray|bdrip|brrip|hdtv|hdrip|dvdrip|dvdscr|camrip|hdtc|hdcam)\b/i,
  /\b(x264|x265|h264|h\.?265|hevc|avc|xvid)\b/i,
  /\b(ddp?5[\s.]1|dd5[\s.]1|aac|ac3|eac3|dts|truehd|atmos|opus|flac)\b/i,
  /\b(hdr10?|dolby[\s.]?vision|sdr)\b/i,
  /\b(remux|proper|repack|extended)\b/i,
  /\b(internal|remaster(?:ed)?)\b/i,
  /\b(dual|dublado|legendado|nacional|plsub|multi[-\s]?sub|multi[-\s]?audio)\b/i,
  /\b(amzn|nflx|hmax|dsnp|iqiyi|adn)\b/i,
  // Voice-over / dub / subtitle labels on Russian releases ("MVO", "2x DVO",
  // "Sub Rus", "Original Eng") are release metadata, not title words.
  /\b(?:\d+\s*[xх]\s*)?(?:mvo|dvo|avo)\b/i,
  /\b(?:sub|subs)\s+(?:rus|eng|ukr)\b/i,
  /\boriginal\s+(?:eng|rus)\b/i,
];

function firstTechIndex(value) {
  let index = value.length;
  for (const re of TECH) {
    const match = value.match(re);
    if (match && match.index < index) index = match.index;
  }
  return index;
}

function normalize(s) {
  return s.replace(/[._]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// Provider filenames sometimes arrive HTML-encoded ("Child&#039;s Play") -
// decode before parsing so titles with apostrophes/entities still match TMDB.
function decodeHtml(s) {
  let out = String(s || '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // Some downloads keep their URL-encoded name ("Best%20in%20Show%202000"),
  // which otherwise glues the whole name into one unsearchable title.
  if (/%(?:2[0-9A-F]|3[A-F]|5[BDF]|7[BD])/i.test(out)) {
    try { out = decodeURIComponent(out.replace(/%(?![0-9A-F]{2})/gi, '%25')); } catch { /* keep as is */ }
  }
  return out;
}

// Bounded FIFO memo: filenames are unbounded across users, and a parse is
// cheap to redo, so evict the oldest entries instead of growing forever.
const PARSE_CACHE_MAX = Math.max(1000, parseInt(process.env.PARSE_CACHE_MAX, 10) || 50000);
const _parseCache = new Map();
function clearParseCache() { _parseCache.clear(); }

function guessMediaInfo(raw) {
  if (!raw || raw.length < 3) return null;
  if (_parseCache.has(raw)) return _parseCache.get(raw);

  let name = decodeHtml(raw).replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '').trim();

  const isAnimeGroup = ANIME_GROUP_RE.test(name);
  const hasCJK       = CJK_RE.test(name);

  name = name.replace(/^\[[^\]]{1,50}\]\s*/, '').trim();
  name = name.replace(/^www\.\S+\s*[-–]+\s*/i, '').trim();
  // Some release groups prefix a full distributor hostname without a dash
  // (the prior rule only handled the dashed form). Strip only a leading
  // www/domain label, before dots are normalized into spaces.
  name = name.replace(/^www\.[a-z0-9-]+\.(?:com|net|org|tv|to|ru|io|co)(?:[._\s-]+|$)/i, '').trim();
  // Common standalone source quality prefix, e.g. `FHD-Title`; this is not a
  // title word and otherwise hides the real title from candidate search.
  name = name.replace(/^FHD[._\s-]+/i, '').trim();
  name = name.replace(/^[A-Z0-9_-]{4,}\.[A-Z]{2,4}(?=\.\.)/i, '').replace(/^[\.\s-]+/, '').trim();
  // Distributor sites also prefix "Site.Org - Title" without www, and some
  // leave the container name behind ("SITE.COM..MKV.Title"). Neither is part
  // of the title.
  name = name.replace(/^[a-z0-9-]{3,}\.(?:org|com|net|tv|to|io|co|me|cc)\s*[-–]+\s*/i, '').trim();
  name = name.replace(/^(?:mkv|mp4|avi)\.+(?=\S)/i, '').trim();

  let norm = normalize(name);
  // Some provider file lists put the year or the season marker before the
  // title. Recover those layouts only when a substantive title follows the
  // marker and the remainder also contains release metadata. Keep the year
  // attached to the parsed title when it is the only year present.
  const leadingYear = norm.match(new RegExp(`^((?:${filmYearPattern()}\\s+)+)(.+)$`));
  if (leadingYear) {
    const remainder = leadingYear[2].trim();
    const beforeTech = remainder.slice(0, firstTechIndex(remainder));
    const titleWords = beforeTech.match(/[\p{L}]{2,}/gu) || [];
    const prefixYears = filmYearCandidates(leadingYear[1]).map(candidate => candidate.year);
    const leadingTitleNumber = /^a\s+/i.test(remainder) || filmYearCandidates(remainder).some(candidate => candidate.index === 0 && candidate.year === parseInt(leadingYear[1].trim().split(/\s+/).at(-1), 10));
    if (titleWords.length >= 2 && prefixYears.length) {
      const hasYearAfter = hasFilmYear(remainder);
      if (!leadingTitleNumber) {
        norm = hasYearAfter
          ? remainder
          : `${beforeTech} ${prefixYears[prefixYears.length - 1]} ${remainder.slice(beforeTech.length)}`.trim();
      }
    }
  }

  let leadingSeason = null;
  const leadingSeasonMatch = norm.match(/^S(\d{1,2})\s+(.+)$/i);
  if (leadingSeasonMatch) {
    const remainder = leadingSeasonMatch[2].trim();
    const beforeTech = remainder.slice(0, firstTechIndex(remainder));
    const titleWords = beforeTech.match(/[\p{L}]{2,}/gu) || [];
    // A season marker alone, or a single word after it, is not enough to
    // distinguish a series title from an episode/edition label.
    if (titleWords.length >= 2 && (hasFilmYear(remainder) || firstTechIndex(remainder) < remainder.length)) {
      leadingSeason = parseInt(leadingSeasonMatch[1], 10);
      norm = remainder;
    }
  }
  // Release metadata and group tags often contain letter-number tokens such
  // as "S93". Only treat episode/season markers before the first quality or
  // source marker as part of the title; otherwise a movie release group can
  // misroute the movie into the Series catalogue.
  const markerCut = firstTechIndex(norm);
  // Pixel sizes and aspect ratios ("720x480", "16x9") look like scene 1x02
  // numbering. Blank them (same length, so indexes still line up).
  const markerText = norm.slice(0, markerCut)
    .replace(/\b(?:\d{3,4}x\d{3,4}|16x9|16x10|21x9|4x3)\b/gi, (token) => ' '.repeat(token.length));

  let isSeries = leadingSeason != null, season = leadingSeason, seasonStart = null, seasonEnd = null, episode = null, episodeEnd = null, airDate = null, airDates = null;
  let serieCut = norm.length;
  let epEndIndex = null;

  const epMatch = markerText.match(EP_RE);
  if (epMatch) {
    isSeries = true;
    season   = parseInt(epMatch[1], 10);
    episode  = parseInt(epMatch[2], 10);
    if (epMatch[3]) episodeEnd = parseInt(epMatch[3], 10);
    else if (epMatch[4]) episodeEnd = parseInt(epMatch[4], 10);
    serieCut = epMatch.index;
    epEndIndex = epMatch.index + epMatch[0].length;
  }

  // Bare 1x02 numbering sits right after SxxExx (an explicit S-marker
  // always wins) and before the bare "S01" / season-word fallbacks, so
  // "Show 1x02 ..." resolves with its episode instead of a bare season.
  if (!isSeries) {
    const xm = markerText.match(EP_SX_RE) || markerText.match(EP_X_RE);
    if (xm) {
      isSeries = true;
      season   = parseInt(xm[1], 10);
      episode  = parseInt(xm[2], 10);
      if (xm[3]) episodeEnd = parseInt(xm[3], 10);
      serieCut = xm.index;
      epEndIndex = xm.index + xm[0].length;
    }
  }

  if (!isSeries) {
    const rm = markerText.match(SEASON_RANGE_RE) || seasonPairRange(markerText) || markerText.match(SEASON_WORD_RANGE_RE);
    if (rm) {
      isSeries = true;
      seasonStart = Math.min(parseInt(rm[1], 10), parseInt(rm[2], 10));
      seasonEnd = Math.max(parseInt(rm[1], 10), parseInt(rm[2], 10));
      serieCut = rm.index;
    }
  }

  if (!isSeries) {
    const sm = markerText.match(S_RE);
    if (sm) {
      isSeries = true;
      season   = parseInt(sm[1], 10);
      serieCut = sm.index;
      const afterS = norm.slice(sm.index + sm[0].length);
      const ae = afterS.match(/^\s*[-\u2013]\s+(\d{1,3})(?:v\d+)?/);
      if (ae) episode = parseInt(ae[1], 10);
    }
  }

  if (!isSeries) {
    const tw = markerText.match(SEASON_WORD_RE) || markerText.match(SEASON_ORD_RE) || markerText.match(SEASON_ORD_EN_RE);
    if (tw) {
      isSeries = true;
      season   = parseInt(tw[1], 10);
      serieCut = tw.index;
    }
  }

  if (!isSeries) {
    const dm = markerText.match(DATE_RE);
    if (dm) {
      isSeries = true;
      const d = mkDate(dm[1], dm[2], dm[3]);
      if (d) { airDate = d; airDates = [d]; }
      serieCut = dm.index;
    } else {
      const dm2 = markerText.match(DATE_MDY);
      if (dm2) {
        // Jackass 2.5/3.5/4.5 are movie version numbers, not air dates
        // "Jackass 3 5 2011" normalizes from "Jackass.3.5.2011" - the "3 5" is the
        // version, not month/day. Don't treat it as a series date.
        const before = markerText.slice(0, dm2.index).trim();
        // normalize() has already turned version dots into spaces, so 2.5
        // arrives here as "2 5". Accept that normalized suffix as well as
        // the undotted title form before deciding whether M D YYYY is an
        // air-date marker.
        const isJackassVer = /^jackass(?:\s+[1-5](?:\s+5)?)?\s*$/i.test(before) && /^[1-5]$/.test(dm2[1]) && /^[1-5]$/.test(dm2[2]);
        // A dated episode always has a show title in front of the date; a
        // bare leading "11-14 2003" is a film title followed by its year.
        if (!isJackassVer && before) {
          isSeries = true;
          const a = mkDate(dm2[3], dm2[1], dm2[2]);
          const b = mkDate(dm2[3], dm2[2], dm2[1]);
          airDates = [a, b].filter(Boolean);
          airDate  = airDates[0] || null;
          serieCut = dm2.index;
        }
      }
    }
  }

  let animeEp = null;
  if (!isSeries || episode === null) {
    const ae = markerText.match(ANIME_EP_RE);
    if (ae && !looksLikeEpisodeCount(markerText.slice(0, ae.index), markerText.slice(ae.index + ae[0].length))) {
      if (!isSeries) { isSeries = true; serieCut = ae.index; }
      animeEp = parseInt(ae[1], 10);
    } else if (!isSeries) {
      const ae2 = markerText.match(ANIME_EP2_RE);
      if (ae2 && !looksLikeEpisodeCount(ae2[1], markerText.slice(ae2[0].length))) {
        isSeries = true; animeEp = parseInt(ae2[2], 10); serieCut = ae2[1].length;
      }
    }
  }

  const isAnime = isAnimeGroup || hasCJK || (isSeries && animeEp !== null);

  let techCut = firstTechIndex(norm);
  const ym = selectFilmYear(norm, filmYearCandidates(norm), techCut);
  let year = null;
  if (ym) { year = ym.year; if (ym.index < techCut) techCut = ym.index; }

  // Episode title for episode-title matching: the text between the SxxExx
  // marker and the first technical token. Left null when absent, numeric, or
  // merged with a date, so it is only used when it is a real title.
  let episodeTitle = null;
  if (isSeries && epEndIndex != null && epEndIndex < techCut) {
    const cleaned = norm.slice(epEndIndex, techCut)
      .replace(/^[\s.\-_\u2013]+/, '')
      .replace(/\s*\([^)]*\)/g, ' ')
      .replace(/\s*\[[^\]]*\]/g, ' ')
      .replace(/[\s\-\u2013]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned && cleaned.length >= 3 && !/^[\d\s.-]+$/.test(cleaned)) episodeTitle = cleaned;
  }

  const cutindex = Math.min(serieCut, techCut);
  let title = norm.substring(0, cutindex);

  title = title.replace(/\s*\([^)]*\)/g, '');
  title = title.replace(/\s*\[[^\]]*\]/g, '');
  title = title.replace(/\s*[-–]\s*(?:\d+[aªº°]\s*)?(?:temporada|season).*$/i, '');
  title = title.replace(/\s+\d+(?:st|nd|rd|th)\s+season.*$/i, '');
  title = title.replace(/[\s([{]+$/, '').trim();
  title = title.replace(/(?:\s+[-–]\s*|\s*[-–]\s+)\d+\s*$/, '');
  title = title.replace(/[\s\-–]+$/, '').trim();
  title = title.replace(/\s{2,}/g, ' ').trim();

  // Recover a title the cleanup emptied, only when a film year anchors it:
  // a fully bracketed title ("(Untitled) (2009)") or a title that is itself a
  // release tag ("Dual 2022 BluRay", where DUAL reads as dual audio).
  let recovered = false;
  if (!title && !isSeries) {
    recovered = true;
    const bracketed = norm.match(/^\(([^()]{1,40})\)/);
    const firstYear = filmYearCandidates(norm).find(candidate => candidate.index > 0);
    if (bracketed && !/^\s*\d{4}\s*$/.test(bracketed[1])) {
      title = bracketed[1].trim();
    } else if (firstYear) {
      const lead = norm.slice(0, firstYear.index).replace(/[\s([{]+$/, '').trim();
      if (lead && lead.split(/\s+/).length <= 3) { title = lead; if (year == null) year = firstYear.year; }
    }
  }
  // One-character titles ("M", "X", "W.") are real films, but only trust them
  // with a release year beside them.
  if (!title || (title.length < 2 && !(year != null && /^[\p{L}\p{N}]$/u.test(title)))) return null;
  if (title.length < 2) recovered = true;

  title = title.split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  // `recovered`: the title was rescued from a name the normal cleanup emptied
  // (or is a single character). Only ever trust it as a film.
  const result = { title, year, isSeries, isAnime, season, seasonStart, seasonEnd, episode: episode ?? animeEp, episodeEnd, airDate, airDates, episodeTitle, recovered };
  if (_parseCache.size >= PARSE_CACHE_MAX) {
    const oldest = _parseCache.keys().next().value;
    if (oldest !== undefined) _parseCache.delete(oldest);
  }
  _parseCache.set(raw, result);
  return result;
}

export interface ParserApi {
  guessMediaInfo: any;
  clearParseCache: any;
}

module.exports = { guessMediaInfo, clearParseCache } satisfies ParserApi;
