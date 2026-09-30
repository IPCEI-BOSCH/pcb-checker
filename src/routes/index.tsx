import { createFileRoute, Link } from "@tanstack/react-router";
import { CircuitBoard, FileCheck2, Layers, ShieldCheck, Users, Factory } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PCB Checker & CAM — Facultatea de Electronică UPB" },
      { name: "description", content: "Verificare DRC automată a proiectelor PCB (Gerber/Excellon), self-check pentru studenți și evaluare pe serii pentru P1 / P1-DCE." },
      { property: "og:title", content: "PCB Checker & CAM — UPB ETTI" },
      { property: "og:description", content: "Self-check DRC, vizualizator Gerber și evaluare pe serii și grupe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: FileCheck2, t: "Self-Check nelimitat", d: "Încarci arhiva ZIP și primești instant raportul DRC, fără nicio penalizare." },
  { icon: Layers, t: "Vizualizator Gerber 2D", d: "Straturi, zoom, pan și marcaje pe fiecare defect cu sfaturi de remediere." },
  { icon: ShieldCheck, t: "Reguli P1 & IPC", d: "40×40 mm, origine (0,0), gardă 1 mm, fiduciali, via-in-pad, stencil IPC-7525B." },
  { icon: Users, t: "Serii, grupe, roluri", d: "Administrator, manageri de serie, îndrumători și studenți, cu acces izolat." },
  { icon: CircuitBoard, t: "Evaluare pe loturi", d: "Rulare DRC pe o grupă întreagă, aprobare sau respingere motivată." },
  { icon: Factory, t: "Generator CAM", d: "Panelizare și stencil-uri industriale — în etapa următoare." },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background pcb-grid">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight text-foreground">
          <CircuitBoard className="h-5 w-5 text-primary" /> PCB_CHECKER / CAM
        </div>
        <Button asChild size="sm"><Link to="/auth">Conectare</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">UPB · ETTI · P1 / P1-DCE</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-foreground md:text-6xl">
          Verifică placa înainte să ajungă la fabricație.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Platforma de verificare DRC și pregătire CAM pentru proiectele de cablaj imprimat. Conectare cu contul universitar Microsoft 365.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg"><Link to="/auth">Intră cu contul UPB</Link></Button>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.t} className="rounded-lg border border-border bg-card/80 p-5 backdrop-blur">
              <f.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 font-medium text-card-foreground">{f.t}</div>
              <p className="mt-1 text-sm text-muted-foreground">{f.d}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
