import { loadGerberZip } from "@/lib/gerber/load";
import { fingerprint, similarityDetail, type Fingerprint } from "@/lib/integrity/fingerprint";

/** Background fingerprinting and pair scoring so the Insights page stays responsive. */
self.onmessage = async (e: MessageEvent) => {
  const { id, kind } = e.data;
  try {
    if (kind === "fp") {
      const fp = fingerprint(await loadGerberZip(e.data.blob as Blob));
      (self as unknown as Worker).postMessage({ id, result: fp });
    } else {
      const fps = e.data.fps as Record<string, Fingerprint>;
      const jobs = e.data.jobs as [string, string][];
      const out = jobs.map(([a, b]) => similarityDetail(fps[a]!, fps[b]!));
      (self as unknown as Worker).postMessage({ id, result: out });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
