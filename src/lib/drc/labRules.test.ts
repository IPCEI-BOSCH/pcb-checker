import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { runDrc } from "./engine";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";
import { LAB_TITLES } from "./labDefinitions";
import { labCalibrationDraft } from "./labProfile";
import { evaluateLabRules } from "./labRules";
import { parseExcellon } from "../gerber/parser";
import { loadGerberZip } from "../gerber/load";
import type { Layer, LayerKind, Primitive } from "../gerber/types";
import type { SilkBlock } from "../silk/extract";

const L = (kind: LayerKind, primitives: Primitive[] = [], holes: Layer["holes"] = []): Layer => ({ fileName: kind, kind, primitives, holes, warnings: [] });
const flash = (x: number, y: number, w = 0.7, h = w, shape: "C" | "R" = "C"): Primitive => ({ t: "flash", x, y, w, h, shape });
const line = (x1: number, y1: number, x2: number, y2: number, w = 0.2): Primitive => ({ t: "line", x1, y1, x2, y2, w });
const profile = labCalibrationDraft(DEFAULT_SETTINGS);
const failed = (code: string, layers: Layer[], settings = profile, variant: "SMT" | "THT" = "SMT") => runDrc(layers, variant, settings).rules.some((r) => r.code === code && !r.passed);
const drilled = (n = 1): Layer[] => [L("top_copper", Array.from({ length: n }, (_, i) => flash(3 + i * 2, 3))), L("bottom_copper", Array.from({ length: n }, (_, i) => flash(3 + i * 2, 3))), L("drill", [], Array.from({ length: n }, (_, i) => ({ x: 3 + i * 2, y: 3, d: 0.4 })))];
const fid = (paste: number | null = 1, mask = 2): Layer[] => [L("top_copper", [flash(5, 5, 1)]), L("top_mask", [flash(5, 5, mask)]), L("top_paste", paste === null ? [] : [flash(5, 5, paste)])];

