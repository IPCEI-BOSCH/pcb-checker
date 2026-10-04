import JSZip from "jszip";
import { classifyLayer, layerBBox, outlineBBox, parseExcellon, parseGerber } from "./parser";
import type { BBox, Layer } from "./types";

const SKIP = /\.(pdf|png|jpg|jpeg|md|html?|csv|xlsx?|kicad_\w+|pos|rpt|zip|log|json|bak|gbrjob|txt)$/i;

export type DrillFormat = "auto" | "2:5" | "2:4" | "2:3" | "3:3";

export async function loadGerberZip(data: Blob | ArrayBuffer, opts: { drillFormat?: DrillFormat } = {}): Promise<Layer[]> {
  const zip = await JSZip.loadAsync(data);
  const layers: Layer[] = [];
  const drills: { base: string; text: string }[] = [];
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX") && !SKIP.test(f.name));
  for (const entry of entries) {
    const text = await entry.async("string");
    const base = entry.name.split("/").pop() ?? entry.name;
    const isGerber = /%FS|%MO|G04|%ADD/.test(text.slice(0, 4000));
    const kind = classifyLayer(base, text);
    try {
      if (kind === "drill") drills.push({ base, text });
      else if (isGerber) layers.push(parseGerber(base, text, kind));
    } catch (e) {
      layers.push({ fileName: base, kind: "unknown", primitives: [], holes: [], warnings: [`Eroare parsare: ${(e as Error).message}`] });
    }
  }
  // Drill files are parsed last so an undeclared coordinate format can be fitted to the board outline.
  const outl = layers.find((l) => l.kind === "outline");
  const ref = outl ?? layers.find((l) => l.kind === "top_copper");
  const box: BBox | null = outl ? outlineBBox(outl) : ref ? layerBBox(ref, true) : null;
  const forced = opts.drillFormat && opts.drillFormat !== "auto"
    ? { int: +opts.drillFormat.split(":")[0]!, dec: +opts.drillFormat.split(":")[1]! }
    : undefined;
  for (const d of drills) {
    try { layers.push(parseExcellon(d.base, d.text, box, forced)); }
    catch (e) { layers.push({ fileName: d.base, kind: "drill", primitives: [], holes: [], warnings: [`Eroare parsare: ${(e as Error).message}`] }); }
  }
  return layers;
}
