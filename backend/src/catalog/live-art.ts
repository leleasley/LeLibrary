// Live folder covers: drawn by the server from the folder's current titles.
//
// Trending, charts, streaming services and other "what's on now" folders get
// one fixed link (/art/folder/<folderId>.jpg). The picture is rebuilt here
// from the folder's current catalogue rows (the shared catalogue cache, so
// this adds no TMDB traffic beyond the posters) and the folder's fixed layers
// (title, marks, gradients) exported by promo/collection-art/live_export.py.
// The maths below mirrors that renderer (mosaic placement, gradient map,
// brand pool, vignette, grain), so a Live cover looks like every other cover.
//
// A fingerprint of exactly what is drawn (layout version, the TMDB image
// paths, the layer file) is the ETag: same titles, same bytes, a device asking
// again gets 304. New titles, new fingerprint, drawn once and cached.
//
// Uses the server's own TMDB key (ART_TMDB_API_KEY, else the hosted Releases
// key), never a user's. No key, no layers or no rows: the fixed snapshot.
import type { Sharp, SharpOptions } from 'sharp';

type SharpFactory = (input?: Buffer | SharpOptions, options?: SharpOptions) => Sharp;
type Vec3 = [number, number, number];
type Stops = [number, Vec3][];
type Img = Float32Array; // W*H*3, 0..1
interface Row { poster?: unknown; background?: unknown; [key: string]: unknown }

const fs = require('fs') as typeof import('fs');
const crypto = require('node:crypto') as typeof import('node:crypto');

const W = 1280;
const H = 720;
const RENDER_VERSION = 1; // bump when the drawing below changes
const ROW_SOURCES = 3;
const MAX_ROWS = 30;

let sharpModule: SharpFactory | null | undefined;
function loadSharp(): SharpFactory | null {
  if (sharpModule === undefined) {
    try { sharpModule = require('sharp') as SharpFactory; } catch { sharpModule = null; }
  }
  return sharpModule ?? null;
}

// ── Pixel maths (mirrors promo/collection-art/render.py) ──────────────────

const LR = 0.2126, LG = 0.7152, LB = 0.0722;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function fill(color: Vec3): Img {
  const a = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { a[i * 3] = color[0]; a[i * 3 + 1] = color[1]; a[i * 3 + 2] = color[2]; }
  return a;
}

function contrast(a: Img, k: number, pivot = 0.45): void {
  for (let i = 0; i < a.length; i++) a[i] = clamp01(((a[i] as number) - pivot) * k + pivot);
}

function saturate(a: Img, s: number): void {
  for (let i = 0; i < a.length; i += 3) {
    const L = (a[i] as number) * LR + (a[i + 1] as number) * LG + (a[i + 2] as number) * LB;
    for (let c = 0; c < 3; c++) a[i + c] = clamp01(L + ((a[i + c] as number) - L) * s);
  }
}

function interp(L: number, stops: Stops, c: number): number {
  const first = stops[0] as [number, Vec3];
  if (L <= first[0]) return first[1][c] as number;
  for (let s = 1; s < stops.length; s++) {
    const [p1, c1] = stops[s] as [number, Vec3];
    const [p0, c0] = stops[s - 1] as [number, Vec3];
    if (L <= p1) {
      const t = p1 === p0 ? 0 : (L - p0) / (p1 - p0);
      return (c0[c] as number) + ((c1[c] as number) - (c0[c] as number)) * t;
    }
  }
  return (stops[stops.length - 1] as [number, Vec3])[1][c] as number;
}

function gradientMap(a: Img, stops: Stops, amount: number, gamma = 1): void {
  for (let i = 0; i < a.length; i += 3) {
    const L = clamp01((a[i] as number) * LR + (a[i + 1] as number) * LG + (a[i + 2] as number) * LB) ** gamma;
    for (let c = 0; c < 3; c++) a[i + c] = (a[i + c] as number) * (1 - amount) + interp(L, stops, c) * amount;
  }
}

function scale(a: Img, k: number): void { for (let i = 0; i < a.length; i++) a[i] = (a[i] as number) * k; }

function radial(x: number, y: number, cx: number, cy: number, rx: number, ry: number, power: number): number {
  const d = Math.sqrt(((x / W - cx) / rx) ** 2 + ((y / H - cy) / ry) ** 2);
  return clamp01(1 - d) ** power;
}

