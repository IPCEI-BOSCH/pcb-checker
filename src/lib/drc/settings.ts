import { supabase } from "@/integrations/supabase/client";
import type { Severity } from "./engine";

/** All tunable values — DRC thresholds, scoring and CAM geometry. Stored as JSON per scope (global / series). */
export interface RuleValues {
  boardSize: number;
  boardHeight: number;
  npthMinDiameter: number;
  drillToDrill: number;
  silkPadClearance: number;
  /** Overlap tolerated before silk counts as on a pad (footprint outlines touching pad edges). */
  silkOverlapTol: number;
  passScore: number;
  reserveScore: number;
  criticalScoreCap: number;
  boardTol: number;
  originTol: number;
  edgeClearance: number;
  outlineMaxWidth: number;
  minTrace: number;
  minClearance: number;
  minHole: number;
  maxHole: number;
  annularRing: number;
  stencilT: number;
  stencilMinAR: number;
  stencilMinAreaRatio: number;
  windowpaneArea: number;
  fiducialMin: number;
  fiducialMax: number;
  fiducialMaskExtra: number;
  minFiducials: number;
  maskDuplicateRatio: number;
}

export interface PenaltyValue {
  points: number;
  severity: Severity;
  enabled: boolean;
  smtOnly: boolean;
  /** Extra points per additional occurrence after the first. */
  perIssue?: number;
  /** Maximum points this rule can subtract in total. */
  cap?: number;
  /** Critical: if it fails, the score is capped to rules.criticalScoreCap and fabrication is refused. */
  critical?: boolean;
}

export interface CamValues {
  panelCols: number;
  panelRows: number;
  panelPitch: number;
  board: number;
  rail: number;
  fiducial: number;
  coupons: boolean;
  fiducials: boolean;
  stencilCols: number;
  stencilRows: number;
  stencilPitch: number;
  stencilPitchY: number;
  stencilOriginX: number;
  stencilOriginY: number;
  stencilFrameW: number;
  stencilFrameH: number;
  stencilMargin: number;
  /** When on, board size, panel pitch and stencil pitch are derived from the DRC board dimensions. */
  autoFromBoard: boolean;
  panelGap: number;
  stencilGapX: number;
  stencilGapY: number;
}

/** Generic geometric checks a teacher-defined rule can use. */
export type CustomCheckType =
  | "min_hole"
  | "max_hole"
  | "min_line_width"
  | "max_line_width"
  | "min_pad"
  | "max_pad"
  | "layer_required"
  | "max_holes"
  | "min_holes"
  | "hole_to_edge"
  | "copper_to_edge"
  | "max_primitives";

export type CustomLayer = "top_copper" | "bottom_copper" | "top_mask" | "top_silk" | "top_paste" | "outline" | "drill" | "fabrication";

export type CustomCategory = "STRUCT" | "MECH" | "DRILL" | "COPPER" | "SOLDERMASK" | "STENCIL" | "SILKSCREEN";

/** A rule added by a teacher (manually or with AI). Scored exactly like built-in rules. */
export interface CustomRule {
  code: string;
  title: string;
  category: CustomCategory;
  checkType: CustomCheckType;
  layer: CustomLayer;
  value: number;
  points: number;
  perIssue: number;
  cap: number;
  severity: Severity;
  critical: boolean;
  enabled: boolean;
  smtOnly: boolean;
  what: string;
  why: string;
  fix: string;
}

