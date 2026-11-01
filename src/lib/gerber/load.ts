import JSZip from "jszip";
import { classifyLayer, layerBBox, outlineBBox, parseExcellon, parseGerber } from "./parser";
import type { BBox, Layer } from "./types";

const SKIP = /\.(pdf|png|jpg|jpeg|md|html?|csv|xlsx?|kicad_\w+|pos|rpt|zip|log|json|bak|gbrjob)$/i;

export type DrillFormat = "auto" | "2:5" | "2:4" | "2:3" | "3:3";

export async function loadGerberZip(data: Blob | ArrayBuffer, opts: { drillFormat?: DrillFormat } = {}): Promise<Layer[]> {
  const zip = await JSZip.loadAsync(data);
  const layers: Layer[] = [];
  const drills: { base: string; text: string; mtime?: number }[] = [];
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX") && !SKIP.test(f.name));
  for (const entry of entries) {
    const text = await entry.async("string");
    const base = entry.name.split("/").pop() ?? entry.name;
    const isGerber = /%FS|%MO|G04|%ADD/.test(text.slice(0, 4000));
    const kind = classifyLayer(base, text);
    try {
      if (kind === "drill") drills.push({ base, text, mtime: entry.date?.getTime() });
      else if (isGerber) { const l = parseGerber(base, text, kind); l.meta = gerberMeta(text, entry.date?.getTime()); layers.push(l); }
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
    try {
      const l = parseExcellon(d.base, d.text, box, forced);
      l.meta = { ...l.meta, mtime: d.mtime };
      layers.push(l);
    }
    catch (e) { layers.push({ fileName: d.base, kind: "drill", primitives: [], holes: [], warnings: [`Eroare parsare: ${(e as Error).message}`] }); }
  }
  return layers;
}

/** Aperture definitions (shape + dims rounded to 3 decimals, in definition order) and CAD header lines — used only by the integrity module. */
export function gerberMeta(text: string, mtime?: number): NonNullable<Layer["meta"]> {
  const apertures: string[] = [];
  for (const m of text.matchAll(/%ADD\d+([A-Za-z_][\w.$]*)(?:,([^*]*))?\*%/g)) {
    const dims = (m[2] ?? "").split("X").filter(Boolean).map((v) => (+v).toFixed(3)).join("x");
    apertures.push(`${m[1]}:${dims}`);
    if (apertures.length >= 200) break;
  }
  const header: string[] = [];
  for (const line of text.slice(0, 6000).split(/\r?\n/)) {
    const t = line.trim();
    if (/^G04/.test(t) && header.filter((h) => h.startsWith("G04")).length < 6) header.push(t.slice(0, 120));
    else if (/^%(TF\.|FS)/.test(t)) header.push(t.slice(0, 120));
    if (header.length >= 15) break;
  }
  return { apertures, header, mtime };
}
