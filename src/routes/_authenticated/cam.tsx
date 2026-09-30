import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Grid3x3, Layers, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { loadGerberZip } from "@/lib/gerber/load";
import { PANEL_DEFAULT, buildPanel, panelSize, type PanelBoard, type PanelConfig, type PanelResult, type PanelSlot } from "@/lib/cam/panelize";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/cam")({
  head: () => ({
    meta: [
      { title: "Generator CAM — PCB Checker UPB" },
      { name: "description", content: "Panelizare industrială 7×6 la pas de 40,508 mm, fișier de găurire unificat și export Gerber gata de fabricație." },
      { property: "og:title", content: "Generator CAM — PCB Checker UPB" },
      { property: "og:description", content: "Panelizare, stencil și export CAM pentru proiectele aprobate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cam,
});

interface Candidate {
  submissionId: string;
  label: string;
  zipPath: string | null;
  score: number | null;
}

function Cam() {
  const { user, has } = useAuth();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [seriesId, setSeriesId] = useState("");
  const [cfg, setCfg] = useState<PanelConfig>({
    cols: PANEL_DEFAULT.cols,
    rows: PANEL_DEFAULT.rows,
    pitch: PANEL_DEFAULT.pitch,
    board: PANEL_DEFAULT.board,
    rail: PANEL_DEFAULT.rail,
    name: "PANOU-CEF2",
    coupons: true,
    fiducials: true,
  });
  const [boards, setBoards] = useState<Record<string, PanelBoard>>({});
  const [slots, setSlots] = useState<Record<string, string>>({}); // "c,r" -> candidate key
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<PanelResult | null>(null);

  const allowed = has("admin", "series_manager", "cam_tech", "instructor");
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });

  const approved = useQuery({
    queryKey: ["cam-approved", seriesId],
    enabled: allowed,
    queryFn: async (): Promise<Candidate[]> => {
      const { data: students, error: se } = await supabase.from("students").select("id, full_name, group_id, theme_number, variant");
      if (se) throw se;
      const groups = structure.data?.groups ?? [];
      const inSeries = new Set(groups.filter((g) => !seriesId || g.series_id === seriesId).map((g) => g.id));
      const ids = students.filter((s) => inSeries.has(s.group_id)).map((s) => s.id);
      if (!ids.length) return [];
      const { data: subs, error } = await supabase
        .from("submissions")
        .select("id, student_id, zip_path, drc_score, review_status, created_at")
        .eq("kind", "OFFICIAL")
        .eq("review_status", "approved")
        .in("student_id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      return subs
        .filter((s) => !seen.has(s.student_id) && seen.add(s.student_id))
        .map((s) => {
          const st = students.find((x) => x.id === s.student_id)!;
          return {
            submissionId: s.id,
            label: `${st.theme_number ?? "—"} · ${st.full_name} (${st.variant})`,
            zipPath: s.zip_path,
            score: s.drc_score != null ? Number(s.drc_score) : null,
          };
        });
    },
  });

  const grid = useMemo(() => {
    const out: PanelSlot[] = [];
    for (let r = cfg.rows - 1; r >= 0; r--) for (let c = 0; c < cfg.cols; c++) out.push({ col: c, row: r, board: boards[slots[`${c},${r}`] ?? ""] ?? null });
    return out;
  }, [cfg.cols, cfg.rows, slots, boards]);

  if (!allowed) return <p className="text-sm text-muted-foreground">Acces restricționat.</p>;

  const loadCandidate = async (cand: Candidate) => {
    if (boards[cand.submissionId]) return cand.submissionId;
    if (!cand.zipPath) throw new Error(`${cand.label}: arhiva lipsește.`);
    const dl = await supabase.storage.from("gerbers").download(cand.zipPath);
    if (dl.error) throw new Error(`${cand.label}: arhiva nu poate fi descărcată.`);
    const layers = await loadGerberZip(dl.data);
    setBoards((b) => ({ ...b, [cand.submissionId]: { label: cand.label, layers } }));
    return cand.submissionId;
  };

  const autoFill = async () => {
    const list = approved.data ?? [];
    if (!list.length) return void toast.error("Nu există proiecte aprobate pentru fabricație în această serie.");
    setBusy("Se încarcă proiectele aprobate…");
    const next: Record<string, string> = {};
    let i = 0;
    try {
      for (let r = 0; r < cfg.rows && i < list.length; r++) {
        for (let c = 0; c < cfg.cols && i < list.length; c++) {
          const cand = list[i++]!;
          setBusy(`Se încarcă ${cand.label}…`);
          const key = await loadCandidate(cand);
          next[`${c},${r}`] = key;
        }
      }
      setSlots(next);
      toast.success(`${Object.keys(next).length} plăcuțe plasate pe panou.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const uploadBoard = async (file: File) => {
    setBusy("Se citește arhiva…");
    try {
      const layers = await loadGerberZip(file);
      if (!layers.length) throw new Error("Arhiva nu conține fișiere Gerber recunoscute.");
      const key = `local-${file.name}-${Date.now()}`;
      setBoards((b) => ({ ...b, [key]: { label: file.name.replace(/\.zip$/i, ""), layers } }));
      const free = grid.find((s) => !s.board);
      if (free) setSlots((s) => ({ ...s, [`${free.col},${free.row}`]: key }));
      toast.success("Plăcuță adăugată pe panou.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("Se generează panoul…");
    try {
      const res = await buildPanel(grid, cfg);
      setResult(res);
      const fileName = `${cfg.name}-${new Date().toISOString().slice(0, 10)}.zip`;
      const path = `${user.id}/cam/${Date.now()}-${fileName}`;
      const up = await supabase.storage.from("gerbers").upload(path, res.blob, { contentType: "application/zip" });
      const { error } = await supabase.from("cam_panels").insert({
        series_id: seriesId || (structure.data?.series[0]?.id ?? ""),
        name: cfg.name,
        cols: cfg.cols,
        rows: cfg.rows,
        pitch_mm: cfg.pitch,
        slots: grid.filter((s) => s.board).map((s) => ({ col: s.col, row: s.row, label: s.board!.label })) as never,
        zip_path: up.error ? null : path,
        created_by: user.id,
      });
      if (error) toast.warning("Panoul a fost generat, dar nu a putut fi salvat în istoric.");
      else await logAudit(user.id, "CAM_PANEL", "series", seriesId || null, { boards: res.boards, name: cfg.name });
      download(res.blob, fileName);
      toast.success(`Panou ${res.boards} plăcuțe · ${res.width.toFixed(1)} × ${res.height.toFixed(1)} mm.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const size = panelSize(cfg);
  const filled = grid.filter((s) => s.board).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Generator CAM</h1>
          <p className="text-sm text-muted-foreground">Panelizare industrială, cupoane de proces și fișier de găurire unificat, gata de trimis la fabricație.</p>
        </div>
        <Button onClick={generate} disabled={!!busy || !filled}><Download className="mr-2 h-4 w-4" /> Generează și descarcă panoul</Button>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Grid3x3 className="h-4 w-4" /> Configurație panou</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Nume panou</Label><Input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></div>
          <div><Label>Coloane</Label><Input type="number" min={1} max={20} value={cfg.cols} onChange={(e) => setCfg({ ...cfg, cols: Math.max(1, Number(e.target.value)) })} /></div>
          <div><Label>Rânduri</Label><Input type="number" min={1} max={20} value={cfg.rows} onChange={(e) => setCfg({ ...cfg, rows: Math.max(1, Number(e.target.value)) })} /></div>
          <div><Label>Pas (mm)</Label><Input type="number" step="0.001" value={cfg.pitch} onChange={(e) => setCfg({ ...cfg, pitch: Number(e.target.value) })} /></div>
          <div><Label>Ramă tehnologică (mm)</Label><Input type="number" step="0.5" value={cfg.rail} onChange={(e) => setCfg({ ...cfg, rail: Number(e.target.value) })} /></div>
          <div className="flex items-center gap-2 pt-6"><Switch checked={cfg.fiducials} onCheckedChange={(v) => setCfg({ ...cfg, fiducials: v })} /><span className="text-sm">Fiduciali de panou</span></div>
          <div className="flex items-center gap-2 pt-6"><Switch checked={cfg.coupons} onCheckedChange={(v) => setCfg({ ...cfg, coupons: v })} /><span className="text-sm">Cupoane de test</span></div>
          <div className="pt-6 text-sm text-muted-foreground">Panou: <span className="font-mono text-foreground">{size.width.toFixed(2)} × {size.height.toFixed(2)} mm</span></div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={seriesId || "ALL"} onValueChange={(v) => setSeriesId(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toate seriile</SelectItem>
            {structure.data?.series.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="secondary" onClick={autoFill} disabled={!!busy}><Layers className="mr-2 h-4 w-4" /> Completează cu proiectele aprobate ({approved.data?.length ?? 0})</Button>
        <Button variant="secondary" onClick={() => uploadRef.current?.click()} disabled={!!busy}><Upload className="mr-2 h-4 w-4" /> Adaugă arhivă manuală</Button>
        <input ref={uploadRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBoard(f); e.target.value = ""; }} />
        {slots && Object.keys(slots).length > 0 && (
          <Button variant="ghost" onClick={() => { setSlots({}); setResult(null); }}><Trash2 className="mr-2 h-4 w-4" /> Golește panoul</Button>
        )}
        {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Hartă panou — {filled} / {cfg.cols * cfg.rows} poziții ocupate</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cfg.cols}, minmax(0, 1fr))` }}>
            {grid.map((s) => {
              const key = `${s.col},${s.row}`;
              return (
                <div
                  key={key}
                  className={`flex aspect-square flex-col items-center justify-center rounded border p-1 text-center text-[10px] leading-tight ${s.board ? "border-primary/60 bg-accent" : "border-dashed border-border bg-card text-muted-foreground"}`}
                >
                  <span className="font-mono text-[9px] opacity-60">{s.col + 1},{s.row + 1}</span>
                  {s.board ? (
                    <>
                      <span className="line-clamp-2 break-all">{s.board.label}</span>
                      <button className="mt-0.5 text-destructive" onClick={() => setSlots((p) => { const n = { ...p }; delete n[key]; return n; })}>elimină</button>
                    </>
                  ) : (
                    <span>liber</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pachet generat</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{result.boards} plăcuțe</Badge>
              <Badge variant="secondary">{result.holes} găuri unificate</Badge>
              <Badge variant="secondary">{result.width.toFixed(2)} × {result.height.toFixed(2)} mm</Badge>
            </div>
            <ul className="font-mono text-xs text-muted-foreground">
              {result.files.map((f) => <li key={f.name}>{f.name} — {(f.bytes / 1024).toFixed(1)} kB</li>)}
            </ul>
            {result.warnings.length > 0 && (
              <div className="text-xs text-destructive">{result.warnings.map((w, i) => <div key={i}>{w}</div>)}</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
