import { DEFAULT_SETTINGS, ruleApplies, type Settings } from "./settings";
import { CATALOG } from "./catalog";
import { extractTextBlocks, type SilkBlock } from "../silk/extract";
import { layerBBox, outlineBBox, primitiveBBox } from "../gerber/parser";
import type { BBox, Layer, LayerKind, Primitive } from "../gerber/types";

export type Severity = "blocking" | "warning" | "info";
export type Variant = "SMT" | "THT";

export interface DrcIssue {
  code: string;
  title: string;
  severity: Severity;
  message: string;
  x?: number;
  y?: number;
  layer?: LayerKind;
}

export interface RuleResult {
  code: string;
  title: string;
  penalty: number; // applied
  maxPenalty: number;
  count?: number;
  critical?: boolean;
  passed: boolean;
  severity: Severity;
  detail: string;
}

/** Electrical connectivity graph exported after the Union-Find pass (ERR net map). */
export interface NetSummary {
  netId: number;
  name: string;
  primitiveIds: { top_copper: number[]; bottom_copper: number[] };
  holeIds: number[];
  totalLengthMm: number;
  minWidthMm: number | null;
  maxWidthMm: number | null;
  boundingBox: BBox;
  /** R = (ρ_Cu / t) · Σ(L/w), ρ = 1.68e-8 Ω·m, t = 35 µm → 0.48 mΩ per square. */
  estimatedResistanceMilliohm: number;
}

export interface DrcReport {
  version: 1;
  variant: Variant;
  score: number; // 0..100
  designPoints: number; // 0..40
  blockingCount: number;
  wouldPass: boolean;
  verdict?: "admis" | "rezerve" | "respins";
  criticalCount?: number;
  manualReview: boolean;
  board: { width: number; height: number; minX: number; minY: number } | null;
  stats: { holes: number; drillDiameters: number[]; layers: { file: string; kind: LayerKind; count: number }[]; minTrace: number | null; minClearance: number | null };
  rules: RuleResult[];
  issues: DrcIssue[];
  /** Explanations for teacher-defined rules used in this report. */
  customCatalog?: Record<string, { err: string; category: string; what: string; why: string; fix: string }> | undefined;
  /** Text blocks found on the silkscreen (geometry only; reading is done on demand). */
  silkText?: { blocks: SilkBlock[]; read?: Record<number, { text: string; confidence: number }>; mirrored?: boolean; nameFound?: boolean | null } | undefined;
  /** Connectivity graph (copper nets) built by Union-Find across TOP/BOTTOM and vias. */
  nets?: NetSummary[] | undefined;
}

export const RULES = {
  boardSize: 40,
  boardTol: 0.2,
  edgeClearance: 1.0,
  outlineMaxWidth: 0.2,
  minTrace: 0.25,
  minClearance: 0.2,
  minHole: 0.3,
  maxHole: 3.2,
  annularRing: 0.15,
  stencilT: 0.12,
  fiducialMin: 0.8,
  fiducialMax: 2.0,
};

export const TITLES: Record<string, string> = {
  MISSING_LAYER: "Straturi obligatorii",
  DRL_COUNT: "Fișier DRL unic",
  BOARD_SIZE: "Dimensiune placă",
  ORIGIN: "Origine coordonate (0,0)",
  BOARD_OVERSIZE: "Placă mai mare decât formatul (CRITIC)",
  HOLE_OUTSIDE_PAD: "Găuri în afara pad-urilor (CRITIC)",
  SILK_OVER_PAD: "Serigrafie pe cuprul pad-urilor",
  SILK_EDGE: "Serigrafie la marginea pad-urilor",
  DRILL_TO_DRILL: "Distanță între găuri",
  OUTLINE_WIDTH: "Lățime contur",
  EDGE_CLEARANCE: "Gardă margine cupru",
  VIA_IN_PAD: "Interdicție VIA în PAD",
  SSTOP_OVER_PAD: "Deschideri mască pe pad-uri",
  MASK_DUPLICATE: "Capcana duplicării (SMTOP = TOP)",
  FIDUCIALS: "Fiduciali optici TOP",
  MIN_TRACE: "Lățime minimă trasee",
  CLEARANCE: "Izolație minimă cupru",
  ANNULAR_RING: "Inel anular minim",
  HOLE_SIZE: "Diametre găuri",
  MISSING_PASTE: "Strat pastă (stencil)",
  STENCIL_RATIO: "Stencil IPC-7525B (AR / Area Ratio)",
  STENCIL_WINDOWPANE: "Segmentare ferestre termice",
  SILK_TEXT_SIZE: "Lizibilitate text serigrafie",
  MASK_EXPANSION: "Expansiune mască pe pad-uri",
  PASTE_SIZE: "Dimensiune pastă față de pad",
  PASTE_MISSING_PAD: "Pastă lipsă pe pad-uri SMD",
  VIA_DIAMETER: "Diametru via (0.4 mm)",
  FAB_CONTENT: "Conținut strat FAB",
  SOLDER_MASK_SLIVER: "Punte de mască prea subțire (sliver)",
  ACID_TRAPS: "Unghiuri ascuțite între trasee (acid traps)",
  COPPER_ISLANDS: "Insule de cupru / gâtuiri plan de masă",
  THERMAL_RELIEF_MISSING: "Pad fără izolare termică în planul de masă",
  TOMBSTONING_ASYMMETRY: "Asimetrie termică pad-uri (tombstoning)",
  NPTH_CLEARANCE: "Gardă găuri de montaj față de cupru",
  OUTLINE_OPEN_OR_INVALID: "Contur deschis sau invalid (CRITIC)",
  DANGLING_TRACES: "Capete de traseu în aer (antene)",
  DRILL_ON_TRACE_NO_PAD: "Gaură pe traseu fără pad (CRITIC)",
};

// code -> [penalty, severity when failing, SMT only]
export const LEGACY_PENALTY: Record<string, [number, Severity, boolean]> = {
  MISSING_LAYER: [20, "blocking", false],
  DRL_COUNT: [20, "blocking", false],
  BOARD_SIZE: [15, "blocking", false],
  ORIGIN: [5, "warning", false],
  OUTLINE_WIDTH: [5, "warning", false],
  EDGE_CLEARANCE: [10, "blocking", false],
  VIA_IN_PAD: [15, "blocking", true],
  SSTOP_OVER_PAD: [10, "blocking", false],
  MASK_DUPLICATE: [25, "blocking", false],
  FIDUCIALS: [10, "blocking", true],
  MIN_TRACE: [5, "warning", false],
  CLEARANCE: [5, "warning", false],
  ANNULAR_RING: [5, "warning", false],
  HOLE_SIZE: [5, "warning", false],
  MISSING_PASTE: [10, "blocking", true],
  STENCIL_RATIO: [5, "warning", true],
  STENCIL_WINDOWPANE: [0, "info", true],
};

/** Axis-aligned rectangle used for SAT-exact distances on rectangular flashes. */
interface Rect { minX: number; minY: number; maxX: number; maxY: number }

type Capsule = { ax: number; ay: number; bx: number; by: number; r: number; b: BBox; i: number; rect?: Rect };

