import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc } from "@/lib/drc/engine";

self.onmessage = async (e: MessageEvent) => {
  const { id, blob, variant, settings } = e.data;
  try {
    const report = runDrc(await loadGerberZip(blob), variant, settings);
    (self as unknown as Worker).postMessage({ id, report });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