function expose(a: Img, target: number, cap = 2): void {
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) sum += (a[i] as number) * LR + (a[i + 1] as number) * LG + (a[i + 2] as number) * LB;
  const m = sum / (W * H);
  if (m >= target) return;
  const g = Math.min(cap, target / Math.max(m, 1e-3));
  const e = 1 / Math.sqrt(g);
  for (let i = 0; i < a.length; i++) {
    const v = a[i] as number;
    a[i] = clamp01(v * g) * 0.85 + clamp01(Math.max(v, 0) ** e) * 0.15;
  }
}

// Seeded normal noise (mulberry32 + Box-Muller): film grain, strongest in the mids.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

interface Finish { vignette?: number; grain?: number; leak?: number[] | null }

function finish(a: Img, seed: number, spec: Finish): void {
  const leak = Array.isArray(spec.leak) && spec.leak.length === 6 ? spec.leak : null;
  const vig = typeof spec.vignette === 'number' ? spec.vignette : 0.42;
  const grain = typeof spec.grain === 'number' ? spec.grain : 0.022;
  const rand = rng(seed);
  const hw = (W >> 1) + 1;
  const half = new Float32Array(hw * ((H >> 1) + 1));
  for (let i = 0; i < half.length; i++) half[i] = normal(rand);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (leak) {
        const m = radial(x, y, leak[3] as number, leak[4] as number, 0.55, 0.9, 1.6) * (leak[5] as number);
        for (let c = 0; c < 3; c++) a[i + c] = 1 - (1 - (a[i + c] as number)) * (1 - (leak[c] as number) * m);
      }
      const v = 1 - vig * clamp01(((x / W - 0.5) / 0.72) ** 2 + ((y / H - 0.5) / 0.78) ** 2) ** 1.3;
      let L = 0;
      for (let c = 0; c < 3; c++) { a[i + c] = (a[i + c] as number) * v; }
      L = clamp01((a[i] as number) * LR + (a[i + 1] as number) * LG + (a[i + 2] as number) * LB);
      const g = ((half[(y >> 1) * hw + (x >> 1)] as number) * 0.6 + normal(rand) * 0.4) * grain * (0.55 + 0.9 * L * (1 - L) * 2);
      for (let c = 0; c < 3; c++) a[i + c] = clamp01((a[i + c] as number) + g);
    }
  }
}

// ── Images ───────────────────────────────────────────────────────────────

async function toImg(sharp: SharpFactory, buf: Buffer, w: number, h: number): Promise<Img> {
  const raw = await sharp(buf).removeAlpha().resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const out = new Float32Array(w * h * 3);
  for (let i = 0; i < out.length; i++) out[i] = (raw[i] as number) / 255;
  return out;
}

// render.py cover(): scale to cover, crop at (fx, fy).
async function coverImg(sharp: SharpFactory, buf: Buffer, fx: number, fy: number): Promise<Img> {
  const meta = await sharp(buf).metadata();
  const iw = meta.width || W, ih = meta.height || H;
  const s = Math.max(W / iw, H / ih);
  const nw = Math.max(W, Math.round(iw * s)), nh = Math.max(H, Math.round(ih * s));
  const raw = await sharp(buf).removeAlpha().resize(nw, nh, { fit: 'fill', kernel: 'lanczos3' })
    .extract({ left: Math.trunc((nw - W) * fx), top: Math.trunc((nh - H) * fy), width: W, height: H }).raw().toBuffer();
  const out = new Float32Array(W * H * 3);
  for (let i = 0; i < out.length; i++) out[i] = (raw[i] as number) / 255;
  return out;
}

function paste(a: Img, tile: Img, tw: number, th: number, x: number, y: number, mask?: Float32Array): void {
  for (let ty = 0; ty < th; ty++) {
    const yy = y + ty;
    if (yy < 0 || yy >= H) continue;
    for (let tx = 0; tx < tw; tx++) {
      const xx = x + tx;
      if (xx < 0 || xx >= W) continue;
      const al = mask ? (mask[ty * tw + tx] as number) : 1;
      if (al <= 0) continue;
      const i = (yy * W + xx) * 3, j = (ty * tw + tx) * 3;
      for (let c = 0; c < 3; c++) a[i + c] = (a[i + c] as number) * (1 - al) + (tile[j + c] as number) * al;
    }
  }
}

