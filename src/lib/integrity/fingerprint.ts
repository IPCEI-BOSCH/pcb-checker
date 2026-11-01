import type { Layer } from "@/lib/gerber/types";
import { outlineBBox } from "@/lib/gerber/parser";
import { extractTextBlocks } from "@/lib/silk/extract";

export const FP_VERSION = 6;
/** Bump when similarityDetail changes so cached pair scores are recomputed. */
export const PAIR_VERSION = 7;

type P2 = [number, number];
/** [midX, midY, angle 0..180°, width, length, layer 0=top 1=bottom] */
type Seg = [number, number, number, number, number, number?];

/** Layout fingerprint used for similarity checks between submissions. Point sets are centred on the board outline centre. */
export interface Fingerprint {
  v?: number;
  pads: number;
  holes: number;
  /** Normalized histogram of pairwise pad distances (0.5 mm bins up to 60 mm). */
  dist: number[];
  /** Normalized drill diameter histogram (0.1 mm bins up to 3 mm). */
  drill: number[];
  /** Radial copper density around board centroid (8 rings) — rotation invariant. */
  radial: number[];
  copperLen: number;
  padPts?: P2[];
  holePts?: [number, number, number][];
  copperPts?: P2[];
  silkPts?: P2[];
  segs?: Seg[];
  /** Reference point used to centre all point sets (outline centre in v4, copper centroid before). */
  centroid?: P2;
  /** v4: board outline size (mm). */
  board?: P2 | undefined;
  /** v5: small plated holes (≤0.65 mm) with copper on both layers — routing decisions, not schematic. */
  vias?: P2[];
  /** v5: technical metadata (staff only). */
  forensic?: Forensic;
  /** v7: RMS radius of the pad cloud around the centre — scale-camouflage detection. */
  rms?: number;
  /** v7: transform/scale-invariant topological routing signature (rubber-band invariance). */
  topo?: TopoSig;
}

/** v7: topological routing descriptor — survives local "rubber-band" dragging of segments. */
export interface TopoSig {
  /** 10 quantiles of segment lengths, normalized by total length (scale invariant). */
  lenQ: number[];
  /** Length-weighted histogram of segment directions (12 bins over 0..180°). */
  angH: number[];
  /** Junction density: segment endpoints touching another segment / endpoint count. */
  junctions: number;
  /** Vias per segment (routing style). */
  viaDensity: number;
}

export interface Forensic {
  apertureSignature: string[];
  cadHeader: string[];
  projectId?: string | undefined;
  zipMin?: number | undefined;
  zipMax?: number | undefined;
  /** v7: quantized distances (0.2 mm bins) between consecutive D03 flashes, in file order — rotation/translation invariant CAD export sequence. */
  flashSeq?: number[];
  /** v7: drill diameters (0.05 mm bins) + hole counts per tool, in first-use order. */
  drillSeq?: number[];
}

export interface ForensicFlags { identicalApertureOrder: boolean; sameProjectId: boolean; closeZipTimestamps: boolean; apertureOrderPct?: number; identicalCadSequence?: boolean }

/** Automatic pre-classification — replaces the generic "undecided" state. */
export type PairClass = "copiere_trasee" | "obfuscare" | "copie_partiala" | "inspectie" | "independent";

export interface SimilarityDetail {
  total: number;
  pads: number;
  holes: number;
  copper: number;
  silk: number;
  global: number;
  comps?: number;
  traces?: number;
  /** v5: same parts / same schematic (pads, components, holes without mounting holes). */
  schema?: number;
  /** v5: copper routing match, width-independent (centre lines). */
  routing?: number;
  /** v5: routing match with width too (exact copy). */
  routingExact?: number;
  /** v5: best 3x3 zone routing match. */
  routeZoneMax?: number;
  cls?: PairClass;
  /** v6: overlapped vias %. */
  viaMatch?: number | undefined;
  /** v6: routing ignoring the copper layer (TOP↔BOTTOM swap). */
  routingCrossLayer?: number;
  layerSwapDetected?: boolean;
  /** v6: best 5x5 overlapping window, in A's centred frame [x0,y0,x1,y1] mm. */
  bestZoneRect?: [number, number, number, number] | undefined;
  forensicFlags?: ForensicFlags;
  zoneMax?: number;
  zones?: number;
  partial?: boolean;
  prefiltered?: boolean;
  transform: { rot: number; mirror: boolean; dx: number; dy: number };
  verdict: "identic" | "foarte_similar" | "similar" | "diferit";
}

