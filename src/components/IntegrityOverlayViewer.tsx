import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import type { Layer, LayerKind, Primitive } from "@/lib/gerber/types";
import { fingerprint, CLASS_LABEL, classOf, type Fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { FlipHorizontal, Printer, RotateCcw, RotateCw, ScanSearch } from "lucide-react";

type Side = { name: string; zipPath: string | null; meta?: string };
type Mode = "overlay" | "side" | "blink" | "diff";
const MODE_LABEL: Record<Mode, string> = { overlay: "Suprapunere", side: "Alăturat", blink: "Clipire", diff: "Diff (Cupru comun)" };
// Diff mode colours (data visualisation): faded board, strong red-orange for shared copper, yellow suspect zone.
const COL_FADE = "rgb(140,140,140)", COL_HIT = "#ff3b30", COL_ZONE = "#ffd60a";
type Group = "top" | "bottom" | "drill" | "silk" | "outline";
const GROUPS: { id: Group; label: string; kinds: LayerKind[] }[] = [
  { id: "top", label: "Cu TOP", kinds: ["top_copper"] },
  { id: "bottom", label: "Cu BOTTOM", kinds: ["bottom_copper"] },
  { id: "drill", label: "Găuri", kinds: ["drill"] },
  { id: "silk", label: "Serigrafie", kinds: ["top_silk", "bottom_silk"] },
  { id: "outline", label: "Contur", kinds: ["outline"] },
];
// Comparison colours (data visualisation, independent of theme): A = cyan, B = magenta; overlap adds to white.
const COL_A = "#00e5ff", COL_B = "#ff2bd6";

type Tf = SimilarityDetail["transform"];
type Loaded = { layers: Layer[]; c: [number, number]; area: number; fp: Fingerprint };
type View = { s: number; ox: number; oy: number };

async function loadSide(path: string | null): Promise<Loaded | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("gerbers").download(path);
  if (error || !data) throw new Error(error?.message ?? "Arhivă indisponibilă");
  const layers = await loadGerberZip(data);
  const fp = fingerprint(layers);
  const c = (fp.centroid ?? [0, 0]) as [number, number];
  const area = fp.board ? fp.board[0] * fp.board[1] : 1600;
  return { layers, c, area, fp };
}

const ROT = (r: number) => (r === 0 ? [1, 0] : r === 90 ? [0, 1] : r === 180 ? [-1, 0] : [0, -1]) as [number, number];

/** Raw board coordinate → common frame: centre on own reference, then (for B) pair transform, then manual tweak. */
function mapper(c: [number, number], t?: Tf, extra?: Tf) {
  const step = (px: number, py: number, tf: Tf): [number, number] => {
    if (tf.mirror) px = -px;
    const [co, si] = ROT(tf.rot);
    return [px * co - py * si + tf.dx, px * si + py * co + tf.dy];
  };
  return (x: number, y: number): [number, number] => {
    let p: [number, number] = [x - c[0], y - c[1]];
    if (t) p = step(p[0], p[1], t);
    if (extra) p = step(p[0], p[1], extra);
    return p;
  };
}

