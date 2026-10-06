/**
 * Series-relative scoring: a pair is suspicious only if it stands out from what is normal
 * in the series (simple themes make every board look alike) and from shared reference projects.
 */
export interface ScoredPair { a: string; b: string; total: number }
export interface Adjusted { adjusted: number; z: number; baseline: number }

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };

export function seriesBaseline(pairs: ScoredPair[]) {
  const totals = pairs.map((p) => p.total);
  const m = median(totals);
  const mad = median(totals.map((t) => Math.abs(t - m))) * 1.4826 || 5;
  const sum = new Map<string, { s: number; n: number }>();
  for (const p of pairs) for (const id of [p.a, p.b]) { const e = sum.get(id) ?? { s: 0, n: 0 }; e.s += p.total; e.n++; sum.set(id, e); }
  const mean = new Map([...sum].map(([k, v]) => [k, v.s / v.n]));
  return { median: m, mad, mean };
}

/** refSim(id) = similarity of a project to the closest teacher reference project (0 if none). */
export function adjustPair(p: ScoredPair, base: ReturnType<typeof seriesBaseline>, refSim: (id: string) => number = () => 0): Adjusted {
  const projectBase = ((base.mean.get(p.a) ?? base.median) + (base.mean.get(p.b) ?? base.median)) / 2;
  const ref = Math.min(refSim(p.a), refSim(p.b));
  const baseline = Math.min(95, Math.max(base.median, projectBase, ref));
  const adjusted = Math.round(Math.max(0, Math.min(100, (100 * (p.total - baseline)) / (100 - baseline))) * 10) / 10;
  const z = Math.round(((p.total - base.median) / base.mad) * 10) / 10;
  return { adjusted, z, baseline: Math.round(baseline * 10) / 10 };
}
