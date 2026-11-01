import { useState } from "react";
import { ArrowRight, CheckSquare, ChevronDown, ChevronUp, MonitorCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Structural/export error codes that trigger the visual OrCAD/Allegro export wizard. */
export const EXPORT_GUIDE_CODES = ["MISSING_LAYER", "DRL_COUNT", "HOLE_OUTSIDE_PAD", "ORIGIN", "MASK_DUPLICATE"];

interface Step { title: string; detail: string; checks?: string[] }

const ARTWORK_STEPS: Step[] = [
  { title: "Manufacture → Artwork…", detail: "Se deschide fereastra „Artwork Control Form”. În tab-ul „Film Control” trebuie să existe câte un film pentru fiecare strat cerut de platformă: TOP, BOTTOM, SMTOP, SMBOT, SPTOP, SSTOP, FAB și conturul (BO).", checks: ["TOP", "BOTTOM", "SOLDERMASK TOP (SMTOP)", "SOLDERMASK BOTTOM (SMBOT)", "PASTEMASK TOP (SPTOP)", "PASTEMASK BOTTOM (SSTOP)", "FAB / ASSEMBLY", "BOARD OUTLINE (BO)"] },
  { title: "Bifează „Undefined line width: 0.2”", detail: "În partea dreaptă a ferestrei Artwork, la „General Parameters”, câmpul „Undefined line width” trebuie completat cu 0.2 (mm). Dacă rămâne gol, liniile fără lățime (conturul!) dispar din Gerber — de aici erorile MISSING_LAYER / contur lipsă.", checks: ["Undefined line width = 0.2"] },
  { title: "Aperture: format RS-274X, „Embedded apertures”", detail: "La „Device type” alege Gerber RS274X. Aperturile trebuie înglobate în fișier — altfel platforma nu poate interpreta formele pad-urilor." },
  { title: "Selectează toate filmele → „Create Artwork”", detail: "Click dreapta pe „Available films” → „Select all”, apoi butonul „Create Artwork”. Fișierele .art apar în folderul proiectului." },
];

const DRILL_STEPS: Step[] = [
  { title: "Manufacture → NC → NC Drill…", detail: "Se deschide fereastra „NC Drill”. Un singur fișier .drl trebuie să rezulte — dacă ai două (plated + non-plated separate), platforma semnalează DRL_COUNT.", checks: ["Enhanced Excellon format", "Auto tool select", "Separate files for plated/non-plated = NE bifat"] },
  { title: "Origin: aceeași origine ca la Artwork", detail: "Eroarea ORIGIN apare când găurile nu cad pe pad-uri — de obicei pentru că NC Drill a fost exportat cu altă origine. Lasă originile implicite (aceleași ca la Artwork) sau setează manual aceeași origine în ambele exporturi." },
  { title: "Format coordonate: 2.5 sau 2.4, metric", detail: "La „Format” alege 2.5 (recomandat) și unități metrice. Apasă „Drill” — fișierul .drl apare în folderul proiectului." },
];

const MASK_STEPS: Step[] = [
  { title: "Mască duplicată (MASK_DUPLICATE)", detail: "Ai două filme de mască pentru același strat (ex. SMTOP și SOLDERMASK_TOP incluse ambele). În Artwork Control Form șterge filmul duplicat sau scoate-l din export — platforma acceptă un singur film per strat." },
];

function StepList({ title, icon, steps }: { title: string; icon: React.ReactNode; steps: Step[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">{icon}{title}</div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[11px] text-primary-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{s.title}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
                {s.checks && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.checks.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                        <CheckSquare className="h-3 w-3 text-primary" />{c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Visual step-by-step OrCAD/Allegro export wizard, shown when the DRC report has structural/export errors. */
export function OrcadExportGuide({ codes }: { codes: string[] }) {
  const [open, setOpen] = useState(true);
  const hits = EXPORT_GUIDE_CODES.filter((c) => codes.includes(c));
  if (!hits.length) return null;
  const needMask = codes.includes("MASK_DUPLICATE");
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><MonitorCheck className="h-5 w-5 text-primary" /> Ghid vizual: export corect din OrCAD / Allegro</CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-label={open ? "Restrânge ghidul" : "Extinde ghidul"}>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Erorile tale ({hits.join(", ")}) arată o problemă de export, nu de proiectare. Urmează exact pașii de mai jos în Cadence OrCAD/Allegro, apoi reîncarcă arhiva ZIP.
        </p>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5">
          <StepList title="Pasul A — Gerber (Artwork)" icon={<ArrowRight className="h-4 w-4 text-primary" />} steps={ARTWORK_STEPS} />
          <StepList title="Pasul B — Găurire (NC Drill)" icon={<ArrowRight className="h-4 w-4 text-primary" />} steps={DRILL_STEPS} />
          {needMask && <StepList title="Pasul C — Mască duplicată" icon={<Square className="h-4 w-4 text-primary" />} steps={MASK_STEPS} />}
          <p className="text-xs text-muted-foreground">După export, arhivează ZIP doar fișierele .art + .drl (fără subfoldere) și reîncarcă aici — verificarea este nelimitată și nu afectează nota.</p>
        </CardContent>
      )}
    </Card>
  );
}
