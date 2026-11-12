import { describe, expect, it } from "vitest";
import { eligibleForCam, resolveSeries, selectedGroups, seriesExportTag } from "./selection";

describe("multi-series CAM", () => {
  it("includes exactly the chosen series, not all", () => {
    expect(resolveSeries(["A", "C"], ["A", "B", "C"])).toEqual(["A", "C"]);
  });
  it("none is empty and all resolves available ids", () => {
    expect(resolveSeries([], ["A", "B"])).toEqual([]);
    expect(resolveSeries(null, ["A", "B"])).toEqual(["A", "B"]);
  });
  it("Drive and official sources exclude unselected and archived groups", () => {
    expect(selectedGroups([{ id: "1", series_id: "A", is_archived: false }, { id: "2", series_id: "B", is_archived: false }, { id: "3", series_id: "A", is_archived: true }], ["A"]).map(g => g.id)).toEqual(["1"]);
  });
  it("stencil accepts SMT but not THT, panel accepts both", () => {
    expect(eligibleForCam("SMT", "stencil")).toBe(true);
    expect(eligibleForCam("THT", "stencil")).toBe(false);
    expect(eligibleForCam("THT", "panel")).toBe(true);
  });
  it("export identifies both series and years", () => {
    expect(seriesExportTag(["A-2026", "C-2025"])).toBe("A-2026+C-2025");
  });
});