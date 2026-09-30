import JSZip from "jszip";
import { classifyLayer, parseExcellon, parseGerber } from "./parser";
import type { Layer } from "./types";

const SKIP = /\.(pdf|png|jpg|jpeg|md|html?|csv|xlsx?|kicad_\w+|pos|rpt|zip|log|json|bak)$/i;

export async function loadGerberZip(data: Blob | ArrayBuffer): Promise<Layer[]> {
  const zip = await JSZip.loadAsync(data);
  const layers: Layer[] = [];
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.startsWith("__MACOSX") && !SKIP.test(f.name));
  for (const entry of entries) {
    const text = await entry.async("string");
    const base = entry.name.split("/").pop() ?? entry.name;
    const isGerber = /%FS|%MO|G04|%ADD/.test(text.slice(0, 4000));
    const kind = classifyLayer(base, text);
    try {
      if (kind === "drill") layers.push(parseExcellon(base, text));
      else if (isGerber) layers.push(parseGerber(base, text, kind));
    } catch (e) {
      layers.push({ fileName: base, kind: "unknown", primitives: [], holes: [], warnings: [`Eroare parsare: ${(e as Error).message}`] });
    }
  }
  return layers;
}
