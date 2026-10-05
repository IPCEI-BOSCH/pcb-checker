import type { Layer } from "@/lib/gerber/types";

/** Translation/rotation-invariant layout fingerprint used for similarity checks between submissions. */
export interface Fingerprint {
  pads: number;
  holes: number;
  /** Normalized histogram of pairwise pad distances (0.5 mm bins up to 60 mm). */
  dist: number[];
  /** Normalized drill diameter histogram (0.1 mm bins up to 3 mm). */
  drill: number[];
  /** Radial copper density around board centroid (8 rings) — rotation invariant. */
  radial: number[];
  copperLen: number;
}

const DIST_BINS = 120;
const DRILL_BINS = 30;
const RINGS = 8;

const norm = (a: number[]) => {
  const s = Math.hypot(...a);
  return s ? a.map((v) => v / s) : a;
};

export function fingerprint(layers: Layer[]): Fingerprint {
  const copper = layers.filter((l) => l.kind === "top_copper" || l.kind === "bottom_copper");
  const pts: [number, number][] = [];
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
  // Deterministic subsample for large boards.
  const step = Math.max(1, Math.ceil(pts.length / 400));
  const sample = pts.filter((_, i) => i % step === 0);
  const dist = new Array(DIST_BINS).fill(0);
  for (let i = 0; i < sample.length; i++)
    for (let j = i + 1; j < sample.length; j++) {
      const d = Math.hypot(sample[i]![0] - sample[j]![0], sample[i]![1] - sample[j]![1]);
      dist[Math.min(DIST_BINS - 1, Math.floor(d / 0.5))]++;
    }
  const drill = new Array(DRILL_BINS).fill(0);
  for (const h of holes) drill[Math.min(DRILL_BINS - 1, Math.floor(h.d / 0.1))]++;
  const all = [...pts, ...segs.map((s) => [s[0], s[1]] as [number, number])];
  const cx = all.reduce((a, p) => a + p[0], 0) / (all.length || 1);
  const cy = all.reduce((a, p) => a + p[1], 0) / (all.length || 1);
  const maxR = Math.max(1, ...all.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
  const radial = new Array(RINGS).fill(0);
  for (const s of segs) radial[Math.min(RINGS - 1, Math.floor((Math.hypot(s[0] - cx, s[1] - cy) / maxR) * RINGS))] += s[2];
  for (const p of pts) radial[Math.min(RINGS - 1, Math.floor((Math.hypot(p[0] - cx, p[1] - cy) / maxR) * RINGS))] += 1;
  return { pads: pts.length, holes: holes.length, dist: norm(dist), drill: norm(drill), radial: norm(radial), copperLen };
}

const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
const ratio = (a: number, b: number) => (Math.max(a, b) ? Math.min(a, b) / Math.max(a, b) : 1);

/** Similarity 0..100. Weighted: pad geometry 45%, drills 20%, copper distribution 20%, counts 15%. */
export function similarity(a: Fingerprint, b: Fingerprint): number {
  if (!a.pads && !b.pads) return 0;
  const s =
    0.45 * cos(a.dist, b.dist) +
    0.2 * cos(a.drill, b.drill) +
    0.2 * cos(a.radial, b.radial) +
    0.15 * ((ratio(a.pads, b.pads) + ratio(a.holes, b.holes) + ratio(a.copperLen, b.copperLen)) / 3);
  return Math.round(Math.max(0, Math.min(1, s)) * 1000) / 10;
}
