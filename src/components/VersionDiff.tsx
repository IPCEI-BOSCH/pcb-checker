import { useEffect, useMemo, useRef, useState } from "react";
import { GitCompareArrows, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import type { Layer, Primitive } from "@/lib/gerber/types";
import type { DrcReport } from "@/lib/drc/engine";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

/**
 * Visual Diff între două predări ale aceluiași student.
 * Versiunea veche = cyan, cea nouă = magenta, neschimbate = gri închis;
 * modul „Diff Only" izolează elementele adăugate (verde) și șterse/mutate (roșu).
 */

export interface VersionEntry {
  id: string;
  label: string;
  zipPath: string | null;
  score: number | null;
  report: DrcReport | null;
  createdAt: string;
}

type Mode = "overlay" | "diffonly";

const COL_OLD = "#00e5ff";
const COL_NEW = "#ff2bd6";
const COL_SAME = "#4b5563";
const COL_ADD = "#22c55e";
const COL_DEL = "#ef4444";

const DRAW_KINDS = ["top_copper", "bottom_copper", "outline"] as const;

function centroid(layers: Layer[]): [number, number] {
  const outline = layers.find((l) => l.kind === "outline");
  let sx = 0, sy = 0, n = 0;
  for (const p of outline?.primitives ?? []) {
    if (p.t === "line") { sx += (p.x1 + p.x2) / 2; sy += (p.y1 + p.y2) / 2; n++; }
  }
  return n ? [sx / n, sy / n] : [0, 0];
}

/** Randează placa (cupru + contur + găuri) într-un canvas offscreen, centrată pe centroidul conturului. */
function renderMask(layers: Layer[], W: number, H: number, dpr: number, view: { s: number; ox: number; oy: number }, c: [number, number]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const P = (x: number, y: number) => [view.ox + (x - c[0]) * view.s, view.oy - (y - c[1]) * view.s] as const;
  for (const l of layers) {
    if (!(DRAW_KINDS as readonly string[]).includes(l.kind)) continue;
    for (const p of l.primitives as Primitive[]) {
      if (p.clear) continue;
      if (p.t === "line") {
        const [a, b] = P(p.x1, p.y1); const [c2, d] = P(p.x2, p.y2);
        ctx.lineWidth = Math.max(l.kind === "outline" ? 0.5 : 1, p.w * view.s);
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, d); ctx.stroke();
      } else if (p.t === "flash") {
        const [x, y] = P(p.x, p.y);
        const w = Math.max(1, p.w * view.s), h = Math.max(1, p.h * view.s);
        ctx.beginPath();
        if (p.shape === "C" || p.shape === "P") ctx.arc(x, y, w / 2, 0, Math.PI * 2);
        else if (p.shape === "O") ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2);
        else ctx.rect(x - w / 2, y - h / 2, w, h);
        ctx.fill();
      } else if (p.pts.length > 2) {
        ctx.beginPath();
        p.pts.forEach(([x0, y0], i) => { const [x, y] = P(x0, y0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath(); ctx.fill("evenodd");
      }
    }
  }
  for (const l of layers.filter((x) => x.kind === "drill")) {
    for (const h of l.holes) {
      const [x, y] = P(h.x, h.y);
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, (h.d / 2) * view.s), 0, Math.PI * 2); ctx.fill();
    }
  }
  return cv;
}