function toCapsule(p: Primitive, i: number): Capsule | null {
  if (p.clear) return null;
  if (p.t === "line") return { ax: p.x1, ay: p.y1, bx: p.x2, by: p.y2, r: p.w / 2, b: primitiveBBox(p), i };
  if (p.t === "flash") {
    const long = Math.max(p.w, p.h);
    const short = Math.min(p.w, p.h);
    const half = (long - short) / 2;
    const horiz = p.w >= p.h;
    return {
      ax: horiz ? p.x - half : p.x,
      ay: horiz ? p.y : p.y - half,
      bx: horiz ? p.x + half : p.x,
      by: horiz ? p.y : p.y + half,
      r: short / 2,
      b: primitiveBBox(p),
      i,
      // Rectangular flashes keep their true shape: the capsule approximation overestimates corners.
      ...(p.shape === "R" ? { rect: { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y - p.h / 2, maxY: p.y + p.h / 2 } } : {}),
    };
  }
  return null;
}

function ptSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function ptRectDist(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.minX - px, 0, px - r.maxX);
  const dy = Math.max(r.minY - py, 0, py - r.maxY);
  return Math.hypot(dx, dy);
}

/** Strict segment intersection (proper crossing, not just touching). */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Exact distance between an axis-aligned rectangle and a segment (SAT on 4 axes + edge tests). */
function rectSegDist(r: Rect, ax: number, ay: number, bx: number, by: number): number {
  if (ptRectDist(ax, ay, r) === 0 || ptRectDist(bx, by, r) === 0) return 0;
  const corners: [number, number][] = [
    [r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY],
  ];
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = corners[i]!;
    const [dx, dy] = corners[(i + 1) % 4]!;
    if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  }
  let min = Math.min(ptRectDist(ax, ay, r), ptRectDist(bx, by, r));
  for (const [cx, cy] of corners) min = Math.min(min, ptSegDist(cx, cy, ax, ay, bx, by));
  return min;
}

function rectRectDist(a: Rect, b: Rect): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX, 0);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY, 0);
  return Math.hypot(dx, dy);
}

/** Gap between two copper items; rectangular flashes use exact SAT distance, the rest capsules. */
function gapBetween(A: Capsule, B: Capsule): number {
  if (A.rect && B.rect) return rectRectDist(A.rect, B.rect);
  if (A.rect) return rectSegDist(A.rect, B.ax, B.ay, B.bx, B.by) - B.r;
  if (B.rect) return rectSegDist(B.rect, A.ax, A.ay, A.bx, A.by) - A.r;
  return segSegDist(A, B) - A.r - B.r;
}

function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yj)) / (yi - yj) + xj) inside = !inside;
  }
  return inside;
}

function polyArea(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j]![0] + pts[i]![0]) * (pts[j]![1] - pts[i]![1]);
  return Math.abs(a / 2);
}

function polyPerimeter(pts: [number, number][]): number {
  let p = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) p += Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
  return p;
}

function segSegDist(a: Capsule, b: Capsule): number {
  const d = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l = dx * dx + dy * dy;
    let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  // intersection test
  const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  const d1 = cross(a.ax, a.ay, a.bx, a.by, b.ax, b.ay);
  const d2 = cross(a.ax, a.ay, a.bx, a.by, b.bx, b.by);
  const d3 = cross(b.ax, b.ay, b.bx, b.by, a.ax, a.ay);
  const d4 = cross(b.ax, b.ay, b.bx, b.by, a.bx, a.by);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    d(a.ax, a.ay, b.ax, b.ay, b.bx, b.by),
    d(a.bx, a.by, b.ax, b.ay, b.bx, b.by),
    d(b.ax, b.ay, a.ax, a.ay, a.bx, a.by),
    d(b.bx, b.by, a.ax, a.ay, a.bx, a.by),
  );
}

function pointInFlash(x: number, y: number, p: Extract<Primitive, { t: "flash" }>, tol = 0) {
  if (p.shape === "C" || p.shape === "P") return Math.hypot(x - p.x, y - p.y) <= p.w / 2 + tol;
  return Math.abs(x - p.x) <= p.w / 2 + tol && Math.abs(y - p.y) <= p.h / 2 + tol;
}

/** Minimum clearance between copper items that do not touch (spatial hash grid 2 mm + Union-Find). */
function clearanceScan(layer: Layer, limit: number) {
  const caps = layer.primitives.map(toCapsule).filter((c): c is Capsule => !!c);
  const cell = 2;
  const grid = new Map<string, Capsule[]>();
  for (const c of caps) {
    for (let gx = Math.floor(c.b.minX / cell); gx <= Math.floor(c.b.maxX / cell); gx++)
      for (let gy = Math.floor(c.b.minY / cell); gy <= Math.floor(c.b.maxY / cell); gy++) {
        const k = `${gx},${gy}`;
        const arr = grid.get(k);
        if (arr) arr.push(c);
        else grid.set(k, [c]);
      }
  }
  // union-find by overlap so connected copper (same net) is not flagged
  const parent = caps.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const idx = new Map(caps.map((c, i) => [c, i]));
  const pairs: [number, number, number][] = [];
  const seen = new Set<string>();
  for (const arr of grid.values()) {
    for (let a = 0; a < arr.length; a++)
      for (let b = a + 1; b < arr.length; b++) {
        const A = arr[a]!;
        const B = arr[b]!;
        const ia = idx.get(A)!;
        const ib = idx.get(B)!;
        const key = ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const gap = gapBetween(A, B);
        if (gap <= 0.001) parent[find(ia)] = find(ib);
        else if (gap < limit * 2) pairs.push([ia, ib, gap]);
      }
    if (seen.size > 400000) break;
  }
  // Copper pours: a gap whose midpoint lies inside solid (non-cut-out) pour copper is not isolation.
  const dark = layer.primitives.filter((p) => p.t === "region" && !p.clear) as Extract<Primitive, { t: "region" }>[];
  const clearR = layer.primitives.filter((p) => p.t === "region" && p.clear) as Extract<Primitive, { t: "region" }>[];
  const clearF = layer.primitives.filter((p) => p.t === "flash" && p.clear) as Extract<Primitive, { t: "flash" }>[];
  const inSolid = (x: number, y: number) =>
    dark.length > 0 &&
    !clearF.some((f) => pointInFlash(x, y, f)) &&
    !clearR.some((r) => pointInPoly(x, y, r.pts)) &&
    dark.some((r) => pointInPoly(x, y, r.pts));
  let min: number | null = null;
  const hits: { x: number; y: number; gap: number }[] = [];
  for (const [a, b, gap] of pairs) {
    if (find(a) === find(b)) continue;
    {
      const ca = caps[a]!;
      const cb = caps[b]!;
      if (inSolid(((ca.ax + ca.bx) / 2 + (cb.ax + cb.bx) / 2) / 2, ((ca.ay + ca.by) / 2 + (cb.ay + cb.by) / 2) / 2)) continue;
    }
    if (min === null || gap < min) min = gap;
    if (gap < limit) {
      const ca = caps[a]!;
      const cb = caps[b]!;
      hits.push({ x: ((ca.ax + ca.bx) / 2 + (cb.ax + cb.bx) / 2) / 2, y: ((ca.ay + ca.by) / 2 + (cb.ay + cb.by) / 2) / 2, gap });
    }
  }
  hits.sort((p, q) => p.gap - q.gap);
  return { min, hits, caps, find };
}

