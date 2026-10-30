import { describe, expect, it } from "vitest";
import { runDrc } from "./engine";
import { DEFAULT_SETTINGS } from "./settings";
import type { Layer } from "../gerber/types";

const L = (kind: Layer["kind"], primitives: Layer["primitives"], holes: Layer["holes"] = []): Layer => ({ fileName: kind, kind, primitives, holes, warnings: [] });
const pad = (w: number, h: number) => ({ t: "flash" as const, x: 10, y: 10, shape: "R" as const, w, h });
const failed = (layers: Layer[]) => new Set(runDrc(layers, "SMT", DEFAULT_SETTINGS).rules.filter((r) => !r.passed).map((r) => r.code));

describe("Seria A calibrated rules", () => {
  it("flags mask equal to pad and paste equal to pad", () => {
    const f = failed([L("top_copper", [pad(1, 1.3)]), L("top_mask", [pad(1, 1.3)]), L("top_paste", [pad(1, 1.3)])]);
    expect(f.has("MASK_EXPANSION")).toBe(true);
    expect(f.has("PASTE_SIZE")).toBe(true);
  });
  it("accepts mask +0.1 mm/side and paste at ~70% area", () => {
    const f = failed([L("top_copper", [pad(1, 1.3)]), L("top_mask", [pad(1.2, 1.5)]), L("top_paste", [pad(0.85, 1.1)])]);
    expect(f.has("MASK_EXPANSION")).toBe(false);
    expect(f.has("PASTE_SIZE")).toBe(false);
  });
  it("requires 0.4 mm vias", () => {
    expect(failed([L("drill", [], [{ x: 5, y: 5, d: 0.33 }])]).has("VIA_DIAMETER")).toBe(true);
    expect(failed([L("drill", [], [{ x: 5, y: 5, d: 0.406 }])]).has("VIA_DIAMETER")).toBe(false);
  });
});