/** Compune două măști: A∩B gri, A\B roșu (șters), B\A verde (adăugat) sau overlay cyan/magenta. */
function composite(ma: HTMLCanvasElement, mb: HTMLCanvasElement, mode: Mode): HTMLCanvasElement {
  const W = ma.width, H = ma.height;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const ctx = out.getContext("2d")!;
  const tinted = (src: HTMLCanvasElement, color: string, op: "none" | "minusA" | "minusB" = "none") => {
    const t = document.createElement("canvas"); t.width = W; t.height = H;
    const tc = t.getContext("2d")!;
    tc.drawImage(src, 0, 0);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = color; tc.fillRect(0, 0, W, H);
    if (op === "minusA") { tc.globalCompositeOperation = "destination-out"; tc.drawImage(ma, 0, 0); }
    if (op === "minusB") { tc.globalCompositeOperation = "destination-out"; tc.drawImage(mb, 0, 0); }
    return t;
  };
  if (mode === "overlay") {
    // neschimbat = A∩B gri închis, apoi A cyan și B magenta cu transparență
    const inter = document.createElement("canvas"); inter.width = W; inter.height = H;
    const ic = inter.getContext("2d")!;
    ic.drawImage(ma, 0, 0);
    ic.globalCompositeOperation = "source-in"; ic.drawImage(mb, 0, 0);
    ctx.globalAlpha = 0.85; ctx.drawImage(tinted(inter, COL_SAME), 0, 0);
    ctx.globalAlpha = 0.55; ctx.drawImage(tinted(ma, COL_OLD), 0, 0);
    ctx.drawImage(tinted(mb, COL_NEW), 0, 0);
    ctx.globalAlpha = 1;
  } else {
    const inter = document.createElement("canvas"); inter.width = W; inter.height = H;
    const ic = inter.getContext("2d")!;
    ic.drawImage(ma, 0, 0);
    ic.globalCompositeOperation = "source-in"; ic.drawImage(mb, 0, 0);
    ctx.globalAlpha = 0.3; ctx.drawImage(tinted(inter, COL_SAME), 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(tinted(ma, COL_DEL, "minusB"), 0, 0); // șters/mutat
    ctx.drawImage(tinted(mb, COL_ADD, "minusA"), 0, 0); // adăugat
  }
  return out;
}

function failedCodes(r: DrcReport | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const rule of r?.rules ?? []) if (!rule.passed) m.set(rule.code, rule.title);
  return m;
}