/**
 * Electrical connectivity graph: Union-Find over the copper capsules of TOP and BOTTOM,
 * merged across layers by drill holes (vias/THT) that touch copper on both sides.
 * Net names come from Gerber X2 %TO.N attributes when present, else NET_001…
 */
function buildNets(top: Layer | undefined, bottom: Layer | undefined, holes: Hole[]): NetSummary[] | undefined {
  const sides: { kind: "top_copper" | "bottom_copper"; caps: Capsule[]; find: (i: number) => number }[] = [];
  for (const [kind, layer] of [["top_copper", top], ["bottom_copper", bottom]] as const) {
    if (!layer) continue;
    const { caps, find } = clearanceScan(layer, 0);
    if (caps.length) sides.push({ kind, caps, find });
  }
  if (!sides.length) return undefined;
  // Global ids: side s, capsule i → gid
  const offset: number[] = [];
  let total = 0;
  for (const s of sides) { offset.push(total); total += s.caps.length; }
  const parent = Array.from({ length: total }, (_, i) => i);
  const gfind = (i: number): number => (parent[i] === i ? i : (parent[i] = gfind(parent[i]!)));
  const gunion = (a: number, b: number) => { parent[gfind(a)] = gfind(b); };
  // Same-layer unions from clearanceScan
  sides.forEach((s, si) => {
    const roots = new Map<number, number>();
    for (let i = 0; i < s.caps.length; i++) {
      const r = s.find(i);
      const prev = roots.get(r);
      if (prev === undefined) roots.set(r, i);
      else gunion(offset[si]! + i, offset[si]! + prev);
    }
  });
  // Cross-layer unions through holes
  const holeGids: number[][] = holes.map(() => []);
  holes.forEach((h, hi) => {
    sides.forEach((s, si) => {
      s.caps.forEach((c, ci) => {
        if (h.x < c.b.minX - 0.25 || h.x > c.b.maxX + 0.25 || h.y < c.b.minY - 0.25 || h.y > c.b.maxY + 0.25) return;
        const d = c.rect ? ptRectDist(h.x, h.y, c.rect) : ptSegDist(h.x, h.y, c.ax, c.ay, c.bx, c.by) - c.r;
        if (d <= 0.25) holeGids[hi]!.push(offset[si]! + ci);
      });
    });
    const gs = holeGids[hi]!;
    for (let i = 1; i < gs.length; i++) gunion(gs[0]!, gs[i]!);
  });
  // Group capsules by global root
  const groups = new Map<number, { s: number; i: number }[]>();
  sides.forEach((s, si) => {
    for (let i = 0; i < s.caps.length; i++) {
      const r = gfind(offset[si]! + i);
      const g = groups.get(r) ?? [];
      g.push({ s: si, i });
      groups.set(r, g);
    }
  });
  const nets: NetSummary[] = [];
  let n = 0;
  for (const members of groups.values()) {
    n++;
    const primitiveIds: NetSummary["primitiveIds"] = { top_copper: [], bottom_copper: [] };
    let name: string | undefined;
    let len = 0;
    let squares = 0;
    let minW: number | null = null;
    let maxW: number | null = null;
    const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { s, i } of members) {
      const c = sides[s]!.caps[i]!;
      const prim = sides[s]!.kind === "top_copper" ? top!.primitives[c.i]! : bottom!.primitives[c.i]!;
      primitiveIds[sides[s]!.kind].push(c.i);
      if (!name && "net" in prim && prim.net) name = prim.net;
      if (prim.t === "line") {
        const L = Math.hypot(prim.x2 - prim.x1, prim.y2 - prim.y1);
        len += L;
        if (prim.w > 0) squares += L / prim.w;
        if (prim.w > 0) { minW = minW === null ? prim.w : Math.min(minW, prim.w); maxW = Math.max(maxW ?? 0, prim.w); }
      } else if (prim.t === "flash") {
        minW = minW === null ? Math.min(prim.w, prim.h) : Math.min(minW, prim.w, prim.h);
        maxW = Math.max(maxW ?? 0, prim.w, prim.h);
      }
      box.minX = Math.min(box.minX, c.b.minX); box.minY = Math.min(box.minY, c.b.minY);
      box.maxX = Math.max(box.maxX, c.b.maxX); box.maxY = Math.max(box.maxY, c.b.maxY);
    }
    const holeIds: number[] = [];
    holes.forEach((h, hi) => {
      if (holeGids[hi]!.some((g) => gfind(g) === gfind(offset[sides.findIndex((s) => s.caps.some((c) => c.i === members[0]!.i))]! + members[0]!.i))) holeIds.push(hi);
    });
    nets.push({
      netId: n,
      name: name ?? `NET_${String(n).padStart(3, "0")}`,
      primitiveIds,
      holeIds,
      totalLengthMm: +len.toFixed(2),
      minWidthMm: minW === null ? null : +minW.toFixed(3),
      maxWidthMm: maxW === null ? null : +maxW.toFixed(3),
      boundingBox: { minX: +box.minX.toFixed(3), minY: +box.minY.toFixed(3), maxX: +box.maxX.toFixed(3), maxY: +box.maxY.toFixed(3) },
      estimatedResistanceMilliohm: +(0.48 * squares).toFixed(2),
    });
  }
  return nets;
}