export const CLASS_LABEL: Record<PairClass, string> = {
  copiere_trasee: "Copiere trasee",
  obfuscare: "Copie camuflată",
  copie_partiala: "Copie parțială",
  inspectie: "De inspectat",
  independent: "Rutare independentă",
};
export const CLASS_RANK: Record<PairClass, number> = { copiere_trasee: 4, obfuscare: 4, copie_partiala: 3, inspectie: 2, independent: 0 };

/** Legacy pairs (no cls) are classified from what they have. */
export function classOf(d: SimilarityDetail): PairClass {
  if (d.cls) return d.cls;
  const r = d.traces ?? d.copper;
  return r >= 75 ? "copiere_trasee" : d.partial ? "copie_partiala" : r >= 40 || d.total >= 85 ? "inspectie" : "independent";
}

const DIST_BINS = 120;
const DRILL_BINS = 30;
const RINGS = 8;

const norm = (a: number[]) => {
  const s = Math.hypot(...a);
  return s ? a.map((v) => v / s) : a;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const sub = <T,>(a: T[], max: number) => { const step = Math.max(1, Math.ceil(a.length / max)); return a.filter((_, i) => i % step === 0); };

export function fingerprint(layers: Layer[]): Fingerprint {
  const copper = layers.filter((l) => l.kind === "top_copper" || l.kind === "bottom_copper");
  const pts: P2[] = [];
  let copperLen = 0;
  const segs: [number, number, number][] = [];
  const segFull: [number, number, number, number, number, number][] = [];
  for (const l of copper) {
    const ly = l.kind === "bottom_copper" ? 1 : 0;
    for (const p of l.primitives) {
      if (p.clear) continue;
      if (p.t === "flash") pts.push([p.x, p.y]);
      else if (p.t === "line") {
        const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
        copperLen += len;
        segs.push([(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2, len]);
        // Long segments are split into ~2 mm pieces so a partly re-routed trace still matches partly.
        if (len > 0.3) {
          const n = Math.max(1, Math.round(len / 2)), ang = ((Math.atan2(p.y2 - p.y1, p.x2 - p.x1) * 180) / Math.PI + 360) % 180;
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            segFull.push([p.x1 + (p.x2 - p.x1) * t, p.y1 + (p.y2 - p.y1) * t, ang, p.w, len / n, ly]);
          }
        }
      }
    }
  }
  const allHoles = layers.filter((l) => l.kind === "drill").flatMap((l) => l.holes);
  // v5: vias = small holes with copper nearby on BOTH layers.
  const near = (kind: string) => {
    const pts: P2[] = [];
    for (const l of copper) if (l.kind === kind) for (const p of l.primitives) {
      if (p.clear) continue;
      if (p.t === "flash") pts.push([p.x, p.y]); else if (p.t === "line") pts.push([p.x1, p.y1], [p.x2, p.y2]);
    }
    return index(pts, 1);
  };
  const nT = near("top_copper"), nB = near("bottom_copper");
  const hasNear = (m: Map<string, P2[]>, x: number, y: number, r: number) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of m.get(`${cx + i},${cy + j}`) ?? []) if (Math.hypot(q[0] - x, q[1] - y) <= r) return true;
    return false;
  };
  const viaList: P2[] = [];
  const holes = allHoles.filter((h) => {
    if (h.d <= 0.65 && hasNear(nT, h.x, h.y, h.d / 2 + 0.3) && hasNear(nB, h.x, h.y, h.d / 2 + 0.3)) { viaList.push([h.x, h.y]); return false; }
    return true;
  });
  const sample = sub(pts, 400);
  const dist = new Array(DIST_BINS).fill(0);
  for (let i = 0; i < sample.length; i++)
    for (let j = i + 1; j < sample.length; j++) {
      const d = Math.hypot(sample[i]![0] - sample[j]![0], sample[i]![1] - sample[j]![1]);
      dist[Math.min(DIST_BINS - 1, Math.floor(d / 0.5))]++;
    }
  const drill = new Array(DRILL_BINS).fill(0);
  for (const h of holes) drill[Math.min(DRILL_BINS - 1, Math.floor(h.d / 0.1))]++;
  const all = [...pts, ...segs.map((s) => [s[0], s[1]] as P2)];
  const cx = all.reduce((a, p) => a + p[0], 0) / (all.length || 1);
  const cy = all.reduce((a, p) => a + p[1], 0) / (all.length || 1);
  const maxR = Math.max(1, ...all.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  const radial = new Array(RINGS).fill(0);
  for (const s of segs) radial[Math.min(RINGS - 1, Math.floor((Math.hypot(s[0] - cx, s[1] - cy) / maxR) * RINGS))] += s[2];
  for (const p of pts) radial[Math.min(RINGS - 1, Math.floor((Math.hypot(p[0] - cx, p[1] - cy) / maxR) * RINGS))] += 1;
  // v4: point sets are centred on the board outline centre (stable reference) — falls back to the copper centroid.
  const outl = layers.find((l) => l.kind === "outline");
  const ob = outl ? outlineBBox(outl) : null;
  const okBox = ob && ob.maxX - ob.minX > 3 && ob.maxY - ob.minY > 3 && ob.maxX - ob.minX < 300;
  const ox = okBox ? (ob!.minX + ob!.maxX) / 2 : cx, oy = okBox ? (ob!.minY + ob!.maxY) / 2 : cy;
  const silk = [...extractTextBlocks(layers.find((l) => l.kind === "top_silk")), ...extractTextBlocks(layers.find((l) => l.kind === "bottom_silk"))];
  return {
    v: FP_VERSION,
    pads: pts.length,
    holes: holes.length,
    dist: norm(dist),
    drill: norm(drill),
    radial: norm(radial),
    copperLen,
    padPts: sub(pts, 400).map(([x, y]) => [r2(x - ox), r2(y - oy)]),
    holePts: sub(holes, 400).map((h) => [r2(h.x - ox), r2(h.y - oy), r2(h.d)]),
    copperPts: sub(segs, 600).map(([x, y]) => [r2(x - ox), r2(y - oy)]),
    silkPts: silk.slice(0, 150).map((b) => [r2(b.x - ox), r2(b.y - oy)]),
    segs: sub(segFull, 1000).map(([x, y, a, w, l, ly]) => [r2(x - ox), r2(y - oy), Math.round(a), r2(w), r2(l), ly]),
    centroid: [ox, oy],
    board: okBox ? [r2(ob!.maxX - ob!.minX), r2(ob!.maxY - ob!.minY)] : undefined,
    vias: sub(viaList, 300).map(([x, y]) => [r2(x - ox), r2(y - oy)]),
    forensic: forensicOf(layers),
  };
}

