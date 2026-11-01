import type { Layer } from "@/lib/gerber/types";
import { decodeBlock } from "./ocr";

export type TextLayerKind = "top_silk" | "bottom_silk" | "top_copper" | "bottom_copper";

/** A cluster of strokes that looks like a word/label (designator, name, logo text), on silk or copper. */
export interface SilkBlock {
  idx: number;
  layer: TextLayerKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Character height in mm (short side of the word box, or the char box for a single glyph). */
  textHeight: number;
  /** Median stroke width in mm. */
  stroke: number;
  vertical: boolean;
  chars: number;
  segs: number;
  /** Local vector pre-OCR result (no AI): decoded text, mean glyph confidence and mirror verdict. */
  decoded?: string;
  decodeConfidence?: number;
  /** true = text written mirrored; false = definitely not mirrored; null = cannot decide. */
  mirrored?: boolean | null;
}

type Seg = { x1: number; y1: number; x2: number; y2: number; w: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number; segs: Seg[] };

const MAX_SEG = 3; // longer lines are footprint outlines, not glyph strokes
const MAX_SEGS = 20000;

function uf(n: number) {
  const p = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (p[i] === i ? i : (p[i] = find(p[i]!)));
  return { find, union: (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; } };
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : 0; };

/** Groups strokes into glyphs (connected strokes) and glyphs into words (aligned, similar height, small gap). Works on silk and copper layers. */
export function extractTextBlocks(layer: Layer | undefined): SilkBlock[] {
  if (!layer || (layer.kind !== "top_silk" && layer.kind !== "bottom_silk" && layer.kind !== "top_copper" && layer.kind !== "bottom_copper")) return [];
  const segs: Seg[] = [];
  for (const p of layer.primitives) {
    if (p.clear || p.t !== "line") continue;
    const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    if (len > MAX_SEG || p.w > 0.6) continue;
    segs.push(p);
    if (segs.length >= MAX_SEGS) break;
  }
  if (!segs.length) return [];

  // 1) glyphs: strokes whose endpoints touch
  const cell = 0.5;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  segs.forEach((s, i) => {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as const) {
      const k = key(x, y);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
  });
  const u = uf(segs.length);
  segs.forEach((s, i) => {
    const link = Math.max(0.12, s.w * 1.2);
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as const) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (j <= i) continue;
            const t = segs[j]!;
            if (Math.hypot(t.x1 - x, t.y1 - y) < link || Math.hypot(t.x2 - x, t.y2 - y) < link) u.union(i, j);
          }
    }
  });
  const glyphMap = new Map<number, Box>();
  segs.forEach((s, i) => {
    const r = u.find(i);
    const b = glyphMap.get(r) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, segs: [] };
    b.minX = Math.min(b.minX, s.x1, s.x2); b.maxX = Math.max(b.maxX, s.x1, s.x2);
    b.minY = Math.min(b.minY, s.y1, s.y2); b.maxY = Math.max(b.maxY, s.y1, s.y2);
    b.segs.push(s);
    glyphMap.set(r, b);
  });
  // keep glyph-sized clusters; drop rings (component circles) and big footprint shapes
  const glyphs = [...glyphMap.values()].filter((g) => {
    const w = g.maxX - g.minX, h = g.maxY - g.minY, big = Math.max(w, h);
    if (big < 0.25 || big > 5) return false;
    if (g.segs.length >= 16 && big > 1.8 && Math.min(w, h) / big > 0.85) return false; // circle outline
    return true;
  }).slice(0, 3000);

  // 2) words: glyphs of similar size placed next to each other
  const gu = uf(glyphs.length);
  for (let i = 0; i < glyphs.length; i++) {
    const a = glyphs[i]!;
    const ha = Math.max(a.maxX - a.minX, a.maxY - a.minY);
    for (let j = i + 1; j < glyphs.length; j++) {
      const b = glyphs[j]!;
      const hb = Math.max(b.maxX - b.minX, b.maxY - b.minY);
      if (Math.min(ha, hb) / Math.max(ha, hb) < 0.45) continue;
      const gap = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX)) + Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      if (gap < 0.7 * Math.max(ha, hb)) gu.union(i, j);
    }
  }
  const words = new Map<number, Box[]>();
  glyphs.forEach((g, i) => { const r = gu.find(i); (words.get(r) ?? words.set(r, []).get(r)!).push(g); });

  const out: SilkBlock[] = [];
  for (const gs of words.values()) {
    const minX = Math.min(...gs.map((g) => g.minX)), maxX = Math.max(...gs.map((g) => g.maxX));
    const minY = Math.min(...gs.map((g) => g.minY)), maxY = Math.max(...gs.map((g) => g.maxY));
    const w = maxX - minX, h = maxY - minY;
    const all = gs.flatMap((g) => g.segs);
    if (gs.length === 1 && all.length < 2) continue; // single stroke = mark/line, not text
    const vertical = gs.length > 1 ? h > w : false;
    const textHeight = gs.length > 1 ? Math.min(w, h) : Math.max(w, h);
    const stroke = median(all.map((s) => s.w));
    // Local vector pre-OCR: decode glyphs and vote the mirror verdict (asymmetric glyphs only).
    const dec = gs.length <= 60 ? decodeBlock(gs.map((g) => g.segs)) : null;
    out.push({
      idx: 0, layer: layer.kind as TextLayerKind, x: +((minX + maxX) / 2).toFixed(3), y: +((minY + maxY) / 2).toFixed(3),
      w: +w.toFixed(3), h: +h.toFixed(3), textHeight: +(textHeight + stroke).toFixed(3), stroke: +stroke.toFixed(3),
      vertical, chars: gs.length, segs: all.length,
      ...(dec && dec.matched ? { decoded: dec.text, decodeConfidence: dec.confidence, mirrored: dec.mirrored } : {}),
    });
  }
  out.sort((a, b) => b.y - a.y || a.x - b.x);
  out.forEach((b, i) => (b.idx = i));
  return out;
}