export function runDrc(layers: Layer[], variant: Variant, settings: Settings = DEFAULT_SETTINGS): DrcReport {
  const R = settings.rules;
  const P: Record<string, import("./settings").PenaltyValue> = { ...settings.penalties };
  const titleOf: Record<string, string> = { ...TITLES };
  const customCatalog: NonNullable<DrcReport["customCatalog"]> = {};
  for (const [code, o] of Object.entries(settings.overrides ?? {})) {
    if (o.title) titleOf[code] = o.title;
    const base = CATALOG[code];
    if (base && (o.what || o.why || o.fix)) customCatalog[code] = { err: base.err, category: base.category, what: o.what || base.what, why: o.why || base.why, fix: o.fix || base.fix };
  }
  const byKind = (k: LayerKind) => layers.filter((l) => l.kind === k);
  const one = (k: LayerKind) => byKind(k)[0];
  const issues: DrcIssue[] = [];
  const failed = new Map<string, string>();
  const details = new Map<string, string>();
  const smt = variant === "SMT";

  const fail = (code: string, message: string, pos?: { x?: number; y?: number; layer?: LayerKind }) => {
    if (!failed.has(code)) failed.set(code, message);
    const sev = P[code]?.severity ?? "warning";
    issues.push({ code, title: titleOf[code] ?? code, severity: sev, message, ...pos });
  };
  const note = (code: string, d: string) => details.set(code, d);

  const top = one("top_copper");
  const bottom = one("bottom_copper");
  const mask = one("top_mask");
  const paste = one("top_paste");
  const outline = one("outline");
  const drills = byKind("drill");
  const holes = drills.flatMap((d) => d.holes);

  // Required layers
  const missing: string[] = [];
  if (!top) missing.push("Cupru TOP");
  if (!outline) missing.push("Contur");
  if (!mask) missing.push("Mască TOP");
  if (missing.length) fail("MISSING_LAYER", `Lipsesc straturile: ${missing.join(", ")}.`);
  else note("MISSING_LAYER", `${layers.length} fișiere recunoscute.`);

  // Drill count
  if (drills.length !== 1) fail("DRL_COUNT", drills.length === 0 ? "Nu a fost găsit niciun fișier Excellon." : `Au fost găsite ${drills.length} fișiere de găurire; se cere exact unul.`);
  else note("DRL_COUNT", `${drills[0]!.fileName} — ${holes.length} găuri.`);

  // Board box
  let board: BBox | null = outline ? outlineBBox(outline) : null;
  if (!board && top) board = layerBBox(top);
  let boardInfo: DrcReport["board"] = null;
  if (board) {
    const w = board.maxX - board.minX;
    const h = board.maxY - board.minY;
    boardInfo = { width: +w.toFixed(3), height: +h.toFixed(3), minX: +board.minX.toFixed(3), minY: +board.minY.toFixed(3) };
    const H = R.boardHeight || R.boardSize;
    const req = `${R.boardSize.toFixed(2)} × ${H.toFixed(2)} mm ±${R.boardTol}`;
    if (w > R.boardSize + R.boardTol || h > H + R.boardTol) {
      fail("BOARD_OVERSIZE", `Placa măsoară ${w.toFixed(2)} × ${h.toFixed(2)} mm — depășește formatul (cerut ${req}). Nu încape în panou/stencil.`, { x: board.maxX, y: board.maxY, layer: "outline" });
      note("BOARD_SIZE", "Vezi eroarea critică de supradimensionare.");
    } else {
      note("BOARD_OVERSIZE", `Placa încape în formatul ${req}.`);
      if (Math.abs(w - R.boardSize) > R.boardTol || Math.abs(h - H) > R.boardTol)
        fail("BOARD_SIZE", `Placa măsoară ${w.toFixed(2)} × ${h.toFixed(2)} mm (cerut ${req}).`, { x: board.maxX, y: board.maxY, layer: "outline" });
      else note("BOARD_SIZE", `${w.toFixed(2)} × ${h.toFixed(2)} mm.`);
    }
    if (Math.abs(board.minX) > R.originTol || Math.abs(board.minY) > R.originTol)
      fail("ORIGIN", `Colțul stânga-jos este la (${board.minX.toFixed(2)}, ${board.minY.toFixed(2)}) mm. Verificarea a continuat cu offset virtual.`, { x: board.minX, y: board.minY, layer: "outline" });
    else note("ORIGIN", "Colțul plăcii este în (0,0).");
  } else fail("BOARD_SIZE", "Nu s-a putut determina conturul plăcii.");

  // Outline width
  if (outline) {
    const wide = outline.primitives.filter((p) => p.t === "line" && p.w > R.outlineMaxWidth) as Extract<Primitive, { t: "line" }>[];
    if (wide.length) fail("OUTLINE_WIDTH", `Linie de contur de ${wide[0]!.w.toFixed(3)} mm (max ${R.outlineMaxWidth} mm).`, { x: wide[0]!.x1, y: wide[0]!.y1, layer: "outline" });
    else note("OUTLINE_WIDTH", "Lățimea conturului este conformă.");
  }

  // Edge clearance
  if (board) {
    let count = 0;
    for (const layer of [top, bottom].filter(Boolean) as Layer[]) {
      for (const p of layer.primitives) {
        if (p.clear) continue;
        const b = primitiveBBox(p);
        const d = Math.min(b.minX - board.minX, board.maxX - b.maxX, b.minY - board.minY, board.maxY - b.maxY);
        if (d < R.edgeClearance - 0.01) {
          count++;
          if (count <= 8) fail("EDGE_CLEARANCE", `Cupru la ${Math.max(0, d).toFixed(2)} mm de margine (min ${R.edgeClearance.toFixed(2)} mm).`, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, layer: layer.kind });
        }
      }
    }
    if (!count) note("EDGE_CLEARANCE", `Tot cuprul respectă garda de ${R.edgeClearance} mm.`);
    else failed.set("EDGE_CLEARANCE", `${count} elemente de cupru prea aproape de margine.`);
  }

  // Holes
  const diam = [...new Set(holes.map((h) => +h.d.toFixed(2)))].sort((a, b) => a - b);
  {
    let bad = 0;
    for (const h of holes) {
      const outside = board && (h.x < board.minX || h.x > board.maxX || h.y < board.minY || h.y > board.maxY);
      if (h.d < R.minHole - 0.001 || h.d > R.maxHole + 0.001 || outside) {
        bad++;
        if (bad <= 6) fail("HOLE_SIZE", outside ? `Gaură în afara plăcii la (${h.x.toFixed(2)}, ${h.y.toFixed(2)}).` : `Gaură Ø${h.d.toFixed(2)} mm în afara domeniului ${R.minHole.toFixed(2)}–${R.maxHole.toFixed(2)} mm.`, { x: h.x, y: h.y, layer: "drill" });
      }
    }
    if (!bad) note("HOLE_SIZE", holes.length ? `${holes.length} găuri, diametre: ${diam.join(", ")} mm.` : "Nicio gaură.");
  }

  // Pads = flashes on top copper
  const topPads = (top?.primitives.filter((p) => p.t === "flash" && !p.clear) ?? []) as Extract<Primitive, { t: "flash" }>[];
  const pasteAps = (paste?.primitives.filter((p) => p.t === "flash" && !p.clear) ?? []) as Extract<Primitive, { t: "flash" }>[];
  const maskAps = (mask?.primitives.filter((p) => p.t === "flash" && !p.clear) ?? []) as Extract<Primitive, { t: "flash" }>[];
  // VIA = small drilled pad without paste; component-pad rules (mask opening, silk) do not apply to it.
  const isVia = (p: Extract<Primitive, { t: "flash" }>) => {
    const h = holes.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 0.2);
    if (!h || h.d > 0.5 || Math.max(p.w, p.h) > 1.05) return false;
    return !pasteAps.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 0.2);
  };
  const viaCount = topPads.filter(isVia).length;

  // Via in pad (SMT): hole inside a pad that also has paste (i.e. an SMD pad)
  if (smt) {
    let n = 0;
    for (const h of holes) {
      const hitPaste = pasteAps.find((p) => pointInFlash(h.x, h.y, p, h.d / 2));
      if (hitPaste) {
        n++;
        if (n <= 8) fail("VIA_IN_PAD", `Gaură Ø${h.d.toFixed(2)} mm în pad SMD la (${h.x.toFixed(2)}, ${h.y.toFixed(2)}).`, { x: h.x, y: h.y, layer: "top_copper" });
      }
    }
    if (!n) note("VIA_IN_PAD", paste ? "Niciun via în pad SMD." : "Nu se poate verifica fără stratul de pastă.");
  }

  // Solder mask openings
  if (mask && top) {
    let n = 0;
    const compPads = topPads.filter((p) => !isVia(p));
    for (const pad of compPads) {
      const open = maskAps.some((m) => Math.hypot(m.x - pad.x, m.y - pad.y) < Math.max(0.05, Math.min(pad.w, pad.h) / 3));
      const regionOpen = mask.primitives.some((m) => m.t === "region" && pointInBBox(pad.x, pad.y, primitiveBBox(m)));
      if (!open && !regionOpen) {
        n++;
        if (n <= 10) fail("SSTOP_OVER_PAD", `Pad de componentă fără deschidere în mască la (${pad.x.toFixed(2)}, ${pad.y.toFixed(2)}).`, { x: pad.x, y: pad.y, layer: "top_mask" });
      }
    }
    const viaNote = viaCount ? ` VIA-urile (${viaCount}) sunt ignorate — pot fi acoperite de mască (tented).` : "";
    if (!n) note("SSTOP_OVER_PAD", `${compPads.length} pad-uri de componentă, toate cu deschidere în mască.${viaNote}`);
    else failed.set("SSTOP_OVER_PAD", `${n} pad-uri de componentă acoperite de mască.${viaNote}`);

    // Duplication trap
    const topLines = top.primitives.filter((p) => p.t === "line").length;
    const maskLines = mask.primitives.filter((p) => p.t === "line").length;
    if (topLines > 5 && maskLines >= topLines * R.maskDuplicateRatio) fail("MASK_DUPLICATE", `Masca conține ${maskLines} trasee (cupru: ${topLines}) — probabil cuprul a fost exportat ca mască.`, { layer: "top_mask" });
    else note("MASK_DUPLICATE", "Masca este distinctă de cupru.");
  }

  // Fiducials
  if (smt && top) {
    // Fiducial: isolated copper target 0.8–2 mm, no hole, no trace attached, mask opening larger than copper.
    // Square pads count only without paste (square pads with paste are SMD component pads).
    const fidLines = top.primitives.filter((p) => p.t === "line" && !p.clear) as Extract<Primitive, { t: "line" }>[];
    const hasPaste = (p: { x: number; y: number }) => pasteAps.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 0.15);
    const fids = topPads.filter(
      (p) =>
        (p.shape === "C" || (p.shape === "R" && Math.abs(p.w - p.h) < 0.01 && !hasPaste(p))) &&
        p.w >= R.fiducialMin - 0.01 &&
        p.w <= R.fiducialMax + 0.01 &&
        !holes.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < p.w / 2 + h.d / 2) &&
        !fidLines.some((l) => Math.hypot(l.x1 - p.x, l.y1 - p.y) < p.w / 2 + 0.05 || Math.hypot(l.x2 - p.x, l.y2 - p.y) < p.w / 2 + 0.05) &&
        (maskAps.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 0.15 && Math.min(m.w, m.h) >= p.w + Math.min(R.fiducialMaskExtra, 0.1) - 0.01) ||
          mask?.primitives.some((m) => m.t === "region" && pointInBBox(p.x, p.y, primitiveBBox(m)))),
    );
    const fidWithPaste = fids.filter((f) => pasteAps.some((a) => Math.hypot(a.x - f.x, a.y - f.y) < 0.15)).length;
    if (fids.length < R.minFiducials) fail("FIDUCIALS", `Au fost detectați ${fids.length} fiduciali (minim ${R.minFiducials}: pad rotund ${R.fiducialMin}–${R.fiducialMax} mm, fără gaură, deschidere mască mai mare).`, { layer: "top_copper" });
    else note("FIDUCIALS", `${fids.length} fiduciali la ${fids.map((f) => `(${f.x.toFixed(1)}, ${f.y.toFixed(1)})`).join(", ")}.${fidWithPaste ? ` Atenție: ${fidWithPaste} au și deschidere de pastă (recomandat fără).` : ""}`);
  }

  // Holes outside any copper pad (critical) — usually a drill format/origin mismatch
  {
    const copperFlashes = [top, bottom].filter(Boolean).flatMap((l) => (l as Layer).primitives.filter((p) => p.t === "flash" && !p.clear)) as Extract<Primitive, { t: "flash" }>[];
    const regions = [top, bottom].filter(Boolean).flatMap((l) => (l as Layer).primitives.filter((p) => p.t === "region" && !p.clear)).map((p) => primitiveBBox(p));
    let n = 0;
    if (copperFlashes.length || regions.length) {
      for (const h of holes) {
        if (h.d >= R.npthMinDiameter) continue;
        const onPad = copperFlashes.some((p) => pointInFlash(h.x, h.y, p, 0.02)) || regions.some((b) => pointInBBox(h.x, h.y, b));
        if (!onPad) {
          n++;
          if (n <= 8) fail("HOLE_OUTSIDE_PAD", `Gaură Ø${h.d.toFixed(2)} mm la (${h.x.toFixed(2)}, ${h.y.toFixed(2)}) nu cade pe niciun pad de cupru.`, { x: h.x, y: h.y, layer: "drill" });
        }
      }
    }
    if (n) failed.set("HOLE_OUTSIDE_PAD", `${n} găuri în afara pad-urilor (din ${holes.length}).`);
    else note("HOLE_OUTSIDE_PAD", holes.length ? "Toate găurile cad pe pad-uri." : "Nicio gaură.");
  }

  // Drill-to-drill
  {
    let n = 0;
    for (let i = 0; i < holes.length && n < 50; i++)
      for (let j = i + 1; j < holes.length; j++) {
        const a = holes[i]!, b = holes[j]!;
        const c = Math.hypot(a.x - b.x, a.y - b.y);
        if (c < 0.01) continue;
        const gap = c - a.d / 2 - b.d / 2;
        if (gap < R.drillToDrill) {
          n++;
          if (n <= 6) fail("DRILL_TO_DRILL", `Găuri la ${Math.max(0, gap).toFixed(2)} mm una de alta (min ${R.drillToDrill} mm) lângă (${a.x.toFixed(2)}, ${a.y.toFixed(2)}).`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, layer: "drill" });
        }
      }
    if (n) failed.set("DRILL_TO_DRILL", `${n} perechi de găuri prea apropiate.`);
    else note("DRILL_TO_DRILL", "Distanțele dintre găuri sunt conforme.");
  }

  // Silkscreen over pads: ink that penetrates a component pad (SMD or THT) is a real defect (SILK_OVER_PAD);
  // ink that only touches the mask opening / pad edge is clipped in CAM (SILK_EDGE).
  // VIAs (small drilled pad, no paste) are excluded — silk over a via does not affect soldering.
  // Issues are counted once per affected pad, not per silk segment.
  {
    const silk = one("top_silk");
    if (silk && (maskAps.length || topPads.length)) {
      const compPads = (topPads.length ? topPads : maskAps).filter((p) => !isVia(p));
      const compOpen = (maskAps.length ? maskAps : topPads).filter((p) => !isVia(p));
      const copper = compPads.map((p, i) => toCapsule(p, i)).filter((c): c is Capsule => !!c);
      const openings = compOpen.map((p, i) => toCapsule(p, i)).filter((c): c is Capsule => !!c);
      const tol = R.silkOverlapTol ?? 0;
      const overlaps = (c: Capsule, pc: Capsule) => !(c.b.maxX < pc.b.minX || c.b.minX > pc.b.maxX || c.b.maxY < pc.b.minY || c.b.minY > pc.b.maxY);
      const hitPads = new Map<number, { pc: Capsule; segs: number }>();
      const edgePads = new Map<number, { pc: Capsule; segs: number }>();
      for (const sp of silk.primitives) {
        const c = toCapsule(sp, 0);
        if (!c) continue;
        let hit = false;
        for (const pc of copper) {
          if (!overlaps(c, pc)) continue;
          if (segSegDist(c, pc) - c.r - pc.r < -tol - 0.001) {
            const e = hitPads.get(pc.i) ?? { pc, segs: 0 };
            e.segs++;
            hitPads.set(pc.i, e);
            hit = true;
          }
        }
        if (hit) continue;
        for (const pc of openings) {
          if (!overlaps(c, pc)) continue;
          if (segSegDist(c, pc) - c.r - pc.r < R.silkPadClearance - 0.001) {
            const e = edgePads.get(pc.i) ?? { pc, segs: 0 };
            e.segs++;
            edgePads.set(pc.i, e);
          }
        }
      }
      // a pad already counted as penetrated is not also an edge touch
      const hitKeys = new Set([...hitPads.values()].map(({ pc }) => `${((pc.ax + pc.bx) / 2).toFixed(2)},${((pc.ay + pc.by) / 2).toFixed(2)}`));
      const loc = (pc: Capsule) => ({ x: (pc.ax + pc.bx) / 2, y: (pc.ay + pc.by) / 2 });
      let n = 0;
      for (const { pc, segs } of hitPads.values()) {
        n++;
        const p = loc(pc);
        if (n <= 8) fail("SILK_OVER_PAD", `Serigrafie pe cuprul pad-ului de componentă la (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) — ${segs} segment(e).`, { ...p, layer: "top_silk" });
      }
      let e = 0;
      for (const { pc } of edgePads.values()) {
        const p = loc(pc);
        if (hitKeys.has(`${p.x.toFixed(2)},${p.y.toFixed(2)}`)) continue;
        e++;
        if (e <= 6) fail("SILK_EDGE", `Serigrafie atinge marginea pad-ului/măștii la (${p.x.toFixed(2)}, ${p.y.toFixed(2)}).`, { ...p, layer: "top_silk" });
      }
      if (n) failed.set("SILK_OVER_PAD", `${n} pad-uri de componentă (SMD/THT) cu serigrafie pe cupru. VIA-urile sunt ignorate.`);
      else note("SILK_OVER_PAD", "Serigrafia nu pătrunde pe pad-urile componentelor (VIA-urile sunt ignorate).");
      if (e) failed.set("SILK_EDGE", `${e} pad-uri atinse la margine (se taie automat la mască).`);
      else note("SILK_EDGE", "Serigrafia păstrează distanța față de deschiderile de mască.");
    }
  }

  // Silkscreen text legibility: words/designators measured from stroke clusters.
  const silkBlocks = [...extractTextBlocks(one("top_silk")), ...extractTextBlocks(one("bottom_silk"))].slice(0, 300);
  silkBlocks.forEach((b, i) => (b.idx = i));
  {
    const small = silkBlocks.filter((b) => b.textHeight < (R.silkMinTextHeight ?? 1) - 0.01 || b.stroke < (R.silkMinStroke ?? 0.15) - 0.005);
    small.slice(0, 8).forEach((b) => fail("SILK_TEXT_SIZE", `Text #${b.idx}: înălțime ${b.textHeight.toFixed(2)} mm, linie ${b.stroke.toFixed(2)} mm (min ${R.silkMinTextHeight} / ${R.silkMinStroke} mm).`, { x: b.x, y: b.y, layer: b.layer }));
    if (small.length) failed.set("SILK_TEXT_SIZE", `${small.length} din ${silkBlocks.length} texte de serigrafie sunt prea mici sau prea subțiri.`);
    else note("SILK_TEXT_SIZE", silkBlocks.length ? `${silkBlocks.length} texte de serigrafie, toate lizibile.` : "Nu s-au găsit texte pe serigrafie.");
  }


  // Min trace width
  let minTrace: number | null = null;
  for (const layer of [top, bottom].filter(Boolean) as Layer[]) {
    for (const p of layer.primitives) {
      if (p.t !== "line" || p.clear || p.w <= 0) continue;
      if (minTrace === null || p.w < minTrace) minTrace = p.w;
      if (p.w < R.minTrace - 0.001 && issues.filter((i) => i.code === "MIN_TRACE").length < 6)
        fail("MIN_TRACE", `Traseu de ${p.w.toFixed(3)} mm (min ${R.minTrace} mm).`, { x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2, layer: layer.kind });
    }
  }
  if (!failed.has("MIN_TRACE")) note("MIN_TRACE", minTrace !== null ? `Lățime minimă: ${minTrace.toFixed(3)} mm.` : "Fără trasee.");

  // Clearance
  let minClearance: number | null = null;
  for (const layer of [top, bottom].filter(Boolean) as Layer[]) {
    const { min, hits } = clearanceScan(layer, R.minClearance);
    if (min !== null && (minClearance === null || min < minClearance)) minClearance = min;
    hits.slice(0, 6).forEach((h) => fail("CLEARANCE", `Izolație de ${h.gap.toFixed(3)} mm (min ${R.minClearance} mm).`, { x: h.x, y: h.y, layer: layer.kind }));
  }
  if (!failed.has("CLEARANCE")) note("CLEARANCE", minClearance !== null ? `Izolație minimă estimată: ${minClearance.toFixed(3)} mm.` : "Nu s-a putut estima.");

  // Annular ring
  {
    let n = 0;
    for (const h of holes) {
      const pad = topPads.find((p) => pointInFlash(h.x, h.y, p));
      if (!pad) continue;
      const ring = (Math.min(pad.w, pad.h) - h.d) / 2;
      if (ring < R.annularRing) {
        n++;
        if (n <= 6) fail("ANNULAR_RING", `Inel anular ${ring.toFixed(3)} mm la (${h.x.toFixed(2)}, ${h.y.toFixed(2)}).`, { x: h.x, y: h.y, layer: "top_copper" });
      }
    }
    if (!n) note("ANNULAR_RING", "Inelele anulare sunt conforme.");
  }

  // Stencil
  if (smt) {
    if (!paste) fail("MISSING_PASTE", "Lipsește stratul de pastă TOP necesar pentru stencil.");
    else {
      note("MISSING_PASTE", `${pasteAps.length} deschideri de stencil.`);
      const T = R.stencilT;
      let bad = 0;
      let big = 0;
      for (const a of pasteAps) {
        const W = Math.min(a.w, a.h);
        const L = Math.max(a.w, a.h);
        const ar = W / T;
        const areaRatio = a.shape === "C" ? a.w / (4 * T) : (L * W) / (2 * (L + W) * T);
        if (ar < R.stencilMinAR || areaRatio < R.stencilMinAreaRatio) {
          bad++;
          if (bad <= 6) fail("STENCIL_RATIO", `Deschidere ${a.w.toFixed(2)}×${a.h.toFixed(2)} mm: AR=${ar.toFixed(2)}, Area Ratio=${areaRatio.toFixed(2)}.`, { x: a.x, y: a.y, layer: "top_paste" });
        }
        const area = L * W;
        if (area > R.windowpaneArea) {
          big++;
          fail("STENCIL_WINDOWPANE", `Pad termic ${a.w.toFixed(1)}×${a.h.toFixed(1)} mm — recomandat segmentare ${area > 25 ? "3×3" : "2×2"} (50–70% arie).`, { x: a.x, y: a.y, layer: "top_paste" });
        }
      }
      if (!bad) note("STENCIL_RATIO", "Toate deschiderile respectă IPC-7525B.");
      if (!big) note("STENCIL_WINDOWPANE", "Nu există pad-uri termice mari.");
    }
  }

  // Calibrated on Seria A 2025 manual review: mask expansion, paste reduction, missing paste, via size, FAB content.
  {
    const near = (l: Layer | undefined, x: number, y: number) =>
      l?.primitives.find((q) => q.t === "flash" && !q.clear && Math.abs(q.x - x) < 0.05 && Math.abs(q.y - y) < 0.05) as Extract<Primitive, { t: "flash" }> | undefined;
    const smdPads = (top?.primitives ?? []).filter((p) => p.t === "flash" && !p.clear && !holes.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 0.05)) as Extract<Primitive, { t: "flash" }>[];
    if (mask && smdPads.length) {
      let n = 0;
      for (const p of smdPads) {
        const m = near(mask, p.x, p.y);
        if (!m) continue; // missing openings are SSTOP_OVER_PAD
        const pw = Math.min(p.w, p.h), mw = Math.min(m.w, m.h);
        if (mw >= pw * 1.8) continue; // fiducial keep-out
        const e = (mw - pw) / 2;
        if (e < R.maskExpMin - 0.005 || e > R.maskExpMax + 0.005) {
          n++;
          if (n <= 6) fail("MASK_EXPANSION", `Mască ${m.w.toFixed(2)}×${m.h.toFixed(2)} pe pad ${p.w.toFixed(2)}×${p.h.toFixed(2)} mm: expansiune ${e.toFixed(3)} mm/latură (cerut ${R.maskExpMin}–${R.maskExpMax}).`, { x: p.x, y: p.y, layer: "top_mask" });
        }
      }
      if (n) failed.set("MASK_EXPANSION", `${n} pad-uri cu expansiunea măștii în afara ${R.maskExpMin}–${R.maskExpMax} mm.`);
      else note("MASK_EXPANSION", "Expansiunea măștii este conformă.");
    }
    if (smt && paste && smdPads.length) {
      let bad = 0, miss = 0;
      for (const p of smdPads) {
        const m = near(mask, p.x, p.y);
        if (m && Math.min(m.w, m.h) >= Math.min(p.w, p.h) * 1.8) continue; // fiducial
        const s = near(paste, p.x, p.y);
        if (!s) { miss++; if (miss <= 6) fail("PASTE_MISSING_PAD", `Pad ${p.w.toFixed(2)}×${p.h.toFixed(2)} mm fără deschidere de pastă.`, { x: p.x, y: p.y, layer: "top_paste" }); continue; }
        const r = (s.w * s.h) / (p.w * p.h);
        if (r < R.pasteRatioMin || r > R.pasteRatioMax) {
          bad++;
          if (bad <= 6) fail("PASTE_SIZE", `Pastă ${s.w.toFixed(2)}×${s.h.toFixed(2)} pe pad ${p.w.toFixed(2)}×${p.h.toFixed(2)} mm (${Math.round(r * 100)}% din arie; cerut ${Math.round(R.pasteRatioMin * 100)}–${Math.round(R.pasteRatioMax * 100)}%).`, { x: p.x, y: p.y, layer: "top_paste" });
        }
      }
      if (bad) failed.set("PASTE_SIZE", `${bad} deschideri de pastă nereduse față de pad.`); else note("PASTE_SIZE", "Pasta este redusă corect față de pad-uri.");
      if (miss) failed.set("PASTE_MISSING_PAD", `${miss} pad-uri SMD fără pastă.`); else note("PASTE_MISSING_PAD", "Toate pad-urile SMD au pastă.");
    }
    if (holes.length) {
      const vias = holes.filter((h) => h.d > 0.05 && h.d < R.viaMaxDetect);
      const wrong = [...new Set(vias.filter((h) => Math.abs(h.d - R.viaDiameter) > R.viaTol).map((h) => h.d.toFixed(3)))];
      if (wrong.length) { const h = vias.find((v) => v.d.toFixed(3) === wrong[0])!; fail("VIA_DIAMETER", `Via-uri de Ø ${wrong.join(", ")} mm (cerut ${R.viaDiameter} ±${R.viaTol} mm).`, { x: h.x, y: h.y, layer: "drill" }); }
      else note("VIA_DIAMETER", vias.length ? `${vias.length} via-uri de Ø ${R.viaDiameter} mm.` : "Nu există via-uri.");
    }
    const fab = one("fabrication");
    const fabLines = fab ? fab.primitives.filter((p) => p.t === "line" && !p.clear).length : 0;
    if (!fab) fail("FAB_CONTENT", "Lipsește stratul FAB (desen și tabel de găurire, secțiune transversală).");
    else if (fabLines < R.fabMinLines) fail("FAB_CONTENT", `FAB conține doar ${fabLines} linii${fabLines === 0 ? " (doar aperturi, fără informații)" : ""} — lipsesc tabelul de găurire / secțiunea transversală / notele.`, { layer: "fabrication" });
    else note("FAB_CONTENT", `FAB cu ${fabLines} linii desenate (verificați manual tabelul și secțiunea).`);
  }

  // Teacher-defined rules: generic geometric checks, scored like built-in rules.
  for (const cr of settings.customRules ?? []) {
    if (!cr.enabled || !cr.code) continue;
    P[cr.code] = { points: cr.points, severity: cr.severity, enabled: true, smtOnly: cr.smtOnly, appliesTo: cr.appliesTo, perIssue: cr.perIssue, cap: cr.cap, critical: cr.critical };
    titleOf[cr.code] = cr.title || cr.code;
    customCatalog[cr.code] = { err: cr.code, category: cr.category, what: cr.what, why: cr.why, fix: cr.example ? `${cr.fix}\nExemplu corect: ${cr.example}` : cr.fix };
    if (!ruleApplies(cr, smt)) continue;
    try {
      evalCustomRule(cr, layers, board, fail, note);
    } catch (e) {
      note(cr.code, `Regula nu a putut fi evaluată: ${(e as Error).message}`);
    }
  }

  // Build rule table & score: base points + perIssue per extra occurrence, capped per rule; critical rules cap the total score.
  const rules: RuleResult[] = [];
  let penalty = 0;
  let criticalCount = 0;
  for (const [code, pv] of Object.entries(P)) {
    const { points: pts, severity: sev, enabled } = pv;
    if (!enabled) continue;
    if (!ruleApplies(pv, smt)) continue;
    const isFailed = failed.has(code);
    if (!isFailed && !details.has(code)) continue;
    const count = issues.filter((i) => i.code === code).length || (isFailed ? 1 : 0);
    const cap = pv.cap ?? Math.max(pts, 15);
    const applied = isFailed ? Math.min(cap, pts + (pv.perIssue ?? 0) * Math.max(0, count - 1)) : 0;
    if (isFailed && pv.critical) criticalCount++;
    penalty += applied;
    rules.push({ code, title: titleOf[code] ?? code, penalty: applied, maxPenalty: cap, count, critical: !!pv.critical, passed: !isFailed, severity: isFailed ? (pv.critical ? "blocking" : sev) : "info", detail: failed.get(code) ?? details.get(code) ?? "" });
  }
  let score = Math.max(0, 100 - penalty);
  if (criticalCount) score = Math.min(score, R.criticalScoreCap);
  const blockingCount = rules.filter((r) => !r.passed && r.severity === "blocking").length;
  const verdict: DrcReport["verdict"] = blockingCount || criticalCount || score < R.reserveScore ? "respins" : score >= R.passScore ? "admis" : "rezerve";

  return {
    version: 1,
    variant,
    score,
    designPoints: +((40 * score) / 100).toFixed(1),
    blockingCount,
    wouldPass: blockingCount === 0 && criticalCount === 0,
    verdict,
    criticalCount,
    manualReview: variant === "THT",
    board: boardInfo,
    stats: {
      holes: holes.length,
      drillDiameters: diam,
      layers: layers.map((l) => ({ file: l.fileName, kind: l.kind, count: l.primitives.length + l.holes.length })),
      minTrace,
      minClearance,
    },
    rules,
    issues: issues.sort((a, b) => sevRank(a.severity) - sevRank(b.severity)),
    customCatalog: Object.keys(customCatalog).length ? customCatalog : undefined,
    silkText: silkBlocks.length ? { blocks: silkBlocks } : undefined,
  };
}