function forensicOf(layers: Layer[]): Forensic {
  const cu = ["top_copper", "bottom_copper"];
  const apertureSignature = layers.filter((l) => cu.includes(l.kind)).sort((a, b) => cu.indexOf(a.kind) - cu.indexOf(b.kind)).flatMap((l) => l.meta?.apertures ?? []).slice(0, 300);
  const src = layers.find((l) => l.kind === "top_copper") ?? layers.find((l) => l.meta?.header?.length);
  const cadHeader = src?.meta?.header ?? [];
  const pid = layers.flatMap((l) => l.meta?.header ?? []).find((h) => h.startsWith("%TF.ProjectId"));
  const times = layers.map((l) => l.meta?.mtime).filter((t): t is number => typeof t === "number" && t > 0);
  return { apertureSignature, cadHeader, projectId: pid?.replace(/^%TF\.ProjectId,?/, "").replace(/\*%?$/, "") || undefined, zipMin: times.length ? Math.min(...times) : undefined, zipMax: times.length ? Math.max(...times) : undefined };
}

export function forensicFlags(a?: Forensic, b?: Forensic): ForensicFlags {
  const sa = a?.apertureSignature ?? [], sb = b?.apertureSignature ?? [];
  let same = 0; const n = Math.max(sa.length, sb.length);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] === sb[i]) same++;
  const pct = n ? same / n : 0;
  const close = (x?: number, y?: number) => x != null && y != null && Math.abs(x - y) < 5 * 60_000;
  return {
    identicalApertureOrder: n >= 4 && pct >= 0.9,
    apertureOrderPct: Math.round(pct * 1000) / 10,
    sameProjectId: !!a?.projectId && a.projectId === b?.projectId,
    closeZipTimestamps: close(a?.zipMin, b?.zipMin) || close(a?.zipMax, b?.zipMax),
  };
}