export const CHECK_TYPES: Record<CustomCheckType, { label: string; unit: string; layers: CustomLayer[]; help: string }> = {
  min_hole: { label: "Diametru gaură minim", unit: "mm", layers: ["drill"], help: "Eroare pentru fiecare gaură mai mică decât valoarea" },
  max_hole: { label: "Diametru gaură maxim", unit: "mm", layers: ["drill"], help: "Eroare pentru fiecare gaură mai mare decât valoarea" },
  min_line_width: { label: "Lățime linie minimă", unit: "mm", layers: ["top_copper", "bottom_copper", "top_silk", "outline", "fabrication"], help: "Linii mai subțiri decât valoarea pe stratul ales" },
  max_line_width: { label: "Lățime linie maximă", unit: "mm", layers: ["top_copper", "bottom_copper", "top_silk", "outline", "fabrication"], help: "Linii mai groase decât valoarea pe stratul ales" },
  min_pad: { label: "Pad / deschidere minimă", unit: "mm", layers: ["top_copper", "bottom_copper", "top_mask", "top_paste"], help: "Latura mică a pad-ului sub valoare" },
  max_pad: { label: "Pad / deschidere maximă", unit: "mm", layers: ["top_copper", "bottom_copper", "top_mask", "top_paste"], help: "Latura mare a pad-ului peste valoare" },
  layer_required: { label: "Strat obligatoriu (nevid)", unit: "", layers: ["top_copper", "bottom_copper", "top_mask", "top_silk", "top_paste", "outline", "drill", "fabrication"], help: "Eroare dacă stratul lipsește sau e gol" },
  max_holes: { label: "Număr maxim de găuri", unit: "buc", layers: ["drill"], help: "Eroare dacă placa are mai multe găuri" },
  min_holes: { label: "Număr minim de găuri", unit: "buc", layers: ["drill"], help: "Eroare dacă placa are mai puține găuri" },
  hole_to_edge: { label: "Distanță gaură – margine placă", unit: "mm", layers: ["drill"], help: "Marginea găurii prea aproape de contur" },
  copper_to_edge: { label: "Distanță element – margine placă", unit: "mm", layers: ["top_copper", "bottom_copper", "top_silk", "top_paste"], help: "Pad-uri/linii de pe strat prea aproape de contur" },
  max_primitives: { label: "Număr maxim de elemente pe strat", unit: "buc", layers: ["top_copper", "bottom_copper", "top_silk", "top_mask", "top_paste", "fabrication"], help: "Ex.: limită de elemente pe serigrafie" },
};

export function blankCustomRule(): CustomRule {
  return {
    code: `CUSTOM_${Date.now().toString(36).toUpperCase()}`,
    title: "Regulă nouă",
    category: "DRILL",
    checkType: "min_hole",
    layer: "drill",
    value: 0.4,
    points: 5,
    perIssue: 1,
    cap: 15,
    severity: "warning",
    critical: false,
    enabled: true,
    smtOnly: false,
    what: "",
    why: "",
    fix: "",
  };
}

export interface Settings {
  rules: RuleValues;
  penalties: Record<string, PenaltyValue>;
  customRules?: CustomRule[];
  cam: CamValues;
  notes?: string;
}

const MIL = 0.0254;

export const DEFAULT_SETTINGS: Settings = {
  rules: {
    boardSize: 40,
    boardHeight: 40,
    npthMinDiameter: 2.5,
    drillToDrill: 0.5,
    silkPadClearance: 0,
    silkOverlapTol: 0.1,
    passScore: 80,
    reserveScore: 50,
    criticalScoreCap: 30,
    boardTol: 0.2,
    originTol: 0.05,
    edgeClearance: 1.0,
    outlineMaxWidth: 0.2,
    minTrace: 0.38,
    minClearance: 0.3,
    minHole: 0.3,
    maxHole: 3.2,
    annularRing: 0.15,
    stencilT: 0.12,
    stencilMinAR: 1.5,
    stencilMinAreaRatio: 0.66,
    windowpaneArea: 9,
    fiducialMin: 0.8,
    fiducialMax: 2.0,
    fiducialMaskExtra: 0.3,
    minFiducials: 2,
    maskDuplicateRatio: 0.5,
  },
  penalties: {
    MISSING_LAYER: { points: 20, severity: "blocking", enabled: true, smtOnly: false, perIssue: 0, cap: 20 },
    DRL_COUNT: { points: 20, severity: "blocking", enabled: true, smtOnly: false, perIssue: 0, cap: 20 },
    BOARD_OVERSIZE: { points: 60, severity: "blocking", enabled: true, smtOnly: false, perIssue: 0, cap: 60, critical: true },
    BOARD_SIZE: { points: 15, severity: "blocking", enabled: true, smtOnly: false, perIssue: 0, cap: 15 },
    HOLE_OUTSIDE_PAD: { points: 40, severity: "blocking", enabled: true, smtOnly: false, perIssue: 5, cap: 60, critical: true },
    ORIGIN: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 0, cap: 5 },
    OUTLINE_WIDTH: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 0, cap: 5 },
    EDGE_CLEARANCE: { points: 10, severity: "blocking", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    VIA_IN_PAD: { points: 15, severity: "blocking", enabled: true, smtOnly: true, perIssue: 2, cap: 25 },
    SSTOP_OVER_PAD: { points: 10, severity: "blocking", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    SILK_OVER_PAD: { points: 20, severity: "blocking", enabled: true, smtOnly: false, perIssue: 2, cap: 30 },
    SILK_EDGE: { points: 2, severity: "info", enabled: true, smtOnly: false, perIssue: 0, cap: 2 },
    MASK_DUPLICATE: { points: 25, severity: "blocking", enabled: true, smtOnly: false, perIssue: 0, cap: 25 },
    FIDUCIALS: { points: 10, severity: "blocking", enabled: true, smtOnly: true, perIssue: 0, cap: 10 },
    MIN_TRACE: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    CLEARANCE: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    DRILL_TO_DRILL: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    ANNULAR_RING: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    HOLE_SIZE: { points: 5, severity: "warning", enabled: true, smtOnly: false, perIssue: 1, cap: 15 },
    MISSING_PASTE: { points: 10, severity: "blocking", enabled: true, smtOnly: true, perIssue: 0, cap: 10 },
    STENCIL_RATIO: { points: 5, severity: "warning", enabled: true, smtOnly: true, perIssue: 1, cap: 15 },
    STENCIL_WINDOWPANE: { points: 0, severity: "info", enabled: true, smtOnly: true, perIssue: 0, cap: 0 },
  },
  cam: {
    panelCols: 7,
    panelRows: 6,
    panelPitch: 40.508,
    board: 40,
    rail: 8,
    fiducial: 1.0,
    coupons: true,
    fiducials: true,
    stencilCols: 7,
    stencilRows: 6,
    stencilPitch: 40,
    stencilPitchY: 50,
    stencilOriginX: 20,
    stencilOriginY: 310,
    stencilFrameW: 300,
    stencilFrameH: 400,
    stencilMargin: 10,
    autoFromBoard: true,
    panelGap: 0.508,
    stencilGapX: 0,
    stencilGapY: 10,
  },
};

