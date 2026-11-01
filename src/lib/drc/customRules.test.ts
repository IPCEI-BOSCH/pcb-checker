import { describe, expect, it } from "vitest";
import { runDrc } from "./engine";
import { DEFAULT_SETTINGS, blankCustomRule, type CustomRule } from "./settings";
import type { Layer } from "@/lib/gerber/types";

const outline: Layer = {
  fileName: "BO.art",
  kind: "outline",
  warnings: [],
  holes: [],
  primitives: [
    { t: "line", x1: 0, y1: 0, x2: 20, y2: 0, w: 0.1 },
    { t: "line", x1: 20, y1: 0, x2: 20, y2: 20, w: 0.1 },
    { t: "line", x1: 20, y1: 20, x2: 0, y2: 20, w: 0.1 },
    { t: "line", x1: 0, y1: 20, x2: 0, y2: 0, w: 0.1 },
  ],
};

const bottomPour: Layer = {
  fileName: "BOTTOM.art",
  kind: "bottom_copper",
  warnings: [],
  holes: [],
  primitives: [{ t: "region", pts: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
};

const drill3: Layer = {
  fileName: "DRILL.drl",
  kind: "drill",
  warnings: [],
  primitives: [],
  holes: [
    { x: 5, y: 5, d: 0.4 },
    { x: 10, y: 5, d: 0.4 },
    { x: 15, y: 5, d: 0.4 },
  ],
};

const emptySilk: Layer = { fileName: "SSTOP.art", kind: "top_silk", warnings: [], primitives: [], holes: [] };

function ruleFor(report: ReturnType<typeof runDrc>, code: string) {
  const r = report.rules.find((x) => x.code === code);
  expect(r, `regula ${code} să apară în raport`).toBeTruthy();
  return r!;
}

function custom(p: Partial<CustomRule>): CustomRule {
  return { ...blankCustomRule(), ...p, enabled: true };
}

describe("extended custom rule checks", () => {
  it("copper_coverage_ratio passes with a full ground pour", () => {
    const settings = { ...DEFAULT_SETTINGS, customRules: [custom({ code: "CUSTOM_GND", checkType: "copper_coverage_ratio", layer: "bottom_copper", value: 35 })] };
    const report = runDrc([outline, bottomPour, drill3, emptySilk], "SMT", settings);
    expect(ruleFor(report, "CUSTOM_GND").passed).toBe(true);
  });

  it("copper_coverage_ratio fails with almost no copper", () => {
    const sparse: Layer = { ...bottomPour, primitives: [{ t: "line", x1: 1, y1: 1, x2: 3, y2: 1, w: 0.3 }] };
    const settings = { ...DEFAULT_SETTINGS, customRules: [custom({ code: "CUSTOM_GND", checkType: "copper_coverage_ratio", layer: "bottom_copper", value: 35 })] };
    const report = runDrc([outline, sparse, drill3, emptySilk], "SMT", settings);
    expect(ruleFor(report, "CUSTOM_GND").passed).toBe(false);
  });

  it("layer_primitive_count enforces a minimum (ground vias)", () => {
    const settings = { ...DEFAULT_SETTINGS, customRules: [custom({ code: "CUSTOM_VIAS", checkType: "layer_primitive_count", layer: "drill", value: 4 })] };
    const report = runDrc([outline, bottomPour, drill3, emptySilk], "SMT", settings);
    expect(ruleFor(report, "CUSTOM_VIAS").passed).toBe(false);
    const ok = runDrc([outline, bottomPour, { ...drill3, holes: [...drill3.holes, { x: 5, y: 10, d: 0.4 }] }, emptySilk], "SMT", settings);
    expect(ruleFor(ok, "CUSTOM_VIAS").passed).toBe(true);
  });

  it("required_silk_aspect fails when no text exists on the layer", () => {
    const settings = { ...DEFAULT_SETTINGS, customRules: [custom({ code: "CUSTOM_NAME", checkType: "required_silk_aspect", layer: "top_silk" })] };
    const report = runDrc([outline, bottomPour, drill3, emptySilk], "SMT", settings);
    expect(ruleFor(report, "CUSTOM_NAME").passed).toBe(false);
  });
});
