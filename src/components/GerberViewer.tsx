import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Eye, EyeOff, Layers, Maximize2, Ruler, ScanLine, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ClientOnly } from "@tanstack/react-router";
import { layerBBox } from "@/lib/gerber/parser";
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER, type BBox, type Layer, type LayerKind, type Primitive } from "@/lib/gerber/types";
import type { DrcIssue, NetSummary } from "@/lib/drc/engine";
import { REMEDIES, type CadTool } from "@/lib/drc/remedies";

const Pcb3D = lazy(() => import("./Pcb3DViewer").then((m) => ({ default: m.Pcb3DViewer })));

/** Pin de comentariu spatial (X,Y) — observația profesorului pe placa studentului. */
export interface BoardPin { x: number; y: number; label: string; title?: string | undefined }

interface Props {
  layers: Layer[];
  issues: DrcIssue[];
  focus?: number | null;
  cad?: CadTool;
  onSelectIssue?: (i: number) => void;
  /** Harta de neturi din raportul DRC (Union-Find) — activează Sonda X-Ray. */
  nets?: NetSummary[] | undefined;
  /** Clearance-ul minim configurat — pentru verdictul verde/roșu al șublerului. */
  minClearance?: number | undefined;
  /** Adnotări spațiale (profesor → student), desenate ca pin-uri numerotate. */
  pins?: BoardPin[] | undefined;
  /** Click dreapta pe placă (coordonate mm) — adaugă pin de comentariu. */
  onPinRequest?: ((x: number, y: number) => void) | undefined;
  /** Centrează și mărește vederea pe un punct (ex. pin selectat din listă). */
  focusPoint?: { x: number; y: number } | null | undefined;
}

type LayerState = { visible: boolean; opacity: number };
type Tool = "none" | "ruler" | "probe";

const PAIRS: { label: string; kinds: LayerKind[]; hint: string }[] = [
  { label: "TOP + DRILL", kinds: ["top_copper", "drill", "outline"], hint: "Găuri pe pad-uri, inel anular" },
  { label: "TOP + SMTOP", kinds: ["top_copper", "top_mask", "outline"], hint: "Deschideri mască pe pad-uri" },
  { label: "TOP + SPTOP", kinds: ["top_copper", "top_paste", "outline"], hint: "Pastă pe pad-urile SMD" },
  { label: "SMTOP + SSTOP", kinds: ["top_mask", "top_silk", "outline"], hint: "Serigrafie peste pad-uri" },
];
const MIL = 0.0254;
const MARKER_COLORS = { blocking: "#ef4444", warning: "#f5b83d", info: "#5aa9e6" } as const;
const SNAP_LABEL = { center: "Snap: Center", edge: "Snap: Copper Edge", outline: "Snap: Board Outline" } as const;

type SnapKind = keyof typeof SNAP_LABEL;
interface SnapResult { x: number; y: number; kind: SnapKind; ref?: { layer: LayerKind; idx: number } }
interface RulerPt extends SnapResult {}

function ptSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { d: number; x: number; y: number } {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const x = x1 + t * dx, y = y1 + t * dy;
  return { d: Math.hypot(px - x, py - y), x, y };
}

/** Distanța minimă între două primitive de cupru (capsule/dreptunghiuri) — pentru gap-ul edge-to-edge. */
function primGap(a: Primitive, b: Primitive): number | null {
  const caps = (p: Primitive): { ax: number; ay: number; bx: number; by: number; r: number } | null => {
    if (p.t === "line") return { ax: p.x1, ay: p.y1, bx: p.x2, by: p.y2, r: p.w / 2 };
    if (p.t === "flash") {
      const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h), half = (long - short) / 2, horiz = p.w >= p.h;
      return { ax: horiz ? p.x - half : p.x, ay: horiz ? p.y : p.y - half, bx: horiz ? p.x + half : p.x, by: horiz ? p.y : p.y + half, r: short / 2 };
    }
    return null;
  };
  const A = caps(a), B = caps(b);
  if (!A || !B) return null;
  const d = Math.min(ptSeg(A.ax, A.ay, B.ax, B.ay, B.bx, B.by).d, ptSeg(A.bx, A.by, B.ax, B.ay, B.bx, B.by).d, ptSeg(B.ax, B.ay, A.ax, A.ay, A.bx, A.by).d, ptSeg(B.bx, B.by, A.ax, A.ay, A.bx, A.by).d);
  return d - A.r - B.r;
}

