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
  | "unknown";

export type ApertureShape = "C" | "R" | "O" | "P" | "M";

export interface Aperture {
  shape: ApertureShape;
  w: number; // mm
  h: number; // mm
}

export type Primitive =
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; w: number; clear?: boolean }
  | { t: "flash"; x: number; y: number; shape: ApertureShape; w: number; h: number; clear?: boolean }
  | { t: "region"; pts: [number, number][]; clear?: boolean };

export interface Hole {
  x: number;
  y: number;
  d: number;
}

export interface Layer {
  fileName: string;
  kind: LayerKind;
  primitives: Primitive[];
  holes: Hole[];
  warnings: string[];
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
  "outline",
  "drill",
  "unknown",
];
