import { loadGerberZip } from "@/lib/gerber/load";
import { fingerprint, similarityDetail, type Fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";

type Job = { resolve: (r: never) => void; reject: (e: Error) => void };

export function createIntegrityPool(size = Math.min(4, Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1))) {
  const workers: Worker[] = [];
  const jobs = new Map<number, Job>();
  let next = 0, rr = 0;
  try {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./integrity.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        const j = jobs.get(e.data.id);
        if (!j) return;
        jobs.delete(e.data.id);
        if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.result as never);
      };
      workers.push(w);
    }
  } catch { /* no workers */ }
  const post = <T,>(msg: object): Promise<T> => {
    const id = next++;
    return new Promise<T>((resolve, reject) => {
      jobs.set(id, { resolve: resolve as never, reject });
      workers[rr++ % workers.length]!.postMessage({ ...msg, id });
    });
  };
  return {
    size: Math.max(1, workers.length),
    fingerprint(blob: Blob): Promise<Fingerprint> {
      if (!workers.length) return loadGerberZip(blob).then(fingerprint);
      return post({ kind: "fp", blob });
    },
    async pairs(fps: Record<string, Fingerprint>, list: [string, string][]): Promise<SimilarityDetail[]> {
      if (!workers.length) {
        const out: SimilarityDetail[] = [];
        for (let i = 0; i < list.length; i++) {
          out.push(similarityDetail(fps[list[i]![0]]!, fps[list[i]![1]]!));
          if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
        }
        return out;
      }
      const n = workers.length, chunk = Math.ceil(list.length / n) || 1;
      const parts: Promise<SimilarityDetail[]>[] = [];
      for (let i = 0; i < list.length; i += chunk) {
        const sl = list.slice(i, i + chunk);
        const need: Record<string, Fingerprint> = {};
        for (const [a, b] of sl) { need[a] = fps[a]!; need[b] = fps[b]!; }
        parts.push(post({ kind: "pairs", fps: need, jobs: sl }));
      }
      return (await Promise.all(parts)).flat();
    },
    close() { workers.forEach((w) => w.terminate()); },
  };
}
