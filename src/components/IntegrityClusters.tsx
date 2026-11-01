import { CLASS_LABEL, classOf, type Fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type R = { studentId: string; submissionId: string | null; name: string; submittedAt?: string | null };
type P<Row extends R> = { a: Row; b: Row; d: SimilarityDetail };

/** Connected components of the filtered pairs, drawn as small graphs; earliest submission/ZIP is marked as a chronological hint only. */
export function IntegrityClusters<Row extends R>({ pairs, fps, onOpen }: { pairs: P<Row>[]; fps: Map<string, Fingerprint>; onOpen: (p: P<Row>) => void }) {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const p of pairs) parent.set(find(p.a.studentId), find(p.b.studentId));
  const groups = new Map<string, { rows: Map<string, Row>; edges: P<Row>[] }>();
  for (const p of pairs) {
    const k = find(p.a.studentId);
    const g = groups.get(k) ?? groups.set(k, { rows: new Map(), edges: [] }).get(k)!;
    g.rows.set(p.a.studentId, p.a); g.rows.set(p.b.studentId, p.b); g.edges.push(p);
  }
  const list = [...groups.values()].sort((x, y) => y.rows.size - x.rows.size);
  if (!list.length) return <p className="text-sm text-muted-foreground">Nu există grupuri peste pragul activ.</p>;

  const timeOf = (r: Row) => {
    const sub = r.submittedAt ? Date.parse(r.submittedAt) : Infinity;
    const zip = (r.submissionId && fps.get(r.submissionId)?.forensic?.zipMin) || Infinity;
    return Math.min(sub, zip);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((g, i) => {
        const nodes = [...g.rows.values()];
        const origin = nodes.reduce((a, b) => (timeOf(b) < timeOf(a) ? b : a));
        const W = 320, H = 220, cx = W / 2, cy = H / 2, rad = nodes.length === 2 ? 90 : 80;
        const pos = new Map(nodes.map((n, k) => [n.studentId, [cx + rad * Math.cos((2 * Math.PI * k) / nodes.length - Math.PI / 2), cy + rad * Math.sin((2 * Math.PI * k) / nodes.length - Math.PI / 2)] as const]));
        return (
          <Card key={i}>
            <CardHeader className="pb-2"><CardTitle className="text-base">Cluster #{i + 1} — {nodes.length} studenți implicați</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Graf cluster ${i + 1}`}>
                {g.edges.map((e, k) => {
                  const [x1, y1] = pos.get(e.a.studentId)!, [x2, y2] = pos.get(e.b.studentId)!;
                  const strong = (e.d.routing ?? e.d.traces ?? 0) >= 75;
                  return (
                    <g key={k} className="cursor-pointer" onClick={() => onOpen(e)}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} className={strong ? "stroke-destructive" : "stroke-muted-foreground"} strokeWidth={strong ? 3 : 1.5} />
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 3} textAnchor="middle" className="fill-foreground text-[9px]">{Math.round(e.d.routing ?? e.d.traces ?? 0)}% · {CLASS_LABEL[classOf(e.d)]}</text>
                    </g>
                  );
                })}
                {nodes.map((n) => { const [x, y] = pos.get(n.studentId)!; return (
                  <g key={n.studentId}>
                    <circle cx={x} cy={y} r={7} className={n === origin ? "fill-primary" : "fill-secondary stroke-border"} />
                    <text x={x} y={y + 18} textAnchor="middle" className="fill-foreground text-[10px]">{n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name}</text>
                  </g>
                ); })}
              </svg>
              {Number.isFinite(timeOf(origin)) && (
                <div className="text-xs"><Badge variant="secondary">Posibilă origine (cronologic)</Badge> {origin.name} — doar un indiciu cronologic (predare sau fișiere din arhivă mai vechi), nu o dovadă.</div>
              )}
              <p className="text-xs text-muted-foreground">Clic pe o muchie pentru comparația Gerber.</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
