import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { layerBBox, primitiveBBox } from "../gerber/parser";
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
  passed: boolean;
  severity: Severity;
  detail: string;
}

export interface DrcReport {
  version: 1;
  variant: Variant;
  score: number; // 0..100
  designPoints: number; // 0..40
  blockingCount: number;
  wouldPass: boolean;
  manualReview: boolean;
  board: { width: number; height: number; minX: number; minY: number } | null;
  stats: { holes: number; drillDiameters: number[]; layers: { file: string; kind: LayerKind; count: number }[]; minTrace: number | null; minClearance: number | null };
  rules: RuleResult[];
  issues: DrcIssue[];
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

type Capsule = { ax: number; ay: number; bx: number; by: number; r: number; b: BBox; i: number };

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
    };
  }
  return null;
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

/** Minimum clearance between copper items that do not touch (spatial hash). */
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
        const gap = segSegDist(A, B) - A.r - B.r;
        if (gap <= 0.001) parent[find(ia)] = find(ib);
        else if (gap < limit * 2) pairs.push([ia, ib, gap]);
      }
    if (seen.size > 400000) break;
  }
  let min: number | null = null;
  const hits: { x: number; y: number; gap: number }[] = [];
  for (const [a, b, gap] of pairs) {
    if (find(a) === find(b)) continue;
    if (min === null || gap < min) min = gap;
    if (gap < limit) {
      const ca = caps[a]!;
      const cb = caps[b]!;
      hits.push({ x: ((ca.ax + ca.bx) / 2 + (cb.ax + cb.bx) / 2) / 2, y: ((ca.ay + ca.by) / 2 + (cb.ay + cb.by) / 2) / 2, gap });
    }
  }
  hits.sort((p, q) => p.gap - q.gap);
  return { min, hits };
}

export function runDrc(layers: Layer[], variant: Variant, settings: Settings = DEFAULT_SETTINGS): DrcReport {
  const R = settings.rules;
  const P = settings.penalties;
  const byKind = (k: LayerKind) => layers.filter((l) => l.kind === k);
  const one = (k: LayerKind) => byKind(k)[0];
  const issues: DrcIssue[] = [];
  const failed = new Map<string, string>();
  const details = new Map<string, string>();
  const smt = variant === "SMT";

  const fail = (code: string, message: string, pos?: { x?: number; y?: number; layer?: LayerKind }) => {
    if (!failed.has(code)) failed.set(code, message);
    const sev = P[code]?.severity ?? "warning";
    issues.push({ code, title: TITLES[code] ?? code, severity: sev, message, ...pos });
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
  let board: BBox | null = outline ? layerBBox(outline, true) : null;
  if (!board && top) board = layerBBox(top);
  let boardInfo: DrcReport["board"] = null;
  if (board) {
    const w = board.maxX - board.minX;
    const h = board.maxY - board.minY;
    boardInfo = { width: +w.toFixed(3), height: +h.toFixed(3), minX: +board.minX.toFixed(3), minY: +board.minY.toFixed(3) };
    if (Math.abs(w - R.boardSize) > R.boardTol || Math.abs(h - R.boardSize) > R.boardTol)
      fail("BOARD_SIZE", `Placa măsoară ${w.toFixed(2)} × ${h.toFixed(2)} mm (cerut ${R.boardSize.toFixed(2)} × ${R.boardSize.toFixed(2)} ±${R.boardTol}).`, { x: board.maxX, y: board.maxY, layer: "outline" });
    else note("BOARD_SIZE", `${w.toFixed(2)} × ${h.toFixed(2)} mm.`);
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
    if (!count) note("EDGE_CLEARANCE", "Tot cuprul respectă garda de ${R.edgeClearance} mm.");
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
    for (const pad of topPads) {
      const open = maskAps.some((m) => Math.hypot(m.x - pad.x, m.y - pad.y) < Math.max(0.05, Math.min(pad.w, pad.h) / 3));
      const regionOpen = mask.primitives.some((m) => m.t === "region" && pointInBBox(pad.x, pad.y, primitiveBBox(m)));
      if (!open && !regionOpen) {
        n++;
        if (n <= 10) fail("SSTOP_OVER_PAD", `Pad fără deschidere în mască la (${pad.x.toFixed(2)}, ${pad.y.toFixed(2)}).`, { x: pad.x, y: pad.y, layer: "top_mask" });
      }
    }
    if (!n) note("SSTOP_OVER_PAD", `${topPads.length} pad-uri, toate cu deschidere în mască.`);
    else failed.set("SSTOP_OVER_PAD", `${n} pad-uri acoperite de mască.`);

    // Duplication trap
    const topLines = top.primitives.filter((p) => p.t === "line").length;
    const maskLines = mask.primitives.filter((p) => p.t === "line").length;
    if (topLines > 5 && maskLines >= topLines * R.maskDuplicateRatio) fail("MASK_DUPLICATE", `Masca conține ${maskLines} trasee (cupru: ${topLines}) — probabil cuprul a fost exportat ca mască.`, { layer: "top_mask" });
    else note("MASK_DUPLICATE", "Masca este distinctă de cupru.");
  }

  // Fiducials
  if (smt && top) {
    const fids = topPads.filter(
      (p) =>
        p.shape === "C" &&
        p.w >= R.fiducialMin &&
        p.w <= R.fiducialMax &&
        !holes.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < p.w / 2) &&
        !pasteAps.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 0.1) &&
        maskAps.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 0.1 && m.w >= p.w + R.fiducialMaskExtra),
    );
    if (fids.length < R.minFiducials) fail("FIDUCIALS", `Au fost detectați ${fids.length} fiduciali (minim ${R.minFiducials}: pad rotund ${R.fiducialMin}–${R.fiducialMax} mm, fără gaură, deschidere mască mai mare).`, { layer: "top_copper" });
    else note("FIDUCIALS", `${fids.length} fiduciali la ${fids.map((f) => `(${f.x.toFixed(1)}, ${f.y.toFixed(1)})`).join(", ")}.`);
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

  // Build rule table & score
  const rules: RuleResult[] = [];
  let penalty = 0;
  for (const [code, pv] of Object.entries(P)) {
    const { points: pts, severity: sev, smtOnly, enabled } = pv;
    if (!enabled) continue;
    if (smtOnly && !smt) continue;
    const isFailed = failed.has(code);
    if (!isFailed && !details.has(code)) continue;
    const applied = isFailed ? pts : 0;
    penalty += applied;
    rules.push({ code, title: TITLES[code] ?? code, penalty: applied, maxPenalty: pts, passed: !isFailed, severity: isFailed ? sev : "info", detail: failed.get(code) ?? details.get(code) ?? "" });
  }
  const score = Math.max(0, 100 - penalty);
  const blockingCount = rules.filter((r) => !r.passed && r.severity === "blocking").length;

  return {
    version: 1,
    variant,
    score,
    designPoints: +((40 * score) / 100).toFixed(1),
    blockingCount,
    wouldPass: blockingCount === 0,
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
  };
}

function sevRank(s: Severity) {
  return s === "blocking" ? 0 : s === "warning" ? 1 : 2;
}
function pointInBBox(x: number, y: number, b: BBox) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}
