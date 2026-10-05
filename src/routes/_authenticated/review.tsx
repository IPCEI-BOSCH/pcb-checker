import { fetchSettings } from "@/lib/drc/settings";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Check, Eye, FileSpreadsheet, FolderInput, Play, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, type DrcReport } from "@/lib/drc/engine";
import { exportSituatie, fetchSituatieRows, runBatchDrc } from "@/lib/situatie";
import type { Layer } from "@/lib/gerber/types";
import { DrcReportView } from "@/components/DrcReportView";
import { ZipImportDialog } from "@/components/ZipImportDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/review")({
  head: () => ({
    meta: [
      { title: "Evaluare grupe — PCB Checker UPB" },
      { name: "description", content: "Panoul îndrumătorului: predări, DRC pe lot, aprobare sau respingere pentru fabricație." },
      { property: "og:title", content: "Evaluare grupe — PCB Checker UPB" },
      { property: "og:description", content: "Evaluare pe loturi a proiectelor PCB." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Review,
});

type Sub = { id: string; student_id: string; revision: number; zip_path: string | null; drc_score: number | null; blocking_count: number; review_status: string; review_reason: string | null; report: unknown; created_at: string; variant: "SMT" | "THT" };
const ALL = "__ALL__";

function Review() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const [yearId, setYearId] = useState<string>("");
  const [seriesId, setSeriesId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [studentId, setStudentId] = useState<string>(ALL);
  const [variantFilter, setVariantFilter] = useState<"ALL" | "SMT" | "THT">("ALL");
  const [batch, setBatch] = useState<{ done: number; total: number; label: string } | null>(null);
  const [view, setView] = useState<{ name: string; report: DrcReport; layers: Layer[] | null; meta?: import("@/lib/drc/evaluationSheet").EvaluationMeta } | null>(null);
  const [reject, setReject] = useState<{ sub: Sub; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [delStudent, setDelStudent] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const s = structure.data;
  const visibleGroups = useMemo(() => {
    if (!s) return [];
    if (has("admin")) return s.groups;
    const mySeries = new Set(s.managers.filter((m) => m.user_id === user.id).map((m) => m.series_id));
    const myGroups = new Set(s.instructors.filter((i) => i.user_id === user.id).map((i) => i.group_id));
    return s.groups.filter((g) => mySeries.has(g.series_id) || myGroups.has(g.id));
  }, [s, has, user.id]);
  const visibleSeries = s?.series.filter((x) => visibleGroups.some((g) => g.series_id === x.id) && (!yearId || x.academic_year_id === yearId)) ?? [];
  const groupsInSeries = visibleGroups.filter((g) => seriesId === ALL ? visibleSeries.some((v) => v.id === g.series_id) : g.series_id === seriesId);
  const scopeGroupIds = useMemo(
    () => (groupId === ALL ? groupsInSeries.map((g) => g.id) : groupId ? [groupId] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupId, seriesId, yearId, visibleGroups.length],
  );
  const groupName = new Map((s?.groups ?? []).map((g) => [g.id, g.name]));
  const seriesOfGroup = new Map((s?.groups ?? []).map((g) => [g.id, g.series_id]));

  const data = useQuery({
    queryKey: ["review", scopeGroupIds.join(",")],
    enabled: scopeGroupIds.length > 0,
    queryFn: async () => {
      const st = await supabase.from("students").select("*").in("group_id", scopeGroupIds).order("full_name");
      if (st.error) throw st.error;
      const ids = st.data.map((x) => x.id);
      const subs: (Sub & { kind: string })[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const r = await supabase.from("submissions").select("id, student_id, revision, kind, zip_path, drc_score, blocking_count, review_status, review_reason, report, created_at, variant").in("student_id", ids.slice(i, i + 150)).order("created_at", { ascending: false });
        if (r.error) throw r.error;
        subs.push(...(r.data as (Sub & { kind: string })[]));
      }
      return { students: st.data, subs };
    },
  });

  const allRows = (data.data?.students ?? [])
    .filter((st) => variantFilter === "ALL" || st.variant === variantFilter)
    .filter((st) => showArchived || st.status !== "archived")
    .map((st) => {
      const all = data.data!.subs.filter((x) => x.student_id === st.id);
      return { st, official: all.find((x) => x.kind === "OFFICIAL") ?? null, selfCount: all.filter((x) => x.kind === "SELF_CHECK").length };
    });
  const rows = studentId === ALL ? allRows : allRows.filter((r) => r.st.id === studentId);
  const kpi = {
    total: rows.length,
    smt: rows.filter((r) => r.st.variant === "SMT").length,
    tht: rows.filter((r) => r.st.variant === "THT").length,
    approved: rows.filter((r) => r.official?.review_status === "approved").length,
    rejected: rows.filter((r) => r.official?.review_status === "rejected").length,
  };

  const runBatch = async () => {
    const targets = rows.filter((r) => r.official?.zip_path).map((r) => ({
      submissionId: r.official!.id, zipPath: r.official!.zip_path!, variant: r.st.variant, seriesId: seriesOfGroup.get(r.st.group_id) ?? null, label: r.st.full_name,
    }));
    if (!targets.length) return void toast.info("Nu există predări oficiale în selecție.");
    const errors = await runBatchDrc(targets, (done, total, label) => setBatch({ done, total, label }));
    await logAudit(user.id, "DRC_RUN", "group", groupId === ALL ? null : groupId, { count: targets.length, scope: groupId === ALL ? "all" : "group" });
    setBatch(null);
    qc.invalidateQueries({ queryKey: ["review"] });
    if (errors.length) toast.warning(`${errors.length} proiecte cu erori: ${errors.slice(0, 3).join("; ")}`);
    toast.success(`DRC rulat pe ${targets.length - errors.length} proiecte.`);
  };

  const setStatus = async (sub: Sub, status: "approved" | "rejected", why?: string) => {
    const { error } = await supabase.from("submissions").update({ review_status: status, review_reason: why ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", sub.id);
    if (error) return void toast.error(error.message);
    await logAudit(user.id, "PANEL_APPROVAL", "submission", sub.id, { status, reason: why });
    qc.invalidateQueries({ queryKey: ["review"] });
    toast.success(status === "approved" ? "Aprobat pentru fabricație." : "Proiect respins.");
  };

  const approveAllClean = async () => {
    const list = rows.filter((r) => r.official && r.official.review_status === "pending" && r.official.report && r.official.blocking_count === 0);
    if (!list.length) return void toast.info("Nu există proiecte fără erori blocante în așteptare.");
    for (const r of list) await supabase.from("submissions").update({ review_status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", r.official!.id);
    await logAudit(user.id, "PANEL_APPROVAL", "group", groupId === ALL ? null : groupId, { bulk: list.length });
    qc.invalidateQueries({ queryKey: ["review"] });
    toast.success(`${list.length} proiecte aprobate pentru fabricație.`);
  };

  const approveStudent = async (id: string) => {
    const { error } = await supabase.from("students").update({ status: "approved" }).eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["review"] });
  };

  const archiveStudent = async (id: string, name: string, archived: boolean) => {
    const { error } = await supabase.from("students").update({ status: archived ? "archived" : "approved" }).eq("id", id);
    if (error) return void toast.error(error.message);
    await logAudit(user.id, archived ? "PROJECT_ARCHIVE" : "PROJECT_UNARCHIVE", "student", id, { name });
    qc.invalidateQueries({ queryKey: ["review"] });
    toast.success(archived ? `Proiectul „${name}” a fost arhivat.` : `Proiectul „${name}” a fost dezarhivat.`);
  };

  const deleteStudent = async (id: string, name: string) => {
    setBusy(true);
    try {
      const { data: subs } = await supabase.from("submissions").select("id, zip_path").eq("student_id", id);
      const paths = (subs ?? []).map((x) => x.zip_path).filter((p): p is string => !!p);
      const { data: slots } = await supabase.from("student_fabrication_slots").select("storage_path").eq("student_id", id);
      const slotPaths = (slots ?? []).map((x) => x.storage_path).filter((p): p is string => !!p);
      if (paths.length || slotPaths.length) await supabase.storage.from("gerbers").remove([...paths, ...slotPaths]);
      await supabase.from("submissions").delete().eq("student_id", id);
      await supabase.from("student_fabrication_slots").delete().eq("student_id", id);
      await supabase.from("project_files").delete().eq("student_id", id);
      const { error } = await supabase.from("students").delete().eq("id", id);
      if (error) throw error;
      await logAudit(user.id, "PROJECT_DELETE", "student", id, { name });
      toast.success(`Proiectul „${name}” a fost șters definitiv.`);
      setDelStudent(null);
      qc.invalidateQueries({ queryKey: ["review"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const openReport = async (name: string, sub: Sub, variant: "SMT" | "THT", sid: string | null, st?: { group_id: string; theme_name: string | null; theme_number: number | null; file_prefix: string | null }) => {
    if (!sub.zip_path) return void toast.error("Predarea nu are arhivă Gerber.");
    const t = toast.loading("Se încarcă fișierele Gerber…");
    try {
      const dl = await supabase.storage.from("gerbers").download(sub.zip_path);
      if (dl.error) throw dl.error;
      const layers = await loadGerberZip(dl.data);
      // Always re-evaluate with the current parser/settings so the viewer and the report agree.
      const report = runDrc(layers, variant, await fetchSettings(sid));
      const seriesName = s?.series.find((x) => x.id === sid)?.name;
      setView({ name, report, layers, meta: {
        student: name, group: st ? groupName.get(st.group_id) : undefined, series: seriesName,
        theme: st ? `${st.theme_name ?? ""}${st.theme_number != null ? ` (N${st.theme_number})` : ""}`.trim() || undefined : undefined,
        submittedAt: `${new Date(sub.created_at).toLocaleString("ro-RO")} · v${sub.revision} (${variant})`,
        archive: sub.zip_path.split("/").pop(),
      } });
    } catch (e) { toast.error((e as Error).message); }
    finally { toast.dismiss(t); }
  };

  const exportExcel = async () => {
    try {
      const list = await fetchSituatieRows(scopeGroupIds);
      const filtered = list.filter((r) => rows.some((x) => x.st.full_name === r.fullName));
      const label = groupId === ALL ? (seriesId === ALL ? "toate_seriile" : visibleSeries.find((x) => x.id === seriesId)?.name ?? "serie") : groupName.get(groupId) ?? "grupa";
      exportSituatie(filtered, `P1DCE_SITUATIE_${label.replace(/\s+/g, "_")}.xlsx`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const canManage = has("admin") || has("series_manager");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Evaluare grupe</h1>
          <p className="text-sm text-muted-foreground">An universitar → serie (sau toate) → grupă (sau toate) → student.</p>
        </div>
        {canManage && <Button variant="secondary" onClick={() => setImportOpen(true)}><FolderInput className="mr-2 h-4 w-4" /> Importă proiecte din ZIP</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={yearId || "all"} onValueChange={(v) => { setYearId(v === "all" ? "" : v); setSeriesId(""); setGroupId(""); }}>
          <SelectTrigger aria-label="An universitar"><SelectValue placeholder="An universitar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toți anii</SelectItem>
            {s?.years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setGroupId(v === ALL ? ALL : ""); setStudentId(ALL); }}>
          <SelectTrigger aria-label="Serie"><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toate seriile</SelectItem>
            {visibleSeries.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}{x.is_archived ? " (arhivată)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupId} onValueChange={(v) => { setGroupId(v); setStudentId(ALL); }} disabled={!seriesId}>
          <SelectTrigger aria-label="Grupă"><SelectValue placeholder="Grupă" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toate grupele</SelectItem>
            {groupsInSeries.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={studentId} onValueChange={setStudentId} disabled={!allRows.length}>
          <SelectTrigger aria-label="Student"><SelectValue placeholder="Student" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Toți studenții</SelectItem>
            {allRows.map((r) => <SelectItem key={r.st.id} value={r.st.id}>{r.st.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={variantFilter} onValueChange={(v) => setVariantFilter(v as typeof variantFilter)}>
          <SelectTrigger aria-label="Variantă"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toate variantele</SelectItem>
            <SelectItem value="SMT">a — SMT</SelectItem>
            <SelectItem value="THT">b — THT</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!visibleGroups.length && s && <p className="text-sm text-muted-foreground">Nu ai încă grupe atribuite.</p>}

      {scopeGroupIds.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            {[["Înscriși", kpi.total], ["Varianta a (SMT)", kpi.smt], ["Varianta b (THT)", kpi.tht], ["Aprobate", kpi.approved], ["Respinse", kpi.rejected]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-card p-4">
                <div className="text-xs text-muted-foreground">{k}</div>
                <div className="mt-1 font-mono text-xl font-semibold text-card-foreground">{v}</div>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Studenți ({rows.length})</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={runBatch} disabled={!!batch}><Play className="mr-2 h-4 w-4" /> Rulează DRC pe toată selecția</Button>
                  <Button size="sm" variant="secondary" onClick={approveAllClean} disabled={!!batch}><Check className="mr-2 h-4 w-4" /> Aprobă toate fără erori blocante</Button>
                  <Button size="sm" variant="secondary" onClick={exportExcel}><FileSpreadsheet className="mr-2 h-4 w-4" /> Exportă situația Excel</Button>
                  <Button size="sm" variant={showArchived ? "default" : "outline"} aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}><Archive className="mr-2 h-4 w-4" /> {showArchived ? "Ascunde arhivate" : "Arată arhivate"}</Button>
                </div>
              </div>
              {batch && (
                <div className="space-y-1">
                  <Progress value={(batch.done / Math.max(1, batch.total)) * 100} />
                  <p className="text-xs text-muted-foreground">DRC {batch.done}/{batch.total}{batch.label ? ` · ${batch.label}` : ""}</p>
                </div>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Grupa</TableHead>
                    <TableHead>Variantă</TableHead>
                    <TableHead>Temă</TableHead>
                    <TableHead>Self-check</TableHead>
                    <TableHead>Predat</TableHead>
                    <TableHead>Scor DRC</TableHead>
                    <TableHead>Deficiențe cheie</TableHead>
                    <TableHead>Intră în FAB?</TableHead>
                    <TableHead className="text-right">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ st, official, selfCount }) => {
                    const rep = official?.report as DrcReport | undefined;
                    const key = rep?.rules?.filter((r) => !r.passed && r.severity === "blocking").map((r) => r.title).slice(0, 2).join(", ");
                    const sid = seriesOfGroup.get(st.group_id) ?? null;
                    const status = official?.review_status;
                    // Suggested decision for pending projects: clean → approve, blocking errors → reject.
                    const suggest = status === "pending" && official?.report ? (official.blocking_count === 0 ? "approve" : "reject") : null;
                    return (
                      <TableRow key={st.id} className={cn(status === "approved" && "bg-success/5", status === "rejected" && "bg-destructive/5")}>
                        <TableCell>
                          {official?.zip_path
                            ? <button type="button" className="text-left font-medium text-foreground underline-offset-2 hover:underline" onClick={() => openReport(st.full_name, official, st.variant, sid, st)}>{st.full_name}</button>
                            : <div className="font-medium text-foreground">{st.full_name}</div>}
                          <div className="font-mono text-[11px] text-muted-foreground">{st.file_prefix ?? st.email}</div>
                          {st.status === "pending" && (
                            <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => approveStudent(st.id)}>Validează înscrierea</Button>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{groupName.get(st.group_id)}</TableCell>
                        <TableCell>{st.variant}</TableCell>
                        <TableCell className="text-sm">{st.theme_name ?? "—"}{st.theme_number != null ? ` · N${st.theme_number}` : ""}</TableCell>
                        <TableCell className="font-mono text-sm">{selfCount}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{official ? <>{new Date(official.created_at).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" })}<div className="text-muted-foreground">v{official.revision}</div></> : "—"}</TableCell>
                        <TableCell className="font-mono">{official?.drc_score != null ? `${Number(official.drc_score)}` : "—"}</TableCell>
                        <TableCell className="max-w-[220px] text-xs text-muted-foreground">{official ? key || (official.report ? "—" : "DRC nerulat") : "Fără predare"}</TableCell>
                        <TableCell>
                          {official && (
                            <Badge variant={status === "approved" ? "default" : status === "rejected" ? "destructive" : "secondary"} className={cn(status === "approved" && "bg-success text-success-foreground")}>
                              {status === "approved" ? "DA" : status === "rejected" ? "NU" : "În evaluare"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {official && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="secondary" onClick={() => openReport(st.full_name, official, st.variant, sid, st)}><Eye className="mr-1 h-4 w-4" /> Vizualizează Gerber</Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label="Aprobă pentru fabricație"
                                aria-pressed={status === "approved"}
                                className={cn(status === "approved" && "border-success bg-success text-success-foreground hover:bg-success/90", suggest === "approve" && "border-success text-success")}
                                onClick={() => setStatus(official, "approved")}
                              ><Check className="mr-1 h-4 w-4" />{status === "approved" ? "Aprobat" : "Aprobă"}</Button>
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label="Respinge proiectul"
                                aria-pressed={status === "rejected"}
                                className={cn(status === "rejected" && "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90", suggest === "reject" && "border-destructive text-destructive")}
                                onClick={() => { setReason(official.review_reason ?? (rep ? `Erori blocante: ${key || official.blocking_count}` : "")); setReject({ sub: official, name: st.full_name }); }}
                              ><X className="mr-1 h-4 w-4" />{status === "rejected" ? "Respins" : "Respinge"}</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length && (
                    <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground">{data.isLoading ? "Se încarcă…" : "Niciun student în selecție."}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Respinge proiectul — {reject?.name}</DialogTitle></DialogHeader>
          <Textarea placeholder="Motivul respingerii (vizibil studentului)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="destructive" disabled={!reason.trim()} onClick={async () => { await setStatus(reject!.sub, "rejected", reason.trim()); setReject(null); }}>Respinge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader><DialogTitle>Gerber & DRC — {view?.name}</DialogTitle></DialogHeader>
          {view && <DrcReportView report={view.report} layers={view.layers} meta={view.meta ?? { student: view.name }} />}
        </DialogContent>
      </Dialog>

      <ZipImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => { qc.invalidateQueries({ queryKey: ["review"] }); qc.invalidateQueries({ queryKey: ["structure"] }); }} />
    </div>
  );
}
