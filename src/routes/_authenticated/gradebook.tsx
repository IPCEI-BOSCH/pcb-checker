import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createSpreadsheet } from "@/lib/sheets.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Calculator, CloudDownload, CloudUpload, Download, Link2, Lock, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit, seriesLabel } from "@/lib/data";
import {
  ALL_COLUMNS,
  AUTO_COLUMNS,
  LINK_COLUMNS,
  linkCells,
  MANUAL_COLUMNS,
  applyManualChanges,
  autoCells,
  diffManualColumns,
  exportWorkbook,
  exportYearWorkbook,
  extractSpreadsheetId,
  fetchGradeRows,
  readSpreadsheetFile,
  proposeFinalGrades,
  DEFAULT_WEIGHTS,
  type FinalWeights,
  rowToArray,
  type ManualChange,
} from "@/lib/gradebook";
import { GoogleWorkspaceCard } from "@/components/GoogleWorkspaceCard";
import { pullGradebook, pushGradebook } from "@/lib/sheets.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/gradebook")({
  head: () => ({
    meta: [
      { title: "Catalog & Sincronizare — PCB Checker UPB" },
      { name: "description", content: "Catalogul CEF2-Proiect_Situatie: export Excel, import note și sincronizare Google Sheets cu protecția coloanelor manuale." },
      { property: "og:title", content: "Catalog & Sincronizare — PCB Checker UPB" },
      { property: "og:description", content: "Sincronizare bidirecțională a situației proiectelor PCB." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Gradebook,
});

function Gradebook() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [seriesId, setSeriesId] = useState<string>("");
  const [yearId, setYearId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [changes, setChanges] = useState<ManualChange[] | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("CEF2-Proiect_Situatie");

  const push = useServerFn(pushGradebook);
  const pull = useServerFn(pullGradebook);
  const createSheet = useServerFn(createSpreadsheet);
  const [manualLink, setManualLink] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weights, setWeights] = useState<FinalWeights>(DEFAULT_WEIGHTS);
  const runFinal = () => {
    const diff = proposeFinalGrades(data, weights);
    setWeightsOpen(false);
    setSourceLabel(`calculul notei finale (DRC ${weights.drc}% · schemă ${weights.schema}% · documentație ${weights.doc}%)`);
    setChanges(diff);
    if (!diff.length) toast.info("Nicio notă de calculat — lipsesc componente sau notele există deja.");
  };

  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const rows = useQuery({ queryKey: ["gradebook", seriesId], queryFn: () => fetchGradeRows(seriesId || null) });
  const years = structure.data?.years;
  const activeYearId = yearId || years?.find((y) => y.is_active)?.id || years?.[0]?.id || "";
  const yearName = years?.find((y) => y.id === activeYearId)?.name ?? "";
  const yearSeries = useMemo(() => (structure.data?.series ?? []).filter((s) => s.academic_year_id === activeYearId), [structure.data, activeYearId]);
  const links = useQuery({
    queryKey: ["sheet-links"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sheet_links").select("*");
      if (error) throw error;
      return data;
    },
  });

  const link = useMemo(() => links.data?.find((l) => l.series_id === seriesId) ?? null, [links.data, seriesId]);
  const canManage = has("admin", "series_manager");
  const data = useMemo(() => {
    const ids = new Set(yearSeries.map((s) => s.id));
    return (rows.data ?? []).filter((r) => ids.has(r.seriesId));
  }, [rows.data, yearSeries]);

  const saveLink = async () => {
    if (!seriesId) return void toast.error("Alege mai întâi seria.");
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!spreadsheetId) return void toast.error("Introdu linkul foii de calcul.");
    const { error } = await supabase
      .from("sheet_links")
      .upsert({ series_id: seriesId, spreadsheet_id: spreadsheetId, sheet_name: sheetName, updated_by: user.id }, { onConflict: "series_id" });
    if (error) return void toast.error(error.message);
    setSheetUrl("");
    toast.success("Foaia de calcul a fost asociată seriei.");
    qc.invalidateQueries({ queryKey: ["sheet-links"] });
  };

  const createAndLink = async () => {
    if (!seriesId) return void toast.error("Alege mai întâi seria.");
    setBusy("Se creează foaia Google Sheets…");
    try {
      const name = structure.data?.series.find((x) => x.id === seriesId)?.name ?? "Serie";
      const r = await createSheet({ data: { title: `P1DCE — Situație Seria ${name} — ${yearName}`, tabs: [sheetName] } });
      const { error } = await supabase.from("sheet_links").upsert({ series_id: seriesId, spreadsheet_id: r.spreadsheetId, sheet_name: sheetName, updated_by: user.id }, { onConflict: "series_id" });
      if (error) throw error;
      await push({ data: { spreadsheetId: r.spreadsheetId, sheetName, header: [...AUTO_COLUMNS], manualHeader: [...MANUAL_COLUMNS], values: data.map(autoCells), linkHeader: [...LINK_COLUMNS], links: data.map(linkCells) } });
      toast.success("Foaia a fost creată, asociată seriei și completată.");
      window.open(r.url, "_blank", "noreferrer");
      qc.invalidateQueries({ queryKey: ["sheet-links"] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const doPush = async () => {
    if (!link) return;
    setBusy("Se trimit datele în Google Sheets…");
    try {
      await push({
        data: {
          spreadsheetId: link.spreadsheet_id,
          sheetName: link.sheet_name,
          header: [...AUTO_COLUMNS],
          manualHeader: [...MANUAL_COLUMNS],
          values: data.map(autoCells),
          linkHeader: [...LINK_COLUMNS],
          links: data.map(linkCells),
        },
      });
      await supabase.from("sheet_links").update({ last_synced_at: new Date().toISOString(), last_direction: "push" }).eq("id", link.id);
      await logAudit(user.id, "SHEET_SYNC_PUSH", "series", seriesId, { rows: data.length });
      qc.invalidateQueries({ queryKey: ["sheet-links"] });
      toast.success(`${data.length} rânduri actualizate. Coloanele de notare manuală au rămas neatinse.`);
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const doPull = async () => {
    if (!link) return;
    setBusy("Se citesc notele din Google Sheets…");
    try {
      const res = await pull({ data: { spreadsheetId: link.spreadsheet_id, sheetName: link.sheet_name } });
      const diff = diffManualColumns(res.values as (string | number | null)[][], data);
      setSourceLabel("Google Sheets");
      setChanges(diff);
      if (!diff.length) toast.info("Nicio modificare de preluat.");
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const importFile = async (file: File) => {
    setBusy("Se citește fișierul…");
    try {
      const matrix = await readSpreadsheetFile(file);
      const diff = diffManualColumns(matrix, data);
      setSourceLabel(file.name);
      setChanges(diff);
      if (!diff.length) toast.info("Nicio modificare față de datele curente.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const applyChanges = async () => {
    if (!changes?.length) return setChanges(null);
    setBusy("Se aplică modificările…");
    try {
      const n = await applyManualChanges(changes);
      await logAudit(user.id, "GRADEBOOK_IMPORT", "series", seriesId || null, { students: n, source: sourceLabel });
      toast.success(`Note actualizate pentru ${n} studenți.`);
      setChanges(null);
      qc.invalidateQueries({ queryKey: ["gradebook"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const seriesName = structure.data?.series.find((s) => s.id === seriesId)?.name;
  const fileBase = `CEF2-Proiect_Situatie-${yearName.replace(/[^\w-]+/g, "_")}${seriesName ? `-Seria_${seriesName}` : ""}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Catalog & Sincronizare</h1>
        <p className="text-sm text-muted-foreground">
          Situația proiectelor în formatul CEF2-Proiect_Situatie. Coloanele de notare manuală sunt protejate: platforma nu le suprascrie niciodată.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={activeYearId} onValueChange={(v) => { setYearId(v); setSeriesId(""); }}>
          <SelectTrigger className="w-48" aria-label="An universitar"><SelectValue placeholder="An universitar" /></SelectTrigger>
          <SelectContent>
            {years?.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}{y.is_active ? " (curent)" : ""}{y.is_demo ? " · demo" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={seriesId || "ALL"} onValueChange={(v) => setSeriesId(v === "ALL" ? "" : v)}>
          <SelectTrigger className="w-64" aria-label="Serie"><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toate seriile din {yearName}</SelectItem>
            {yearSeries.map((s) => <SelectItem key={s.id} value={s.id}>{seriesLabel(s, years)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="secondary" onClick={() => exportYearWorkbook(data, yearName, seriesId ? yearSeries.filter((s) => s.id === seriesId) : yearSeries)} disabled={!data.length}>
          <Download className="mr-2 h-4 w-4" /> Export Excel {seriesName ? `Seria ${seriesName}` : "an"} {yearName}
        </Button>
        <Button variant="secondary" onClick={() => exportWorkbook(data, fileBase, "csv")} disabled={!data.length}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!!busy || !data.length}>
          <Upload className="mr-2 h-4 w-4" /> Import note (Excel/CSV)
        </Button>
        {canManage && (
          <Button variant="secondary" onClick={() => setWeightsOpen(true)} disabled={!data.length}>
            <Calculator className="mr-2 h-4 w-4" /> Calculează nota finală
          </Button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
      </div>

      {canManage && <GoogleWorkspaceCard studentIds={data.map((r) => r.studentId)} onFoldersCreated={() => qc.invalidateQueries({ queryKey: ["gradebook"] })} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" /> Google Sheets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!seriesId && <p className="text-sm text-muted-foreground">Alege o serie pentru a asocia o foaie de calcul.</p>}
          {seriesId && link && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary" className="font-mono">{link.sheet_name}</Badge>
              <Button asChild size="sm" variant="outline"><a href={`https://docs.google.com/spreadsheets/d/${link.spreadsheet_id}/edit`} target="_blank" rel="noreferrer">Deschide în Google Sheets</a></Button>
              <span className="text-muted-foreground">
                {link.last_synced_at ? `Ultima sincronizare: ${new Date(link.last_synced_at).toLocaleString("ro-RO")}` : "Încă nesincronizată"}
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={doPush} disabled={!!busy || !canManage}><CloudUpload className="mr-2 h-4 w-4" /> Trimite situația</Button>
                <Button size="sm" variant="secondary" onClick={doPull} disabled={!!busy || !canManage}><CloudDownload className="mr-2 h-4 w-4" /> Preia notele</Button>
              </div>
            </div>
          )}
          {seriesId && canManage && !link && !manualLink && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm">
              <span className="text-muted-foreground">Seria nu are încă o foaie Google Sheets.</span>
              <Button size="sm" onClick={createAndLink} disabled={!!busy}>Creează foaie nouă</Button>
              <Button size="sm" variant="outline" onClick={() => setManualLink(true)}>Am deja o foaie</Button>
            </div>
          )}
          {seriesId && canManage && link && !manualLink && (
            <Button size="sm" variant="ghost" onClick={() => setManualLink(true)}>Schimbă foaia asociată</Button>
          )}
          {seriesId && canManage && manualLink && (
            <div className="flex flex-wrap items-end gap-2">
              <Input className="w-96" placeholder="Link Google Sheets" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
              <Input className="w-64" placeholder="Nume filă" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
              <Button variant="outline" onClick={async () => { await saveLink(); setManualLink(false); }}>{link ? "Actualizează asocierea" : "Asociază"}</Button>
              <Button variant="ghost" onClick={() => setManualLink(false)}>Renunță</Button>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> La trimitere se scriu doar coloanele {AUTO_COLUMNS.length} generate de platformă; {MANUAL_COLUMNS.join(", ")} rămân ale profesorului. Linkurile către folderele Drive și punctele din dosare se scriu după coloanele profesorului.
          </p>
        </CardContent>
      </Card>

      <GradebookKpis k={kpis} alerts={alerts.data ?? null} />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Situație ({data.length} studenți)</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => exportWorkbook(filtered, `${fileBase}-filtrat`, "xlsx")} disabled={!filtered.length}><Download className="mr-1 h-4 w-4" /> Export filtrat</Button>
            <Button size="sm" variant="outline" onClick={() => print(filtered)} disabled={!filtered.length}><Printer className="mr-1 h-4 w-4" /> Borderou A4</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <GradebookFilters f={filters} setF={setFilters} groups={groupNames} shown={filtered.length} total={data.length} />
          <GradebookTable rows={filtered} canEdit={canEdit} selected={selected} setSelected={setSelected} onSave={saveField} onInspect={setInspect} />
          {canEdit && <p className="text-xs text-muted-foreground">Editare directă: Enter salvează și coboară, Tab trece la celula următoare, Esc anulează. Notele acceptă 1–10 cu virgulă sau punct.</p>}
        </CardContent>
      </Card>

      <GradebookBulkBar
        count={selectedRows.length}
        canEdit={canEdit}
        onClear={() => setSelected(new Set())}
        onApply={bulkApply}
        onFinal={() => { setFinalScope(selectedRows); setWeightsOpen(true); }}
        onExport={() => exportWorkbook(selectedRows, `${fileBase}-selectie`, "xlsx")}
        onPrint={() => print(selectedRows)}
      />
      <StudentInspectionDrawer row={inspect} onClose={() => setInspect(null)} />

      <Dialog open={weightsOpen} onOpenChange={setWeightsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Calcul notă finală</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Nota (1–10) = medie ponderată: punctele DRC (0–40 transformate în 1–10), nota schemă și nota documentație. Se calculează doar unde există toate componentele cu pondere. Vei vedea lista înainte de aplicare.</p>
          {([["drc", "Puncte DRC"], ["schema", "Nota schemă"], ["doc", "Nota documentație"]] as const).map(([k, l]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">{l}
              <span className="flex items-center gap-1"><Input type="number" min={0} max={100} className="w-20" value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Math.max(0, +e.target.value || 0) })} /> %</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm"><Switch checked={weights.overwrite} onCheckedChange={(v) => setWeights({ ...weights, overwrite: v })} aria-label="Recalculează și notele existente" /> Recalculează și notele finale deja trecute</label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWeightsOpen(false)}>Renunță</Button>
            <Button onClick={runFinal}>Previzualizează</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!changes} onOpenChange={(o) => !o && setChanges(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Modificări din {sourceLabel}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Se modifică doar coloanele de notare manuală, numai după ce apeși „Aplică”.</p>
          <div className="max-h-80 overflow-y-auto">
            {!changes?.length && <p className="text-sm">Nicio diferență.</p>}
            {changes?.map((c, i) => (
              <div key={i} className="flex items-center justify-between border-b border-border py-1.5 text-sm">
                <span>{c.fullName} · <span className="text-muted-foreground">{c.label}</span></span>
                <span className="font-mono">{c.from} → {c.to}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChanges(null)}>Renunță</Button>
            <Button onClick={applyChanges} disabled={!changes?.length}>Aplică {changes?.length ?? 0} modificări</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function friendly(e: unknown) {
  const msg = (e as Error).message ?? "";
  if (msg.includes("NOT_CONNECTED")) return "Contul Google nu este conectat încă. Cere administratorului conectarea Google Sheets.";
  return msg;
}
