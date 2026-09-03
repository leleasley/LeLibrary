// ── LeLibrary's Nuvio Fusion badge pack ───────────────────────────────────
// Nuvio imports this JSON, then applies the regular expressions to addon
// stream text. Images are generated locally from this stable definition so
// self-hosted installs never depend on a third-party artwork CDN.

const GROUPS = [
  ['resolution', 'Resolution'], ['source', 'Source'], ['edition', 'Edition'],
  ['visual', 'Visual'], ['audio', 'Audio'], ['channels', 'Channels'],
  ['codec', 'Codec'], ['language', 'Language'],
];

// Bump whenever badge artwork or labels change: Nuvio caches badge images by
// URL, so the ?v= query in the manifest is what pulls fresh art onto devices.
const ART_VERSION = 2;

// Order is intentional: Nuvio displays the first match for each group.
// Labels stay short (like the community packs) so the text stays legible at
// badge size. Patterns use exclusions so a stronger signal always wins: a
// REMUX never also shows BluRay, DV suppresses HDR, 4K suppresses 720p.
const BADGES = [
  ['res-4k', 'resolution', '4K', '(?i)^(?=.*(?:2160p|\\b4k\\b|uhd))(?!.*(?:1080p|720p))', '#FF1769AA'],
  ['res-2k', 'resolution', '2K', '(?i)\\b(1440p|2k|qhd)\\b', '#FF2E8B57'],
  ['res-1080p', 'resolution', '1080p', '(?i)\\b1080p\\b', '#FF3C6EBD'],
  ['res-720p', 'resolution', '720p', '(?i)\\b720p\\b', '#FF607D8B'],
  ['source-remux', 'source', 'REMUX', '(?i)\\bremux\\b', '#FFB7791F'],
  ['source-bluray', 'source', 'BluRay', '(?i)^(?=.*\\b(?:blu[ .-]?ray|bdrip)\\b)(?!.*\\bremux\\b)', '#FF2D7D46'],
  ['source-webdl', 'source', 'WEB-DL', '(?i)\\bweb[ .-]?dl\\b', '#FF4C51BF'],
  ['source-webrip', 'source', 'WEBRip', '(?i)\\bweb[ .-]?rip\\b', '#FF596275'],
  ['source-hdtv', 'source', 'HDTV', '(?i)\\bhdtv\\b', '#FF617283'],
  ['source-dvdrip', 'source', 'DVD', '(?i)\\bdvd(?:rip)?\\b', '#FF6C4B3E'],
  ['source-cam', 'source', 'CAM', '(?i)\\b(cam|ts|tc)\\b', '#FFB23A48'],
  ['edition-imax', 'edition', 'IMAX', '(?i)\\bimax(?:[ .-]?enhanced)?\\b', '#FF5A3D93'],
  ['edition-extended', 'edition', 'EXTENDED', '(?i)\\bextended\\b', '#FF805AD5'],
  ['edition-criterion', 'edition', 'CRITERION', '(?i)\\bcriterion\\b', '#FFB35C1E'],
  ['edition-remastered', 'edition', 'REMASTER', '(?i)\\bremaster(?:ed)?\\b', '#FF737A85'],
  ['visual-dv', 'visual', 'DV', '(?i)\\b(dolby[ .-]?vision|dovi|dv)\\b', '#FF8352B8'],
  ['visual-hdr10plus', 'visual', 'HDR10+', '(?i)^(?!.*\\b(?:dolby[ .-]?vision|dovi|dv)\\b)(?=.*\\bhdr10(?:\\+|plus)\\b)', '#FFEE8D22'],
  ['visual-hdr10', 'visual', 'HDR10', '(?i)^(?!.*\\b(?:dolby[ .-]?vision|dovi|dv)\\b)(?=.*\\bhdr10\\b)', '#FFE26B35'],
  ['visual-hdr', 'visual', 'HDR', '(?i)^(?!.*\\b(?:dolby[ .-]?vision|dovi|dv)\\b)(?=.*\\bhdr\\b)', '#FFCD4B5A'],
  ['visual-10bit', 'visual', '10-BIT', '(?i)\\b10[ .-]?bit\\b', '#FF418C9C'],
  ['audio-atmos-truehd', 'audio', 'ATMOS', '(?i)\\b(atmos.*truehd|truehd.*atmos)\\b', '#FF2B8A6E'],
  ['audio-atmos', 'audio', 'ATMOS', '(?i)\\batmos\\b', '#FF3084A9'],
  ['audio-truehd', 'audio', 'TRUEHD', '(?i)\\btruehd\\b', '#FF327C8F'],
  ['audio-dtsx', 'audio', 'DTS:X', '(?i)\\bdts[ .-]?x\\b', '#FFB95454'],
  ['audio-dtshd', 'audio', 'DTS-HD', '(?i)\\bdts[ .-]?hd(?:[ .-]?ma)?\\b', '#FF9B4D5A'],
  ['audio-ddplus', 'audio', 'DD+', '(?i)\\bdd(?:\\+|p)?(?=\\d|\\b)|\\beac3\\b', '#FF6D5AB4'],
  ['audio-aac', 'audio', 'AAC', '(?i)\\baac\\b', '#FF7D8794'],
  ['ch-71', 'channels', '7.1', '(?i)(?<!\\d)7[ .]1\\b', '#FF246B9A'],
  ['ch-51', 'channels', '5.1', '(?i)(?<!\\d)5[ .]1\\b', '#FF387E72'],
  ['ch-20', 'channels', '2.0', '(?i)(?<!\\d)2[ .]0\\b', '#FF6F7784'],
  ['codec-av1', 'codec', 'AV1', '(?i)\\bav1\\b', '#FF9150A8'],
  ['codec-hevc', 'codec', 'HEVC', '(?i)\\b(hevc|h[ .]?265|x265)\\b', '#FF30805C'],
  ['codec-avc', 'codec', 'AVC', '(?i)\\b(avc|h[ .]?264|x264)\\b', '#FF516A9E'],
  ['lang-multi', 'language', 'MULTI', '(?i)\\b(multi|dual[ .-]?audio)\\b', '#FF69798A'],
  ['lang-en', 'language', 'EN', '(?i)\\b(english|eng)\\b', '#FF4A77B5'],
  ['lang-pt', 'language', 'PT', '(?i)\\b(portuguese|pt[ .-]?br|pt[ .-]?pt)\\b', '#FF2E915B'],
  ['lang-es', 'language', 'ES', '(?i)\\b(spanish|espanol|esp)\\b', '#FFB55348'],
];

