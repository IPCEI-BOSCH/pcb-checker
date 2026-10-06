import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import type { Layer, LayerKind, Primitive } from "@/lib/gerber/types";
import { fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Printer, RotateCcw } from "lucide-react";

type Side = { name: string; zipPath: string | null; meta?: string };
type Mode = "overlay" | "side" | "blink";
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
type Loaded = { layers: Layer[]; c: [number, number] };

async function loadSide(path: string | null): Promise<Loaded | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("gerbers").download(path);
  if (error || !data) throw new Error(error?.message ?? "Arhivă indisponibilă");
  const layers = await loadGerberZip(data);
  const c = fingerprint(layers).centroid ?? [0, 0];
  return { layers, c: c as [number, number] };
}

/** Maps a raw board coordinate to the common frame: centre on own centroid, then (for B) rotate/mirror/translate. */
function mapper(c: [number, number], t?: Tf) {
  return (x: number, y: number): [number, number] => {
    let px = x - c[0], py = y - c[1];
    if (!t) return [px, py];
    if (t.mirror) px = -px;
    const [co, si] = t.rot === 0 ? [1, 0] : t.rot === 90 ? [0, 1] : t.rot === 180 ? [-1, 0] : [0, -1];
    return [px * co - py * si + t.dx, px * si + py * co + t.dy];
  };
}

function drawBoard(ctx: CanvasRenderingContext2D, d: Loaded, groups: Set<Group>, color: string, t: Tf | undefined, view: { s: number; ox: number; oy: number }) {
  const m = mapper(d.c, t);
  const P = (x: number, y: number) => { const [a, b] = m(x, y); return [view.ox + a * view.s, view.oy - b * view.s] as const; };
  const rotSwap = t && (t.rot === 90 || t.rot === 270);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const g of GROUPS) {
    if (!groups.has(g.id)) continue;
    for (const l of d.layers.filter((x) => g.kinds.includes(x.kind))) {
      ctx.globalAlpha = g.id === "silk" ? 0.6 : g.id === "outline" ? 0.9 : 0.85;
      for (const p of l.primitives as Primitive[]) {
        if (p.clear) continue;
        if (p.t === "line") {
          const [a, b] = P(p.x1, p.y1), [c, e] = P(p.x2, p.y2);
          ctx.lineWidth = Math.max(1, (g.id === "outline" ? Math.max(p.w, 0.15) : p.w) * view.s);
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
          ctx.closePath(); ctx.fill();
        }
      }
      if (g.id === "drill") {
        ctx.lineWidth = Math.max(1, 0.12 * view.s);
        for (const h of l.holes) { const [x, y] = P(h.x, h.y); ctx.beginPath(); ctx.arc(x, y, Math.max(1, (h.d / 2) * view.s), 0, Math.PI * 2); ctx.stroke(); }
      }
    }
  }
  ctx.globalAlpha = 1;
}

function extent(d: Loaded | null, t?: Tf) {
  if (!d) return 10;
  const m = mapper(d.c, t); let e = 5;
  for (const l of d.layers) for (const p of l.primitives) {
    const pts: [number, number][] = p.t === "line" ? [[p.x1, p.y1], [p.x2, p.y2]] : p.t === "flash" ? [[p.x, p.y]] : p.pts;
    for (const [x, y] of pts) { const [a, b] = m(x, y); e = Math.max(e, Math.abs(a), Math.abs(b)); }
  }
  return Math.min(e, 200);
}