type FieldMeta = { label: string; unit: string; group: string; step?: number; help?: string };

export const RULE_FIELDS: Record<keyof RuleValues, FieldMeta> = {
  boardSize: { label: "Lățime placă (X)", unit: "mm", group: "Geometrie", step: 0.1, help: "Modifică automat panoul și stencilul (dacă e activă sincronizarea)" },
  boardHeight: { label: "Înălțime placă (Y)", unit: "mm", group: "Geometrie", step: 0.1 },
  npthMinDiameter: { label: "Gaură de montaj (fără pad) de la Ø", unit: "mm", group: "Găurire", step: 0.1, help: "Găurile mai mari sunt considerate găuri de prindere și pot sta în afara pad-urilor" },
  drillToDrill: { label: "Distanță minimă între găuri (margine-margine)", unit: "mm", group: "Găurire", step: 0.05 },
  silkPadClearance: { label: "Gardă serigrafie față de pad", unit: "mm", group: "Fiduciali & mască", step: 0.01 },
  silkOverlapTol: { label: "Toleranță suprapunere serigrafie (contur carcasă)", unit: "mm", group: "Fiduciali & mască", step: 0.01 },
  passScore: { label: "Scor minim „Admis fabricație”", unit: "pct", group: "Scorare", step: 1 },
  reserveScore: { label: "Scor minim „Admis cu rezerve”", unit: "pct", group: "Scorare", step: 1 },
  criticalScoreCap: { label: "Scor maxim când există o eroare critică", unit: "pct", group: "Scorare", step: 1, help: "Ex.: găuri în afara pad-urilor, placă mai mare decât formatul" },
  boardTol: { label: "Toleranță dimensiune", unit: "mm", group: "Geometrie", step: 0.01 },
  originTol: { label: "Toleranță origine (0,0)", unit: "mm", group: "Geometrie", step: 0.01 },
  outlineMaxWidth: { label: "Lățime maximă contur", unit: "mm", group: "Geometrie", step: 0.01 },
  edgeClearance: { label: "Gardă margine (cupru)", unit: "mm", group: "Geometrie", step: 0.05 },
  minTrace: { label: "Lățime minimă traseu", unit: "mm", group: "Cupru", step: 0.001, help: "15 mil ≈ 0.380 mm (16 mil = 0.406 mm)" },
  minClearance: { label: "Izolație minimă (clearance)", unit: "mm", group: "Cupru", step: 0.001, help: "12 mil ≈ 0.300 mm (14 mil = 0.356 mm)" },
  annularRing: { label: "Inel anular minim", unit: "mm", group: "Cupru", step: 0.01 },
  minHole: { label: "Diametru minim gaură", unit: "mm", group: "Găurire", step: 0.05 },
  maxHole: { label: "Diametru maxim gaură", unit: "mm", group: "Găurire", step: 0.05 },
  fiducialMin: { label: "Fiducial Ø minim", unit: "mm", group: "Fiduciali & mască", step: 0.05 },
  fiducialMax: { label: "Fiducial Ø maxim", unit: "mm", group: "Fiduciali & mască", step: 0.05 },
  fiducialMaskExtra: { label: "Deschidere mască fiducial (+)", unit: "mm", group: "Fiduciali & mască", step: 0.05 },
  minFiducials: { label: "Număr minim fiduciali", unit: "buc", group: "Fiduciali & mască", step: 1 },
  maskDuplicateRatio: { label: "Prag capcană SMTOP=TOP", unit: "raport", group: "Fiduciali & mască", step: 0.05 },
  stencilT: { label: "Grosime stencil", unit: "mm", group: "Stencil IPC-7525B", step: 0.01 },
  stencilMinAR: { label: "Aspect Ratio minim", unit: "", group: "Stencil IPC-7525B", step: 0.05 },
  stencilMinAreaRatio: { label: "Area Ratio minim", unit: "", group: "Stencil IPC-7525B", step: 0.01 },
  windowpaneArea: { label: "Arie pad termic (segmentare)", unit: "mm²", group: "Stencil IPC-7525B", step: 0.5 },
};