describe("P1DCE 2019–2020 calibration", () => {
  it("keeps all sixteen new penalties off until manual activation", () => {
    expect(Object.keys(LAB_TITLES)).toHaveLength(16);
    for (const code of Object.keys(LAB_TITLES)) { expect(DEFAULT_SETTINGS.penalties[code]?.enabled).toBe(false); expect(profile.penalties[code]?.enabled).toBe(true); }
    expect(DEFAULT_SETTINGS.rules.fiducialPasteMode).toBe(1);
  });
  it("ERR_71 distinguishes undefined tools from valid comment tool tables, without double penalty", () => {
    const bad = parseExcellon("DRILL.drl", "M48\nMETRIC\n%\nT1\nX3.0Y3.0\nM30");
    expect(bad.meta?.undefinedTools).toEqual([1]);
    expect(failed("DRILL_NO_TOOLS", [bad])).toBe(true);
    expect(failed("HOLE_SIZE", [bad])).toBe(false);
    const good = parseExcellon("DRILL.drl", ";T01 Holesize 1. = 0.4 MM\nM48\nMETRIC\n%\nT1\nX3.0Y3.0\nM30");
    expect(failed("DRILL_NO_TOOLS", [good])).toBe(false);
  });
  for (const [code, kind] of [["OUTLINE_IN_SILK", "top_silk"], ["OUTLINE_IN_MASK", "bottom_mask"]] as const) it(`${code}: matches split contour, not offset border or clear geometry`, () => {
    const outline = L("outline", [line(0, 0, 40, 0)]);
    expect(failed(code, [outline, L(kind, [line(0, 0, 20, 0), line(20, 0, 40, 0)])])).toBe(true);
    expect(failed(code, [outline, L(kind, [line(0, 1, 40, 1)])])).toBe(false);
    expect(failed(code, [outline, L(kind, [{ ...line(0, 0, 40, 0), clear: true }])])).toBe(false);
  });
  it("ERR_69 manual stencil needs matched 1 mm paste ±10%; industrial mode forbids it", () => {
    expect(failed("FIDUCIAL_PASTE_MATCH", fid())).toBe(false);
    expect(failed("FIDUCIAL_PASTE_MATCH", fid(1.1))).toBe(false);
    expect(failed("FIDUCIAL_PASTE_MATCH", fid(1.2))).toBe(true);
    expect(failed("FIDUCIAL_PASTE_MATCH", fid(null))).toBe(true);
    const industrial = mergeSettings(profile); industrial.rules.fiducialPasteMode = 0;
    expect(failed("FIDUCIAL_PASTE_MATCH", fid(null), industrial)).toBe(false);
    expect(failed("FIDUCIAL_PASTE_MATCH", fid(), industrial)).toBe(true);
  });
  it("ERR_70 accepts Ø2 mm guard and flags opposite-side copper or small mask", () => {
    expect(failed("FIDUCIAL_KEEPOUT", fid())).toBe(false);
    expect(failed("FIDUCIAL_KEEPOUT", fid(1, 1.5))).toBe(true);
    expect(failed("FIDUCIAL_KEEPOUT", [...fid(), L("bottom_copper", [line(4, 5, 6, 5)])])).toBe(true);
  });
  it("ERR_72 permits 35 vias but reports 36; THT holes are not vias", () => {
    expect(failed("EXCESSIVE_VIAS", drilled(35))).toBe(false);
    expect(failed("EXCESSIVE_VIAS", drilled(36))).toBe(true);
  });
  it("ERR_73 flags isolated via pads but not a routed or plane-connected via", () => {
    expect(failed("UNUSED_VIAS", drilled())).toBe(true);
    const routed = drilled(); routed[0]?.primitives.push(line(3, 3, 5, 3));
    expect(failed("UNUSED_VIAS", routed)).toBe(false);
    const pour = drilled(); pour[0]?.primitives.push({ t: "region", pts: [[1, 1], [5, 1], [5, 5], [1, 5]] });
    expect(failed("UNUSED_VIAS", pour)).toBe(false);
  });
  it("ERR_74 compares track width with via pad, independently of thermal relief", () => {
    const bad = drilled(); bad[0]?.primitives.push(line(1, 3, 5, 3, 1));
    expect(failed("ANNULAR_RING_DROWNED", bad)).toBe(true);
    const good = drilled(); good[0]?.primitives.push(line(1, 3, 5, 3, 0.4));
    expect(failed("ANNULAR_RING_DROWNED", good)).toBe(false);
  });
  it("ERR_75 warns only in SMT and respects authorized THT count", () => {
    const layers = [L("top_copper", [flash(5, 5, 2)]), L("drill", [], [{ x: 5, y: 5, d: 1 }])];
    expect(failed("UNAUTHORIZED_THT", layers)).toBe(true);
    expect(failed("UNAUTHORIZED_THT", layers, profile, "THT")).toBe(false);
    const allowed = mergeSettings(profile); allowed.rules.smtAllowedThtHoles = 1;
    expect(failed("UNAUTHORIZED_THT", layers, allowed)).toBe(false);
  });
  it("ERR_76 distinguishes diagonal exits from perpendicular exits", () => {
    expect(failed("PAD_EXIT_ANGLE", [L("top_copper", [flash(5, 5, 1, 1.5, "R"), line(5, 5, 8, 8)])])).toBe(true);
    expect(failed("PAD_EXIT_ANGLE", [L("top_copper", [flash(5, 5, 1, 1.5, "R"), line(5, 5, 8, 5)])])).toBe(false);
  });
  it("ERR_77 counts distinct exits, not duplicate exporter segments", () => {
    const pad = flash(5, 5, 1, 1.5, "R");
    expect(failed("PAD_MULTIPLE_EXITS", [L("top_copper", [pad, line(5, 5, 8, 5), line(5, 5, 2, 5)])])).toBe(true);
    expect(failed("PAD_MULTIPLE_EXITS", [L("top_copper", [pad, line(5, 5, 8, 5), line(5, 5, 8, 5)])])).toBe(false);
  });
  it("ERR_78 flags right angle corners but not 45° bends, T junctions, or pad junctions", () => {
    const corner = [line(1, 1, 3, 1), line(3, 1, 3, 3)];
    expect(failed("RIGHT_ANGLE_TRACES", [L("top_copper", corner)])).toBe(true);
    expect(failed("RIGHT_ANGLE_TRACES", [L("top_copper", [line(1, 1, 3, 1), line(3, 1, 5, 3)])])).toBe(false);
    expect(failed("RIGHT_ANGLE_TRACES", [L("top_copper", [...corner, line(3, 1, 5, 1)])])).toBe(false);
    expect(failed("RIGHT_ANGLE_TRACES", [L("top_copper", [...corner, flash(3, 1)])])).toBe(false);
  });
  it("ERR_65 ignores tented vias and checks the corresponding side mask", () => {
    const base = [...drilled(), L("top_silk", [line(2, 3, 4, 3)])];
    expect(failed("SILK_OVER_VIA", base)).toBe(false);
    expect(failed("SILK_OVER_VIA", [...base, L("top_mask", [flash(3, 3, 0.8)])])).toBe(true);
    expect(failed("SILK_OVER_VIA", [...base, L("bottom_mask", [flash(3, 3, 0.8)])])).toBe(false);
  });
  it("ERR_79 preserves archive entries, accepts a P1_ root, and reports flat/diacritic/temp names", async () => {
    const make = async (names: string[]) => { const zip = new JSZip(); for (const name of names) zip.file(name, "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX5000000Y5000000D03*\nM02*"); return loadGerberZip(await zip.generateAsync({ type: "arraybuffer" })); };
    expect(failed("ARCHIVE_CONVENTION", await make(["P1_2019_431A_Test/TOP.art"]))).toBe(false);
    expect(failed("ARCHIVE_CONVENTION", await make(["TOP.art"]))).toBe(true);
    expect(failed("ARCHIVE_CONVENTION", await make(["P1_2019_431A_Ștefan/TOP.art", "P1_2019_431A_Ștefan/tmp.bak"]))).toBe(true);
  });
  const block = (x: number, y: number, angle = 0): SilkBlock => ({ idx: 0, layer: "top_silk", x, y, w: 2, h: 1, textHeight: 1, stroke: 0.15, vertical: false, chars: 2, segs: 6, decoded: "R1", decodeConfidence: 0.9, axisAngleDeg: angle });
  const textIssues = (blocks: SilkBlock[]) => evaluateLabRules([], "SMT", profile, blocks, [], { gap: () => Infinity, pointInFlash: () => false, pointInPoly: () => false, ptSegDist: () => Infinity });
  it("ERR_64 warns on overlapping recognized text boxes only on same face", () => {
    expect(textIssues([block(5, 5), block(5.5, 5)]).some((i) => i.code === "SILK_TEXT_OVERLAP")).toBe(true);
    expect(textIssues([block(5, 5), block(8, 5)]).some((i) => i.code === "SILK_TEXT_OVERLAP")).toBe(false);
    expect(textIssues([block(5, 5), { ...block(5, 5), layer: "bottom_silk" }]).some((i) => i.code === "SILK_TEXT_OVERLAP")).toBe(false);
  });
  it("ERR_66 groups unsigned reading axes: 0/90 accepted, 0/45/90 reported", () => {
    expect(textIssues([block(1, 1, 0), block(4, 1, 90)]).some((i) => i.code === "SILK_MAX_DIRECTIONS")).toBe(false);
    expect(textIssues([block(1, 1, 0), block(4, 1, 45), block(8, 1, 90)]).some((i) => i.code === "SILK_MAX_DIRECTIONS")).toBe(true);
  });
  it("FAB counts positive-width strokes, not zero-width lines", () => {
    const settings = mergeSettings(DEFAULT_SETTINGS); settings.rules.fabMinLines = 2;
    expect(failed("FAB_CONTENT", [L("fabrication", [line(1, 1, 2, 1, 0), line(1, 2, 2, 2, 0)])], settings)).toBe(true);
    expect(failed("FAB_CONTENT", [L("fabrication", [line(1, 1, 2, 1), line(1, 2, 2, 2)])], settings)).toBe(false);
  });
});