const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
const ratio = (a: number, b: number) => (Math.max(a, b) ? Math.min(a, b) / Math.max(a, b) : 1);

/** Histogram-only similarity 0..1 (v1 behaviour). */
function globalSim(a: Fingerprint, b: Fingerprint) {
  return 0.45 * cos(a.dist, b.dist) + 0.2 * cos(a.drill, b.drill) + 0.2 * cos(a.radial, b.radial) + 0.15 * ((ratio(a.pads, b.pads) + ratio(a.holes, b.holes) + ratio(a.copperLen, b.copperLen)) / 3);
}

type Tf = { rot: number; mirror: boolean };
const TFS: Tf[] = [0, 90, 180, 270].flatMap((rot) => [{ rot, mirror: false }, { rot, mirror: true }]);
function apply(p: P2, t: Tf, dx = 0, dy = 0): P2 {
  let [x, y] = p;
  if (t.mirror) x = -x;
  const [c, s] = t.rot === 0 ? [1, 0] : t.rot === 90 ? [0, 1] : t.rot === 180 ? [-1, 0] : [0, -1];
  return [x * c - y * s + dx, x * s + y * c + dy];
}

function index(pts: P2[], cell: number) {
  const m = new Map<string, P2[]>();
  for (const p of pts) { const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; (m.get(k) ?? m.set(k, []).get(k)!).push(p); }
  return m;
}
/** Fraction of points of `b` (already transformed) that land within `tol` of a point of `a`, over max(|a|,|b|). */
function matchFrac(aIdx: Map<string, P2[]>, na: number, b: P2[], tol: number) {
  if (!na || !b.length) return na === b.length ? 1 : 0;
  let hit = 0;
  for (const p of b) {
    const cx = Math.floor(p[0] / tol), cy = Math.floor(p[1] / tol);
    let ok = false;
    for (let dx = -1; dx <= 1 && !ok; dx++)
      for (let dy = -1; dy <= 1 && !ok; dy++)
        for (const q of aIdx.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) { ok = true; break; }
    if (ok) hit++;
  }
  return hit / Math.max(na, b.length);
}

/**
 * Finds the rotation/mirror/translation that best overlays B onto A.
 * v5: candidates = outline-centred (0,0) + top 12 offset votes (pads + holes, larger sample),
 * each refined on a 0.05 mm grid; score uses pads AND trace midpoints so a one-pitch (2.54 mm) shift
 * that only lines up pin rows loses to the true alignment.
 */
function align(a: P2[], b: P2[], ca: P2[] = [], cb: P2[] = []) {
  const tol = 0.25;
  const aIdx = index(a, tol), cIdx = index(ca, 0.5);
  const sampleA = sub(a, 150);
  const scoreAt = (bt: P2[], ct: P2[], dx: number, dy: number) => {
    const sp = matchFrac(aIdx, a.length, bt.map(([x, y]) => [x + dx, y + dy] as P2), tol);
    if (ca.length < 5 || ct.length < 5) return { sp, s: sp };
    const sc = matchFrac(cIdx, ca.length, ct.map(([x, y]) => [x + dx, y + dy] as P2), 0.5);
    return { sp, s: 0.6 * sp + 0.4 * sc };
  };
  let best = { score: 0, rank: -1, t: TFS[0]!, dx: 0, dy: 0 };
  for (const t of TFS) {
    const bt = b.map((p) => apply(p, t)), ct = sub(cb, 300).map((p) => apply(p, t));
    const votes = new Map<string, number>();
    for (const pa of sampleA) for (const pb of bt) { const k = `${Math.round((pa[0] - pb[0]) / 0.25)},${Math.round((pa[1] - pb[1]) / 0.25)}`; votes.set(k, (votes.get(k) ?? 0) + 1); }
    const cands: P2[] = [[0, 0], ...[...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k]) => k.split(",").map((v) => +v * 0.25) as P2)];
    const scored = cands.map(([dx, dy]) => ({ dx, dy, ...scoreAt(bt, ct, dx, dy) })).sort((x, y) => y.s - x.s).slice(0, 3);
    for (const c of scored) {
      let cur = c;
      for (let ix = -4; ix <= 4; ix++) for (let iy = -4; iy <= 4; iy++) {
        if (!ix && !iy) continue;
        const dx = c.dx + ix * 0.05, dy = c.dy + iy * 0.05, r = scoreAt(bt, ct, dx, dy);
        if (r.s > cur.s) cur = { dx, dy, ...r };
      }
      if (cur.s > best.rank) best = { score: cur.sp, rank: cur.s, t, dx: r2(cur.dx), dy: r2(cur.dy) };
    }
  }
  return best;
}

