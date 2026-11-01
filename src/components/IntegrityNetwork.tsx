import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLASS_LABEL, classOf, type SimilarityDetail } from "@/lib/integrity/fingerprint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type R = { studentId: string; name: string; score?: number | null; group?: string | undefined; submittedAt?: string | null };
type P<Row extends R> = { a: Row; b: Row; d: SimilarityDetail };
type Hist = { student_id: string; created_at: string; drc_score: number | null; kind: string };

/** Per-student chronology of self-check/official runs — the basis of the source→copy inference. */
interface Chrono { first: number; iterations: number; firstScore: number | null; lastScore: number | null }

function chronoOf(list: Hist[]): Chrono | null {
  if (!list.length) return null;
  const scores = list.map((h) => h.drc_score).filter((s): s is number => s != null);
  return {
    first: Date.parse(list[0]!.created_at),
    iterations: list.length,
    firstScore: scores[0] ?? null,
    lastScore: scores[scores.length - 1] ?? null,
  };
}

/**
 * Who copied from whom: the probable source is the student whose topology appeared first
 * AND who shows progressive iterations (score growing over days). A student whose first
 * upload is already at the final score, after the other's iterations, is the probable copy.
 */
export function inferDirection(ca: Chrono | null, cb: Chrono | null): { source: "a" | "b"; reason: string } | null {
  if (!ca || !cb) return null;
  const dtH = (ca.first - cb.first) / 3_600_000; // negative = a earlier
  const earlier: "a" | "b" | null = dtH <= -1 ? "a" : dtH >= 1 ? "b" : null;
  if (!earlier) return null;
  const late = earlier === "a" ? cb : ca;
  const early = earlier === "a" ? ca : cb;
  const hours = Math.round(Math.abs(dtH));
  const grew = early.firstScore != null && early.lastScore != null && early.lastScore - early.firstScore >= 10;
  const lateInstant = late.iterations <= 2 && (late.firstScore == null || late.lastScore == null || late.lastScore - late.firstScore < 10);
  const bits: string[] = [];
  if (early.iterations > late.iterations) bits.push(`${early.iterations} iterații anterioare în Self-Check`);
  if (grew) bits.push(`scor crescut progresiv ${early.firstScore} → ${early.lastScore}`);
  bits.push(`cu ${hours >= 24 ? `${Math.round(hours / 24)} zile` : `${hours}h`} înainte`);
  // Confidence: chronology alone is a hint; iterations + growth make it strong.
  if (!lateInstant && early.iterations <= late.iterations && !grew) return null;
  return { source: earlier, reason: bits.join(", ") };
}

const GROUP_COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#6366f1"];
const groupColor = (g?: string) => {
  if (!g) return "#64748b";
  let h = 0;
  for (const c of g) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
};

