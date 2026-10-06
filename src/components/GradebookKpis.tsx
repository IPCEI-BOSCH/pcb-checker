import type { GradebookKpis as K } from "@/lib/gradebook";
import { Card, CardContent } from "@/components/ui/card";

export function GradebookKpis({ k, alerts }: { k: K; alerts: number | null }) {
  const items: [string, string, string?][] = [
    ["Studenți / predări", `${k.submitted} / ${k.total}`, `${k.submitRate}% au predat`],
    ["Conformitate DRC", `${k.approved} aprobați`, `${k.rejected} respinși · ${k.pending} în evaluare`],
    ["Situație notare", `${k.graded} / ${k.total}`, `${k.needsGrading} necesită notare`],
    ["Medie DRC (0–40)", k.avgDrc?.toString() ?? "—"],
    ["Medii schemă / doc.", `${k.avgSchema ?? "—"} / ${k.avgDoc ?? "—"}`],
    ["Medie notă finală", k.avgFinal?.toString() ?? "—"],
  ];
  if (alerts != null) items.push(["Alerte integritate", String(alerts), "nerezolvate"]);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {items.map(([label, value, sub]) => (
        <Card key={label}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold text-foreground">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