export function IntegrityOverlayViewer({ a, b, detail }: { a: Side; b: Side; detail: SimilarityDetail }) {
  const [da, setDa] = useState<Loaded | null>(null);
  const [db, setDb] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [mode, setMode] = useState<Mode>("overlay");
  const [mix, setMix] = useState(50);
  const [groups, setGroups] = useState<Set<Group>>(new Set(["top", "bottom", "drill", "outline"]));
  const [blinkB, setBlinkB] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<[number, number] | null>(null);

  useEffect(() => {
    let off = false;
    setBusy(true); setErr(null); setDa(null); setDb(null);
    Promise.all([loadSide(a.zipPath), loadSide(b.zipPath)])
      .then(([x, y]) => { if (!off) { setDa(x); setDb(y); if (!x || !y) setErr("Una dintre predări nu are arhivă ZIP stocată."); } })
      .catch((e) => !off && setErr((e as Error).message))
      .finally(() => !off && setBusy(false));
    return () => { off = true; };
  }, [a.zipPath, b.zipPath]);

  useEffect(() => {
    if (mode !== "blink") return;
    const id = setInterval(() => setBlinkB((v) => !v), 700);
    return () => clearInterval(id);
  }, [mode]);

  const ext = useMemo(() => Math.max(extent(da), extent(db, detail.transform)) + 2, [da, db, detail.transform]);

  useEffect(() => {
    const cv = canvas.current; if (!cv || !da || !db) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, W, H);
    if (mode === "side") {
      const half = W / 2, s = (Math.min(half, H) / (2 * ext)) * zoom;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, half - 1, H); ctx.clip();
      drawBoard(ctx, da, groups, COL_A, undefined, { s, ox: half / 2 + pan[0], oy: H / 2 + pan[1] }); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(half + 1, 0, half, H); ctx.clip();
      drawBoard(ctx, db, groups, COL_B, detail.transform, { s, ox: half * 1.5 + pan[0], oy: H / 2 + pan[1] }); ctx.restore();
      ctx.fillStyle = "#333"; ctx.fillRect(half - 1, 0, 2, H);
      return;
    }
    const s = (Math.min(W, H) / (2 * ext)) * zoom, view = { s, ox: W / 2 + pan[0], oy: H / 2 + pan[1] };
    ctx.globalCompositeOperation = "lighter";
    if (mode === "blink") drawBoard(ctx, blinkB ? db : da, groups, blinkB ? COL_B : COL_A, blinkB ? detail.transform : undefined, view);
    else {
      const tmp = document.createElement("canvas"); tmp.width = cv.width; tmp.height = cv.height;
      const t2 = tmp.getContext("2d")!; t2.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoard(t2, da, groups, COL_A, undefined, view);
      ctx.globalAlpha = Math.min(1, (100 - mix) / 50); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tmp, 0, 0);
      t2.setTransform(1, 0, 0, 1, 0, 0); t2.clearRect(0, 0, tmp.width, tmp.height); t2.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBoard(t2, db, groups, COL_B, detail.transform, view);
      ctx.globalAlpha = Math.min(1, mix / 50); ctx.drawImage(tmp, 0, 0);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }, [da, db, groups, mode, mix, blinkB, zoom, pan, ext, detail.transform]);

  const toggle = (g: Group) => setGroups((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const print = () => {
    const img = canvas.current?.toDataURL("image/png"); if (!img) return;
    const w = window.open("", "_blank"); if (!w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const row = (k: string, v: string | number | undefined) => `<tr><td>${esc(k)}</td><td><b>${esc(String(v ?? "—"))}</b></td></tr>`;
    w.document.write(`<!doctype html><html><head><title>Fișă integritate PCB</title><style>body{font-family:system-ui,sans-serif;margin:18mm;color:#111}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}td{border:1px solid #ccc;padding:4px 6px}img{width:100%;border:1px solid #999;margin:10px 0;background:#05070a}.sig{margin-top:30px;display:flex;justify-content:space-between;font-size:12px}@page{size:A4}</style></head><body>
<h1>Fișă de verificare a integrității — layout PCB</h1>
<p style="font-size:12px">Generată: ${new Date().toLocaleString("ro-RO")}. Scorul este un indiciu pentru verificare umană, nu o probă automată.</p>
<table>${row("Proiect A (cyan)", a.name + (a.meta ? " · " + a.meta : ""))}${row("Proiect B (magenta)", b.name + (b.meta ? " · " + b.meta : ""))}
${row("Similaritate totală %", detail.total)}${row("Pad-uri %", detail.pads)}${row("Trasee (direcție+lățime) %", detail.traces)}${row("Cupru %", detail.copper)}${row("Componente %", detail.comps)}${row("Găuri %", detail.holes)}${row("Serigrafie %", detail.silk)}${row("Zonă max % / zone copiate", `${detail.zoneMax ?? "—"} / ${detail.zones ?? "—"}`)}${row("Copie parțială", detail.partial ? "da" : "nu")}${row("Transformare B", `${detail.transform.rot}°${detail.transform.mirror ? ", oglindit" : ""}, Δ ${detail.transform.dx.toFixed(1)}/${detail.transform.dy.toFixed(1)} mm`)}</table>
<img src="${img}" alt="Suprapunere"/>
<div class="sig"><span>Cadru didactic: ____________________</span><span>Semnătură: ____________</span></div>
<script>onload=()=>print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-3">
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
        <Button size="sm" variant="ghost" onClick={() => { setZoom(1); setPan([0, 0]); }} aria-label="Resetează vederea"><RotateCcw className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={print} disabled={!da || !db}><Printer className="mr-1 h-4 w-4" />Fișă A4</Button>
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_A }} />{a.name}</span>
        <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_B }} />{b.name} (aliniat {detail.transform.rot}°{detail.transform.mirror ? ", oglindit" : ""})</span>
        <span className="text-muted-foreground">Alb = suprapunere identică</span>
      </div>
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-[60vh] w-full cursor-grab rounded-md border border-border"
          onWheel={(e) => setZoom((z) => Math.min(40, Math.max(0.3, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
          onMouseDown={(e) => (drag.current = [e.clientX, e.clientY])}
          onMouseMove={(e) => { if (!drag.current) return; const [x, y] = drag.current; drag.current = [e.clientX, e.clientY]; setPan(([px, py]) => [px + e.clientX - x, py + e.clientY - y]); }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => (drag.current = null)}
          role="img"
          aria-label="Suprapunerea Gerber a celor două plăci"
        />
        {(busy || err) && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{busy ? "Se încarcă fișierele Gerber…" : err}</div>}
      </div>
      {mode === "overlay" && (
        <div className="flex items-center gap-3 text-sm"><span className="truncate">{a.name}</span><Slider value={[mix]} min={0} max={100} step={5} onValueChange={(v) => setMix(v[0] ?? 50)} aria-label="Amestec" /><span className="truncate">{b.name}</span></div>
      )}
      <p className="text-xs text-muted-foreground">
        Pad-uri {detail.pads}% · Trasee {detail.traces ?? "—"}% · Cupru {detail.copper}% · Componente {detail.comps ?? "—"}% · Găuri {detail.holes}% · Text {detail.silk}% · Zonă max {detail.zoneMax ?? "—"}%{detail.partial ? " · copie parțială" : ""}. Rotița = zoom, trage = deplasare.
      </p>
    </div>
  );
}