export function VersionDiffDialog({ studentName, versions, open, onClose }: { studentName: string; versions: VersionEntry[]; open: boolean; onClose: () => void }) {
  const usable = versions.filter((v) => v.zipPath);
  const [oldId, setOldId] = useState<string>("");
  const [newId, setNewId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("overlay");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [boards, setBoards] = useState<{ a: Layer[]; b: Layer[] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const drag = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!open) return;
    const sortedV = [...usable].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setOldId(sortedV[0]?.id ?? "");
    setNewId(sortedV[sortedV.length - 1]?.id ?? "");
    setBoards(null); setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const vOld = usable.find((v) => v.id === oldId);
  const vNew = usable.find((v) => v.id === newId);

  useEffect(() => {
    if (!vOld?.zipPath || !vNew?.zipPath || vOld.id === vNew.id) { setBoards(null); return; }
    let off = false;
    setBusy(true); setErr(null);
    (async () => {
      const [da, db] = await Promise.all([
        supabase.storage.from("gerbers").download(vOld.zipPath!),
        supabase.storage.from("gerbers").download(vNew.zipPath!),
      ]);
      if (da.error || !da.data) throw new Error(da.error?.message ?? "Arhiva versiunii vechi lipsește");
      if (db.error || !db.data) throw new Error(db.error?.message ?? "Arhiva versiunii noi lipsește");
      const [la, lb] = await Promise.all([loadGerberZip(da.data), loadGerberZip(db.data)]);
      if (!off) setBoards({ a: la, b: lb });
    })().catch((e) => !off && setErr((e as Error).message)).finally(() => !off && setBusy(false));
    return () => { off = true; };
  }, [vOld?.id, vNew?.id, vOld?.zipPath, vNew?.zipPath]);

  const ext = useMemo(() => {
    if (!boards) return 30;
    let e = 10;
    for (const layers of [boards.a, boards.b]) {
      for (const l of layers) {
        if (!(DRAW_KINDS as readonly string[]).includes(l.kind)) continue;
        for (const p of l.primitives) {
          const pts: [number, number][] = p.t === "line" ? [[p.x1, p.y1], [p.x2, p.y2]] : p.t === "flash" ? [[p.x, p.y]] : p.pts;
          for (const [x, y] of pts) e = Math.max(e, Math.abs(x), Math.abs(y));
        }
      }
    }
    return Math.min(e, 300);
  }, [boards]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !boards) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, cv.width, cv.height);
    const s = (Math.min(W, H) / (2 * ext)) * zoom;
    const view = { s, ox: W / 2 + pan[0], oy: H / 2 + pan[1] };
    const ma = renderMask(boards.a, W, H, dpr, view, centroid(boards.a));
    const mb = renderMask(boards.b, W, H, dpr, view, centroid(boards.b));
    ctx.drawImage(composite(ma, mb, mode), 0, 0);
  }, [boards, mode, ext, zoom, pan]);

  const summary = useMemo(() => {
    if (!vOld || !vNew) return null;
    const fa = failedCodes(vOld.report), fb = failedCodes(vNew.report);
    const resolved = [...fa.keys()].filter((k) => !fb.has(k)).map((k) => fa.get(k)!);
    const introduced = [...fb.keys()].filter((k) => !fa.has(k)).map((k) => fb.get(k)!);
    const dScore = (vNew.score ?? 0) - (vOld.score ?? 0);
    return { resolved, introduced, dScore };
  }, [vOld, vNew]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><GitCompareArrows className="h-4 w-4" /> Compară vizual 2 versiuni — {studentName}</DialogTitle>
        </DialogHeader>
        {usable.length < 2 ? (
          <p className="text-sm text-muted-foreground">Studentul are mai puțin de două predări cu arhivă ZIP — nu există ce compara.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Select value={oldId} onValueChange={setOldId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Versiunea veche" /></SelectTrigger>
                <SelectContent>{usable.map((v) => <SelectItem key={v.id} value={v.id}>{v.label} · scor {v.score ?? "—"}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-muted-foreground">vs</span>
              <Select value={newId} onValueChange={setNewId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Versiunea nouă" /></SelectTrigger>
                <SelectContent>{usable.map((v) => <SelectItem key={v.id} value={v.id}>{v.label} · scor {v.score ?? "—"}</SelectItem>)}</SelectContent>
              </Select>
              <span className="mx-1 h-5 w-px bg-border" />
              <Button size="sm" variant={mode === "overlay" ? "default" : "outline"} onClick={() => setMode("overlay")}>Suprapunere</Button>
              <Button size="sm" variant={mode === "diffonly" ? "default" : "outline"} onClick={() => setMode("diffonly")}>Diff Only</Button>
            </div>

            {summary && vOld?.id !== vNew?.id && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={summary.dScore >= 0 ? "default" : "destructive"} className={summary.dScore >= 0 ? "bg-green-600 text-white hover:bg-green-600" : ""}>
                  ΔScor {summary.dScore >= 0 ? "+" : ""}{summary.dScore.toFixed(0)} pct
                </Badge>
                {summary.resolved.length > 0 && <span className="text-green-600">Rezolvate: {summary.resolved.join(", ")}</span>}
                {summary.introduced.length > 0 && <span className="text-destructive">Noi: {summary.introduced.join(", ")}</span>}
                {summary.resolved.length === 0 && summary.introduced.length === 0 && <span className="text-muted-foreground">Aceleași erori în ambele versiuni.</span>}
              </div>
            )}

            <div className="relative">
              <canvas
                ref={canvasRef}
                className="h-[55vh] w-full cursor-grab rounded-md border border-border"
                onWheel={(e) => setZoom((z) => Math.min(40, Math.max(0.3, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
                onMouseDown={(e) => (drag.current = [e.clientX, e.clientY])}
                onMouseMove={(e) => { if (!drag.current) return; const [x, y] = drag.current; drag.current = [e.clientX, e.clientY]; setPan(([px, py]) => [px + e.clientX - x, py + e.clientY - y]); }}
                onMouseUp={() => (drag.current = null)}
                onMouseLeave={() => (drag.current = null)}
                role="img"
                aria-label="Diff vizual între cele două versiuni"
              />
              {(busy || err) && <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Se încarcă versiunile…</> : err}</div>}
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              {mode === "overlay" ? (
                <>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_OLD }} />{vOld?.label ?? "Vechi"}</span>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_NEW }} />{vNew?.label ?? "Nou"}</span>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_SAME }} />Neschimbat</span>
                </>
              ) : (
                <>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_ADD }} />Adăugat în versiunea nouă</span>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_DEL }} />Șters / mutat</span>
                  <span><span className="mr-1 inline-block h-3 w-3 align-middle" style={{ background: COL_SAME }} />Neschimbat</span>
                </>
              )}
              <span className="text-muted-foreground">Rotița = zoom · trage = deplasare</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
