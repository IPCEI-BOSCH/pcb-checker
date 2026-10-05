import type { Layer } from "@/lib/gerber/types";
import { extractTextBlocks } from "@/lib/silk/extract";

export const FP_VERSION = 2;

type P2 = [number, number];

/** Layout fingerprint used for similarity checks between submissions. Point sets are centred on the copper centroid. */
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
  /** v2: centred point sets used for geometric alignment (rotation 0/90/180/270, mirror, translation). */
  padPts?: P2[];
  holePts?: [number, number, number][];
  copperPts?: P2[];
  silkPts?: P2[];
}

export interface SimilarityDetail {
  total: number;
  pads: number;
  holes: number;
  copper: number;
  silk: number;
  global: number;
  /** Best transform: rotation in degrees, mirror flag, translation applied to B. */
  transform: { rot: number; mirror: boolean; dx: number; dy: number };
  verdict: "identic" | "foarte_similar" | "similar" | "diferit";
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
  for (const l of copper) {
    for (const p of l.primitives) {
      if (p.clear) continue;
      if (p.t === "flash") pts.push([p.x, p.y]);
      else if (p.t === "line") {
        const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
        copperLen += len;
        segs.push([(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2, len]);
      }
    }
  }
  const holes = layers.filter((l) => l.kind === "drill").flatMap((l) => l.holes);
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
  const silk = [...extractTextBlocks(layers.find((l) => l.kind === "top_silk")), ...extractTextBlocks(layers.find((l) => l.kind === "bottom_silk"))];
  return {
    v: FP_VERSION,
    pads: pts.length,
    holes: holes.length,
    dist: norm(dist),
    drill: norm(drill),
    radial: norm(radial),
    copperLen,
    padPts: sub(pts, 400).map(([x, y]) => [r2(x - cx), r2(y - cy)]),
    holePts: sub(holes, 400).map((h) => [r2(h.x - cx), r2(h.y - cy), r2(h.d)]),
    copperPts: sub(segs, 600).map(([x, y]) => [r2(x - cx), r2(y - cy)]),
    silkPts: silk.slice(0, 150).map((b) => [r2(b.x - cx), r2(b.y - cy)]),
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

/** Finds the rotation/mirror/translation that best overlays B's pads onto A's (offset voting, then exact match count). */
function align(a: P2[], b: P2[]) {
  const tol = 0.25;
  const aIdx = index(a, tol);
  const sampleA = sub(a, 40);
  let best = { score: 0, t: TFS[0]!, dx: 0, dy: 0 };
  for (const t of TFS) {
    const bt = b.map((p) => apply(p, t));
    const votes = new Map<string, number>();
    for (const pa of sampleA) for (const pb of bt) { const k = `${Math.round((pa[0] - pb[0]) / 0.2)},${Math.round((pa[1] - pb[1]) / 0.2)}`; votes.set(k, (votes.get(k) ?? 0) + 1); }
    const top = [...votes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    top.push(["0,0", 0]);
    for (const [k] of top) {
      const [ix, iy] = k.split(",").map(Number) as [number, number];
      const dx = ix * 0.2, dy = iy * 0.2;
      const score = matchFrac(aIdx, a.length, bt.map(([x, y]) => [x + dx, y + dy] as P2), tol);
      if (score > best.score) best = { score, t, dx, dy };
    }
  }
  return best;
}

export function similarityDetail(a: Fingerprint, b: Fingerprint): SimilarityDetail {
  const global = Math.max(0, Math.min(1, globalSim(a, b)));
  const hasGeo = (a.padPts?.length ?? 0) >= 5 && (b.padPts?.length ?? 0) >= 5;
  if (!hasGeo) {
    const total = Math.round(global * 1000) / 10;
    return { total, pads: 0, holes: 0, copper: 0, silk: 0, global: total, transform: { rot: 0, mirror: false, dx: 0, dy: 0 }, verdict: verdictOf(total) };
  }
  const al = align(a.padPts!, b.padPts!);
  const tr = (pts: P2[] | undefined) => (pts ?? []).map((p) => apply(p, al.t, al.dx, al.dy));
  const holesA = (a.holePts ?? []).map(([x, y]) => [x, y] as P2);
  const holesB = tr((b.holePts ?? []).map(([x, y]) => [x, y] as P2));
  const holes = matchFrac(index(holesA, 0.25), holesA.length, holesB, 0.25);
  const copper = matchFrac(index(a.copperPts ?? [], 0.5), a.copperPts?.length ?? 0, tr(b.copperPts), 0.5);
  const silkA = a.silkPts ?? [], silkB = tr(b.silkPts);
  const silk = silkA.length || silkB.length ? matchFrac(index(silkA, 0.6), silkA.length, silkB, 0.6) : 0;
  const hasSilk = silkA.length > 0 && silkB.length > 0;
  const s = hasSilk
    ? 0.35 * al.score + 0.2 * holes + 0.2 * copper + 0.1 * silk + 0.15 * global
    : 0.4 * al.score + 0.2 * holes + 0.25 * copper + 0.15 * global;
  const total = Math.round(Math.max(0, Math.min(1, s)) * 1000) / 10;
  const pct = (v: number) => Math.round(v * 1000) / 10;
  return { total, pads: pct(al.score), holes: pct(holes), copper: pct(copper), silk: pct(silk), global: pct(global), transform: { rot: al.t.rot, mirror: al.t.mirror, dx: al.dx, dy: al.dy }, verdict: verdictOf(total) };
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