const MAX_MARKS = 8;

function evalCustomRule(
  cr: import("./settings").CustomRule,
  layers: Layer[],
  board: BBox | null,
  fail: (code: string, message: string, pos?: { x?: number; y?: number; layer?: LayerKind }) => void,
  note: (code: string, d: string) => void,
) {
  const kind = cr.layer as LayerKind;
  const lays = layers.filter((l) => l.kind === kind);
  const prims = lays.flatMap((l) => l.primitives).filter((p) => !p.clear);
  const holes = layers.filter((l) => l.kind === "drill").flatMap((l) => l.holes);
  const tol = Math.abs(cr.tolerance ?? 0);
  const v = cr.checkType.startsWith("max") && !["max_holes", "max_primitives"].includes(cr.checkType) ? cr.value + tol : cr.checkType.startsWith("min") && !["min_holes"].includes(cr.checkType) || cr.checkType.endsWith("_edge") ? cr.value - tol : cr.value;
  const f = (n: number) => n.toFixed(3);
  const holedAt = (x: number, y: number) => holes.some((h) => Math.hypot(h.x - x, h.y - y) < Math.max(0.05, h.d / 2));
  const report = (hits: { x: number; y: number; msg: string }[], okMsg: string) => {
    if (!hits.length) return note(cr.code, okMsg);
    if (hits.length < Math.max(1, cr.minOccurrences ?? 1)) return note(cr.code, `${hits.length} cazuri, sub pragul de ${cr.minOccurrences} apariții — nu se depunctează.`);
    hits.slice(0, MAX_MARKS).forEach((h, i) => fail(cr.code, i === 0 && hits.length > 1 ? `${h.msg} (${hits.length} cazuri)` : h.msg, { x: h.x, y: h.y, layer: kind }));
  };
  const edgeDist = (x: number, y: number) => (board ? Math.min(x - board.minX, board.maxX - x, y - board.minY, board.maxY - y) : Infinity);
  switch (cr.checkType) {
    case "min_hole":
      return report(holes.filter((h) => h.d < v - 1e-6).map((h) => ({ x: h.x, y: h.y, msg: `Gaură Ø${f(h.d)} mm sub minimul de ${v} mm.` })), `Toate găurile ≥ ${v} mm.`);
    case "max_hole":
      return report(holes.filter((h) => h.d > v + 1e-6).map((h) => ({ x: h.x, y: h.y, msg: `Gaură Ø${f(h.d)} mm peste maximul de ${v} mm.` })), `Toate găurile ≤ ${v} mm.`);
    case "min_line_width":
    case "max_line_width": {
      const min = cr.checkType === "min_line_width";
      const bad = prims.filter((p): p is Extract<Primitive, { t: "line" }> => p.t === "line" && (min ? p.w < v - 1e-6 : p.w > v + 1e-6));
      return report(bad.map((p) => ({ x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2, msg: `Linie de ${f(p.w)} mm (${min ? "min" : "max"} ${v} mm).` })), `Liniile respectă ${min ? "minimul" : "maximul"} de ${v} mm.`);
    }
    case "min_pad":
    case "max_pad": {
      const min = cr.checkType === "min_pad";
      const bad = prims.filter((p): p is Extract<Primitive, { t: "flash" }> => p.t === "flash" && !(cr.ignoreHoled && holedAt(p.x, p.y)) && (min ? Math.min(p.w, p.h) < v - 1e-6 : Math.max(p.w, p.h) > v + 1e-6));
      return report(bad.map((p) => ({ x: p.x, y: p.y, msg: `Pad ${f(p.w)}×${f(p.h)} mm (${min ? "min" : "max"} ${v} mm).` })), `Pad-urile respectă limita de ${v} mm.`);
    }
    case "layer_required": {
      const n = kind === "drill" ? holes.length : prims.length;
      if (!lays.length || n === 0) fail(cr.code, `Stratul ${kind} lipsește sau este gol.`, { layer: kind });
      else note(cr.code, `Stratul există (${n} elemente).`);
      return;
    }
    case "max_holes":
      if (holes.length > v) fail(cr.code, `Placa are ${holes.length} găuri (maxim ${v}).`, { layer: "drill" });
      else note(cr.code, `${holes.length} găuri (maxim ${v}).`);
      return;
    case "min_holes":
      if (holes.length < v) fail(cr.code, `Placa are ${holes.length} găuri (minim ${v}).`, { layer: "drill" });
      else note(cr.code, `${holes.length} găuri (minim ${v}).`);
      return;
    case "max_primitives":
      if (prims.length > v) fail(cr.code, `Stratul are ${prims.length} elemente (maxim ${v}).`, { layer: kind });
      else note(cr.code, `${prims.length} elemente (maxim ${v}).`);
      return;
    case "hole_to_edge": {
      if (!board) return note(cr.code, "Conturul plăcii nu a fost găsit.");
      const bad = holes.filter((h) => edgeDist(h.x, h.y) - h.d / 2 < v - 1e-6);
      return report(bad.map((h) => ({ x: h.x, y: h.y, msg: `Gaură Ø${f(h.d)} la ${f(edgeDist(h.x, h.y) - h.d / 2)} mm de margine (min ${v} mm).` })), `Toate găurile la ≥ ${v} mm de margine.`);
    }
    case "copper_to_edge": {
      if (!board) return note(cr.code, "Conturul plăcii nu a fost găsit.");
      const hits: { x: number; y: number; msg: string }[] = [];
      for (const p of prims) {
        if (p.t === "flash") {
          const d = edgeDist(p.x, p.y) - Math.max(p.w, p.h) / 2;
          if (d < v - 1e-6) hits.push({ x: p.x, y: p.y, msg: `Pad la ${f(d)} mm de margine (min ${v} mm).` });
        } else if (p.t === "line") {
          const d = Math.min(edgeDist(p.x1, p.y1), edgeDist(p.x2, p.y2)) - p.w / 2;
          if (d < v - 1e-6) hits.push({ x: p.x1, y: p.y1, msg: `Linie la ${f(d)} mm de margine (min ${v} mm).` });
        }
      }
      return report(hits, `Toate elementele la ≥ ${v} mm de margine.`);
    }
  }
}

function sevRank(s: Severity) {
  return s === "blocking" ? 0 : s === "warning" ? 1 : 2;
}
function pointInBBox(x: number, y: number, b: BBox) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}
