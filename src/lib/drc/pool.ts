import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, type DrcReport } from "@/lib/drc/engine";

type Job = { resolve: (r: DrcReport) => void; reject: (e: Error) => void };

/** Small pool of background workers so batch DRC does not freeze the page; falls back to the main thread.
 *  Concurrency is clamped to [2, 6] so the UI thread keeps 60 FPS even at ~150 simultaneous archives. */
export function createDrcPool(size = Math.max(2, Math.min(globalThis.navigator?.hardwareConcurrency || 4, 6))) {
  const workers: Worker[] = [];
  const jobs = new Map<number, Job>();
  let next = 0;
  let rr = 0;
  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./drc.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        const j = jobs.get(e.data.id);
        if (!j) return;
        jobs.delete(e.data.id);
        if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.report);
      };
      workers.push(w);
    }
  } catch { /* workers unavailable */ }
  return {
    size: Math.max(1, workers.length),
    run(blob: Blob, variant: "SMT" | "THT", settings: unknown): Promise<DrcReport> {
      if (!workers.length) return loadGerberZip(blob).then((l) => runDrc(l, variant, settings as never));
      const id = next++;
      return new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject });
        workers[rr++ % workers.length]!.postMessage({ id, blob, variant, settings });
      });
    },
    close() { workers.forEach((w) => w.terminate()); },
  };
}
