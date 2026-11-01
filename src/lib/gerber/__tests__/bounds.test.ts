import { describe, expect, it } from "vitest";
import { layerBBox } from "../parser";
import type { Layer } from "../types";

describe("Gerber bounds with malformed apertures", () => {
  it("keeps valid board geometry when a macro has non-finite dimensions", () => {
    const layer: Layer = {
      fileName: "TOP.art", kind: "top_copper", warnings: [], holes: [],
      primitives: [
        { t: "flash", x: 4.318, y: 28.448, shape: "M", w: NaN, h: NaN },
        { t: "line", x1: 2, y1: 3, x2: 39, y2: 40, w: 0.4 },
      ],
    };
    expect(layerBBox(layer)).toEqual({ minX: 1.8, minY: 2.8, maxX: 39.2, maxY: 40.2 });
  });

  it("returns no bounds for a file with only invalid geometry", () => {
    expect(layerBBox({ fileName: "TOP.art", kind: "top_copper", warnings: [], holes: [], primitives: [
      { t: "flash", x: 0, y: 0, shape: "M", w: NaN, h: Infinity },
    ] })).toBeNull();
  });
});