export function GerberViewer({ layers, issues, focus, cad = "orcad", onSelectIssue, nets, minClearance = 0.35, pins, onPinRequest, focusPoint }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ scale: 10, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<Tool>("none");
  const [ruler, setRuler] = useState<{ a: RulerPt; b: RulerPt | null } | null>(null);
  const [snapInfo, setSnapInfo] = useState<SnapResult | null>(null);
  const [probeNet, setProbeNet] = useState<NetSummary | null>(null);
  const [probePinned, setProbePinned] = useState(false);
  const [pair, setPair] = useState<string | null>(null);
  const [view3d, setView3d] = useState(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const sorted = useMemo(
    () => [...layers].map((l, idx) => ({ l, idx })).sort((a, b) => LAYER_ORDER.indexOf(a.l.kind) - LAYER_ORDER.indexOf(b.l.kind)),
    [layers],
  );
  const [state, setState] = useState<Record<number, LayerState>>({});
  useEffect(() => {
    const s: Record<number, LayerState> = {};
    layers.forEach((l, i) => {
      s[i] = { visible: !["bottom_silk", "bottom_paste", "bottom_mask", "fabrication"].includes(l.kind), opacity: l.kind.includes("mask") ? 0.35 : 0.85 };
    });
    setState(s);
  }, [layers]);

  const bounds = useMemo<BBox>(() => {
    let b: BBox | null = null;
    const core = layers.some((l) => l.kind !== "fabrication") ? layers.filter((l) => l.kind !== "fabrication") : layers;
    for (const l of core) {
      const lb = layerBBox(l);
      if (!lb) continue;
      b = b ? { minX: Math.min(b.minX, lb.minX), minY: Math.min(b.minY, lb.minY), maxX: Math.max(b.maxX, lb.maxX), maxY: Math.max(b.maxY, lb.maxY) } : lb;
    }
    return b ?? { minX: 0, minY: 0, maxX: 40, maxY: 40 };
  }, [layers]);

  const fit = useCallback(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const w = bounds.maxX - bounds.minX || 40;
    const h = bounds.maxY - bounds.minY || 40;
    const scale = Math.min(size.w / w, size.h / h) * 0.88;
    setView({ scale, ox: size.w / 2 - ((bounds.minX + bounds.maxX) / 2) * scale, oy: size.h / 2 + ((bounds.minY + bounds.maxY) / 2) * scale });
  }, [bounds, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setSize((previous) => previous.w === w && previous.h === h ? previous : { w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view3d]);
  useEffect(() => { if (!view3d) fit(); }, [fit, view3d]);

  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const applyPair = (p: (typeof PAIRS)[number] | null) => {
    setPair(p?.label ?? null);
    setState((s) => {
      const n: Record<number, LayerState> = {};
      layers.forEach((l, i) => {
        const cur = s[i] ?? { visible: true, opacity: 0.85 };
        n[i] = { ...cur, visible: p ? p.kinds.includes(l.kind) : !["bottom_silk", "bottom_paste", "bottom_mask", "fabrication"].includes(l.kind) };
      });
      return n;
    });
  };

  // === Magnetic Snap: centru pad/gaură, margine cupru, contur placă ===
  const snap = useCallback((w: { x: number; y: number }): SnapResult => {
    const tol = 10 / view.scale;
    let best: SnapResult = { ...w, kind: "center" };
    let bd = tol;
    for (const l of layers) {
      if (l.kind === "top_copper" || l.kind === "bottom_copper") {
        l.primitives.forEach((p, idx) => {
          if (p.clear) return;
          if (p.t === "flash") {
            const dc = Math.hypot(p.x - w.x, p.y - w.y);
            if (dc < bd) { bd = dc; best = { x: p.x, y: p.y, kind: "center", ref: { layer: l.kind, idx } }; }
            // marginea pad-ului: punctul de pe contur în direcția cursorului
            const ang = Math.atan2(w.y - p.y, w.x - p.x);
            const rx = p.shape === "C" || p.shape === "P" ? p.w / 2 : Math.abs(Math.cos(ang)) * p.w / 2 + Math.abs(Math.sin(ang)) * p.h / 2 > 0 ? (p.w / 2) * Math.sign(Math.cos(ang) || 1) : p.w / 2;
            const ex = p.shape === "C" || p.shape === "P" ? p.x + Math.cos(ang) * (p.w / 2) : p.x + Math.max(-p.w / 2, Math.min(p.w / 2, (w.x - p.x)));
            const ey = p.shape === "C" || p.shape === "P" ? p.y + Math.sin(ang) * (p.w / 2) : p.y + Math.max(-p.h / 2, Math.min(p.h / 2, (w.y - p.y)));
            void rx;
            const de = Math.hypot(ex - w.x, ey - w.y);
            if (de < bd) { bd = de; best = { x: ex, y: ey, kind: "edge", ref: { layer: l.kind, idx } }; }
          } else if (p.t === "line") {
            const s = ptSeg(w.x, w.y, p.x1, p.y1, p.x2, p.y2);
            const de = Math.max(0, s.d - p.w / 2);
            if (de < bd) {
              // proiecție pe marginea capsulei
              const nx = s.d > 1e-6 ? (w.x - s.x) / s.d : 0, ny = s.d > 1e-6 ? (w.y - s.y) / s.d : 0;
              bd = de;
              best = { x: s.x + nx * p.w / 2, y: s.y + ny * p.w / 2, kind: "edge", ref: { layer: l.kind, idx } };
            }
          }
        });
      }
      if (l.kind === "outline") {
        l.primitives.forEach((p, idx) => {
          if (p.t !== "line") return;
          for (const [cx2, cy2] of [[p.x1, p.y1], [p.x2, p.y2]] as const) {
            const dc = Math.hypot(cx2 - w.x, cy2 - w.y);
            if (dc < bd) { bd = dc; best = { x: cx2, y: cy2, kind: "outline", ref: { layer: l.kind, idx } }; }
          }
          const s = ptSeg(w.x, w.y, p.x1, p.y1, p.x2, p.y2);
          if (s.d < bd) { bd = s.d; best = { x: s.x, y: s.y, kind: "outline", ref: { layer: l.kind, idx } }; }
        });
      }
      for (const h of l.holes) {
        const dc = Math.hypot(h.x - w.x, h.y - w.y);
        if (dc < bd) { bd = dc; best = { x: h.x, y: h.y, kind: "center" }; }
      }
    }
    return best;
  }, [layers, view.scale]);

  // === Sonda X-Ray: harta (strat, index primitivă) → net ===
  const netByPrim = useMemo(() => {
    const m = new Map<string, NetSummary>();
    for (const n of nets ?? []) {
      for (const [kind, ids] of Object.entries(n.primitiveIds)) for (const i of ids) m.set(`${kind}:${i}`, n);
    }
    return m;
  }, [nets]);

  const hitCopper = useCallback((w: { x: number; y: number }): NetSummary | null => {
    if (!nets?.length) return null;
    for (const kind of ["top_copper", "bottom_copper"] as const) {
      const l = layers.find((x) => x.kind === kind);
      if (!l) continue;
      for (let i = 0; i < l.primitives.length; i++) {
        const p = l.primitives[i]!;
        if (p.clear) continue;
        let hit = false;
        if (p.t === "flash") hit = Math.abs(w.x - p.x) <= p.w / 2 + 0.05 && Math.abs(w.y - p.y) <= p.h / 2 + 0.05;
        else if (p.t === "line") hit = ptSeg(w.x, w.y, p.x1, p.y1, p.x2, p.y2).d <= p.w / 2 + 0.05;
        if (hit) {
          const n = netByPrim.get(`${kind}:${i}`);
          if (n) return n;
        }
      }
      // via-uri: gaura atinge netul
      const drill = layers.find((x) => x.kind === "drill");
      if (drill) {
        for (let hi = 0; hi < drill.holes.length; hi++) {
          const h = drill.holes[hi]!;
          if (Math.hypot(h.x - w.x, h.y - w.y) <= h.d / 2 + 0.1) {
            const n = nets.find((nn) => nn.holeIds.includes(hi));
            if (n) return n;
          }
        }
      }
    }
    return null;
  }, [layers, nets, netByPrim]);

  const probeSet = useMemo(() => {
    if (!probeNet) return null;
    const s = new Set<string>();
    for (const [kind, ids] of Object.entries(probeNet.primitiveIds)) for (const i of ids) s.add(`${kind}:${i}`);
    return s;
  }, [probeNet]);

  const toScreen = useCallback((x: number, y: number) => [view.ox + x * view.scale, view.oy - y * view.scale] as const, [view]);

  useEffect(() => {
    if (focus == null) return;
    const iss = issues[focus];
    if (!iss || iss.x == null || iss.y == null) return;
    const ix = iss.x, iy = iss.y;
    const scale = Math.max(view.scale, Math.min(size.w, size.h) / 12);
    setView({ scale, ox: size.w / 2 - ix * scale, oy: size.h / 2 + iy * scale });
    if (iss.layer) setState((s) => {
      const n = { ...s };
      layers.forEach((l, i) => { if (l.kind === iss.layer && n[i]) n[i] = { ...n[i]!, visible: true }; });
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Zoom direct pe un punct cerut din afară (pin de comentariu, întrebare de interviu).
  useEffect(() => {
    if (!focusPoint) return;
    const scale = Math.max(view.scale, Math.min(size.w, size.h) / 10);
    setView({ scale, ox: size.w / 2 - focusPoint.x * scale, oy: size.h / 2 + focusPoint.y * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPoint]);

  // Tastatură: X = Sondă Net, M = Șubler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "x" || e.key === "X") { setTool((v) => (v === "probe" ? "none" : "probe")); setRuler(null); }
      if (e.key === "m" || e.key === "M") { setTool((v) => (v === "ruler" ? "none" : "ruler")); setProbeNet(null); }
      if (e.key === "Escape") { setTool("none"); setRuler(null); setProbeNet(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // === Desenare ===
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const { l, idx } of sorted) {
      const st = state[idx];
      if (!st?.visible) continue;
      const color = LAYER_COLORS[l.kind];
      const isCopper = l.kind === "top_copper" || l.kind === "bottom_copper";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      l.primitives.forEach((p, pi) => {
        // X-Ray: elementele din afara netului selectat se estompează la 18%
        const inNet = probeSet?.has(`${l.kind}:${pi}`);
        ctx.globalAlpha = probeSet && isCopper ? (inNet ? 1 : st.opacity * 0.18) : st.opacity;
        if (inNet) { ctx.shadowColor = "#7ef9ff"; ctx.shadowBlur = 12; }
        if (p.clear) { ctx.fillStyle = "#0c1410"; ctx.strokeStyle = "#0c1410"; }
        if (p.t === "line") {
          const [a, b] = toScreen(p.x1, p.y1);
          const [c2, d] = toScreen(p.x2, p.y2);
          ctx.lineWidth = Math.max(1, p.w * view.scale);
          ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, d); ctx.stroke();
        } else if (p.t === "flash") {
          const [x, y] = toScreen(p.x, p.y);
          const w = Math.max(1, p.w * view.scale);
          const h = Math.max(1, p.h * view.scale);
          ctx.beginPath();
          if (p.shape === "C" || p.shape === "P") ctx.arc(x, y, w / 2, 0, Math.PI * 2);
          else if (p.shape === "O") ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
          else ctx.rect(x - w / 2, y - h / 2, w, h);
          ctx.fill();
        } else {
          ctx.beginPath();
          p.pts.forEach(([px, py], i) => {
            const [sx, sy] = toScreen(px, py);
            if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
          });
          ctx.closePath();
          ctx.fill();
        }
        if (p.clear) { ctx.fillStyle = color; ctx.strokeStyle = color; }
        ctx.shadowBlur = 0;
      });
      if (l.kind === "drill") {
        ctx.globalAlpha = 1;
        l.holes.forEach((h, hi) => {
          const [x, y] = toScreen(h.x, h.y);
          const inNet = probeNet?.holeIds.includes(hi);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.5, (h.d / 2) * view.scale), 0, Math.PI * 2);
          ctx.fillStyle = "#050806";
          ctx.fill();
          ctx.strokeStyle = inNet ? "#7ef9ff" : "#6b7d72";
          ctx.lineWidth = inNet ? 2 : 0.75;
          if (inNet) { ctx.shadowColor = "#7ef9ff"; ctx.shadowBlur = 10; }
          ctx.stroke();
          ctx.shadowBlur = 0;
        });
      }
    }
    ctx.globalAlpha = 1;
    // origine
    const [ox, oy] = toScreen(0, 0);
    ctx.strokeStyle = "#5aa9e6";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();

    // Șubler: cotă tehnică cu săgeți
    if (ruler) {
      const [ax, ay] = toScreen(ruler.a.x, ruler.a.y);
      const end = ruler.b ?? snapInfo ?? cursorRef.current;
      if (end) {
        const [bx, by] = toScreen(end.x, end.y);
        ctx.strokeStyle = "#38bdf8";
        ctx.fillStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        // săgeți la ambele capete
        const ang = Math.atan2(by - ay, bx - ax);
        for (const [px2, py2, a2] of [[ax, ay, ang + Math.PI], [bx, by, ang]] as const) {
          ctx.beginPath();
          ctx.moveTo(px2, py2);
          ctx.lineTo(px2 - 10 * Math.cos(a2 - 0.4), py2 - 10 * Math.sin(a2 - 0.4));
          ctx.lineTo(px2 - 10 * Math.cos(a2 + 0.4), py2 - 10 * Math.sin(a2 + 0.4));
          ctx.closePath(); ctx.fill();
        }
        [[ax, ay], [bx, by]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x!, y!, 3, 0, Math.PI * 2); ctx.fill(); });
      }
    }
    // ținta de snap
    if (tool === "ruler" && snapInfo) {
      const [sx, sy] = toScreen(snapInfo.x, snapInfo.y);
      ctx.strokeStyle = snapInfo.kind === "center" ? "#38bdf8" : snapInfo.kind === "edge" ? "#4ade80" : "#f5b83d";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10); ctx.stroke();
    }

    issues.forEach((iss, i) => {
      if (iss.x == null || iss.y == null) return;
      const [x, y] = toScreen(iss.x, iss.y);
      const col = MARKER_COLORS[iss.severity];
      const active = focus === i || hover?.i === i;
      ctx.beginPath();
      ctx.arc(x, y - 14, active ? 9 : 7, 0, Math.PI * 2);
      ctx.moveTo(x - 5, y - 10); ctx.lineTo(x, y); ctx.lineTo(x + 5, y - 10);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.font = "bold 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x, y - 11);
    });

    // Pin-uri de comentariu (profesor → student): romb chihlimbar numerotat.
    pins?.forEach((p, i) => {
      const [x, y] = toScreen(p.x, p.y);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#f5a623";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.fillRect(-6, -6, 12, 12);
      ctx.strokeRect(-6, -6, 12, 12);
      ctx.restore();
      ctx.fillStyle = "#000";
      ctx.font = "bold 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x, y + 3);
    });
  }, [sorted, state, view, size, issues, focus, hover, toScreen, ruler, cursor, snapInfo, tool, probeSet, probeNet, pins, view3d]);

  const hitIssue = (px: number, py: number) => {
    for (let i = issues.length - 1; i >= 0; i--) {
      const iss = issues[i];
      if (!iss || iss.x == null || iss.y == null) continue;
      const [x, y] = toScreen(iss.x, iss.y);
      if (Math.hypot(px - x, py - (y - 14)) < 10) return i;
    }
    return -1;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    setView((v) => {
      const scale = Math.min(2000, Math.max(1, v.scale * Math.exp(-dy * 0.0015)));
      const f = scale / v.scale;
      return { scale, ox: px - (px - v.ox) * f, oy: py - (py - v.oy) * f };
    });
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", prevent, { passive: false });
    return () => c.removeEventListener("wheel", prevent);
  }, [view3d]);

  const hovered = hover ? issues[hover.i] : null;
  const zoom = (k: number) => setView((v) => {
    const scale = v.scale * k;
    return { scale, ox: size.w / 2 - (size.w / 2 - v.ox) * k, oy: size.h / 2 - (size.h / 2 - v.oy) * k };
  });

  // Gap edge-to-edge între primitivele ancorate de șubler
  const rulerGap = useMemo(() => {
    if (!ruler?.a.ref || !ruler?.b?.ref) return null;
    const la = layers.find((l) => l.kind === ruler.a.ref!.layer);
    const lb = layers.find((l) => l.kind === ruler.b!.ref!.layer);
    const pa = la?.primitives[ruler.a.ref.idx];
    const pb = lb?.primitives[ruler.b!.ref!.idx];
    if (!pa || !pb) return null;
    return primGap(pa, pb);
  }, [ruler, layers]);

  const rulerEnd = ruler ? (ruler.b ?? snapInfo ?? cursor) : null;

  if (view3d) {
    return (
      <div className="space-y-2">
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setView3d(false)}><Layers className="mr-1 h-4 w-4" /> 2D CAM</Button>
          <Button size="sm" variant="default" disabled><Box className="mr-1 h-4 w-4" /> 3D PCB</Button>
        </div>
        <ClientOnly fallback={<div className="flex h-[560px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">Se încarcă motorul 3D…</div>}>
          <Suspense fallback={<div className="flex h-[560px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">Se încarcă motorul 3D…</div>}>
            <Pcb3D layers={layers} issues={issues} />
          </Suspense>
        </ClientOnly>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div ref={wrapRef} className="relative h-[520px] min-w-0 overflow-hidden rounded-md border border-border">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          className={tool !== "none" ? "cursor-cell touch-none" : "cursor-crosshair touch-none"}
          onWheel={onWheel}
          onContextMenu={(e) => {
            if (!onPinRequest) return;
            e.preventDefault();
            const rect = canvasRef.current!.getBoundingClientRect();
            onPinRequest((e.clientX - rect.left - view.ox) / view.scale, (view.oy - (e.clientY - rect.top)) / view.scale);
          }}
          onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false })}
          onMouseMove={(e) => {
            const rect = canvasRef.current!.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const raw = { x: (px - view.ox) / view.scale, y: (view.oy - py) / view.scale };
            const sn = tool === "ruler" ? snap(raw) : null;
            setSnapInfo(sn);
            const world = sn ?? raw;
            cursorRef.current = world;
            setCursor(world);
            if (drag.current) {
              const dx = e.clientX - drag.current.x;
              const dy = e.clientY - drag.current.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
              setView((v) => ({ ...v, ox: drag.current!.ox + dx, oy: drag.current!.oy + dy }));
              return;
            }
            if (tool === "probe" && !probePinned) setProbeNet(hitCopper(raw));
            const i = hitIssue(px, py);
            setHover(i >= 0 ? { i, px, py } : null);
          }}
          onMouseUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved && tool === "ruler") {
              const rect = canvasRef.current!.getBoundingClientRect();
              const w = { x: (e.clientX - rect.left - view.ox) / view.scale, y: (view.oy - (e.clientY - rect.top)) / view.scale };
              const sw = snap(w);
              setRuler((r) => (!r || r.b ? { a: sw, b: null } : { ...r, b: sw }));
              return;
            }
            if (d && !d.moved && tool === "probe") {
              const rect = canvasRef.current!.getBoundingClientRect();
              const w = { x: (e.clientX - rect.left - view.ox) / view.scale, y: (view.oy - (e.clientY - rect.top)) / view.scale };
              const n = hitCopper(w);
              setProbeNet(n);
              setProbePinned(!!n && !probePinned);
              if (!n) setProbePinned(false);
              return;
            }
            if (d && !d.moved) {
              const rect = canvasRef.current!.getBoundingClientRect();
              const i = hitIssue(e.clientX - rect.left, e.clientY - rect.top);
              if (i >= 0) onSelectIssue?.(i);
            }
          }}
          onMouseLeave={() => {
            drag.current = null;
            setHover(null);
            setCursor(null);
            setSnapInfo(null);
            if (tool === "probe" && !probePinned) setProbeNet(null);
          }}
        />
        {focus != null && issues[focus]?.x != null && (() => {
          const [rx, ry] = toScreen(issues[focus]!.x!, issues[focus]!.y!);
          if (rx < -20 || ry < -20 || rx > size.w + 20 || ry > size.h + 20) return null;
          return (
            <div className="pointer-events-none absolute" style={{ left: rx - 18, top: ry - 18 }} aria-hidden>
              <span className="absolute inset-0 h-9 w-9 animate-ping rounded-full border-2 border-destructive" />
              <span className="absolute inset-0 h-9 w-9 rounded-full border-2 border-destructive" />
              <span className="absolute left-1/2 top-0 h-9 w-px -translate-x-1/2 bg-destructive" />
              <span className="absolute left-0 top-1/2 h-px w-9 -translate-y-1/2 bg-destructive" />
            </div>
          );
        })()}

        {/* HUD Șubler */}
        {ruler && rulerEnd && (() => {
          const dx = rulerEnd.x - ruler.a.x, dy = rulerEnd.y - ruler.a.y, d = Math.hypot(dx, dy);
          const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
          return (
            <div className="absolute right-2 top-2 rounded bg-card/95 px-2 py-1 font-mono text-xs text-card-foreground shadow">
              <div>ΔX {Math.abs(dx).toFixed(3)} mm · {(Math.abs(dx) / MIL).toFixed(1)} mil</div>
              <div>ΔY {Math.abs(dy).toFixed(3)} mm · {(Math.abs(dy) / MIL).toFixed(1)} mil</div>
              <div>α {Math.abs(ang).toFixed(1)}°</div>
              <div className="font-semibold">D {d.toFixed(3)} mm · {(d / MIL).toFixed(1)} mil</div>
              {rulerGap !== null && ruler.b && (
                <div className={rulerGap >= minClearance ? "font-semibold text-green-500" : "font-semibold text-red-500"}>
                  Gap cupru: {Math.max(0, rulerGap).toFixed(3)} mm {rulerGap >= minClearance ? "✓" : `✗ < ${minClearance}`}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">{SNAP_LABEL[(ruler.b ?? snapInfo)?.kind ?? "center"]}</div>
            </div>
          );
        })()}

        {/* HUD Sondă X-Ray */}
        {tool === "probe" && (
          <div className="absolute right-2 top-2 w-56 rounded bg-card/95 p-2 font-mono text-xs text-card-foreground shadow">
            {probeNet ? (
              <>
                <div className="mb-1 font-semibold text-cyan-300">NET #{probeNet.netId} · {probeNet.name}</div>
                <div>Lungime: {probeNet.totalLengthMm.toFixed(1)} mm</div>
                <div>Lățime: {probeNet.minWidthMm ?? "—"} – {probeNet.maxWidthMm ?? "—"} mm</div>
                <div>Pad-uri: {probeNet.primitiveIds.top_copper.length + probeNet.primitiveIds.bottom_copper.length} · Via-uri: {probeNet.holeIds.length}</div>
                <div>Rezistență ≈ {probeNet.estimatedResistanceMilliohm.toFixed(1)} mΩ</div>
                <div className="mt-1 text-[10px] text-muted-foreground">{probePinned ? "Fixat — click pe net pentru eliberare" : "Click pentru fixare"}</div>
              </>
            ) : (
              <div className="text-muted-foreground">Sondă Net activă — treceți peste un pad, traseu sau via.</div>
            )}
          </div>
        )}

        <div className="absolute left-2 top-2 flex gap-1">
          <Button size="icon" variant={tool === "ruler" ? "default" : "secondary"} onClick={() => { setTool((v) => (v === "ruler" ? "none" : "ruler")); setRuler(null); setProbeNet(null); }} aria-label="Șubler digital (M)" aria-pressed={tool === "ruler"} title="Șubler digital (M): snap magnetic pe centre, margini de cupru și contur"><Ruler className="h-4 w-4" /></Button>
          <Button size="icon" variant={tool === "probe" ? "default" : "secondary"} disabled={!nets?.length} onClick={() => { setTool((v) => (v === "probe" ? "none" : "probe")); setRuler(null); setProbePinned(false); }} aria-label="Sondă Net X-Ray (X)" aria-pressed={tool === "probe"} title={nets?.length ? "Sondă Net X-Ray (X): evidențiază netul electric sub cursor" : "Sonda necesită harta de neturi (raport DRC recent)"}><ScanLine className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={() => zoom(1.3)} aria-label="Mărește"><ZoomIn className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={() => zoom(1 / 1.3)} aria-label="Micșorează"><ZoomOut className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={fit} aria-label="Încadrează"><Maximize2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={() => setView3d(true)} aria-label="Vizualizare 3D PCB" title="Comută pe vizualizarea 3D Stack-Up"><Box className="h-4 w-4" /></Button>
        </div>
        {cursor && (
          <div className="absolute bottom-2 left-2 rounded bg-card/90 px-2 py-1 font-mono text-xs text-muted-foreground">
            X {cursor.x.toFixed(3)} · Y {cursor.y.toFixed(3)} mm{snapInfo && tool === "ruler" ? ` · ${SNAP_LABEL[snapInfo.kind]}` : ""}
          </div>
        )}
        {hovered && hover && tool === "none" && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-popover p-3 text-xs shadow-lg"
            style={{ left: Math.min(hover.px + 14, size.w - 300), top: Math.max(hover.py - 20, 8) }}
          >
            <div className="font-semibold text-popover-foreground">#{hover.i + 1} {hovered.title}</div>
            <div className="mt-1 text-muted-foreground">{hovered.message}</div>
            {hovered.x != null && (
              <div className="mt-1 font-mono text-muted-foreground">({hovered.x.toFixed(3)}, {hovered.y!.toFixed(3)}) mm</div>
            )}
            <div className="mt-2 border-t border-border pt-2 text-popover-foreground">
              {REMEDIES[hovered.code]?.[cad] ?? REMEDIES[hovered.code]?.general}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-md border border-border bg-card p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Perechi rapide</div>
        <div className="grid grid-cols-2 gap-1">
          {PAIRS.map((p) => (
            <Button key={p.label} size="sm" variant={pair === p.label ? "default" : "outline"} className="h-7 px-1 text-[10px]" title={p.hint} onClick={() => applyPair(p)}>{p.label}</Button>
          ))}
          <Button size="sm" variant={pair === null ? "default" : "outline"} className="col-span-2 h-7 text-[10px]" onClick={() => applyPair(null)}><Layers className="mr-1 h-3 w-3" /> Toate straturile</Button>
        </div>
        {tool === "ruler" && <p className="text-[11px] text-muted-foreground">Șubler (M): snap pe centrul pad-urilor/găurilor, marginea cuprului și conturul plăcii. Click pe două puncte — gap-ul edge-to-edge e verde dacă ≥ {minClearance} mm, roșu altfel.</p>}
        {tool === "probe" && <p className="text-[11px] text-muted-foreground">Sondă Net (X): hover evidențiază netul electric (X-Ray), click îl fixează. Restul plăcii se estompează la 18%.</p>}
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Straturi</div>
        {sorted.map(({ l, idx }) => {
          const st = state[idx];
          if (!st) return null;
          return (
            <div key={idx} className="space-y-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left text-sm"
                onClick={() => setState((s) => ({ ...s, [idx]: { ...st, visible: !st.visible } }))}
              >
                <span className="h-3 w-3 shrink-0 rounded-sm border border-border" style={{ background: LAYER_COLORS[l.kind] }} />
                <span className="flex-1 truncate" title={l.fileName}>{LAYER_LABELS[l.kind]}</span>
                {st.visible ? <Eye className="h-3.5 w-3.5 text-muted-foreground" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              <Slider
                value={[st.opacity * 100]}
                min={5}
                max={100}
                step={5}
                onValueChange={([v]) => setState((s) => ({ ...s, [idx]: { ...st, opacity: (v ?? 50) / 100 } }))}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
