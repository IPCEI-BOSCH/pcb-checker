import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Crosshair, FileText, Info, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openEvaluationSheet, type EvaluationMeta } from "@/lib/drc/evaluationSheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GerberViewer } from "@/components/GerberViewer";
import type { DrcReport } from "@/lib/drc/engine";
import { CAD_LABELS, REMEDIES, type CadTool } from "@/lib/drc/remedies";
import { CATALOG, CATEGORY_LABELS } from "@/lib/drc/catalog";
import type { Layer } from "@/lib/gerber/types";
import { cn } from "@/lib/utils";

export function DrcReportView({ report, layers, meta }: { report: DrcReport; layers: Layer[] | null; meta?: EvaluationMeta }) {
  const [cad] = useState<CadTool>("orcad");
  const [focus, setFocus] = useState<number | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const locate = (code: string) => {
    const i = report.issues.findIndex((x) => x.code === code && x.x != null);
    if (i < 0) return;
    setFocus(i);
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => openEvaluationSheet(report, meta)}><FileText className="mr-1 h-4 w-4" /> Fișă de evaluare (PDF / print)</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Scor DRC" value={`${report.score}/100`} tone={report.score >= 80 ? "ok" : report.score >= 50 ? "warn" : "bad"} />
        <Stat label="Proiectare (barem)" value={`${report.designPoints}/40`} />
        <Stat label="Erori blocante" value={String(report.blockingCount)} tone={report.blockingCount ? "bad" : "ok"} />
        <Stat
          label="Status fabricație"
          value={report.manualReview ? "Evaluare manuală (THT)" : report.verdict === "admis" ? "Admis fabricație" : report.verdict === "rezerve" ? "Admis cu rezerve" : report.verdict === "respins" ? "Respins fabricație" : report.wouldPass ? "V-ar trece" : "V-ar fi respins"}
          tone={report.manualReview ? undefined : report.verdict === "rezerve" ? "warn" : report.wouldPass ? "ok" : "bad"}
        />
      </div>

      {!!report.criticalCount && (
        <div role="alert" className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-foreground">
          <div className="flex items-center gap-2 font-semibold text-destructive"><XCircle className="h-4 w-4" /> Eroare critică — proiectul nu poate intra în fabricație</div>
          <p className="mt-1">Există {report.criticalCount} {report.criticalCount === 1 ? "eroare critică" : "erori critice"} (de ex. găuri în afara pad-urilor sau placă mai mare decât formatul). Scorul a fost limitat automat. Corectați-le întâi — explicațiile sunt mai jos.</p>
        </div>
      )}

      {report.rules.some((r) => !r.passed) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">De ce ai pierdut puncte și ce trebuie să repari</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {report.rules.filter((r) => !r.passed).sort((a, b) => Number(!!b.critical) - Number(!!a.critical) || b.penalty - a.penalty).map((r) => {
              const c = CATALOG[r.code];
              return (
                <div key={r.code} className={cn("rounded-md border p-3 text-sm", r.critical ? "border-destructive" : "border-border")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {c && <span className="font-mono text-xs text-muted-foreground">{c.err}</span>}
                      <span className="font-semibold text-foreground">{r.title}</span>
                      {c && <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[c.category]}</Badge>}
                      {r.critical && <Badge variant="destructive" className="text-[10px]">CRITIC</Badge>}
                    </div>
                    <span className="flex items-center gap-2">
                    {layers && report.issues.some((x) => x.code === r.code && x.x != null) && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => locate(r.code)}><Crosshair className="mr-1 h-3 w-3" /> Localizează pe placă</Button>
                    )}
                    <span className="font-mono text-xs text-destructive">−{r.penalty}p{r.count && r.count > 1 ? ` · ${r.count} apariții` : ""}{r.penalty >= r.maxPenalty && r.maxPenalty ? " (plafon)" : ""}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Constatat: {r.detail}</p>
                  {c && (
                    <dl className="mt-2 grid gap-1 text-xs">
                      <div><dt className="inline font-semibold text-foreground">Ce e greșit: </dt><dd className="inline">{c.what}</dd></div>
                      <div><dt className="inline font-semibold text-foreground">De ce contează: </dt><dd className="inline">{c.why}</dd></div>
                      <div><dt className="inline font-semibold text-foreground">Cum repari: </dt><dd className="inline">{c.fix}</dd></div>
                      {REMEDIES[r.code]?.[cad] && <div><dt className="inline font-semibold text-foreground">În {CAD_LABELS[cad]}: </dt><dd className="inline">{REMEDIES[r.code]?.[cad]}</dd></div>}
                    </dl>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {layers && (
        <Card ref={viewerRef}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Vizualizator PCB</CardTitle>
            <span className="text-xs text-muted-foreground">Ghid remediere: {CAD_LABELS[cad]}</span>
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
                    {REMEDIES[iss.code]?.[cad] ?? REMEDIES[iss.code]?.general ?? CATALOG[iss.code]?.fix}
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