// render.py mosaic(): staggered poster wall, slightly over-scanned.
async function mosaic(sharp: SharpFactory, posters: Buffer[], cols: number, gap: number, base: Img): Promise<Img> {
  const pw = (W + gap) / cols - gap;
  const ph = pw * 1.5;
  const tw = Math.trunc(pw), th = Math.trunc(ph);
  const tiles: Img[] = [];
  for (const p of posters) { try { tiles.push(await toImg(sharp, p, tw, th)); } catch { /* skip */ } }
  if (!tiles.length) return base;
  const a = new Float32Array(W * H * 3);
  let k = 0;
  for (let c = 0; c <= cols; c++) {
    const x = Math.trunc(c * (pw + gap) - pw * 0.35);
    let y = -Math.trunc(ph * (0.15 + 0.45 * ((c * 0.37) % 1)));
    while (y < H) {
      paste(a, tiles[k % tiles.length] as Img, tw, th, x, y);
      k++;
      y += Math.trunc(ph + gap);
    }
  }
  return a;
}

function roundedMask(w: number, h: number, r: number): Float32Array {
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x < r ? r - x - 0.5 : x >= w - r ? x - (w - r) + 0.5 : 0;
    const dy = y < r ? r - y - 0.5 : y >= h - r ? y - (h - r) + 0.5 : 0;
    const d = dx && dy ? Math.sqrt(dx * dx + dy * dy) : 0;
    m[y * w + x] = d ? clamp01(r - d + 0.5) : 1;
  }
  return m;
}

async function layer(sharp: SharpFactory, a: Img, file: string): Promise<void> {
  const raw = await sharp(fs.readFileSync(file)).ensureAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer();
  for (let p = 0; p < W * H; p++) {
    const al = (raw[p * 4 + 3] as number) / 255;
    if (!al) continue;
    for (let c = 0; c < 3; c++) a[p * 3 + c] = (a[p * 3 + c] as number) * (1 - al) + ((raw[p * 4 + c] as number) / 255) * al;
  }
}

function vec(v: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number') ? v as Vec3 : fallback;
}
function stopsOf(v: unknown): Stops {
  const out = (Array.isArray(v) ? v : []).filter((s) => Array.isArray(s) && typeof s[0] === 'number').map((s) => [s[0], vec(s[1])] as [number, Vec3]);
  return out.length ? out : [[0, [0, 0, 0]], [1, [1, 1, 1]]];
}
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ── Drawing one cover ────────────────────────────────────────────────────

export interface LiveInputs { posters: Buffer[]; backdrop: Buffer | null }

async function drawLive(spec: Record<string, unknown>, inputs: LiveInputs, layers: { over: string; under?: string }, seed: number, sharpFactory?: SharpFactory | null): Promise<Buffer | null> {
  const sharp = sharpFactory === undefined ? loadSharp() : sharpFactory;
  if (!sharp) return null;
  const layout = spec['layout'];
  let a: Img;
  if (layout === 'brand') {
    const field = vec(spec['field']), edge = vec(spec['edge']), hi = vec(spec['hi']);
    const posters = inputs.posters.slice(0, num(spec['posters'], 10));
    if (posters.length) {
      a = await mosaic(sharp, posters, num(spec['cols'], 8), num(spec['gap'], 8), fill(field));
      gradientMap(a, [[0, [edge[0] * 0.5, edge[1] * 0.5, edge[2] * 0.5]], [0.6, field], [1, hi]], 1);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        const dim = 1 - 0.45 * radial(x, y, 0.5, 0.46, 0.42, 0.42, 1.2);
        for (let c = 0; c < 3; c++) a[i + c] = ((a[i + c] as number) * 0.45 + field[c] * 0.55) * dim;
      }
    } else {
      a = fill(field);
    }
    const lift = vec(spec['brandLift']);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const pool = radial(x, y, 0.5, 0.46, 0.75, 1.05, 1.4);
      const add = posters.length ? 0 : radial(x, y, 0.5, 0.5, 0.6, 0.9, 1.8);
      for (let c = 0; c < 3; c++) a[i + c] = (a[i + c] as number) * (0.35 + 0.65 * pool) + edge[c] * (1 - pool) * 0.6 + lift[c] * add;
    }
  } else if (layout === 'wall') {
    const posters = inputs.posters.slice(0, num(spec['posters'], 14));
    a = posters.length ? await mosaic(sharp, posters, num(spec['cols'], 7), num(spec['gap'], 10), fill(vec(spec['empty']))) : fill(vec(spec['empty']));
    if (posters.length) {
      contrast(a, num(spec['contrast'], 1.04));
      gradientMap(a, stopsOf(spec['stops']), num(spec['amount'], 0.42));
      saturate(a, num(spec['saturate'], 1));
    }
    scale(a, num(spec['mult'], 1));
  } else if (layout === 'top3') {
    if (inputs.backdrop) {
      a = await coverImg(sharp, inputs.backdrop, num(spec['fx'], 0.5), num(spec['fy'], 0.4));
      contrast(a, num(spec['contrast'], 1.05));
      gradientMap(a, stopsOf(spec['stops']), num(spec['amount'], 0.85));
      scale(a, num(spec['mult'], 0.72));
      const u8 = Buffer.alloc(W * H * 3);
      for (let i = 0; i < u8.length; i++) u8[i] = Math.round(clamp01(a[i] as number) * 255);
      const blurred = await sharp(u8, { raw: { width: W, height: H, channels: 3 } }).blur(num(spec['blur'], 10)).raw().toBuffer();
      for (let i = 0; i < a.length; i++) a[i] = (blurred[i] as number) / 255;
    } else {
      a = fill(vec(spec['empty']));
    }
    if (layers.under) await layer(sharp, a, layers.under);
    const slots = Array.isArray(spec['slots']) ? spec['slots'] as number[][] : [];
    const radius = num(spec['radius'], 10);
    for (let s = 0; s < slots.length && s < inputs.posters.length; s++) {
      const [x, y, w, h] = slots[s] as number[];
      if (![x, y, w, h].every((n) => typeof n === 'number')) continue;
      try {
        const tile = await toImg(sharp, inputs.posters[s] as Buffer, w as number, h as number);
        paste(a, tile, w as number, h as number, x as number, y as number, roundedMask(w as number, h as number, radius));
      } catch { /* empty slot */ }
    }
  } else if (layout === 'still') {
    if (inputs.backdrop) {
      a = await coverImg(sharp, inputs.backdrop, num(spec['fx'], 0.5), num(spec['fy'], 0.38));
      contrast(a, num(spec['contrast'], 1.1));
      gradientMap(a, stopsOf(spec['stops']), num(spec['amount'], 0.82), num(spec['gamma'], 0.95));
    } else {
      const sh = vec(spec['empty']), mid = vec(spec['emptyMid']);
      a = new Float32Array(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const m = radial(x, y, 0.72, 0.35, 0.8, 1.1, 1.6);
        for (let c = 0; c < 3; c++) a[(y * W + x) * 3 + c] = sh[c] * (1 - m) + mid[c] * m;
      }
    }
    expose(a, num(spec['expose'], 0.17));
  } else {
    return null;
  }
  await layer(sharp, a, layers.over);
  finish(a, seed, spec as Finish);
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp01(a[i] as number) * 255);
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 86, progressive: true, mozjpeg: true }).toBuffer();
}