/** Collects the strokes inside a block (for rendering to an image). */
export function blockSegments(layer: Layer, b: SilkBlock): Seg[] {
  const pad = 0.2;
  const res: Seg[] = [];
  for (const p of layer.primitives) {
    if (p.clear || p.t !== "line") continue;
    if (Math.min(p.x1, p.x2) >= b.x - b.w / 2 - pad && Math.max(p.x1, p.x2) <= b.x + b.w / 2 + pad && Math.min(p.y1, p.y2) >= b.y - b.h / 2 - pad && Math.max(p.y1, p.y2) <= b.y + b.h / 2 + pad) res.push(p);
  }
  return res;
}

/**
 * Renders text blocks into one labelled contact sheet (browser only): each block is drawn black-on-white,
 * rotated horizontal, and mirrored for bottom silk so it reads normally. Returns a PNG data URL.
 */
export function renderBlocksSheet(layers: Layer[], blocks: SilkBlock[], max = 60): string | null {
  if (typeof document === "undefined" || !blocks.length) return null;
  const list = blocks.slice(0, max);
  const rowH = 70, colW = 360, cols = 3;
  const canvas = document.createElement("canvas");
  canvas.width = colW * cols;
  canvas.height = rowH * Math.ceil(list.length / cols);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  list.forEach((b, i) => {
    const layer = layers.find((l) => l.kind === b.layer);
    if (!layer) return;
    const ox = (i % cols) * colW, oy = Math.floor(i / cols) * rowH;
    ctx.fillStyle = "#c00"; ctx.font = "bold 14px sans-serif"; ctx.fillText(`#${b.idx}`, ox + 4, oy + 16);
    const len = b.vertical ? b.h : b.w, thick = b.vertical ? b.w : b.h;
    const s = Math.min((colW - 50) / Math.max(len, 0.1), (rowH - 14) / Math.max(thick, 0.1));
    ctx.save();
    ctx.translate(ox + 44 + (colW - 50) / 2, oy + rowH / 2);
    if (b.vertical) ctx.rotate(Math.PI / 2);
    ctx.scale(b.layer === "bottom_silk" ? -s : s, -s);
    ctx.strokeStyle = "#000"; ctx.lineCap = "round";
    for (const sg of blockSegments(layer, b)) {
      ctx.lineWidth = Math.max(sg.w, 1.2 / s);
      ctx.beginPath(); ctx.moveTo(sg.x1 - b.x, sg.y1 - b.y); ctx.lineTo(sg.x2 - b.x, sg.y2 - b.y); ctx.stroke();
    }
    ctx.restore();
  });
  return canvas.toDataURL("image/png");
}

/** Normalizes for fuzzy matching: lowercase, no diacritics, alnum only. */
export const normText = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