export const CAM_FIELDS: Record<keyof CamValues, FieldMeta> = {
  panelCols: { label: "Panou — coloane", unit: "", group: "Panou PCB", step: 1 },
  panelRows: { label: "Panou — rânduri", unit: "", group: "Panou PCB", step: 1 },
  panelPitch: { label: "Panou — pas", unit: "mm", group: "Panou PCB", step: 0.001 },
  board: { label: "Plăcuță", unit: "mm", group: "Panou PCB", step: 0.1 },
  rail: { label: "Ramă tehnologică", unit: "mm", group: "Panou PCB", step: 0.5 },
  fiducial: { label: "Fiducial panou Ø", unit: "mm", group: "Panou PCB", step: 0.1 },
  coupons: { label: "Cupoane de test", unit: "", group: "Panou PCB" },
  fiducials: { label: "Fiduciali de panou", unit: "", group: "Panou PCB" },
  stencilCols: { label: "Stencil — coloane", unit: "", group: "Stencil A3", step: 1 },
  stencilRows: { label: "Stencil — rânduri", unit: "", group: "Stencil A3", step: 1 },
  stencilPitch: { label: "Stencil — pas pe X (între coloane)", unit: "mm", group: "Stencil A3", step: 0.001, help: "Harta oficială: 40 mm (X = 20, 60 … 260)" },
  stencilPitchY: { label: "Stencil — pas pe Y (între rânduri)", unit: "mm", group: "Stencil A3", step: 0.001, help: "Harta oficială: 50 mm (Y = 310, 260 … 60)" },
  stencilOriginX: { label: "Stencil — X prima coloană", unit: "mm", group: "Stencil A3", step: 0.1 },
  stencilOriginY: { label: "Stencil — Y primul rând (sus)", unit: "mm", group: "Stencil A3", step: 0.1 },
  stencilFrameW: { label: "Folie — lățime", unit: "mm", group: "Stencil A3", step: 1 },
  stencilFrameH: { label: "Folie — înălțime", unit: "mm", group: "Stencil A3", step: 1 },
  stencilMargin: { label: "Margine minimă", unit: "mm", group: "Stencil A3", step: 1 },
  autoFromBoard: { label: "Calculează automat din dimensiunea plăcii", unit: "", group: "Sincronizare cu placa", help: "Plăcuța, pasul panoului și pașii stencilului urmează dimensiunea din Reguli DRC" },
  panelGap: { label: "Spațiu între plăci în panou", unit: "mm", group: "Sincronizare cu placa", step: 0.001 },
  stencilGapX: { label: "Spațiu stencil între coloane", unit: "mm", group: "Sincronizare cu placa", step: 0.1 },
  stencilGapY: { label: "Spațiu stencil între rânduri", unit: "mm", group: "Sincronizare cu placa", step: 0.1 },
};

export function mergeSettings(...parts: (Partial<Settings> | null | undefined)[]): Settings {
  const out: Settings = structuredClone(DEFAULT_SETTINGS);
  for (const p of parts) {
    if (!p) continue;
    Object.assign(out.rules, p.rules ?? {});
    Object.assign(out.cam, p.cam ?? {});
    for (const [k, v] of Object.entries(p.penalties ?? {})) out.penalties[k] = { ...(out.penalties[k] ?? DEFAULT_SETTINGS.penalties['ORIGIN']!), ...v };
    if (p.notes !== undefined) out.notes = p.notes;
  }
  return deriveCam(out);
}

/** Board dimensions drive panel/stencil geometry when cam.autoFromBoard is on. */
export function deriveCam(s: Settings): Settings {
  if (!s.cam.autoFromBoard) return s;
  const w = s.rules.boardSize;
  const h = s.rules.boardHeight || w;
  const big = Math.max(w, h);
  s.cam.board = big;
  s.cam.panelPitch = +(big + s.cam.panelGap).toFixed(3);
  s.cam.stencilPitch = +(w + s.cam.stencilGapX).toFixed(3);
  s.cam.stencilPitchY = +(h + s.cam.stencilGapY).toFixed(3);
  return s;
}

