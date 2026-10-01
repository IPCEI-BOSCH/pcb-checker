import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { toast } from "sonner";
import { Cloud, Download, Grid3x3, Layers, Plus, Printer, Trash2, Upload } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { fetchDriveLayout, listDriveLayouts } from "@/lib/drive.functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { fetchSettings } from "@/lib/drc/settings";
import { loadGerberZip } from "@/lib/gerber/load";
import {
  buildPanel, buildStencil, panelLayers, panelSize, positionTable, slotOrigin, stencilLayers, stencilOrigin,
  type PanelBoard, type PanelConfig, type PanelSlot, type PositionRow, type StencilConfig,
} from "@/lib/cam/panelize";
import { GerberViewer } from "@/components/GerberViewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/cam")({
  head: () => ({
    meta: [
      { title: "Generator CAM — PCB Checker UPB" },
      { name: "description", content: "Panelizare PCB și stencil A3 cu inspector Gerber, hărți de poziții și fișiere date_in pentru GerbTool." },
      { property: "og:title", content: "Generator CAM — PCB Checker UPB" },
      { property: "og:description", content: "Panouri și stencile multiple, gata de fabricație." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cam,
});

interface Candidate { submissionId: string; label: string; zipPath: string | null; variant: "SMT" | "THT" }
type Mode = "panel" | "stencil";
type Page = (string | null)[];

function Cam() {
  const { user, has } = useAuth();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("panel");
  const [seriesId, setSeriesId] = useState("");
  const [cfg, setCfg] = useState<PanelConfig>({ cols: 7, rows: 6, pitch: 40.508, board: 40, rail: 8, name: "PANOU-CEF2", coupons: true, fiducials: true });
  const [scfg, setScfg] = useState<StencilConfig>({ name: "STENCIL-CEF2", cols: 7, rows: 6, pitch: 40.508, board: 40, frameW: 420, frameH: 297, margin: 10 });
  const [boards, setBoards] = useState<Record<string, PanelBoard>>({});
  const [pages, setPages] = useState<Record<Mode, Page[]>>({ panel: [[]], stencil: [[]] });
  const [active, setActive] = useState<Record<Mode, number>>({ panel: 0, stencil: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyApproved, setOnlyApproved] = useState(true);
  const driveData = useRef<Record<string, { series: string; group: string; folder: string; files: { name: string; b64: string }[] }>>({});
  const driveReport = useRef("");
  const listLayouts = useServerFn(listDriveLayouts);
  const fetchLayout = useServerFn(fetchDriveLayout);

  const allowed = has("admin", "series_manager", "cam_tech", "instructor");
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const settings = useQuery({ queryKey: ["drc-settings", seriesId || null], queryFn: () => fetchSettings(seriesId || null) });

  useEffect(() => {
    const c = settings.data?.cam;
    if (!c) return;
    setCfg((p) => ({ ...p, cols: c.panelCols, rows: c.panelRows, pitch: c.panelPitch, board: c.board, rail: c.rail, coupons: c.coupons, fiducials: c.fiducials }));
    setScfg((p) => ({ ...p, cols: c.stencilCols, rows: c.stencilRows, pitch: c.stencilPitch, board: c.board, frameW: c.stencilFrameW, frameH: c.stencilFrameH, margin: c.stencilMargin }));
  }, [settings.data]);

  const approved = useQuery({
    queryKey: ["cam-approved", seriesId, structure.data?.groups.length, onlyApproved],
    enabled: allowed && !!structure.data,
    queryFn: async (): Promise<Candidate[]> => {
      const { data: students, error: se } = await supabase.from("students").select("id, full_name, group_id, theme_number, variant");
      if (se) throw se;
      const inSeries = new Set((structure.data?.groups ?? []).filter((g) => !seriesId || g.series_id === seriesId).map((g) => g.id));
      const ids = students.filter((s) => inSeries.has(s.group_id)).map((s) => s.id);
      if (!ids.length) return [];
      let q = supabase.from("submissions").select("id, student_id, zip_path, created_at").eq("kind", "OFFICIAL").in("student_id", ids);
      if (onlyApproved) q = q.eq("review_status", "approved");
      const { data: subs, error } = await q.order("created_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      return subs.filter((s) => !seen.has(s.student_id) && seen.add(s.student_id)).map((s) => {
        const st = students.find((x) => x.id === s.student_id)!;
        return { submissionId: s.id, label: `${st.theme_number ?? "—"} · ${st.full_name} (${st.variant})`, zipPath: s.zip_path, variant: st.variant };
      });
    },
  });

  const dims = mode === "panel" ? { cols: cfg.cols, rows: cfg.rows } : { cols: scfg.cols, rows: scfg.rows };
  const cap = dims.cols * dims.rows;
  const modePages = pages[mode];
  const pageIdx = Math.min(active[mode], modePages.length - 1);

  const toSlots = (page: Page, cols: number, rows: number): PanelSlot[] => {
    const out: PanelSlot[] = [];
    for (let i = 0; i < cols * rows; i++) out.push({ col: i % cols, row: Math.floor(i / cols), board: boards[page[i] ?? ""] ?? null });
    return out;
  };
  const slots = useMemo(() => toSlots(modePages[pageIdx] ?? [], dims.cols, dims.rows), [modePages, pageIdx, dims.cols, dims.rows, boards]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewLayers = useMemo(() => (slots.some((s) => s.board) ? (mode === "panel" ? panelLayers(slots, cfg) : stencilLayers(slots, scfg)) : []), [slots, mode, cfg, scfg]);
  const origin = (c: number, r: number) => (mode === "panel" ? slotOrigin(cfg, c, r) : stencilOrigin(scfg).at(c, r));
  const positions = positionTable(slots, dims.cols, origin);

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

  /** Place keys after existing ones; full pages are never overwritten — new pages are created. */
  const appendKeys = (keys: string[], m: Mode = mode) => {
    const c = m === "panel" ? cfg.cols * cfg.rows : scfg.cols * scfg.rows;
    setPages((prev) => {
      const list = prev[m].map((p) => [...p]);
      for (const k of keys) {
        let target = list.find((p) => { const idx = Array.from({ length: c }, (_, i) => i).find((i) => !p[i]); return idx !== undefined; });
        if (!target) { target = []; list.push(target); }
        const free = Array.from({ length: c }, (_, i) => i).find((i) => !target![i])!;
        target[free] = k;
      }
      return { ...prev, [m]: list };
    });
  };

  const autoFill = async () => {
    const placed = new Set(modePages.flat().filter(Boolean));
    const list = (approved.data ?? []).filter((c) => (mode === "stencil" ? c.variant === "SMT" : true) && !placed.has(c.submissionId));
    if (!list.length) return void toast.info("Nu există proiecte aprobate noi pentru această serie.");
    const keys: string[] = [];
    try {
      for (const cand of list) { setBusy(`Se încarcă ${cand.label}…`); keys.push(await loadCandidate(cand)); }
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
    appendKeys(keys);
    const before = modePages.filter((p) => p.some(Boolean)).length;
    toast.success(`${keys.length} proiecte plasate. ${Math.ceil((placed.size + keys.length) / cap) > before ? "S-au creat pagini noi pentru proiectele care nu au încăput." : ""}`);
  };

  const uploadBoards = async (files: FileList) => {
    const keys: string[] = [];
    for (const file of Array.from(files)) {
      setBusy(`Se citește ${file.name}…`);
      try {
        const layers = await loadGerberZip(file);
        if (!layers.length) throw new Error(`${file.name}: nu conține fișiere Gerber.`);
        const key = `local-${file.name}-${Date.now()}-${Math.random()}`;
        setBoards((b) => ({ ...b, [key]: { label: file.name.replace(/\.zip$/i, ""), layers } }));
        keys.push(key);
      } catch (e) { toast.error((e as Error).message); }
    }
    setBusy(null);
    appendKeys(keys);
  };

  /** Pulls Layout/ folders straight from each student's Google Drive folder for the selected series (or all). */
  const pullDrive = async () => {
    const groupIds = (structure.data?.groups ?? []).filter((g) => !g.is_archived && (!seriesId || g.series_id === seriesId)).map((g) => g.id);
    if (!groupIds.length) return void toast.info("Nu există grupe în selecție.");
    setBusy("Se citesc folderele din Google Drive…");
    try {
      const list = await listLayouts({ data: { groupIds } });
      const placed = new Set(modePages.flat().filter(Boolean));
      const report: string[] = [`Preluare Drive ${new Date().toLocaleString("ro-RO")} — ${mode === "panel" ? "PANOU" : "STENCIL"}`, ""];
      const keys: string[] = [];
      for (const s of list) {
        const key = `drive:${s.studentId}`;
        const why = !s.folderName ? "fără folder în Drive"
          : s.missing.length ? `lipsesc: ${s.missing.join(", ")}`
          : onlyApproved && s.review !== "approved" ? `neaprobat (${s.review ?? "nepredat"})`
          : mode === "stencil" && s.variant !== "SMT" ? "THT — nu intră pe stencil"
          : placed.has(key) ? "deja plasat" : null;
        if (why) { report.push(`EXCLUS  ${s.group}  ${s.name}: ${why}`); continue; }
        setBusy(`Se descarcă ${s.folderName}…`);
        const { files } = await fetchLayout({ data: { studentId: s.studentId } });
        const zip = new JSZip();
        files.forEach((f) => zip.file(f.name, f.b64, { base64: true }));
        const layers = await loadGerberZip(await zip.generateAsync({ type: "blob" }));
        const g = structure.data?.groups.find((x) => x.name === s.group);
        const ser = structure.data?.series.find((x) => x.id === g?.series_id)?.name ?? "Serie";
        driveData.current[key] = { series: ser.replace(/\s+/g, "_"), group: s.group, folder: s.folderName!, files };
        setBoards((b) => ({ ...b, [key]: { label: s.folderName!, layers } }));
        keys.push(key);
        report.push(`INCLUS  ${s.group}  ${s.folderName}`);
      }
      driveReport.current = report.join("\r\n");
      appendKeys(keys);
      toast.success(`${keys.length} proiecte preluate din Drive, ${list.length - keys.length} excluse (vezi raportul din arhivă).`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const removeAt = (i: number) => setPages((p) => ({ ...p, [mode]: p[mode].map((pg, j) => (j === pageIdx ? pg.map((k, x) => (x === i ? null : k)) : pg)) }));

  const pageName = (m: Mode, i: number) => `${m === "panel" ? cfg.name : scfg.name}-${i + 1}`;

  const generateAll = async () => {
    const list = modePages.map((p, i) => ({ i, slots: toSlots(p, dims.cols, dims.rows) })).filter((x) => x.slots.some((s) => s.board));
    if (!list.length) return void toast.error("Nu există plăcuțe plasate.");
    const master = new JSZip();
    try {
      for (const { i, slots: ss } of list) {
        const name = pageName(mode, i);
        setBusy(`Se generează ${name}…`);
        const res = mode === "panel" ? await buildPanel(ss, { ...cfg, name }) : await buildStencil(ss, { ...scfg, name });
        master.file(`${name}.zip`, res.blob);
        const path = `${user.id}/cam/${Date.now()}-${name}.zip`;
        const up = await supabase.storage.from("gerbers").upload(path, res.blob, { contentType: "application/zip" });
        await supabase.from("cam_panels").insert({
          series_id: seriesId || (structure.data?.series[0]?.id ?? ""),
          name, cols: dims.cols, rows: dims.rows, pitch_mm: mode === "panel" ? cfg.pitch : scfg.pitch,
          slots: { type: mode, positions: positionTable(ss, dims.cols, origin) } as never,
          zip_path: up.error ? null : path, created_by: user.id,
        });
        res.warnings.forEach((w) => toast.warning(w));
      }
      // Original student folders, CETTI structure: PROIECTE/<Serie>/<Grupa>/<Folder>/Layout/*
      const placedKeys = new Set(list.flatMap((x) => modePages[x.i]).filter(Boolean) as string[]);
      const folders: string[] = [];
      for (const k of placedKeys) {
        const d = driveData.current[k];
        if (!d) continue;
        const base = `PROIECTE/${d.series}/${d.group}/${d.folder}/Layout`;
        folders.push(`${d.series}/${d.group}/${d.folder}`);
        for (const f of d.files) master.file(`${base}/${f.name}`, f.b64, { base64: true });
      }
      if (folders.length) master.file("PROIECTE/lista_foldere.txt", folders.sort().join("\r\n"));
      if (driveReport.current) master.file("RAPORT_PRELUARE_DRIVE.txt", driveReport.current);
      const blob = await master.generateAsync({ type: "blob" });
      download(blob, `${mode === "panel" ? "PANOURI" : "STENCILE"}-${new Date().toISOString().slice(0, 10)}.zip`);
      await logAudit(user.id, mode === "panel" ? "CAM_PANEL" : "CAM_STENCIL", "series", seriesId || null, { pages: list.length });
      toast.success(`${list.length} ${mode === "panel" ? "panouri" : "stencile"} generate.`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const printPositions = () => {
    const blocks = modePages.map((p, i) => ({ name: pageName(mode, i), rows: positionTable(toSlots(p, dims.cols, dims.rows), dims.cols, origin) })).filter((b) => b.rows.length);
    const w = window.open("", "_blank");
    if (!w) return void toast.error("Permiteți ferestrele pop-up pentru tipărire.");
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    w.document.write(`<html><head><title>Poziții ${mode}</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}h2{margin:16px 0 6px}.g{display:grid;grid-template-columns:repeat(${dims.cols},1fr);gap:2px;margin-bottom:10px}.g div{border:1px solid #999;min-height:34px;font-size:9px;padding:2px}</style></head><body>` +
      blocks.map((b) => {
        const byIdx = new Map(b.rows.map((r) => [r.index, r]));
        const grid = Array.from({ length: dims.rows }, (_, rr) => dims.rows - 1 - rr).flatMap((r) => Array.from({ length: dims.cols }, (_, c) => { const x = byIdx.get(r * dims.cols + c + 1); return `<div><b>${r * dims.cols + c + 1}</b> ${x ? esc(x.label) : ""}</div>`; })).join("");
        return `<h2>${esc(b.name)} — ${b.rows.length}/${cap}</h2><div class="g">${grid}</div><table><tr><th>Poz</th><th>Col</th><th>Rând</th><th>X (mm)</th><th>Y (mm)</th><th>Proiect</th></tr>${b.rows.map((r) => `<tr><td>${r.index}</td><td>${r.col}</td><td>${r.row}</td><td>${r.x.toFixed(3)}</td><td>${r.y.toFixed(3)}</td><td>${esc(r.label)}</td></tr>`).join("")}</table>`;
      }).join("") + "</body></html>");
    w.document.close();
    w.print();
  };

  const size = mode === "panel" ? panelSize(cfg) : { width: scfg.frameW, height: scfg.frameH };
  const filled = slots.filter((s) => s.board).length;
  const total = modePages.flat().filter(Boolean).length;
  const fitsStencil = stencilOrigin(scfg).fits;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Generator CAM</h1>
          <p className="text-sm text-muted-foreground">Panou PCB și stencil A3. Când o pagină se umple se creează automat alta — nimic nu se suprascrie. Parametrii implicți vin din „Reguli & Setări”.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={printPositions} disabled={!total}><Printer className="mr-2 h-4 w-4" /> Tipărește pozițiile</Button>
          <Button onClick={generateAll} disabled={!!busy || !total}><Download className="mr-2 h-4 w-4" /> Generează toate ({modePages.filter((p) => p.some(Boolean)).length})</Button>
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList><TabsTrigger value="panel">Panou PCB</TabsTrigger><TabsTrigger value="stencil">Stencil A3</TabsTrigger></TabsList>
        <TabsContent value="panel">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Grid3x3 className="h-4 w-4" /> Configurație panou</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nume"><Input value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
              <Field label="Coloane"><Input type="number" min={1} value={cfg.cols} onChange={(e) => setCfg({ ...cfg, cols: Math.max(1, +e.target.value) })} /></Field>
              <Field label="Rânduri"><Input type="number" min={1} value={cfg.rows} onChange={(e) => setCfg({ ...cfg, rows: Math.max(1, +e.target.value) })} /></Field>
              <Field label="Pas (mm)"><Input type="number" step="0.001" value={cfg.pitch} onChange={(e) => setCfg({ ...cfg, pitch: +e.target.value })} /></Field>
              <Field label="Ramă (mm)"><Input type="number" step="0.5" value={cfg.rail} onChange={(e) => setCfg({ ...cfg, rail: +e.target.value })} /></Field>
              <div className="flex items-center gap-2 pt-6"><Switch checked={cfg.fiducials} aria-label="Fiduciali pe panou" onCheckedChange={(v) => setCfg({ ...cfg, fiducials: v })} /><span className="text-sm">Fiduciali</span></div>
              <div className="flex items-center gap-2 pt-6"><Switch checked={cfg.coupons} aria-label="Cupoane de test pe panou" onCheckedChange={(v) => setCfg({ ...cfg, coupons: v })} /><span className="text-sm">Cupoane test</span></div>
              <div className="pt-6 text-sm text-muted-foreground">Panou: <span className="font-mono text-foreground">{size.width.toFixed(2)} × {size.height.toFixed(2)} mm</span></div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="stencil">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Grid3x3 className="h-4 w-4" /> Configurație stencil</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Nume"><Input value={scfg.name} onChange={(e) => setScfg({ ...scfg, name: e.target.value })} /></Field>
              <Field label="Coloane"><Input type="number" min={1} value={scfg.cols} onChange={(e) => setScfg({ ...scfg, cols: Math.max(1, +e.target.value) })} /></Field>
              <Field label="Rânduri"><Input type="number" min={1} value={scfg.rows} onChange={(e) => setScfg({ ...scfg, rows: Math.max(1, +e.target.value) })} /></Field>
              <Field label="Pas (mm)"><Input type="number" step="0.001" value={scfg.pitch} onChange={(e) => setScfg({ ...scfg, pitch: +e.target.value })} /></Field>
              <Field label="Folie lățime (mm)"><Input type="number" value={scfg.frameW} onChange={(e) => setScfg({ ...scfg, frameW: +e.target.value })} /></Field>
              <Field label="Folie înălțime (mm)"><Input type="number" value={scfg.frameH} onChange={(e) => setScfg({ ...scfg, frameH: +e.target.value })} /></Field>
              <Field label="Margine (mm)"><Input type="number" value={scfg.margin} onChange={(e) => setScfg({ ...scfg, margin: +e.target.value })} /></Field>
              <div className="pt-6 text-sm">{fitsStencil ? <Badge variant="secondary">Matricea încape pe folie</Badge> : <Badge variant="destructive">Matricea depășește folia</Badge>}</div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={seriesId || "ALL"} onValueChange={(v) => setSeriesId(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toate seriile</SelectItem>
            {structure.data?.series.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={pullDrive} disabled={!!busy}><Cloud className="mr-2 h-4 w-4" /> Preia din Google Drive</Button>
        <div className="flex items-center gap-2"><Switch checked={onlyApproved} aria-label="Include doar proiectele aprobate" onCheckedChange={setOnlyApproved} /><span className="text-sm">Doar aprobate</span></div>
        <Button variant="secondary" onClick={autoFill} disabled={!!busy}><Layers className="mr-2 h-4 w-4" /> {onlyApproved ? "Adaugă proiectele aprobate" : "Adaugă toate predările"} ({(approved.data ?? []).filter((c) => mode === "panel" || c.variant === "SMT").length})</Button>
        <Button variant="secondary" onClick={() => uploadRef.current?.click()} disabled={!!busy}><Upload className="mr-2 h-4 w-4" /> Arhive manuale</Button>
        <input ref={uploadRef} type="file" accept=".zip" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) uploadBoards(e.target.files); e.target.value = ""; }} />
        {total > 0 && <Button variant="ghost" onClick={() => { setPages((p) => ({ ...p, [mode]: [[]] })); setActive((a) => ({ ...a, [mode]: 0 })); }}><Trash2 className="mr-2 h-4 w-4" /> Golește</Button>}
        {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {modePages.map((p, i) => (
          <Button key={i} size="sm" variant={i === pageIdx ? "default" : "outline"} onClick={() => setActive((a) => ({ ...a, [mode]: i }))}>
            {pageName(mode, i)} <span className="ml-1 opacity-70">({p.filter(Boolean).length}/{cap})</span>
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => { setPages((p) => ({ ...p, [mode]: [...p[mode], []] })); setActive((a) => ({ ...a, [mode]: modePages.length })); }}><Plus className="mr-1 h-4 w-4" /> Pagină nouă</Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Hartă {pageName(mode, pageIdx)} — {filled} / {cap}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${dims.cols}, minmax(0, 1fr))` }}>
              {[...slots].sort((a, b) => b.row - a.row || a.col - b.col).map((s) => {
                const i = s.row * dims.cols + s.col;
                return (
                  <div key={i} className={`flex aspect-square flex-col items-center justify-center rounded border p-0.5 text-center text-[9px] leading-tight ${s.board ? "border-primary/60 bg-accent" : "border-dashed border-border text-muted-foreground"}`}>
                    <span className="font-mono opacity-60">#{i + 1}</span>
                    {s.board ? <><span className="line-clamp-2 break-all">{s.board.label}</span><button className="text-destructive" onClick={() => removeAt(i)}>elimină</button></> : <span>liber</span>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Inspector Gerber — {mode === "panel" ? "panou" : "stencil"}</CardTitle></CardHeader>
          <CardContent>
            {viewLayers.length ? <div className="h-[520px]"><GerberViewer layers={viewLayers} issues={[]} /></div> : <p className="text-sm text-muted-foreground">Adăugați plăcuțe pentru a vedea previzualizarea.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Poziții proiecte — {pageName(mode, pageIdx)}</CardTitle></CardHeader>
        <CardContent><PositionsTable rows={positions} /></CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>;
}

function PositionsTable({ rows }: { rows: PositionRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nicio poziție ocupată.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Poz.</th><th>Col</th><th>Rând</th><th>X (mm)</th><th>Y (mm)</th><th>Proiect</th></tr></thead>
        <tbody className="font-mono text-xs">
          {rows.map((r) => <tr key={r.index} className="border-t border-border"><td className="py-1">{r.index}</td><td>{r.col}</td><td>{r.row}</td><td>{r.x.toFixed(3)}</td><td>{r.y.toFixed(3)}</td><td className="font-sans">{r.label}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
