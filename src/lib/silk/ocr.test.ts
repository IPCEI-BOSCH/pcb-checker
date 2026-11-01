import { describe, expect, it } from "vitest";
import { decodeBlock, matchGlyph, type Seg } from "./ocr";

/** Turns a 5×7 bitmap into stroke segments (one small square per set cell), Y-up like Gerber. */
function bitmapToSegs(rows: string[], ox = 0, flip = false): Seg[] {
  const segs: Seg[] = [];
  for (let r = 0; r < 7; r++)
    for (let c = 0; c < 5; c++) {
      if (rows[r]![c] !== "1") continue;
      const cc = flip ? 4 - c : c;
      const x = ox + cc * 1.2, y = (6 - r) * 1.2, s = 0.9, w = 0.25;
      segs.push(
        { x1: x, y1: y, x2: x + s, y2: y, w },
        { x1: x + s, y1: y, x2: x + s, y2: y + s, w },
        { x1: x + s, y1: y + s, x2: x, y2: y + s, w },
        { x1: x, y1: y + s, x2: x, y2: y, w },
      );
    }
  return segs;
}

const E = ["11111", "10000", "10000", "11110", "10000", "10000", "11111"];
const L = ["10000", "10000", "10000", "10000", "10000", "10000", "11111"];
const A = ["01110", "10001", "10001", "11111", "10001", "10001", "10001"];

describe("vector pre-OCR", () => {
  it("recognizes a normal glyph and its orientation", () => {
    const m = matchGlyph(bitmapToSegs(E));
    expect(m).not.toBeNull();
    expect(m!.char).toBe("E");
    expect(m!.mirrored).toBe(false);
    expect(m!.score).toBeGreaterThan(0.5);
  });

  it("recognizes a mirrored glyph as mirrored", () => {
    const m = matchGlyph(bitmapToSegs(E, 0, true));
    expect(m).not.toBeNull();
    expect(m!.char).toBe("E");
    expect(m!.mirrored).toBe(true);
  });

  it("votes a normal word as not mirrored", () => {
    const d = decodeBlock([bitmapToSegs(E), bitmapToSegs(L, 8)]);
    expect(d.text).toBe("EL");
    expect(d.mirrored).toBe(false);
  });

  it("votes a mirrored word as mirrored", () => {
    const d = decodeBlock([bitmapToSegs(E, 0, true), bitmapToSegs(L, 8, true)]);
    expect(d.mirrored).toBe(true);
  });

  it("does not decide mirroring from symmetric glyphs only", () => {
    const d = decodeBlock([bitmapToSegs(A), bitmapToSegs(A, 8, true)]);
    expect(d.mirrored).toBeNull();
  });
});
