// Folder hero backdrops: a tilted poster mosaic, dimmed so Nuvio's own title
// and tabs stay readable over it (Nuvio shows heroBackdropUrl behind a
// folder's contents). Drawn by the server from a list of TMDB posters: the
// folder's current titles for Live folders, the franchise's films or the
// folder's timeless titles for the rest (hero-art-service.ts decides which).
//
// Everything here is libvips work (resize, composite, rotate, encode): it runs
// on sharp's thread pool, never on the request loop.
import type { Sharp, SharpOptions } from 'sharp';

type SharpFactory = (input?: Buffer | SharpOptions, options?: SharpOptions) => Sharp;

const OUT_W = 1920;
const OUT_H = 1080;
const TILE_W = 220;
const TILE_H = 330;
const GAP = 22;
const RADIUS = 12;
const COLS = 13;
const ROWS = 8;
const ANGLE = -11; // degrees: the mosaic leans like a shelf seen from the side
const INK = { r: 9, g: 9, b: 12 };
const HERO_VERSION = 1; // bump when the drawing below changes

let sharpModule: SharpFactory | null | undefined;
function loadSharp(): SharpFactory | null {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp') as SharpFactory; } catch { sharpModule = null; }
  }
  return sharpModule ?? null;
}

// Deterministic shuffle (mulberry32), so one folder always lays out the same
// way and repeated posters never sit side by side.
function shuffled<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const roundMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE_W}" height="${TILE_H}"><rect width="${TILE_W}" height="${TILE_H}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`);

// The dimming and edge falloff, drawn over the finished mosaic.
const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}">
  <defs>
    <linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.72"/><stop offset="0.55" stop-color="#000" stop-opacity="0.18"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#06060a" fill-opacity="0.34"/>
  <rect width="100%" height="100%" fill="url(#l)"/>
  <rect width="100%" height="100%" fill="url(#b)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
</svg>`);

async function tile(sharp: SharpFactory, poster: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(poster).resize(TILE_W, TILE_H, { fit: 'cover' })
      .composite([{ input: roundMask, blend: 'dest-in' }]).png().toBuffer();
  } catch {
    return null;
  }
}

// posters: decoded-or-not image buffers (TMDB w342 JPEGs). At least four are
// needed for a mosaic that does not look like wallpaper; fewer returns null.
async function drawHero(posters: Buffer[], seed: number, sharpFactory?: SharpFactory | null): Promise<Buffer | null> {
  const sharp = sharpFactory === undefined ? loadSharp() : sharpFactory;
  if (!sharp) return null;
  const tiles = (await Promise.all(posters.map((p) => tile(sharp, p)))).filter(Boolean) as Buffer[];
  if (tiles.length < 4) return null;
  const width = COLS * (TILE_W + GAP) + GAP;
  const height = ROWS * (TILE_H + GAP) + GAP + TILE_H; // staggered columns run past the bottom
  const order = shuffled(tiles.map((_, i) => i), seed);
  const layers: { input: Buffer; left: number; top: number }[] = [];
  // Walk the shuffled list down each column; the next column starts `stride`
  // further on. Up/down neighbours are consecutive entries and side-by-side
  // ones are `stride` apart, so a poster never sits beside itself (the stride
  // is nudged off any multiple of the list length).
  const perColumn = ROWS + 1;
  let stride = perColumn;
  while (order.length > 1 && (stride % order.length === 0 || stride % order.length === order.length - 1 || stride % order.length === 1)) stride++;
  for (let c = 0; c < COLS; c++) {
    const offset = c % 2 ? Math.round((TILE_H + GAP) / 2) : 0;
    for (let r = 0; r < perColumn; r++) {
      const top = GAP + r * (TILE_H + GAP) - offset;
      if (top < 0 || top >= height) continue; // sharp composites need non-negative offsets
      const index = order[(c * stride + r) % order.length] as number;
      layers.push({ input: tiles[index] as Buffer, left: GAP + c * (TILE_W + GAP), top });
    }
  }
  const wall = await sharp({ create: { width, height, channels: 3, background: INK } })
    .composite(layers).png().toBuffer();
  const turned = await sharp(wall).rotate(ANGLE, { background: INK }).toBuffer({ resolveWithObject: true });
  const left = Math.max(0, Math.round((turned.info.width - OUT_W) / 2));
  const top = Math.max(0, Math.round((turned.info.height - OUT_H) / 2));
  return sharp(turned.data)
    .extract({ left, top, width: Math.min(OUT_W, turned.info.width), height: Math.min(OUT_H, turned.info.height) })
    .resize(OUT_W, OUT_H, { fit: 'cover' })
    .composite([{ input: shade }])
    .jpeg({ quality: 80, progressive: true, mozjpeg: true })
    .toBuffer();
}

export interface HeroArtApi {
  drawHero: typeof drawHero;
  HERO_VERSION: number;
  SIZE: { width: number; height: number };
}

module.exports = { drawHero, HERO_VERSION, SIZE: { width: OUT_W, height: OUT_H } } satisfies HeroArtApi;
