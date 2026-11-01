/**
 * Local vector pre-OCR for Gerber stroke text (no AI cost).
 * Each glyph's segments are rasterized onto a small grid and matched against a 5×7
 * stroke-font template set, both normal and horizontally flipped — the flip score
 * decides whether the text is mirrored, using only left/right-asymmetric glyphs.
 */

export type Seg = { x1: number; y1: number; x2: number; y2: number; w: number };

/** 5×7 bitmaps, row 0 = top. */
const T: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

/** Glyphs whose mirrored form is visually distinct (left/right asymmetry). Only these vote on mirroring. */
export const ASYMMETRIC_GLYPHS = new Set(["B", "C", "D", "E", "F", "G", "J", "K", "L", "P", "R", "S", "Z", "2", "3", "4", "5", "6", "7", "9"]);

const GW = 8, GH = 12;

type Grid = Float32Array;

function templateGrid(rows: string[], flip: boolean): Grid {
  const g = new Float32Array(GW * GH);
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++) {
      if (rows[r]![c] !== "1") continue;
      const cc = flip ? 4 - c : c;
      // map 5×7 into GW×GH with 1px margin
      const x0 = Math.round(1 + (cc / 5) * (GW - 2)), y0 = Math.round(1 + (r / 7) * (GH - 2));
      const x1 = Math.round(1 + ((cc + 1) / 5) * (GW - 2)), y1 = Math.round(1 + ((r + 1) / 7) * (GH - 2));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * GW + x] = 1;
    }
  return dilate(g);
}

function dilate(g: Grid): Grid {
  const out = new Float32Array(g);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++)
      if (g[y * GW + x])
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < GW && yy >= 0 && yy < GH) out[yy * GW + xx] = 1;
          }
  return out;
}

const TEMPLATES: { char: string; normal: Grid; flipped: Grid }[] = Object.entries(T).map(([char, rows]) => ({
  char,
  normal: templateGrid(rows, false),
  flipped: templateGrid(rows, true),
}));

/** Rasterizes glyph segments into a GW×GH grid (row 0 = top, Gerber Y-up). */
export function rasterizeGlyph(segs: Seg[]): Grid {
  const g = new Float32Array(GW * GH);
  const minX = Math.min(...segs.map((s) => Math.min(s.x1, s.x2)));
  const maxX = Math.max(...segs.map((s) => Math.max(s.x1, s.x2)));
  const minY = Math.min(...segs.map((s) => Math.min(s.y1, s.y2)));
  const maxY = Math.max(...segs.map((s) => Math.max(s.y1, s.y2)));
  const w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, 1e-6);
  for (const s of segs) {
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const steps = Math.max(2, Math.ceil((len / Math.max(w, h)) * 3 * GW));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = s.x1 + (s.x2 - s.x1) * t, py = s.y1 + (s.y2 - s.y1) * t;
      const gx = Math.min(GW - 1, Math.max(0, Math.round(((px - minX) / w) * (GW - 1))));
      const gy = Math.min(GH - 1, Math.max(0, Math.round(((maxY - py) / h) * (GH - 1)))); // Y-up → row 0 top
      g[gy * GW + gx] = 1;
    }
  }
  return g;
}

function dice(a: Grid, b: Grid): number {
  let inter = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) {
    sa += a[i]!; sb += b[i]!;
    if (a[i] && b[i]) inter++;
  }
  return sa + sb ? (2 * inter) / (sa + sb) : 0;
}

export interface GlyphMatch {
  char: string;
  /** 0..1 similarity of the best orientation. */
  score: number;
  /** true when the horizontally flipped template matched better. */
  mirrored: boolean;
}

/** Matches one glyph against the stroke-font templates. Returns null for non-glyph blobs. */
export function matchGlyph(segs: Seg[]): GlyphMatch | null {
  if (!segs.length) return null;
  const g = rasterizeGlyph(segs);
  let best: GlyphMatch | null = null;
  for (const t of TEMPLATES) {
    const sn = dice(g, t.normal), sf = dice(g, t.flipped);
    const m: GlyphMatch = sn >= sf ? { char: t.char, score: sn, mirrored: false } : { char: t.char, score: sf, mirrored: true };
    if (!best || m.score > best.score) best = m;
  }
  return best && best.score >= 0.42 ? best : null;
}

export interface BlockDecode {
  text: string;
  /** Mean similarity of matched glyphs, 0..1. */
  confidence: number;
  /** null = not enough asymmetric glyphs to decide. */
  mirrored: boolean | null;
  matched: number;
  total: number;
}

/**
 * Decodes a text block from its per-glyph segment lists. The mirror verdict is voted
 * only by confidently matched asymmetric glyphs (E, F, L, P, R, B, C, G, J, K, 2, 3, 5…).
 */
export function decodeBlock(glyphs: Seg[][]): BlockDecode {
  let text = "";
  let scoreSum = 0, matched = 0, votesFor = 0, votesAgainst = 0;
  for (const segs of glyphs) {
    if (segs.length < 1) continue;
    const m = matchGlyph(segs);
    if (!m) {
      text += "·";
      continue;
    }
    matched++;
    scoreSum += m.score;
    text += m.score >= 0.5 ? m.char : m.char.toLowerCase();
    if (m.score >= 0.5 && ASYMMETRIC_GLYPHS.has(m.char)) (m.mirrored ? votesFor++ : votesAgainst++);
  }
  const votes = votesFor + votesAgainst;
  return {
    text,
    confidence: matched ? +(scoreSum / matched).toFixed(3) : 0,
    mirrored: votes >= 1 ? votesFor > votesAgainst : null,
    matched,
    total: glyphs.length,
  };
}
