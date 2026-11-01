export type LayerKind =
  | "top_copper"
  | "bottom_copper"
  | "top_mask"
  | "bottom_mask"
  | "top_silk"
  | "bottom_silk"
  | "top_paste"
  | "bottom_paste"
  | "outline"
  | "drill"
  | "fabrication"
  | "unknown";

export type ApertureShape = "C" | "R" | "O" | "P" | "M";

export interface Aperture {
  shape: ApertureShape;
  w: number; // mm
  h: number; // mm
}

/** Analytic parameters of a G02/G03 arc that produced this polyline segment. */
export interface ArcParams {
  cx: number;
  cy: number;
  r: number;
  a0: number; // start angle (rad)
  a1: number; // end angle (rad)
  cw: boolean;
}

export type Primitive =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; w: number; clear?: boolean; arc?: ArcParams; net?: string; refdes?: string }
  | { t: "flash"; x: number; y: number; shape: ApertureShape; w: number; h: number; clear?: boolean; net?: string; refdes?: string; fn?: string }
  | { t: "region"; pts: [number, number][]; clear?: boolean; net?: string; refdes?: string };

export interface Hole {
  x: number;
  y: number;
  d: number;
  /** Slotted hole (G85 / M15-M16 milling): end point of the slot. */
  slot?: { x2: number; y2: number };
}

export interface Layer {
  fileName: string;
  kind: LayerKind;
  primitives: Primitive[];
  holes: Hole[];
  warnings: string[];
  /** Excellon coordinate format actually used (int:dec). */
  fmt?: { int: number; dec: number; inch?: boolean };
  /** Forensic metadata (integrity module only): aperture definitions in order, CAD header lines, ZIP entry mtime, drill tool order. */
  meta?: { apertures?: string[]; header?: string[]; mtime?: number | undefined; toolOrder?: number[] };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const LAYER_LABELS: Record<LayerKind, string> = {
  top_copper: "Cupru TOP",
  bottom_copper: "Cupru BOTTOM",
  top_mask: "Mască TOP (SMTOP)",
  bottom_mask: "Mască BOTTOM",
  top_silk: "Serigrafie TOP",
  bottom_silk: "Serigrafie BOTTOM",
  top_paste: "Pastă TOP (Stencil)",
  bottom_paste: "Pastă BOTTOM",
  outline: "Contur / Mecanic",
  drill: "Găurire (Excellon)",
  fabrication: "Fabricație / Mecanic (FAB)",
  unknown: "Nerecunoscut",
};

// Industrial conventional colors used only for canvas rendering.
export const LAYER_COLORS: Record<LayerKind, string> = {
  top_copper: "#d4863b",
  bottom_copper: "#4f8fd6",
  top_mask: "#1f8a4c",
  bottom_mask: "#2a6f8a",
  top_silk: "#f5f5f0",
  bottom_silk: "#c9c2e8",
  top_paste: "#a8a8b3",
  bottom_paste: "#8a8a99",
  outline: "#f2d04b",
  drill: "#0b0f0d",
  fabrication: "#c77dff",
  unknown: "#888888",
};

export const LAYER_ORDER: LayerKind[] = [
  "bottom_silk",
  "bottom_mask",
  "bottom_copper",
  "top_copper",
  "top_mask",
  "top_paste",
  "top_silk",
  "bottom_paste",
  "fabrication",
  "outline",
  "drill",
  "unknown",
];
