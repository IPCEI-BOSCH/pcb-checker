import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Play, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, type DrcReport } from "@/lib/drc/engine";
import type { Layer } from "@/lib/gerber/types";
import { DrcReportView } from "@/components/DrcReportView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

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

function Review() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const [yearId, setYearId] = useState<string>("");
  const [seriesId, setSeriesId] = useState<string>("");
  const [groupId, setGroupId] = useState<string>("");
  const [variantFilter, setVariantFilter] = useState<"ALL" | "SMT" | "THT">("ALL");
  const [batch, setBatch] = useState<string | null>(null);
  const [view, setView] = useState<{ name: string; report: DrcReport; layers: Layer[] | null } | null>(null);
  const [reject, setReject] = useState<{ sub: Sub; name: string } | null>(null);
  const [reason, setReason] = useState("");

  const s = structure.data;
  const visibleGroups = useMemo(() => {
    if (!s) return [];
    if (has("admin")) return s.groups;
    const mySeries = new Set(s.managers.filter((m) => m.user_id === user.id).map((m) => m.series_id));
    const myGroups = new Set(s.instructors.filter((i) => i.user_id === user.id).map((i) => i.group_id));
    return s.groups.filter((g) => mySeries.has(g.series_id) || myGroups.has(g.id));
  }, [s, has, user.id]);
  const visibleSeries = s?.series.filter((x) => visibleGroups.some((g) => g.series_id === x.id) && (!yearId || x.academic_year_id === yearId)) ?? [];
  const groupsInSeries = visibleGroups.filter((g) => g.series_id === seriesId);

  const data = useQuery({
    queryKey: ["review", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const st = await supabase.from("students").select("*").eq("group_id", groupId).order("full_name");
      if (st.error) throw st.error;
      const ids = st.data.map((x) => x.id);
      const subs = ids.length
        ? await supabase.from("submissions").select("id, student_id, revision, kind, zip_path, drc_score, blocking_count, review_status, review_reason, report, created_at, variant").in("student_id", ids).order("created_at", { ascending: false })
        : { data: [], error: null };
      if (subs.error) throw subs.error;
      return { students: st.data, subs: subs.data as (Sub & { kind: string })[] };
    },
  });

  const rows = (data.data?.students ?? [])
    .filter((st) => variantFilter === "ALL" || st.variant === variantFilter)
    .map((st) => {
      const all = data.data!.subs.filter((x) => x.student_id === st.id);
      return { st, official: all.find((x) => x.kind === "OFFICIAL") ?? null, selfCount: all.filter((x) => x.kind === "SELF_CHECK").length };
    });
  const kpi = {
    total: rows.length,
    smt: rows.filter((r) => r.st.variant === "SMT").length,
    tht: rows.filter((r) => r.st.variant === "THT").length,
    approved: rows.filter((r) => r.official?.review_status === "approved").length,
    rejected: rows.filter((r) => r.official?.review_status === "rejected").length,
  };

  const runBatch = async () => {
    const targets = rows.filter((r) => r.official?.zip_path);
    if (!targets.length) return void toast.info("Nu există predări oficiale în această grupă.");
    let done = 0;
    for (const r of targets) {
      setBatch(`${++done}/${targets.length} · ${r.st.full_name}`);
      try {
        const dl = await supabase.storage.from("gerbers").download(r.official!.zip_path!);
        if (dl.error) throw dl.error;
        const report = runDrc(await loadGerberZip(dl.data), r.st.variant);
        await supabase.from("submissions").update({ report: report as never, drc_score: report.score, blocking_count: report.blockingCount }).eq("id", r.official!.id);
      } catch (e) {
        toast.error(`${r.st.full_name}: ${(e as Error).message}`);
      }
    }
    await logAudit(user.id, "DRC_RUN", "group", groupId, { count: targets.length });
    setBatch(null);
    qc.invalidateQueries({ queryKey: ["review", groupId] });
    toast.success(`DRC rulat pe ${targets.length} proiecte.`);
  };

  const setStatus = async (sub: Sub, status: "approved" | "rejected", why?: string) => {
    const { error } = await supabase.from("submissions").update({ review_status: status, review_reason: why ?? null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq("id", sub.id);
    if (error) return void toast.error(error.message);
    await logAudit(user.id, "PANEL_APPROVAL", "submission", sub.id, { status, reason: why });
    qc.invalidateQueries({ queryKey: ["review", groupId] });
    toast.success(status === "approved" ? "Aprobat pentru fabricație." : "Proiect respins.");
  };

  const approveStudent = async (id: string) => {
    const { error } = await supabase.from("students").update({ status: "approved" }).eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["review", groupId] });
  };

  const openReport = async (name: string, sub: Sub) => {
    let layers: Layer[] | null = null;
    if (sub.zip_path) {
      const dl = await supabase.storage.from("gerbers").download(sub.zip_path);
      if (!dl.error) layers = await loadGerberZip(dl.data);
    }
    setView({ name, report: sub.report as DrcReport, layers });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Evaluare grupe</h1>
        <p className="text-sm text-muted-foreground">An universitar → serie → grupă → variantă.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={yearId || "all"} onValueChange={(v) => { setYearId(v === "all" ? "" : v); setSeriesId(""); setGroupId(""); }}>
          <SelectTrigger><SelectValue placeholder="An universitar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toți anii</SelectItem>
            {s?.years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setGroupId(""); }}>
          <SelectTrigger><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>{visibleSeries.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}{x.is_archived ? " (arhivată)" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={groupId} onValueChange={setGroupId} disabled={!seriesId}>
          <SelectTrigger><SelectValue placeholder="Grupă" /></SelectTrigger>
          <SelectContent>{groupsInSeries.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={variantFilter} onValueChange={(v) => setVariantFilter(v as typeof variantFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Toate variantele</SelectItem>
            <SelectItem value="SMT">a — SMT</SelectItem>
            <SelectItem value="THT">b — THT</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!visibleGroups.length && s && <p className="text-sm text-muted-foreground">Nu ai încă grupe atribuite.</p>}

      {groupId && (
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
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Studenți</CardTitle>
              <Button size="sm" onClick={runBatch} disabled={!!batch}><Play className="mr-2 h-4 w-4" />{batch ?? "Rulează DRC pe lot"}</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Variantă</TableHead>
                    <TableHead>Temă</TableHead>
                    <TableHead>Self-check</TableHead>
                    <TableHead>Scor DRC</TableHead>
                    <TableHead>Deficiențe cheie</TableHead>
                    <TableHead>Fabricație</TableHead>
                    <TableHead className="text-right">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ st, official, selfCount }) => {
                    const rep = official?.report as DrcReport | undefined;
                    const key = rep?.rules.filter((r) => !r.passed && r.severity === "blocking").map((r) => r.title).slice(0, 2).join(", ");
                    return (
                      <TableRow key={st.id}>
                        <TableCell>
                          <div className="font-medium text-foreground">{st.full_name}</div>
                          <div className="text-xs text-muted-foreground">{st.email}</div>
                          {st.status === "pending" && (
                            <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => approveStudent(st.id)}>Validează înscrierea</Button>
                          )}
                        </TableCell>
                        <TableCell>{st.variant}</TableCell>
                        <TableCell className="text-sm">{st.theme_name ?? "—"}{st.theme_number != null ? ` · ${st.theme_number}` : ""}</TableCell>
                        <TableCell className="font-mono text-sm">{selfCount}</TableCell>
                        <TableCell className="font-mono">{official ? `${Number(official.drc_score)}` : "—"}</TableCell>
                        <TableCell className="max-w-[220px] text-xs text-muted-foreground">{official ? key || "—" : "Fără predare"}</TableCell>
                        <TableCell>
                          {official && (
                            <Badge variant={official.review_status === "approved" ? "default" : official.review_status === "rejected" ? "destructive" : "secondary"}>
                              {official.review_status === "approved" ? "DA" : official.review_status === "rejected" ? "NU" : "În evaluare"}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {official && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="secondary" onClick={() => openReport(st.full_name, official)}>Raport</Button>
                              <Button size="icon" variant="secondary" aria-label="Aprobă" onClick={() => setStatus(official, "approved")}><Check className="h-4 w-4" /></Button>
                              <Button size="icon" variant="secondary" aria-label="Respinge" onClick={() => { setReason(""); setReject({ sub: official, name: st.full_name }); }}><X className="h-4 w-4" /></Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length && (
                    <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Niciun student în această grupă.</TableCell></TableRow>
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
          <DialogHeader><DialogTitle>Raport DRC — {view?.name}</DialogTitle></DialogHeader>
          {view && <DrcReportView report={view.report} layers={view.layers} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
