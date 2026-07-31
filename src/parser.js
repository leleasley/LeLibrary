
const YEAR_RE = /\b(19[5-9]\d|20[0-3]\d)\b/;

const EP_RE = /[Ss](\d{1,2})[Ee](\d{1,2})(?:[-–][Ee]?(\d{1,2})|[Ee](\d{1,2}))?/;

const S_RE    = /\b[Ss](\d{1,2})\b(?![Ee\d])/;

const SEASON_WORD_RE = /\b(?:season|temporada)\s*(\d{1,2})\b/i;
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
  /\b(dual|dublado|legendado|nacional|plsub|multi[-\s]?sub|multi[-\s]?audio)\b/i,
  /\b(amzn|nflx|hmax|dsnp|iqiyi|adn)\b/i,
];

function normalize(s) {
  return s.replace(/[._]/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function guessMediaInfo(raw) {
  if (!raw || raw.length < 3) return null;

  let name = raw.replace(/\.(mkv|mp4|avi|mov|ts|wmv|m4v|webm)$/i, '').trim();

  const isAnimeGroup = ANIME_GROUP_RE.test(name);
  const hasCJK       = CJK_RE.test(name);

  name = name.replace(/^\[[^\]]{1,50}\]\s*/, '').trim();
  name = name.replace(/^www\.\S+\s*[-–]+\s*/i, '').trim();
  name = name.replace(/^[A-Z0-9_-]{4,}\.[A-Z]{2,4}(?=\.\.)/i, '').replace(/^[\.\s-]+/, '').trim();

  const norm = normalize(name);

  let isSeries = false, season = null, episode = null, episodeEnd = null, airDate = null, airDates = null;
  let serieCut = norm.length;

  const epMatch = norm.match(EP_RE);
  if (epMatch) {
    isSeries = true;
    season   = parseInt(epMatch[1], 10);
    episode  = parseInt(epMatch[2], 10);
    if (epMatch[3]) episodeEnd = parseInt(epMatch[3], 10);
    else if (epMatch[4]) episodeEnd = parseInt(epMatch[4], 10);
    serieCut = epMatch.index;
  }

  if (!isSeries) {
    const sm = norm.match(S_RE);
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
    const tw = norm.match(SEASON_WORD_RE) || norm.match(SEASON_ORD_RE) || norm.match(SEASON_ORD_EN_RE);
    if (tw) {
      isSeries = true;
      season   = parseInt(tw[1], 10);
      serieCut = tw.index;
    }
  }

  if (!isSeries) {
    const dm = norm.match(DATE_RE);
    if (dm) {
      isSeries = true;
      const d = mkDate(dm[1], dm[2], dm[3]);
      if (d) { airDate = d; airDates = [d]; }
      serieCut = dm.index;
    } else {
      const dm2 = norm.match(DATE_MDY);
      if (dm2) {
        isSeries = true;
        const a = mkDate(dm2[3], dm2[1], dm2[2]);
        const b = mkDate(dm2[3], dm2[2], dm2[1]);
        airDates = [a, b].filter(Boolean);
        airDate  = airDates[0] || null;
        serieCut = dm2.index;
      }
    }
  }

  let animeEp = null;
  if (!isSeries || episode === null) {
    const ae = norm.match(ANIME_EP_RE);
    if (ae) {
      if (!isSeries) { isSeries = true; serieCut = ae.index; }
      animeEp = parseInt(ae[1], 10);
    } else if (!isSeries) {
      const ae2 = norm.match(ANIME_EP2_RE);
      if (ae2) { isSeries = true; animeEp = parseInt(ae2[2], 10); serieCut = ae2[1].length; }
    }
  }

  const isAnime = isAnimeGroup || hasCJK || (isSeries && animeEp !== null);

  let techCut = norm.length;
  for (const re of TECH) {
    const m = norm.match(re);
    if (m && m.index < techCut) techCut = m.index;
  }

  const ym = norm.match(YEAR_RE);
  let year = null;
  if (ym) { year = parseInt(ym[1], 10); if (ym.index < techCut) techCut = ym.index; }

  const cutindex = Math.min(serieCut, techCut);
  let title = norm.substring(0, cutindex);

  title = title.replace(/\s*\([^)]*\)/g, '');
  title = title.replace(/\s*\[[^\]]*\]/g, '');
  title = title.replace(/\s*[-–]\s*(?:\d+[aªº°]\s*)?(?:temporada|season).*$/i, '');
  title = title.replace(/\s+\d+(?:st|nd|rd|th)\s+season.*$/i, '');
  title = title.replace(/[\s([{]+$/, '').trim();
  title = title.replace(/\s*[-–]\s*\d+\s*$/, '');
  title = title.replace(/[\s\-–]+$/, '').trim();
  title = title.replace(/\s{2,}/g, ' ').trim();

  if (!title || title.length < 2) return null;

  title = title.split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return { title, year, isSeries, isAnime, season, episode: episode ?? animeEp, episodeEnd, airDate, airDates };
}

module.exports = { guessMediaInfo };