/** Clusters pads into parts (single-linkage, 2.6 mm) and returns part centroids. */
function components(pads: P2[]): P2[] {
  const n = pads.length, link = 2.6;
  const parent = pads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const idx = index(pads, link);
  const key = (p: P2) => [Math.floor(p[0] / link), Math.floor(p[1] / link)];
  const pos = new Map(pads.map((p, i) => [p, i] as const));
  for (let i = 0; i < n; i++) {
    const [cx, cy] = key(pads[i]!) as [number, number];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const q of idx.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (Math.hypot(q[0] - pads[i]![0], q[1] - pads[i]![1]) <= link) parent[find(i)] = find(pos.get(q)!);
      }
  }
  const g = new Map<number, P2[]>();
  pads.forEach((p, i) => { const r = find(i); (g.get(r) ?? g.set(r, []).get(r)!).push(p); });
  return [...g.values()].map((ps) => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] as P2);
}

/** Per-zone (3x3) fraction of A's pads matched by transformed B pads. */
function zoneMatch(a: P2[], bt: P2[], tol: number) {
  const bIdx = index(bt, tol);
  const xs = a.map((p) => p[0]), ys = a.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1e-6, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1e-6;
  const tot = new Array(9).fill(0), hit = new Array(9).fill(0);
  for (const p of a) {
    const z = Math.min(2, Math.floor(((p[0] - x0) / (x1 - x0)) * 3)) + 3 * Math.min(2, Math.floor(((p[1] - y0) / (y1 - y0)) * 3));
    tot[z]++;
    if (matchFrac(bIdx, bt.length, [p], tol) > 0) hit[z]++;
  }
  let max = 0, good = 0;
  for (let z = 0; z < 9; z++) if (tot[z] >= 4) { const f = hit[z] / tot[z]; max = Math.max(max, f); if (f >= 0.85) good++; }
  return { max, good };
}

/**
 * Length-weighted fraction of trace pieces matched after applying B's transform.
 * loose = centre line only (position ±0.4 mm, direction ±10°, same layer) — immune to trace-width camouflage;
 * exact = also width ±25%. Also returns the best 3x3 zone match (partial / module copy).
 */