// ── Inputs from the folder's current rows ─────────────────────────────────

function needsBackdrop(spec: Record<string, unknown>): boolean { return spec['layout'] === 'top3' || spec['layout'] === 'still'; }
function posterCount(spec: Record<string, unknown>): number {
  return num(spec['posters'], spec['layout'] === 'top3' ? 3 : spec['layout'] === 'still' ? 0 : 10);
}

// TMDB image paths the cover will show, in render.py order: the rows of the
// folder's first sources, de-duplicated.
function pickPaths(rows: Row[], spec: Record<string, unknown>): { posters: string[]; backdrop: string } {
  const { tmdbPathFromImageUrl } = require('./generated-covers.ts') as { tmdbPathFromImageUrl: (v: unknown) => string };
  const posters: string[] = [];
  let backdrop = '';
  const want = posterCount(spec);
  for (const row of rows) {
    const p = tmdbPathFromImageUrl(row.poster);
    if (p && posters.length < want && !posters.includes(p)) posters.push(p);
    if (!backdrop && needsBackdrop(spec)) backdrop = tmdbPathFromImageUrl(row.background);
  }
  return { posters, backdrop };
}

function fingerprint(folderId: string, spec: Record<string, unknown>, paths: { posters: string[]; backdrop: string }, layerStamp: string): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify([RENDER_VERSION, folderId, spec['version'], spec['layout'], paths.posters, paths.backdrop, layerStamp]))
    .digest('hex').slice(0, 20);
}

function seedOf(folderId: string): number {
  return parseInt(crypto.createHash('sha1').update(folderId).digest('hex').slice(0, 8), 16);
}

export interface LiveArtApi {
  drawLive: typeof drawLive;
  pickPaths: typeof pickPaths;
  fingerprint: typeof fingerprint;
  seedOf: typeof seedOf;
  needsBackdrop: typeof needsBackdrop;
  ROW_SOURCES: number;
  MAX_ROWS: number;
  RENDER_VERSION: number;
}

module.exports = { drawLive, pickPaths, fingerprint, seedOf, needsBackdrop, ROW_SOURCES, MAX_ROWS, RENDER_VERSION } satisfies LiveArtApi;