const byId = new Map(BADGES.map((row) => [row[0], row]));
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[c]); }
// Badge colors are stored Nuvio-style (AARRGGBB). SVG renderers read 8-digit
// hex as RRGGBBAA instead, which would tint every badge wrong — strip the
// alpha prefix down to plain RGB for raster output.
function svgColor(value) {
  const raw = String(value || '').trim();
  return /^#[0-9a-fA-F]{8}$/.test(raw) ? `#${raw.slice(3)}` : raw;
}
function badgeSvg(id) {
  const row = byId.get(id);
  if (!row) return null;
  const [, , label, , color] = row;
  const fill = svgColor(color);
  // Labels are short by design; keep the type large so it stays readable at
  // the ~20dp height Nuvio renders badge chips.
  const fontSize = label.length > 8 ? 30 : label.length > 5 ? 36 : 42;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="76" viewBox="0 0 300 76"><rect width="300" height="76" rx="14" fill="#121820"/><rect x="2" y="2" width="296" height="72" rx="12" fill="${fill}" fill-opacity=".92"/><rect x="4" y="4" width="292" height="68" rx="10" fill="#071016" fill-opacity=".20"/><text x="150" y="48" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="800" text-anchor="middle">${escapeXml(label)}</text></svg>`;
}
function manifest(baseUrl) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  return {
    groups: GROUPS.map(([id, name]) => ({ id, name, color: '#FF17212B', isExpanded: true })),
    filters: BADGES.map(([id, groupId, name, pattern, tagColor]) => ({
      // PNG: Nuvio's badge image loader has no SVG decoder, so SVG badges
      // decode to empty black chips. PNG renders everywhere. The ?v= query
      // busts Nuvio's on-device image cache whenever the artwork changes —
      // bump ART_VERSION with any visual/label edit or apps keep the old art.
      id, groupId, name, pattern, imageURL: `${root}/api/nuvio-badges/lelibrary-premium/${id}.png?v=${ART_VERSION}`,
      tagColor, borderColor: '#FFFFFFFF', textColor: '#FFFFFFFF', tagStyle: 'image', isEnabled: true,
    })),
  };
}
module.exports = { BADGES, GROUPS, ART_VERSION, badgeSvg, svgColor, manifest };
