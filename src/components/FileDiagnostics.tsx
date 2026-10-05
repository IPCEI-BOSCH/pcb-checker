import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { layerBBox, outlineBBox } from "@/lib/gerber/parser";
import { LAYER_LABELS, type Layer } from "@/lib/gerber/types";

const REQUIRED = ["BO", "BOTTOM", "DRILL", "FAB", "SMBOT", "SMTOP", "SPTOP", "SSTOP", "TOP"];

/** Per-file diagnostic: detected layer type, bounding box, entity counts, apertures and drill tools. */
export function FileDiagnostics({ layers }: { layers: Layer[] }) {
  const names = layers.map((l) => l.fileName.toUpperCase());
  const missing = REQUIRED.filter((r) => !names.some((n) => new RegExp(`(^|[^A-Z0-9])${r}\\.`).test(n)));
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Diagnostic fișiere</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {missing.length > 0 && <p className="text-sm text-destructive">Lipsesc: {missing.map((m) => `${m}`).join(", ")}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th className="p-1">Fișier</th><th className="p-1">Tip detectat</th><th className="p-1">Dimensiune (mm)</th><th className="p-1">Pad-uri</th><th className="p-1">Linii</th><th className="p-1">Regiuni</th><th className="p-1">Aperturi</th><th className="p-1">Avertizări</th></tr>
            </thead>
            <tbody>
              {layers.map((l) => {
                const b = l.kind === "outline" ? outlineBBox(l) : l.kind === "drill" ? null : layerBBox(l, true);
                const flashes = l.primitives.filter((p) => p.t === "flash");
                const aps = new Set(flashes.map((p) => (p.t === "flash" ? `${p.shape} ${p.w.toFixed(2)}×${p.h.toFixed(2)}` : "")));
                return (
                  <tr key={l.fileName} className="border-t border-border align-top">
                    <td className="p-1 font-mono text-foreground">{l.fileName}</td>
                    <td className="p-1">{l.kind === "unknown" ? <Badge variant="destructive" className="text-[10px]">nerecunoscut</Badge> : LAYER_LABELS[l.kind]}</td>
                    <td className="p-1 font-mono">{b ? `${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)}` : "—"}</td>
                    <td className="p-1 font-mono">{flashes.length}</td>
                    <td className="p-1 font-mono">{l.primitives.filter((p) => p.t === "line").length}</td>
                    <td className="p-1 font-mono">{l.primitives.filter((p) => p.t === "region").length}</td>
                    <td className="p-1 font-mono">{aps.size}</td>
                    <td className="p-1 text-warning">{l.warnings.join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {layers.filter((l) => l.kind === "drill").map((l) => {
          const tools = new Map<string, number>();
          l.holes.forEach((h) => tools.set(h.d.toFixed(2), (tools.get(h.d.toFixed(2)) ?? 0) + 1));
          return (
            <div key={l.fileName} className="rounded-md border border-border p-3 text-xs">
              <div className="font-semibold text-foreground">{l.fileName}: {l.holes.length} găuri · format {l.fmt ? `${l.fmt.int}:${l.fmt.dec} ${l.fmt.inch ? "inch" : "mm"}` : "nedetectat"}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {[...tools.entries()].sort((a, b) => +a[0] - +b[0]).map(([d, n], i) => (
                  <span key={d} className="rounded bg-muted px-2 py-0.5 font-mono">T{i + 1}: Ø{d} mm × {n}</span>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
