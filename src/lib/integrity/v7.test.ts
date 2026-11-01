import { describe, expect, it } from "vitest";
import { cadSequenceScore, type Forensic } from "@/lib/integrity/fingerprint";
import { inferDirection } from "@/components/IntegrityNetwork";

const foren = (flashSeq: number[], drillSeq: number[], apertures: string[]): Forensic => ({ apertureSignature: apertures, cadHeader: [], flashSeq, drillSeq });

describe("cadSequenceScore (v7)", () => {
  it("identical CAD export order scores ≥85 and independent order scores low", () => {
    const seq = [12, 5, 40, 7, 7, 19, 3, 25, 25, 8, 60, 4, 11, 11, 30];
    const drill = [16, 24, 8, 40, 20, 6];
    const ap = ["C,0.5", "R,1.6,1.6", "C,0.8", "C,1.0"];
    const same = cadSequenceScore(foren(seq, drill, ap), foren([...seq], [...drill], [...ap]));
    expect(same).toBeGreaterThanOrEqual(85);
    const shuffled = cadSequenceScore(foren(seq, drill, ap), foren([...seq].reverse(), [8, 40, 20, 6, 16, 24], [...ap].reverse()));
    expect(shuffled!).toBeLessThan(same! - 30);
  });

  it("returns undefined when there is not enough flash data", () => {
    expect(cadSequenceScore(foren([1, 2, 3], [], []), foren([1, 2, 3], [], []))).toBeUndefined();
  });
});

describe("inferDirection (v7)", () => {
  const early = { first: Date.parse("2026-10-01T10:00:00Z"), iterations: 9, firstScore: 42, lastScore: 95 };
  const late = { first: Date.parse("2026-10-03T16:00:00Z"), iterations: 1, firstScore: 95, lastScore: 95 };

  it("points from the earlier, iterated project to the late instant one", () => {
    const d = inferDirection(early, late);
    expect(d?.source).toBe("a");
    expect(d?.reason).toContain("iterații");
  });

  it("is symmetric", () => {
    expect(inferDirection(late, early)?.source).toBe("b");
  });

  it("refuses when chronology is ambiguous", () => {
    const close = { first: early.first + 30 * 60_000, iterations: 8, firstScore: 50, lastScore: 90 };
    expect(inferDirection(early, close)).toBeNull();
  });
});
