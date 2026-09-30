import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { layerBBox } from "@/lib/gerber/parser";
import { LAYER_COLORS, LAYER_LABELS, LAYER_ORDER, type BBox, type Layer } from "@/lib/gerber/types";
import type { DrcIssue } from "@/lib/drc/engine";
import { REMEDIES, type CadTool } from "@/lib/drc/remedies";

interface Props {
  layers: Layer[];
  issues: DrcIssue[];
  focus?: number | null;
  cad?: CadTool;
  onSelectIssue?: (i: number) => void;
}

type LayerState = { visible: boolean; opacity: number };

const MARKER_COLORS = { blocking: "#ef4444", warning: "#f5b83d", info: "#5aa9e6" } as const;

export function GerberViewer({ layers, issues, focus, cad = "kicad", onSelectIssue }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ scale: 10, ox: 0, oy: 0 });
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const sorted = useMemo(
    () => [...layers].map((l, idx) => ({ l, idx })).sort((a, b) => LAYER_ORDER.indexOf(a.l.kind) - LAYER_ORDER.indexOf(b.l.kind)),
    [layers],
  );
  const [state, setState] = useState<Record<number, LayerState>>({});
  useEffect(() => {
    const s: Record<number, LayerState> = {};
    layers.forEach((l, i) => {
      s[i] = { visible: !["bottom_silk", "bottom_paste", "bottom_mask"].includes(l.kind), opacity: l.kind.includes("mask") ? 0.35 : 0.85 };
    });
    setState(s);
  }, [layers]);

  const bounds = useMemo<BBox>(() => {
    let b: BBox | null = null;
    for (const l of layers) {
      const lb = layerBBox(l);
      if (!lb) continue;
      b = b ? { minX: Math.min(b.minX, lb.minX), minY: Math.min(b.minY, lb.minY), maxX: Math.max(b.maxX, lb.maxX), maxY: Math.max(b.maxY, lb.maxY) } : lb;
    }
    return b ?? { minX: 0, minY: 0, maxX: 40, maxY: 40 };
  }, [layers]);

  const fit = useCallback(() => {
    const w = bounds.maxX - bounds.minX || 40;
    const h = bounds.maxY - bounds.minY || 40;
    const scale = Math.min(size.w / w, size.h / h) * 0.88;
    setView({ scale, ox: size.w / 2 - ((bounds.minX + bounds.maxX) / 2) * scale, oy: size.h / 2 + ((bounds.minY + bounds.maxY) / 2) * scale });
  }, [bounds, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => fit(), [fit]);

  const toScreen = useCallback((x: number, y: number) => [view.ox + x * view.scale, view.oy - y * view.scale] as const, [view]);

  useEffect(() => {
    if (focus == null) return;
    const iss = issues[focus];
    if (!iss || iss.x == null || iss.y == null) return;
    const ix = iss.x;
    const iy = iss.y;
    const scale = Math.max(view.scale, Math.min(size.w, size.h) / 12);
    setView({ scale, ox: size.w / 2 - ix * scale, oy: size.h / 2 + iy * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0c1410";
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const { l, idx } of sorted) {
      const st = state[idx];
      if (!st?.visible) continue;
      const color = LAYER_COLORS[l.kind];
      ctx.globalAlpha = st.opacity;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      for (const p of l.primitives) {
        if (p.clear) {
          ctx.fillStyle = "#0c1410";
          ctx.strokeStyle = "#0c1410";
        }
        if (p.t === "line") {
          const [a, b] = toScreen(p.x1, p.y1);
          const [c2, d] = toScreen(p.x2, p.y2);
          ctx.lineWidth = Math.max(1, p.w * view.scale);
          ctx.beginPath();
          ctx.moveTo(a, b);
          ctx.lineTo(c2, d);
          ctx.stroke();
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
            if (i) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
          });
          ctx.closePath();
          ctx.fill();
        }
        if (p.clear) {
          ctx.fillStyle = color;
          ctx.strokeStyle = color;
        }
      }
      if (l.kind === "drill") {
        ctx.globalAlpha = 1;
        for (const h of l.holes) {
          const [x, y] = toScreen(h.x, h.y);
          ctx.beginPath();
          ctx.arc(x, y, Math.max(1.5, (h.d / 2) * view.scale), 0, Math.PI * 2);
          ctx.fillStyle = "#050806";
          ctx.fill();
          ctx.strokeStyle = "#6b7d72";
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    // origin cross
    const [ox, oy] = toScreen(0, 0);
    ctx.strokeStyle = "#5aa9e6";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox - 10, oy);
    ctx.lineTo(ox + 10, oy);
    ctx.moveTo(ox, oy - 10);
    ctx.lineTo(ox, oy + 10);
    ctx.stroke();

    issues.forEach((iss, i) => {
      if (iss.x == null || iss.y == null) return;
      const [x, y] = toScreen(iss.x, iss.y);
      const col = MARKER_COLORS[iss.severity];
      const active = focus === i || hover?.i === i;
      ctx.beginPath();
      ctx.arc(x, y - 14, active ? 9 : 7, 0, Math.PI * 2);
      ctx.moveTo(x - 5, y - 10);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 5, y - 10);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.font = "bold 9px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), x, y - 11);
    });
  }, [sorted, state, view, size, issues, focus, hover, toScreen]);

  const hitIssue = (px: number, py: number) => {
    for (let i = issues.length - 1; i >= 0; i--) {
      const iss = issues[i];
      if (iss.x == null || iss.y == null) continue;
      const [x, y] = toScreen(iss.x, iss.y);
      if (Math.hypot(px - x, py - (y - 14)) < 10) return i;
    }
    return -1;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const scale = Math.min(2000, Math.max(1, v.scale * k));
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
  }, []);

  const hovered = hover ? issues[hover.i] : null;
  const zoom = (k: number) => setView((v) => {
    const scale = v.scale * k;
    const f = k;
    return { scale, ox: size.w / 2 - (size.w / 2 - v.ox) * f, oy: size.h / 2 - (size.h / 2 - v.oy) * f };
  });

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
      <div ref={wrapRef} className="relative h-[520px] overflow-hidden rounded-md border border-border">
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          className="cursor-crosshair touch-none"
          onWheel={onWheel}
          onMouseDown={(e) => (drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false })}
          onMouseMove={(e) => {
            const rect = canvasRef.current!.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            setCursor({ x: (px - view.ox) / view.scale, y: (view.oy - py) / view.scale });
            if (drag.current) {
              const dx = e.clientX - drag.current.x;
              const dy = e.clientY - drag.current.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
              setView((v) => ({ ...v, ox: drag.current!.ox + dx, oy: drag.current!.oy + dy }));
              return;
            }
            const i = hitIssue(px, py);
            setHover(i >= 0 ? { i, px, py } : null);
          }}
          onMouseUp={(e) => {
            const d = drag.current;
            drag.current = null;
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
          }}
        />
        <div className="absolute left-2 top-2 flex gap-1">
          <Button size="icon" variant="secondary" onClick={() => zoom(1.3)} aria-label="Mărește"><ZoomIn className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={() => zoom(1 / 1.3)} aria-label="Micșorează"><ZoomOut className="h-4 w-4" /></Button>
          <Button size="icon" variant="secondary" onClick={fit} aria-label="Încadrează"><Maximize2 className="h-4 w-4" /></Button>
        </div>
        {cursor && (
          <div className="absolute bottom-2 left-2 rounded bg-card/90 px-2 py-1 font-mono text-xs text-muted-foreground">
            X {cursor.x.toFixed(3)} · Y {cursor.y.toFixed(3)} mm
          </div>
        )}
        {hovered && hover && (
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
