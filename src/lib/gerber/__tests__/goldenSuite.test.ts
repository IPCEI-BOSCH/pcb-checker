import { describe, expect, it } from "vitest";
import { GOLDEN_SUITE, runGoldenSuite } from "./goldenSuite";

describe("Golden Suite — parser & DRC benchmarks", () => {
  it("include benchmark-urile inițiale și calibrarea de laborator", () => {
    expect(GOLDEN_SUITE).toHaveLength(18);
  });

  it("toate benchmark-urile trec (PASS)", async () => {
    const results = await runGoldenSuite();
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.name}: ${r.failures.join("; ")}`)).toEqual([]);
  }, 120_000);
});