/** Effective settings for a series: defaults <- global row <- series row. */
export async function fetchSettings(seriesId?: string | null): Promise<Settings> {
  const { data, error } = await supabase.from("drc_settings").select("series_id, settings");
  if (error) throw error;
  const global = data.find((r) => !r.series_id)?.settings as Partial<Settings> | undefined;
  const own = seriesId ? (data.find((r) => r.series_id === seriesId)?.settings as Partial<Settings> | undefined) : undefined;
  return mergeSettings(global, own);
}

export async function saveSettings(seriesId: string | null, settings: Settings, userId: string) {
  const q = supabase.from("drc_settings").select("id");
  const { data: existing } = seriesId ? await q.eq("series_id", seriesId).maybeSingle() : await q.is("series_id", null).maybeSingle();
  const row = { series_id: seriesId, settings: settings as never, updated_by: userId, updated_at: new Date().toISOString() };
  const { error } = existing
    ? await supabase.from("drc_settings").update(row).eq("id", existing.id)
    : await supabase.from("drc_settings").insert(row);
  if (error) throw error;
}

/** Flatten to key/value rows for spreadsheets. */
export function flattenSettings(s: Settings): [string, string, string][] {
  const rows: [string, string, string][] = [];
  for (const [k, v] of Object.entries(s.rules)) rows.push([`rules.${k}`, String(v), RULE_FIELDS[k as keyof RuleValues]?.label ?? ""]);
  for (const [k, v] of Object.entries(s.penalties)) {
    rows.push([`penalties.${k}.points`, String(v.points), `Penalizare ${k}`]);
    rows.push([`penalties.${k}.severity`, v.severity, `Severitate ${k} (blocking/warning/info)`]);
    rows.push([`penalties.${k}.enabled`, String(v.enabled), `Activă ${k}`]);
    rows.push([`penalties.${k}.perIssue`, String(v.perIssue ?? 0), `Puncte per apariție suplimentară ${k}`]);
    rows.push([`penalties.${k}.cap`, String(v.cap ?? v.points), `Plafon penalizare ${k}`]);
    rows.push([`penalties.${k}.critical`, String(!!v.critical), `Eroare critică ${k}`]);
  }
  for (const [k, v] of Object.entries(s.cam)) rows.push([`cam.${k}`, String(v), CAM_FIELDS[k as keyof CamValues]?.label ?? ""]);
  rows.push(["notes", s.notes ?? "", "Note"]);
  return rows;
}

export function unflattenSettings(rows: string[][], base: Settings): Settings {
  const out = structuredClone(base);
  const parse = (v: string, ref: unknown) => (typeof ref === "number" ? Number(v.replace(",", ".")) : typeof ref === "boolean" ? /^(true|1|da|yes)$/i.test(v.trim()) : v.trim());
  for (const [key, value] of rows) {
    if (!key || value === undefined) continue;
    const parts = key.trim().split(".");
    if (parts[0] === "rules" && parts[1] && parts[1] in out.rules) {
      const n = parse(value, 0) as number;
      if (Number.isFinite(n)) (out.rules as unknown as Record<string, number>)[parts[1]] = n;
    } else if (parts[0] === "cam" && parts[1] && parts[1] in out.cam) {
      const ref = (out.cam as unknown as Record<string, unknown>)[parts[1]];
      const v = parse(value, ref);
      if (typeof v !== "number" || Number.isFinite(v)) (out.cam as unknown as Record<string, unknown>)[parts[1]] = v;
    } else if (parts[0] === "penalties" && parts[1] && parts[2]) {
      const p = out.penalties[parts[1]] ?? { points: 0, severity: "warning", enabled: true, smtOnly: false };
      if (parts[2] === "points") p.points = Number(value) || 0;
      else if (parts[2] === "severity" && ["blocking", "warning", "info"].includes(value.trim())) p.severity = value.trim() as Severity;
      else if (parts[2] === "enabled") p.enabled = /^(true|1|da|yes)$/i.test(value.trim());
      else if (parts[2] === "perIssue") p.perIssue = Number(value) || 0;
      else if (parts[2] === "cap") p.cap = Number(value) || 0;
      else if (parts[2] === "critical") p.critical = /^(true|1|da|yes)$/i.test(value.trim());
      out.penalties[parts[1]] = p;
    } else if (parts[0] === "notes") out.notes = value;
  }
  return deriveCam(out);
}
