import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Database, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure } from "@/lib/data";
import { deleteDemo, importDemo } from "@/lib/demo";
import { FabricationSlots } from "@/components/FabricationSlots";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "Istoric pe ani — PCB Checker UPB" },
      { name: "description", content: "Situații și proiecte din anii universitari anteriori." },
      { property: "og:title", content: "Istoric pe ani — PCB Checker UPB" },
      { property: "og:description", content: "Arhiva proiectelor PCB pe ani, serii și grupe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: History,
});

function History() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const [yearId, setYearId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const s = structure.data;
  const years = s?.years ?? [];
  const series = s?.series.filter((x) => x.academic_year_id === yearId) ?? [];
  const groups = useMemo(() => s?.groups.filter((g) => g.series_id === seriesId) ?? [], [s, seriesId]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  /** Câți studenți are fiecare serie — folosit la preselecție și la etichetele din listă. */
  const counts = useQuery({
    queryKey: ["history-counts", s?.groups.length],
    enabled: !!s,
    queryFn: async () => {
      const r = await supabase.from("students").select("group_id");
      if (r.error) throw r.error;
      const bySeries = new Map<string, number>();
      const gmap = new Map((s?.groups ?? []).map((g) => [g.id, g.series_id]));
      for (const x of r.data) {
        const sid = gmap.get(x.group_id);
        if (sid) bySeries.set(sid, (bySeries.get(sid) ?? 0) + 1);
      }
      return bySeries;
    },
  });

  useEffect(() => {
    if (!s || !counts.data) return;
    if (!yearId) {
      const best = s.series.filter((x) => (counts.data.get(x.id) ?? 0) > 0).sort((a, b) => (counts.data.get(b.id) ?? 0) - (counts.data.get(a.id) ?? 0))[0]
        ?? s.series.find((x) => s.years.some((y) => y.id === x.academic_year_id));
      if (best) { setYearId(best.academic_year_id); setSeriesId(best.id); }
      return;
    }
    if (!seriesId) {
      const inYear = s.series.filter((x) => x.academic_year_id === yearId);
      const first = inYear.sort((a, b) => (counts.data.get(b.id) ?? 0) - (counts.data.get(a.id) ?? 0))[0];
      if (first) setSeriesId(first.id);
    }
  }, [s, counts.data, yearId, seriesId]);

  const rows = useQuery({
    queryKey: ["history", seriesId],
    enabled: !!seriesId,
    queryFn: async () => {
      const ids = groups.map((g) => g.id);
      if (!ids.length) return [];
      const st = await supabase.from("students").select("*").in("group_id", ids).order("full_name");
      if (st.error) throw st.error;
      const sids = st.data.map((x) => x.id);
      const subs = sids.length ? await supabase.from("submissions").select("student_id, drc_score, blocking_count, review_status, created_at").eq("kind", "OFFICIAL").in("student_id", sids).order("created_at", { ascending: false }) : { data: [] };
      const last = new Map<string, NonNullable<typeof subs.data>[number]>();
      for (const x of subs.data ?? []) if (!last.has(x.student_id)) last.set(x.student_id, x);
      return st.data.map((x) => ({ ...x, sub: last.get(x.id) }));
    },
  });

  const stats = useMemo(() => {
    const d = rows.data ?? [];
    const scored = d.map((r) => r.sub?.drc_score).filter((x): x is number => x !== null && x !== undefined);
    return {
      total: d.length,
      approved: d.filter((r) => r.sub?.review_status === "approved").length,
      blocking: d.filter((r) => (r.sub?.blocking_count ?? 0) > 0).length,
      avg: scored.length ? scored.reduce((a, b) => a + Number(b), 0) / scored.length : null,
    };
  }, [rows.data]);



  const exportCsv = () => {
    const head = ["Grupa", "Folder", "Student", "Tema", "N", "Varianta", "Scor DRC", "Erori blocante", "Intră în FAB?", "Nota schemă", "Nota doc", "Nota finală"];
    const lines = (rows.data ?? []).map((r) => [groupName.get(r.group_id), r.file_prefix, r.full_name, r.theme_name, r.theme_number, r.variant, r.sub?.drc_score, r.sub?.blocking_count, r.sub?.review_status === "approved" ? "DA" : "NU", r.grade_schema, r.grade_doc, r.grade_final].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + [head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    a.download = `Situatie_${years.find((y) => y.id === yearId)?.name}_${series.find((x) => x.id === seriesId)?.name}.csv`;
    a.click();
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); qc.invalidateQueries(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Istoric pe ani universitari</h1>
        <p className="text-sm text-muted-foreground">Alegeți anul și seria pentru a vedea situația, fișierele și rezultatele DRC.</p>
      </div>

      {has("admin") && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Database className="h-4 w-4" /> Date demo — Seria B (46 proiecte reale)</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button disabled={!!busy} onClick={() => { setBusy("…"); run(async () => { const n = await importDemo(user.id, setBusy); toast.message(`${n} proiecte importate`); }, "Seria B demo a fost importată."); }}>Importă Seria B demo</Button>
            <Button variant="destructive" disabled={!!busy} onClick={() => { if (!confirm("Ștergeți toate datele demo?")) return; setBusy("…"); run(() => deleteDemo(user.id, setBusy), "Datele demo au fost șterse."); }}><Trash2 className="mr-2 h-4 w-4" /> Șterge datele demo</Button>
            {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Select value={yearId} onValueChange={(v) => { setYearId(v); setSeriesId(""); }}>
          <SelectTrigger className="w-64"><SelectValue placeholder="An universitar" /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}{y.is_demo ? " · demo" : y.is_active ? " · curent" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={seriesId} onValueChange={setSeriesId} disabled={!yearId}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Serie" /></SelectTrigger>
          <SelectContent>{series.map((x) => <SelectItem key={x.id} value={x.id}>Seria {x.name} · {counts.data?.get(x.id) ?? 0} proiecte</SelectItem>)}</SelectContent>
        </Select>
        {!!rows.data?.length && <Button variant="secondary" onClick={exportCsv}>Exportă situația (CSV)</Button>}
      </div>

      {!!rows.data?.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { k: "Proiecte", v: String(stats.total) },
            { k: "Intră în fabricație", v: String(stats.approved) },
            { k: "Cu erori blocante", v: String(stats.blocking) },
            { k: "Scor DRC mediu", v: stats.avg === null ? "—" : stats.avg.toFixed(1) },
            { k: "Grupe", v: String(groups.length) },
          ].map((c) => (
            <Card key={c.k}><CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{c.k}</div>
              <div className="text-2xl font-semibold text-foreground">{c.v}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {seriesId && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Grupa</TableHead><TableHead>Student / Folder</TableHead><TableHead>Tema · N</TableHead>
                <TableHead>DRC</TableHead><TableHead>FAB</TableHead><TableHead>Notă</TableHead><TableHead />
              </TableRow></TableHeader>
              <TableBody>
                {rows.isLoading && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Se încarcă…</TableCell></TableRow>}
                {rows.data?.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Niciun student în această serie.</TableCell></TableRow>}
                {rows.data?.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow key={r.id}>
                      <TableCell>{groupName.get(r.group_id)}</TableCell>
                      <TableCell><div className="font-medium">{r.full_name}</div><div className="font-mono text-xs text-muted-foreground">{r.file_prefix}</div></TableCell>
                      <TableCell>{r.theme_name ?? "—"} · N{r.theme_number ?? "?"}</TableCell>
                      <TableCell>{r.sub ? <span>{Number(r.sub.drc_score).toFixed(0)} · <span className="text-muted-foreground">{r.sub.blocking_count} blocante</span></span> : "—"}</TableCell>
                      <TableCell><Badge variant={r.sub?.review_status === "approved" ? "default" : "secondary"}>{r.sub?.review_status === "approved" ? "DA" : "NU"}</Badge></TableCell>
                      <TableCell>{r.grade_final ?? "—"}</TableCell>
                      <TableCell><Button size="sm" variant="ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Închide" : "Fișiere"}</Button></TableCell>
                    </TableRow>
                    {open === r.id && (
                      <TableRow key={r.id + "-d"}><TableCell colSpan={7}>
                        <FabricationSlots studentId={r.id} userId={user.id} canUpload={false} seriesId={seriesId} variant={r.variant} />
                      </TableCell></TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