function polyArea(pts: [number, number][]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

/**
 * Draws one board into its own offscreen layer: dark primitives add copper, clear-polarity
 * primitives (LPC / pour cut-outs) erase it with destination-out, regions use even-odd fill.
 * Each layer group is rendered separately so a clearance on TOP never erases BOTTOM.
 */
function renderBoard(W: number, H: number, dpr: number, d: Loaded, groups: Set<Group>, color: string, t: Tf | undefined, extra: Tf | undefined, view: View, hidePours: boolean) {
  const out = document.createElement("canvas"); out.width = W * dpr; out.height = H * dpr;
  const octx = out.getContext("2d")!;
  const m = mapper(d.c, t, extra);
  const P = (x: number, y: number) => { const [a, b] = m(x, y); return [view.ox + a * view.s, view.oy - b * view.s] as const; };
  const totRot = ((t?.rot ?? 0) + (extra?.rot ?? 0)) % 180;
  const rotSwap = totRot === 90;
  const bigPour = d.area * 0.12;
  for (const g of GROUPS) {
    if (!groups.has(g.id)) continue;
    const lc = document.createElement("canvas"); lc.width = out.width; lc.height = out.height;
    const ctx = lc.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const l of d.layers.filter((x) => g.kinds.includes(x.kind))) {
      for (const p of l.primitives as Primitive[]) {
        if (hidePours && p.t === "region" && !p.clear && polyArea(p.pts) > bigPour) continue;
        ctx.globalCompositeOperation = p.clear ? "destination-out" : "source-over";
        if (p.t === "line") {
          const [a, b] = P(p.x1, p.y1), [c, e] = P(p.x2, p.y2);
          ctx.lineWidth = Math.max(p.clear ? 0.5 : 1, (g.id === "outline" ? Math.max(p.w, 0.15) : p.w) * view.s);
          ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, e); ctx.stroke();
        } else if (p.t === "flash") {
          const [x, y] = P(p.x, p.y);
          const w = (rotSwap ? p.h : p.w) * view.s, h = (rotSwap ? p.w : p.h) * view.s;
          ctx.beginPath();
          if (p.shape === "C") ctx.arc(x, y, Math.max(0.8, w / 2), 0, Math.PI * 2);
          else if (p.shape === "O") ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
          else ctx.rect(x - w / 2, y - h / 2, w, h);
          ctx.fill();
        } else if (p.t === "region" && p.pts.length > 2) {
          ctx.beginPath();
          p.pts.forEach(([x0, y0], i) => { const [x, y] = P(x0, y0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.closePath(); ctx.fill("evenodd");
        }
      }
    }
    // Drilled holes punch through copper, then are outlined so they stay visible.
    if (g.id === "top" || g.id === "bottom" || g.id === "drill") {
      const holes = d.layers.filter((x) => x.kind === "drill").flatMap((x) => x.holes);
      for (const h of holes) {
        const [x, y] = P(h.x, h.y), r = Math.max(1, (h.d / 2) * view.s);
        if (g.id !== "drill") { ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.globalCompositeOperation = "source-over"; ctx.lineWidth = Math.max(1, 0.12 * view.s); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    octx.globalAlpha = g.id === "silk" ? 0.6 : g.id === "outline" ? 0.9 : 0.85;
    octx.globalCompositeOperation = "lighter";
    octx.drawImage(lc, 0, 0);
  }
  return out;
}

function extent(d: Loaded | null, t?: Tf) {
  if (!d) return 10;
  const m = mapper(d.c, t); let e = 5;
  for (const l of d.layers) {
    if (l.kind !== "outline" && l.kind !== "top_copper" && l.kind !== "bottom_copper") continue;
    for (const p of l.primitives) {
      const pts: [number, number][] = p.t === "line" ? [[p.x1, p.y1], [p.x2, p.y2]] : p.t === "flash" ? [[p.x, p.y]] : p.pts;
      for (const [x, y] of pts) { const [a, b] = m(x, y); e = Math.max(e, Math.abs(a), Math.abs(b)); }
    }
  }
  return Math.min(e, 200);
}

const ID: Tf = { rot: 0, mirror: false, dx: 0, dy: 0 };

type DSeg = { x: number; y: number; a: number; w: number; l: number };
/** Trace pieces (and vias) shared by both boards within copy tolerance (±0.4 mm, ±10°, any layer), in the common frame. */
function sharedCopper(fa: Fingerprint, fb: Fingerprint, t: Tf, extra?: Tf) {
  const m = mapper([0, 0], t, extra);
  const rotAng = (ang: number) => { let r = ang; for (const tf of [t, extra]) { if (!tf) continue; if (tf.mirror) r = 180 - r; r += tf.rot; } return ((r % 180) + 180) % 180; };
  const A: DSeg[] = (fa.segs ?? []).map((s) => ({ x: s[0], y: s[1], a: s[2], w: s[3], l: s[4] }));
  const B: DSeg[] = (fb.segs ?? []).map((s) => { const [x, y] = m(s[0], s[1]); return { x, y, a: rotAng(s[2]), w: s[3], l: s[4] }; });
  const tol = 0.4, idx = new Map<string, number[]>();
  B.forEach((s, i) => { const k = `${Math.floor(s.x / tol)},${Math.floor(s.y / tol)}`; (idx.get(k) ?? idx.set(k, []).get(k)!).push(i); });
  const hitB = new Set<number>(), out: DSeg[] = [];
  for (const s of A) {
    const cx = Math.floor(s.x / tol), cy = Math.floor(s.y / tol); let ok = false;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of idx.get(`${cx + i},${cy + j}`) ?? []) {
      const q = B[k]!; const da = Math.abs(q.a - s.a);
      if (Math.abs(q.x - s.x) <= tol && Math.abs(q.y - s.y) <= tol && Math.min(da, 180 - da) <= 10) { ok = true; hitB.add(k); }
    }
    if (ok) out.push(s);
  }
  B.forEach((s, i) => { if (hitB.has(i)) out.push(s); });
  const vb = (fb.vias ?? []).map((p) => m(p[0], p[1]));
  const vias = (fa.vias ?? []).filter((p) => vb.some((q) => Math.abs(q[0] - p[0]) <= 0.25 && Math.abs(q[1] - p[1]) <= 0.25));
  return { segs: out, vias };
}

export function IntegrityOverlayViewer({ a, b, detail }: { a: Side; b: Side; detail: SimilarityDetail }) {
  const [da, setDa] = useState<Loaded | null>(null);
  const [db, setDb] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<Mode>("overlay");
  const [mix, setMix] = useState(50);
  const [groups, setGroups] = useState<Set<Group>>(new Set(["top", "bottom", "drill", "outline"]));
  const [hidePours, setHidePours] = useState(false);
  const [blinkB, setBlinkB] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [extra, setExtra] = useState<Tf>(ID);
  const [cross, setCross] = useState<[number, number] | null>(null);
  const [printDiff, setPrintDiff] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<[number, number] | null>(null);

  useEffect(() => {
    let off = false;
    setBusy(true); setErr(null); setDa(null); setDb(null); setExtra(ID);
    Promise.all([loadSide(a.zipPath), loadSide(b.zipPath)])
      .then(([x, y]) => { if (!off) { setDa(x); setDb(y); if (!x || !y) setErr("Una dintre predări nu are arhivă ZIP stocată."); } })
      .catch((e) => !off && setErr((e as Error).message))
      .finally(() => !off && setBusy(false));
    return () => { off = true; };
  }, [a.zipPath, b.zipPath]);

  useEffect(() => {
    if (mode !== "blink") return;
    const id = setInterval(() => setBlinkB((v) => !v), 600);
    return () => clearInterval(id);
  }, [mode]);

  const ext = useMemo(() => Math.max(extent(da), extent(db, detail.transform)) + 2, [da, db, detail.transform]);
  const manual = extra.rot || extra.mirror || extra.dx || extra.dy ? extra : undefined;

  useEffect(() => {
    const cv = canvas.current; if (!cv || !da || !db) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!; ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (mode === "side") {
      const half = W / 2, s = (Math.min(half, H) / (2 * ext)) * zoom;
      const ia = renderBoard(W, H, dpr, da, groups, COL_A, undefined, undefined, { s, ox: half / 2 + pan[0], oy: H / 2 + pan[1] }, hidePours);
      const ib = renderBoard(W, H, dpr, db, groups, COL_B, detail.transform, manual, { s, ox: half * 1.5 + pan[0], oy: H / 2 + pan[1] }, hidePours);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, (half - 1) * dpr, H * dpr); ctx.clip(); ctx.drawImage(ia, 0, 0); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect((half + 1) * dpr, 0, half * dpr, H * dpr); ctx.clip(); ctx.drawImage(ib, 0, 0); ctx.restore();
      ctx.fillStyle = "#333"; ctx.fillRect((half - 1) * dpr, 0, 2 * dpr, H * dpr);
      if (cross) {
        // Linked crosshair: same board point in both halves.
        const lx = cross[0] < half ? cross[0] : cross[0] - half;
        ctx.strokeStyle = "#ffffff"; ctx.globalAlpha = 0.6; ctx.lineWidth = dpr;
        for (const x of [lx, lx + half]) { ctx.beginPath(); ctx.moveTo(x * dpr, 0); ctx.lineTo(x * dpr, H * dpr); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(0, cross[1] * dpr); ctx.lineTo(W * dpr, cross[1] * dpr); ctx.stroke(); ctx.globalAlpha = 1;
      }
      return;
    }
    const s = (Math.min(W, H) / (2 * ext)) * zoom, view = { s, ox: W / 2 + pan[0], oy: H / 2 + pan[1] };
    if (mode === "diff") {
      ctx.globalAlpha = 0.22;
      ctx.drawImage(renderBoard(W, H, dpr, da, groups, COL_FADE, undefined, undefined, view, hidePours), 0, 0);
      ctx.drawImage(renderBoard(W, H, dpr, db, groups, COL_FADE, detail.transform, manual, view, hidePours), 0, 0);
      ctx.globalAlpha = 1;
      const sh = sharedCopper(da.fp, db.fp, detail.transform, manual);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = COL_HIT; ctx.fillStyle = COL_HIT; ctx.lineCap = "round";
      for (const g of sh.segs) {
        const r = (g.a * Math.PI) / 180, hx = (Math.cos(r) * g.l) / 2, hy = (Math.sin(r) * g.l) / 2;
        ctx.lineWidth = Math.max(1.5, g.w * s);
        ctx.beginPath(); ctx.moveTo(view.ox + (g.x - hx) * s, view.oy - (g.y - hy) * s); ctx.lineTo(view.ox + (g.x + hx) * s, view.oy - (g.y + hy) * s); ctx.stroke();
      }
      for (const [x, y] of sh.vias) { ctx.beginPath(); ctx.arc(view.ox + x * s, view.oy - y * s, Math.max(2, 0.35 * s), 0, Math.PI * 2); ctx.fill(); }
      const z = detail.bestZoneRect;
      if (z && (detail.routeZoneMax ?? 0) >= 80) {
        ctx.strokeStyle = COL_ZONE; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(view.ox + z[0] * s, view.oy - z[3] * s, (z[2] - z[0]) * s, (z[3] - z[1]) * s); ctx.setLineDash([]);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }
    ctx.globalCompositeOperation = "lighter";
    if (mode === "blink") {
      ctx.drawImage(blinkB ? renderBoard(W, H, dpr, db, groups, COL_B, detail.transform, manual, view, hidePours) : renderBoard(W, H, dpr, da, groups, COL_A, undefined, undefined, view, hidePours), 0, 0);
    } else {
      ctx.globalAlpha = Math.min(1, (100 - mix) / 50);
      ctx.drawImage(renderBoard(W, H, dpr, da, groups, COL_A, undefined, undefined, view, hidePours), 0, 0);
      ctx.globalAlpha = Math.min(1, mix / 50);
      ctx.drawImage(renderBoard(W, H, dpr, db, groups, COL_B, detail.transform, manual, view, hidePours), 0, 0);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }, [da, db, groups, mode, mix, blinkB, zoom, pan, ext, detail.transform, manual, hidePours, cross]);

  const zoomZone = () => {
    const z = detail.bestZoneRect, cv = canvas.current; if (!z || !cv) return;
    const W = cv.clientWidth, H = cv.clientHeight, base = Math.min(W, H) / (2 * ext);
    const zz = Math.min(40, Math.max(1, Math.min(W / ((z[2] - z[0]) * base), H / ((z[3] - z[1]) * base)) * 0.85));
    const cx = (z[0] + z[2]) / 2, cy = (z[1] + z[3]) / 2;
    setMode("diff"); setZoom(zz); setPan([-cx * base * zz, cy * base * zz]);
  };
  const toggle = (g: Group) => setGroups((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const nudge = (dx: number, dy: number) => setExtra((e) => ({ ...e, dx: Math.round((e.dx + dx) * 100) / 100, dy: Math.round((e.dy + dy) * 100) / 100 }));

  const onKey = (e: React.KeyboardEvent) => {
    const st = e.shiftKey ? 1 : 0.2;
    if (e.key === "ArrowLeft") nudge(-st, 0); else if (e.key === "ArrowRight") nudge(st, 0);
    else if (e.key === "ArrowUp") nudge(0, st); else if (e.key === "ArrowDown") nudge(0, -st);
    else if (e.key === " ") setMode((m) => (m === "blink" ? "overlay" : "blink"));
    else return;
    e.preventDefault();
  };

  const print = async () => {
    const prev = mode;
    if (printDiff !== (mode === "diff")) { setMode(printDiff ? "diff" : "overlay"); await new Promise((r) => setTimeout(r, 120)); }
    const img = canvas.current?.toDataURL("image/png"); if (prev !== mode || printDiff !== (prev === "diff")) setMode(prev); if (!img) return;
    const ff = detail.forensicFlags, fa = da?.fp.forensic, fb = db?.fp.forensic;
    const yn = (v?: boolean) => (v ? "DA" : "nu");
    const dt = (t?: number) => (t ? new Date(t).toLocaleString("ro-RO") : "—");
    const w = window.open("", "_blank"); if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const row = (k: string, v: string | number | undefined) => `<tr><td>${esc(k)}</td><td><b>${esc(String(v ?? "—"))}</b></td></tr>`;
    w.document.write(`<!doctype html><html><head><title>Fișă integritate PCB</title><style>body{font-family:system-ui,sans-serif;margin:16mm;color:#111}h1{font-size:17px;margin:0}h2{font-size:12px;font-weight:normal;margin:2px 0 10px}table{border-collapse:collapse;width:100%;font-size:12px}td{border:1px solid #ccc;padding:4px 6px}img{width:100%;border:1px solid #999;margin:10px 0;background:#05070a}.sig{margin-top:30px;display:flex;justify-content:space-between;font-size:12px}@page{size:A4}</style></head><body>
<h1>Universitatea Națională de Știință și Tehnologie POLITEHNICA București</h1>
<h2>Facultatea de Electronică, Telecomunicații și Tehnologia Informației — Fișă de verificare a integrității layout-ului PCB</h2>
<p style="font-size:12px">Generată: ${new Date().toLocaleString("ro-RO")}. Scorul este un indiciu pentru verificare umană, nu o probă automată.</p>
<table>${row("Proiect A (cyan)", a.name + (a.meta ? " · " + a.meta : ""))}${row("Proiect B (magenta)", b.name + (b.meta ? " · " + b.meta : ""))}
${row("Clasificare automată", CLASS_LABEL[classOf(detail)])}${row("Rutare trasee % (fără grosime)", detail.routing ?? detail.traces)}${row("Rutare exactă % (cu grosime)", detail.routingExact)}${row("Schemă / piese %", detail.schema)}${row("Cea mai copiată zonă de trasee %", detail.routeZoneMax)}
${row("Similaritate totală %", detail.total)}${row("Pad-uri %", detail.pads)}${row("Componente %", detail.comps)}${row("Găuri % (fără găuri de prindere)", detail.holes)}${row("Serigrafie %", detail.silk)}${row("Transformare B", `${detail.transform.rot}°${detail.transform.mirror ? ", oglindit" : ""}, Δ ${detail.transform.dx.toFixed(2)}/${detail.transform.dy.toFixed(2)} mm`)}${row("Via-uri suprapuse %", detail.viaMatch)}${row("Rutare cross-layer %", detail.routingCrossLayer)}${row("Inversare TOP↔BOTTOM detectată", yn(detail.layerSwapDetected))}${manual ? row("Ajustare manuală", `${extra.rot}°${extra.mirror ? ", oglindit" : ""}, Δ ${extra.dx}/${extra.dy} mm`) : ""}</table>
<h3 style="font-size:13px;margin:12px 0 4px">Indicatori tehnici Gerber / ZIP (Forensics)</h3><table>${row("Ordine aperturi identică (≥90%)", `${yn(ff?.identicalApertureOrder)} (${ff?.apertureOrderPct ?? "—"}%)`)}${row("Același %TF.ProjectId", yn(ff?.sameProjectId))}${row("Timestamp intern ZIP apropiat (<5 min)", yn(ff?.closeZipTimestamps))}${row("Header CAD A", (fa?.cadHeader ?? []).slice(0, 3).join(" | "))}${row("Header CAD B", (fb?.cadHeader ?? []).slice(0, 3).join(" | "))}${row("Arhivă A (min–max)", `${dt(fa?.zipMin)} – ${dt(fa?.zipMax)}`)}${row("Arhivă B (min–max)", `${dt(fb?.zipMin)} – ${dt(fb?.zipMax)}`)}</table>
<p style="font-size:11px">Imagine: ${printDiff ? "Diff — cupru comun evidențiat cu roșu, chenar galben = zona cu similitudine maximă" : "Suprapunere cyan/magenta"}.</p>
<img src="${img}" alt="Comparație"/>
<div class="sig"><span>Cadru didactic: ____________________</span><span>Semnătură: ____________</span></div>
<script>onload=()=>print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-3" ref={wrap}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["overlay", "side", "blink"] as Mode[]).map((m) => (
          <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>
            {m === "overlay" ? "Suprapunere" : m === "side" ? "Alăturat" : "Clipire"}
          </Button>
        ))}
        <span className="mx-2 h-5 w-px bg-border" />
        {GROUPS.map((g) => (
          <label key={g.id} className="flex items-center gap-1 text-xs"><Switch checked={groups.has(g.id)} onCheckedChange={() => toggle(g.id)} aria-label={g.label} />{g.label}</label>
        ))}
        <label className="flex items-center gap-1 text-xs"><Switch checked={hidePours} onCheckedChange={setHidePours} aria-label="Ascunde planurile de masă" />Ascunde planurile de masă</label>
        <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setPan([0, 0]); setExtra(ID); }} aria-label="Resetează vederea"><RotateCcw className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={zoomZone} disabled={!detail.bestZoneRect}><ScanSearch className="mr-1 h-4 w-4" />Zoom pe zona suspectă</Button>
        <label className="flex items-center gap-1 text-xs"><Switch checked={printDiff} onCheckedChange={setPrintDiff} aria-label="Fișa folosește modul Diff" />Fișă: Diff</label>
        <Button size="sm" variant="outline" onClick={() => void print()} disabled={!da || !db}><Printer className="mr-1 h-4 w-4" />Fișă A4</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Ajustare manuală B:</span>
        <Button size="sm" variant="outline" onClick={() => setExtra((e) => ({ ...e, rot: (e.rot + 90) % 360 }))} aria-label="Rotește B 90°"><RotateCw className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => setExtra((e) => ({ ...e, mirror: !e.mirror }))} aria-label="Oglindește B"><FlipHorizontal className="h-4 w-4" /></Button>
        <span className="text-muted-foreground">Săgeți = ±0,2 mm (Shift ±1 mm) · Spațiu = clipire · {extra.rot}°{extra.mirror ? " oglindit" : ""} Δ {extra.dx}/{extra.dy} mm</span>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_A }} />{a.name}</span>
        <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_B }} />{b.name} (aliniat {detail.transform.rot}°{detail.transform.mirror ? ", oglindit" : ""})</span>
        <span className="text-muted-foreground">Alb = suprapunere identică</span>
      </div>
      <div className="relative">
        <canvas
          ref={canvas}
          tabIndex={0}
          onKeyDown={onKey}
          className="h-[60vh] w-full cursor-grab rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onWheel={(e) => setZoom((z) => Math.min(40, Math.max(0.3, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
          onMouseDown={(e) => { (e.target as HTMLCanvasElement).focus(); drag.current = [e.clientX, e.clientY]; }}
          onMouseMove={(e) => {
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            if (mode === "side") setCross([e.clientX - r.left, e.clientY - r.top]);
            if (!drag.current) return; const [x, y] = drag.current; drag.current = [e.clientX, e.clientY]; setPan(([px, py]) => [px + e.clientX - x, py + e.clientY - y]);
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => { drag.current = null; setCross(null); }}
          role="img"
          aria-label="Suprapunerea Gerber a celor două plăci"
        />
        {(busy || err) && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{busy ? "Se încarcă fișierele Gerber…" : err}</div>}
      </div>
      {mode === "overlay" && (
        <div className="flex items-center gap-3 text-sm"><span className="truncate">{a.name}</span><Slider value={[mix]} min={0} max={100} step={5} onValueChange={(v) => setMix(v[0] ?? 50)} aria-label="Amestec" /><span className="truncate">{b.name}</span></div>
      )}
      <p className="text-xs text-muted-foreground">
        {CLASS_LABEL[classOf(detail)]}{detail.layerSwapDetected ? " (inversare TOP↔BOTTOM)" : ""} · Cross-layer {detail.routingCrossLayer ?? "—"}% · Via-uri {detail.viaMatch ?? "—"}% · Rutare {detail.routing ?? detail.traces ?? "—"}% (exactă {detail.routingExact ?? "—"}%) · Schemă {detail.schema ?? "—"}% · Pad-uri {detail.pads}% · Găuri {detail.holes}% · Text {detail.silk}%. Rotița = zoom, trage = deplasare.
      </p>
    </div>
  );
}
