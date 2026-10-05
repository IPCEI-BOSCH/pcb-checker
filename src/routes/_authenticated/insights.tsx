import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, BarChart3, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchStructure, seriesLabel, sortSeriesByYear } from "@/lib/data";
import { loadGerberZip } from "@/lib/gerber/load";
import { fingerprint, similarity, type Fingerprint } from "@/lib/integrity/fingerprint";
import type { DrcReport } from "@/lib/drc/engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "Statistici & Integritate — PCB Checker UPB" },
      { name: "description", content: "Statistici de serie, erori frecvente și detecția layout-urilor PCB copiate." },
      { property: "og:title", content: "Statistici & Integritate — PCB Checker UPB" },
      { property: "og:description", content: "Erori frecvente pe serie și amprentă geometrică anti-plagiat PCB." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Insights,
});

type Row = { studentId: string; name: string; theme: string; seriesId: string; zipPath: string | null; report: DrcReport | null; score: number | null };

async function fetchRows(seriesIds: string[]): Promise<Row[]> {
  if (!seriesIds.length) return [];
  const g = await supabase.from("groups").select("id, series_id").in("series_id", seriesIds);
  const gmap = new Map((g.data ?? []).map((x) => [x.id, x.series_id]));
  if (!gmap.size) return [];
  const st = await supabase.from("students").select("id, full_name, theme_name, theme_number, group_id").in("group_id", [...gmap.keys()]);
  const ids = (st.data ?? []).map((s) => s.id);
  const subs = ids.length ? await supabase.from("submissions").select("student_id, zip_path, report, drc_score, created_at").eq("kind", "OFFICIAL").in("student_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const latest = new Map<string, { zip_path: string | null; report: unknown; drc_score: number | null }>();
  for (const s of subs.data ?? []) if (!latest.has(s.student_id)) latest.set(s.student_id, s);
  return (st.data ?? []).map((s) => {
    const sub = latest.get(s.id);
    return {
      studentId: s.id, name: s.full_name, seriesId: gmap.get(s.group_id)!,
      theme: [s.theme_number, s.theme_name].filter(Boolean).join(" ") || "—",
      zipPath: sub?.zip_path ?? null, report: (sub?.report as DrcReport) ?? null, score: sub?.drc_score ?? null,
    };
  });
}

function Insights() {
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const years = structure.data?.years ?? [];
  const allSeries = sortSeriesByYear(structure.data?.series ?? [], years);
  const [seriesId, setSeriesId] = useState("");
  const [withHistory, setWithHistory] = useState(true);
  const [threshold, setThreshold] = useState(85);
  const current = allSeries.find((s) => s.id === seriesId);
  const compareIds = useMemo(() => {
    if (!current) return [];
    if (!withHistory) return [current.id];
    return allSeries.filter((s) => s.id === current.id || s.name === current.name).map((s) => s.id);
  }, [current, withHistory, allSeries]);
  const rows = useQuery({ queryKey: ["insights", compareIds], queryFn: () => fetchRows(compareIds), enabled: compareIds.length > 0 });
  const seriesRows = (rows.data ?? []).filter((r) => r.seriesId === seriesId);

  // ---- statistics
  const stats = useMemo(() => {
    const withRep = seriesRows.filter((r) => r.report);
    const freq = new Map<string, { title: string; projects: number; occurrences: number }>();
    for (const r of withRep) {
      const seen = new Set<string>();
      for (const i of r.report!.issues ?? []) {
        const f = freq.get(i.code) ?? { title: i.title, projects: 0, occurrences: 0 };
        f.occurrences++;
        if (!seen.has(i.code)) { f.projects++; seen.add(i.code); }
        freq.set(i.code, f);
      }
    }
    const verdict = { admis: 0, rezerve: 0, respins: 0 };
    for (const r of withRep) verdict[r.report!.verdict ?? (r.report!.wouldPass ? "admis" : "respins")]++;
    const scores = withRep.map((r) => r.report!.score);
    const bins = [0, 0, 0, 0, 0];
    for (const s of scores) bins[Math.min(4, Math.floor(s / 20))]!++;
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return { total: seriesRows.length, checked: withRep.length, verdict, bins, avg, top: [...freq.entries()].sort((a, b) => b[1].projects - a[1].projects).slice(0, 15) };
  }, [seriesRows]);

  // ---- integrity
  const [fps, setFps] = useState<Map<string, Fingerprint>>(new Map());
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const runFingerprints = async () => {
    const targets = (rows.data ?? []).filter((r) => r.zipPath && !fps.has(r.studentId));
    setProg({ done: 0, total: targets.length });
    const next = new Map(fps);
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      try {
        const { data, error } = await supabase.storage.from("gerbers").download(t.zipPath!);
        if (error) throw error;
        next.set(t.studentId, fingerprint(await loadGerberZip(data)));
      } catch { fail++; }
      setProg({ done: i + 1, total: targets.length });
    }
    setFps(next);
    setProg(null);
    toast.success(`Amprente calculate: ${next.size}${fail ? ` · ${fail} arhive nu au putut fi citite` : ""}`);
  };
  const pairs = useMemo(() => {
    const all = (rows.data ?? []).filter((r) => fps.has(r.studentId));
    const mine = all.filter((r) => r.seriesId === seriesId);
    const out: { a: Row; b: Row; s: number }[] = [];
    for (const a of mine)
      for (const b of all) {
        if (a.studentId === b.studentId) continue;
        if (b.seriesId === seriesId && b.studentId < a.studentId) continue;
        const s = similarity(fps.get(a.studentId)!, fps.get(b.studentId)!);
        if (s >= threshold) out.push({ a, b, s });
      }
    return out.sort((x, y) => y.s - x.s);
  }, [rows.data, fps, seriesId, threshold]);
  const yearOf = (sid: string) => { const s = allSeries.find((x) => x.id === sid); return s ? seriesLabel(s, years) : ""; };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Statistici & Integritate</h1>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setFps(new Map()); }}>
            <SelectTrigger className="w-72" aria-label="Serie"><SelectValue placeholder="Alege seria" /></SelectTrigger>
            <SelectContent>{allSeries.map((s) => <SelectItem key={s.id} value={s.id}>{seriesLabel(s, years)}</SelectItem>)}</SelectContent>
          </Select>
          {rows.isLoading && <span className="text-sm text-muted-foreground">Se încarcă…</span>}
        </CardContent>
      </Card>

      {current && (
        <>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> Statistici serie</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-5">
                {[["Proiecte", stats.total], ["Verificate", stats.checked], ["Admise", stats.verdict.admis], ["Cu rezerve", stats.verdict.rezerve], ["Respinse", stats.verdict.respins]].map(([l, v]) => (
                  <div key={l} className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold">{v}</div></div>
                ))}
              </div>
              <div>
                <div className="mb-1 text-sm text-muted-foreground">Distribuție scor (medie {stats.avg.toFixed(1)})</div>
                <div className="flex h-28 items-end gap-2">
                  {stats.bins.map((b, i) => {
                    const max = Math.max(1, ...stats.bins);
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center gap-1">
                        <span className="text-xs">{b}</span>
                        <div className="w-full rounded-t bg-primary" style={{ height: `${(b / max) * 80}px` }} />
                        <span className="text-[10px] text-muted-foreground">{i * 20}–{i * 20 + 20}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Cod</TableHead><TableHead>Eroare frecventă</TableHead><TableHead className="text-right">Proiecte</TableHead><TableHead className="text-right">Apariții</TableHead></TableRow></TableHeader>
                <TableBody>
                  {stats.top.map(([code, f]) => (
                    <TableRow key={code}>
                      <TableCell className="font-mono text-xs">{code}</TableCell>
                      <TableCell>{f.title}</TableCell>
                      <TableCell className="text-right">{f.projects} ({stats.checked ? Math.round((f.projects / stats.checked) * 100) : 0}%)</TableCell>
                      <TableCell className="text-right">{f.occurrences}</TableCell>
                    </TableRow>
                  ))}
                  {!stats.top.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nicio predare verificată în această serie.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Integritate academică — amprentă layout</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Compară poziția relativă a pad-urilor, sculele de găurire și distribuția cuprului — indiferent de mutare sau rotire. Un scor mare între teme diferite merită verificat manual; nu este o dovadă automată.</p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={withHistory} onCheckedChange={(v) => { setWithHistory(v); }} aria-label="Include anii anteriori" /> Include aceeași serie din anii anteriori</label>
                <label className="flex items-center gap-2 text-sm">Prag alertă <Input type="number" className="w-20" value={threshold} min={50} max={100} onChange={(e) => setThreshold(+e.target.value || 85)} /> %</label>
                <Button onClick={runFingerprints} disabled={!!prog || !rows.data}><Play className="mr-1 h-4 w-4" /> Calculează amprentele</Button>
                <span className="text-sm text-muted-foreground">{fps.size} amprente</span>
              </div>
              {prog && <Progress value={(prog.done / Math.max(1, prog.total)) * 100} />}
              <Table>
                <TableHeader><TableRow><TableHead>Proiect</TableHead><TableHead>Seamănă cu</TableHead><TableHead className="text-right">Similaritate</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pairs.map((p, i) => {
                    const sameTheme = p.a.theme === p.b.theme && p.a.theme !== "—";
                    return (
                      <TableRow key={i}>
                        <TableCell><div className="font-medium">{p.a.name}</div><div className="text-xs text-muted-foreground">Temă: {p.a.theme}</div></TableCell>
                        <TableCell><div className="font-medium">{p.b.name}</div><div className="text-xs text-muted-foreground">Temă: {p.b.theme} · {yearOf(p.b.seriesId)}</div></TableCell>
                        <TableCell className="text-right">
                          <Badge variant={sameTheme ? "secondary" : "destructive"}>{p.s.toFixed(1)}%</Badge>
                          <div className="text-[10px] text-muted-foreground">{sameTheme ? "aceeași temă" : "teme diferite"}</div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!pairs.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">{fps.size ? "Nicio pereche peste prag." : "Apasă „Calculează amprentele”."}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
