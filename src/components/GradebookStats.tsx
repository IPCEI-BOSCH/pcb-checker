import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import type { GradeRow } from "@/lib/gradebook";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Pedagogical summary: group/series average, pass rate (ADMIS/REZERVE/RESPINS) and final-grade histogram. */
export function GradebookStats({ rows }: { rows: GradeRow[] }) {
  const s = useMemo(() => {
    const submitted = rows.filter((r) => r.reviewStatus !== "none");
    const admis = rows.filter((r) => r.reviewStatus === "approved").length;
    const rezerve = rows.filter((r) => r.reviewStatus === "pending").length;
    const respins = rows.filter((r) => r.reviewStatus === "rejected").length;
    const finals = rows.map((r) => r.gradeFinal).filter((x): x is number => x != null);
    const avg = finals.length ? finals.reduce((a, b) => a + b, 0) / finals.length : null;
    const pass = finals.filter((g) => g >= 5).length;
    const bins = new Array(10).fill(0) as number[];
    for (const g of finals) bins[Math.min(9, Math.max(0, Math.floor(g) - 1))]!++;
    return { submitted: submitted.length, admis, rezerve, respins, avg, pass, graded: finals.length, bins };
  }, [rows]);

  if (!rows.length) return null;
  const maxBin = Math.max(1, ...s.bins);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-5 w-5" /> Statistici pedagogice</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Media notelor finale</div><div className="text-2xl font-semibold">{s.avg?.toFixed(2) ?? "—"}</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Promovabilitate (≥5)</div><div className="text-2xl font-semibold">{s.graded ? Math.round((s.pass / s.graded) * 100) : 0}%</div><div className="text-xs text-muted-foreground">{s.pass}/{s.graded} notate</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">ADMIS fabricație</div><div className="text-2xl font-semibold text-success">{s.admis}</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">REZERVE / RESPINS</div><div className="text-2xl font-semibold"><span className="text-warning">{s.rezerve}</span> / <span className="text-destructive">{s.respins}</span></div></div>
        </div>
        <div>
          <div className="mb-1 text-sm text-muted-foreground">Histograma notelor finale</div>
          <div className="flex h-24 items-end gap-1.5">
            {s.bins.map((b, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px]">{b || ""}</span>
                <div className={`w-full rounded-t ${i + 1 >= 5 ? "bg-primary" : "bg-destructive/70"}`} style={{ height: `${(b / maxBin) * 64}px` }} />
                <span className="text-[10px] text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