/** Plagiarism network graph: nodes = students (colour = group, size = DRC score), edges = suspect pairs with source→copy arrows. */
export function IntegrityNetwork<Row extends R>({ pairs, onOpen }: { pairs: P<Row>[]; onOpen: (p: P<Row>) => void }) {
  const ids = useMemo(() => [...new Set(pairs.flatMap((p) => [p.a.studentId, p.b.studentId]))], [pairs]);
  const hist = useQuery({
    queryKey: ["integrity_history", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const out: Hist[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await supabase.from("submissions").select("student_id, created_at, drc_score, kind").in("student_id", ids.slice(i, i + 150)).order("created_at", { ascending: true });
        out.push(...((data ?? []) as Hist[]));
      }
      return out;
    },
  });
  const chrono = useMemo(() => {
    const m = new Map<string, Chrono | null>();
    const by = new Map<string, Hist[]>();
    for (const h of hist.data ?? []) (by.get(h.student_id) ?? by.set(h.student_id, []).get(h.student_id)!).push(h);
    for (const id of ids) m.set(id, chronoOf(by.get(id) ?? []));
    return m;
  }, [hist.data, ids]);

  const components = useMemo(() => {
    const parent = new Map<string, string>();
    const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
    for (const p of pairs) parent.set(find(p.a.studentId), find(p.b.studentId));
    const comps = new Map<string, { nodes: Map<string, Row>; edges: P<Row>[] }>();
    for (const p of pairs) {
      const k = find(p.a.studentId);
      const c = comps.get(k) ?? comps.set(k, { nodes: new Map(), edges: [] }).get(k)!;
      c.nodes.set(p.a.studentId, p.a); c.nodes.set(p.b.studentId, p.b); c.edges.push(p);
    }
    return [...comps.values()].sort((x, y) => y.nodes.size - x.nodes.size);
  }, [pairs]);

  if (!pairs.length) return <p className="text-sm text-muted-foreground">Nicio pereche suspectă peste pragul activ — nu există rețea de afișat.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Nod = student (culoare = grupa, dimensiune = scorul DRC). Muchie = pereche suspectă (grosime = scorul de rutare; linie punctată portocalie = camuflaj: layer-swap sau scalare). Săgeata arată direcția probabilă Sursă → Copie, inferată din cronologia Self-Check — indiciu, nu dovadă.
      </p>
      {hist.isLoading && <p className="text-xs text-muted-foreground">Se încarcă cronologia încercărilor…</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {components.map((c, ci) => {
          const nodes = [...c.nodes.values()];
          const W = 460, H = Math.max(240, 120 + nodes.length * 22), cx = W / 2, cy = H / 2 - 10;
          const rad = Math.min(W, H) / 2 - 46;
          const pos = new Map(nodes.map((n, k) => [n.studentId, [cx + rad * Math.cos((2 * Math.PI * k) / nodes.length - Math.PI / 2), cy + rad * Math.sin((2 * Math.PI * k) / nodes.length - Math.PI / 2)] as const]));
          const dirs = c.edges.map((e) => {
            const d = inferDirection(chrono.get(e.a.studentId) ?? null, chrono.get(e.b.studentId) ?? null);
            return d ? { ...d, from: d.source === "a" ? e.a : e.b, to: d.source === "a" ? e.b : e.a } : null;
          });
          return (
            <Card key={ci}>
              <CardHeader className="pb-2"><CardTitle className="text-base">Rețea #{ci + 1} — {nodes.length} studenți, {c.edges.length} legături suspecte</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Rețea de plagiat ${ci + 1}`}>
                  <defs>
                    <marker id={`arr-${ci}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 1 L 9 5 L 0 9 z" className="fill-destructive" />
                    </marker>
                  </defs>
                  {c.edges.map((e, k) => {
                    const [x1, y1] = pos.get(e.a.studentId)!, [x2, y2] = pos.get(e.b.studentId)!;
                    const cls = classOf(e.d);
                    const obf = cls === "obfuscare";
                    const routing = e.d.routing ?? e.d.traces ?? 0;
                    const dir = dirs[k];
                    // Shorten the line at the target end so the arrowhead is visible outside the node.
                    let ex = x2, ey = y2;
                    if (dir) {
                      const [fx, fy] = dir.source === "a" ? [x1, y1] : [x2, y2];
                      const [tx, ty] = dir.source === "a" ? [x2, y2] : [x1, y1];
                      const len = Math.hypot(tx - fx, ty - fy) || 1;
                      const rr = 10 + ((dir.to.score ?? 50) / 100) * 8 + 4;
                      ex = tx - ((tx - fx) / len) * rr; ey = ty - ((ty - fy) / len) * rr;
                    }
                    const sx = dir ? (dir.source === "a" ? x1 : x2) : x1, sy = dir ? (dir.source === "a" ? y1 : y2) : y1;
                    return (
                      <g key={k} className="cursor-pointer" onClick={() => onOpen(e)}>
                        <line
                          x1={sx} y1={sy} x2={dir ? ex : x2} y2={dir ? ey : y2}
                          stroke={obf ? "#f59e0b" : "hsl(var(--destructive))"}
                          strokeWidth={1.5 + routing / 22}
                          strokeDasharray={obf ? "6 4" : undefined}
                          strokeOpacity={0.85}
                          markerEnd={dir ? `url(#arr-${ci})` : undefined}
                        />
                        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="fill-foreground text-[9px]">
                          {Math.round(routing)}% · {CLASS_LABEL[cls]}{e.d.obfuscationSubtype === "scalare_artificiala" ? ` (×${e.d.scaleFactor})` : ""}
                        </text>
                      </g>
                    );
                  })}
                  {nodes.map((n) => {
                    const [x, y] = pos.get(n.studentId)!;
                    const r = 8 + ((n.score ?? 50) / 100) * 8;
                    const isSource = dirs.some((d) => d?.from.studentId === n.studentId);
                    return (
                      <g key={n.studentId}>
                        <circle cx={x} cy={y} r={r} fill={groupColor(n.group)} fillOpacity={0.85} stroke={isSource ? "hsl(var(--destructive))" : "hsl(var(--border))"} strokeWidth={isSource ? 3 : 1} />
                        <text x={x} y={y + r + 12} textAnchor="middle" className="fill-foreground text-[10px]">{n.name.length > 24 ? n.name.slice(0, 23) + "…" : n.name}</text>
                        {n.group && <text x={x} y={y + r + 23} textAnchor="middle" className="fill-muted-foreground text-[8px]">{n.group}</text>}
                      </g>
                    );
                  })}
                </svg>
                <div className="space-y-1">
                  {c.edges.map((e, k) => {
                    const dir = dirs[k];
                    if (!dir) return null;
                    return (
                      <div key={k} className="text-xs">
                        <Badge variant="secondary">Sursă probabilă</Badge>{" "}
                        <b>{dir.from.name}</b> → {dir.to.name} <span className="text-muted-foreground">({dir.reason})</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Clic pe o muchie pentru comparația Gerber. Contur roșu pe nod = sursă probabilă în cel puțin o pereche.</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