function traceMatch(a: Seg[], b: Seg[], t: Tf, dx: number, dy: number, anyLayer = false) {
  const out = { loose: 0, exact: 0, zoneMax: 0, zones: 0, rect: undefined as [number, number, number, number] | undefined };
  if (!a.length || !b.length) return out;
  const tol = 0.4;
  const m = new Map<string, number[]>();
  a.forEach((s, i) => { const k = `${Math.floor(s[0] / tol)},${Math.floor(s[1] / tol)}`; (m.get(k) ?? m.set(k, []).get(k)!).push(i); });
  const rotA = (ang: number) => { let r = t.mirror ? 180 - ang : ang; r += t.rot; return ((r % 180) + 180) % 180; };
  let hitL = 0, hitE = 0, wb = 0;
  const pieces: { x: number; y: number; l: number; ok: boolean }[] = [];
  for (const s of b) {
    const [x, y] = apply([s[0], s[1]], t, dx, dy);
    const ang = rotA(s[2]);
    const cx = Math.floor(x / tol), cy = Math.floor(y / tol);
    let loose = false, exact = false;
    for (let i = -1; i <= 1 && !exact; i++) for (let j = -1; j <= 1 && !exact; j++)
      for (const k of m.get(`${cx + i},${cy + j}`) ?? []) {
        const q = a[k]!; const da = Math.abs(q[2] - ang); const dA = Math.min(da, 180 - da);
        if (Math.abs(q[0] - x) > tol || Math.abs(q[1] - y) > tol || dA > 10) continue;
        if (!anyLayer && q[5] != null && s[5] != null && q[5] !== s[5]) continue;
        loose = true;
        if (Math.abs(q[3] - s[3]) <= 0.25 * Math.max(q[3], s[3], 0.1)) { exact = true; break; }
      }
    wb += s[4]; if (loose) hitL += s[4]; if (exact) hitE += s[4];
    pieces.push({ x, y, l: s[4], ok: loose });
  }
  const la = a.reduce((x, s) => x + s[4], 0), den = Math.max(la, wb, 1e-6);
  out.loose = hitL / den; out.exact = hitE / den;
  const xs = pieces.map((p) => p.x), ys = pieces.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1e-6, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1e-6;
  // v6: 5x5 windows of 1/3 board size overlapping by 50% — a copied block on a 3x3 border is not diluted.
  const ww = (x1 - x0) / 3, wh = (y1 - y0) / 3;
  const minLen = Math.max(10, 0.06 * wb);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    const wx0 = x0 + (i * ww) / 2, wy0 = y0 + (j * wh) / 2, wx1 = wx0 + ww, wy1 = wy0 + wh;
    let tot = 0, hit = 0;
    for (const p of pieces) if (p.x >= wx0 && p.x < wx1 && p.y >= wy0 && p.y < wy1) { tot += p.l; if (p.ok) hit += p.l; }
    if (tot < minLen) continue;
    const f = hit / tot;
    if (f > out.zoneMax) { out.zoneMax = f; out.rect = [r2(wx0), r2(wy0), r2(wx1), r2(wy1)]; }
    if (f >= 0.85) out.zones++;
  }
  return out;
}

/** Cheap check: boards whose pad/hole counts differ a lot cannot be copies — skips the costly alignment. */
export function prefilter(a: Fingerprint, b: Fingerprint) {
  return ratio(a.pads, b.pads) < 0.55 || ratio(a.holes || 1, b.holes || 1) < 0.55;
}

/** Mounting holes (≥2.8 mm) are identical on most boards of a series — excluded as boilerplate. */
const MOUNT_D = 2.8;

