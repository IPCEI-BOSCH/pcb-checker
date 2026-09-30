import { useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GerberViewer } from "@/components/GerberViewer";
import type { DrcReport } from "@/lib/drc/engine";
import { CAD_LABELS, REMEDIES, type CadTool } from "@/lib/drc/remedies";
import type { Layer } from "@/lib/gerber/types";
import { cn } from "@/lib/utils";

export function DrcReportView({ report, layers }: { report: DrcReport; layers: Layer[] | null }) {
  const [cad, setCad] = useState<CadTool>("kicad");
  const [focus, setFocus] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Scor DRC" value={`${report.score}/100`} tone={report.score >= 80 ? "ok" : report.score >= 50 ? "warn" : "bad"} />
        <Stat label="Proiectare (barem)" value={`${report.designPoints}/40`} />
        <Stat label="Erori blocante" value={String(report.blockingCount)} tone={report.blockingCount ? "bad" : "ok"} />
        <Stat
          label="Status fabricație"
          value={report.manualReview ? "Evaluare manuală (THT)" : report.wouldPass ? "V-ar trece" : "V-ar fi respins"}
          tone={report.manualReview ? undefined : report.wouldPass ? "ok" : "bad"}
        />
      </div>

      {layers && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Vizualizator PCB</CardTitle>
            <Select value={cad} onValueChange={(v) => setCad(v as CadTool)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CAD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>Ghid: {v}</SelectItem>)}</SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <GerberViewer layers={layers} issues={report.issues} focus={focus} cad={cad} onSelectIssue={setFocus} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Barem reguli</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {report.rules.map((r) => (
              <div key={r.code} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
                {r.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : r.severity === "blocking" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> : r.severity === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className={cn("font-mono text-xs", r.penalty ? "text-destructive" : "text-muted-foreground")}>{r.penalty ? `−${r.penalty}p` : r.maxPenalty ? "0p" : ""}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Defecte detectate ({report.issues.length})</CardTitle></CardHeader>
          <CardContent className="max-h-[560px] space-y-1.5 overflow-y-auto">
            {!report.issues.length && <p className="text-sm text-muted-foreground">Nu au fost detectate defecte.</p>}
            {report.issues.map((iss, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setFocus(i)}
                className={cn("w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent", focus === i ? "border-primary bg-accent" : "border-border")}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                  <Badge variant={iss.severity === "blocking" ? "destructive" : "secondary"} className="text-[10px]">
                    {iss.severity === "blocking" ? "BLOCANT" : iss.severity === "warning" ? "AVERTISMENT" : "INFO"}
                  </Badge>
                  <span className="font-medium text-foreground">{iss.title}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{iss.message}</div>
                {focus === i && (
                  <div className="mt-2 rounded bg-muted p-2 text-xs text-foreground">
                    <span className="font-semibold">Remediere ({CAD_LABELS[cad]}): </span>
                    {REMEDIES[iss.code]?.[cad] ?? REMEDIES[iss.code]?.general}
                  </div>
                )}
              </button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Fișiere detectate</CardTitle></CardHeader>
        <CardContent className="grid gap-1 text-xs sm:grid-cols-2">
          {report.stats.layers.map((l) => (
            <div key={l.file} className="flex justify-between gap-2 font-mono">
              <span className="truncate text-foreground">{l.file}</span>
              <span className="text-muted-foreground">{l.kind} · {l.count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl font-semibold text-card-foreground", tone === "ok" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-destructive")}>{value}</div>
    </div>
  );
}
