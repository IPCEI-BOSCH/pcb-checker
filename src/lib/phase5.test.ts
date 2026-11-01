import { describe, expect, it } from "vitest";
import { deadlineState, type Deadline } from "@/lib/deadlines";
import { interviewGrade, generateInterviewQuestions } from "@/lib/interview";
import type { DrcReport } from "@/lib/drc/engine";

const dl: Deadline = {
  id: "d1", series_id: "s1", group_id: null,
  soft_deadline: "2026-11-10T23:59:00Z",
  hard_deadline: "2026-11-17T23:59:00Z",
  late_penalty_per_day: 5,
};

describe("deadlineState", () => {
  it("open before the soft deadline", () => {
    const s = deadlineState(dl, null, new Date("2026-11-10T10:00:00Z"));
    expect(s.phase).toBe("open");
    expect(s.penalty).toBe(0);
  });

  it("late after soft deadline: whole days × penalty per day", () => {
    const s = deadlineState(dl, null, new Date("2026-11-13T12:00:00Z"));
    expect(s.phase).toBe("late");
    expect(s.lateDays).toBe(3);
    expect(s.penalty).toBe(15);
  });

  it("closed after the hard deadline", () => {
    expect(deadlineState(dl, null, new Date("2026-11-18T00:00:00Z")).phase).toBe("closed");
  });

  it("an individual extension past the hard deadline reopens submission", () => {
    const s = deadlineState(dl, "2026-11-25T23:59:00Z", new Date("2026-11-20T10:00:00Z"));
    expect(s.phase).not.toBe("closed");
  });

  it("no deadline configured → always open", () => {
    expect(deadlineState(null, null).phase).toBe("open");
  });
});

describe("interviewGrade", () => {
  it("100/50/0 maps to 10 / 5.5 / 1", () => {
    expect(interviewGrade([100, 100, 100])).toBe(10);
    expect(interviewGrade([0, 0, 0])).toBe(1);
    expect(interviewGrade([50, 50, 50])).toBe(5.5);
  });
});

describe("generateInterviewQuestions", () => {
  const base: DrcReport = {
    version: 1, variant: "SMT", score: 90, designPoints: 36, blockingCount: 0, wouldPass: true,
    manualReview: false, board: null,
    stats: { holes: 10, drillDiameters: [0.8], layers: [], minTrace: 0.25, minClearance: 0.3 },
    rules: [], issues: [],
  };

  it("always returns exactly 3 questions with expected answers", () => {
    const qs = generateInterviewQuestions(base);
    expect(qs).toHaveLength(3);
    for (const q of qs) expect(q.answer.length).toBeGreaterThan(20);
  });

  it("anchors the via question on the net with the most vias", () => {
    const qs = generateInterviewQuestions({
      ...base,
      nets: [{ netId: 1, name: "VCC", primitiveIds: { top_copper: [], bottom_copper: [] }, holeIds: [1, 2, 3], totalLengthMm: 42, minWidthMm: 0.5, maxWidthMm: 0.5, boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, estimatedResistanceMilliohm: 5 }],
    });
    expect(qs[0]!.question).toContain("VCC");
    expect(qs[0]!.question).toContain("3 treceri");
    expect(qs[0]!.x).toBe(5);
  });
});