export function similarityDetail(a: Fingerprint, b: Fingerprint): SimilarityDetail {
  const global = Math.max(0, Math.min(1, globalSim(a, b)));
  const hasGeo = (a.padPts?.length ?? 0) >= 5 && (b.padPts?.length ?? 0) >= 5;
  const pf = hasGeo && prefilter(a, b);
  if (!hasGeo || pf) {
    const total = Math.round(global * (pf ? 600 : 1000)) / 10;
    return { total, pads: 0, holes: 0, copper: 0, silk: 0, global: Math.round(global * 1000) / 10, prefiltered: pf, cls: "independent", transform: { rot: 0, mirror: false, dx: 0, dy: 0 }, verdict: verdictOf(total) };
  }
  const segMid = (s?: Seg[]) => (s ?? []).map((x) => [x[0], x[1]] as P2);
  const al = align(a.padPts!, b.padPts!, segMid(a.segs), segMid(b.segs));
  const tr = (pts: P2[] | undefined) => (pts ?? []).map((p) => apply(p, al.t, al.dx, al.dy));
  const holesA = (a.holePts ?? []).filter((h) => h[2] < MOUNT_D).map(([x, y]) => [x, y] as P2);
  const holesB = tr((b.holePts ?? []).filter((h) => h[2] < MOUNT_D).map(([x, y]) => [x, y] as P2));
  const holes = matchFrac(index(holesA, 0.25), holesA.length, holesB, 0.25);
  const copper = matchFrac(index(a.copperPts ?? [], 0.5), a.copperPts?.length ?? 0, tr(b.copperPts), 0.5);
  const silkA = a.silkPts ?? [], silkB = tr(b.silkPts);
  const silk = silkA.length || silkB.length ? matchFrac(index(silkA, 0.6), silkA.length, silkB, 0.6) : 0;
  const hasSilk = silkA.length > 0 && silkB.length > 0;
  const compA = components(a.padPts!), compB = tr(components(b.padPts!));
  const comps = matchFrac(index(compA, 0.6), compA.length, compB, 0.6);
  const zm = zoneMatch(a.padPts!, tr(b.padPts), 0.25);
  const hasSegs = (a.segs?.length ?? 0) >= 5 && (b.segs?.length ?? 0) >= 5;
  const tm = hasSegs ? traceMatch(a.segs!, b.segs!, al.t, al.dx, al.dy) : { loose: copper, exact: copper, zoneMax: zm.max, zones: zm.good, rect: undefined };
  const cross = hasSegs ? traceMatch(a.segs!, b.segs!, al.t, al.dx, al.dy, true).loose : tm.loose;
  const va = a.vias ?? [], vb = tr(b.vias);
  const hasVias = va.length >= 3 && vb.length >= 3;
  const viaMatch = hasVias ? matchFrac(index(va, 0.25), va.length, vb, 0.25) : 0;
  const ff = forensicFlags(a.forensic, b.forensic);
  const schema = 0.4 * comps + 0.35 * al.score + 0.25 * holes;
  const routing = hasVias ? 0.85 * tm.loose + 0.15 * viaMatch : tm.loose;
  const layerSwapDetected = cross - tm.loose >= 0.2 && cross >= 0.7;
  // Routing dominates: same schematic alone (same theme) must not look like a copy.
  const s = hasSilk
    ? 0.45 * routing + 0.15 * tm.exact + 0.2 * schema + 0.1 * silk + 0.1 * global
    : 0.5 * routing + 0.15 * tm.exact + 0.25 * schema + 0.1 * global;
  const total = Math.round(Math.max(0, Math.min(1, s)) * 1000) / 10;
  const pct = (v: number) => Math.round(v * 1000) / 10;
  const partial = routing < 0.75 && tm.zones >= 1 && tm.zoneMax >= 0.9 && (zm.max >= 0.85 || !hasSegs);
  const cls: PairClass = layerSwapDetected ? "obfuscare" : routing >= 0.75
    ? (hasSilk && silk < 0.2 ? "obfuscare" : "copiere_trasee")
    : partial ? "copie_partiala"
    : routing >= 0.4 ? "inspectie" : "independent";
  return {
    total, pads: pct(al.score), holes: pct(holes), copper: pct(copper), silk: pct(silk), global: pct(global),
    comps: pct(comps), traces: pct(routing), schema: pct(schema), routing: pct(routing), routingExact: pct(tm.exact), routeZoneMax: pct(tm.zoneMax),
    cls, zoneMax: pct(zm.max), zones: tm.zones, partial,
    viaMatch: hasVias ? pct(viaMatch) : undefined, routingCrossLayer: pct(cross), layerSwapDetected, bestZoneRect: tm.rect, forensicFlags: ff,
    transform: { rot: al.t.rot, mirror: al.t.mirror, dx: al.dx, dy: al.dy }, verdict: verdictOf(total),
  };
}

export function verdictOf(total: number): SimilarityDetail["verdict"] {
  return total >= 92 ? "identic" : total >= 80 ? "foarte_similar" : total >= 65 ? "similar" : "diferit";
}

export const VERDICT_LABEL: Record<SimilarityDetail["verdict"], string> = { identic: "Identic", foarte_similar: "Foarte similar", similar: "Similar", diferit: "Diferit" };

/** Similarity 0..100 (kept for callers that only need the number). */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  return similarityDetail(a, b).total;
}

/** Transforms B's points with a similarity result's transform (for overlay drawing). */
export function transformPts(pts: P2[], t: SimilarityDetail["transform"]): P2[] {
  return pts.map((p) => apply(p, { rot: t.rot, mirror: t.mirror }, t.dx, t.dy));
}
