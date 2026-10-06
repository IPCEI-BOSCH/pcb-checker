import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { ShieldAlert, BarChart3, Play, Download, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchStructure, seriesLabel, sortSeriesByYear } from "@/lib/data";
import { FP_VERSION, VERDICT_LABEL, transformPts, type Fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";
import { createIntegrityPool } from "@/lib/integrity/pool";
import type { DrcReport } from "@/lib/drc/engine";
import type { Json } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type Row = { studentId: string; submissionId: string | null; name: string; theme: string; seriesId: string; zipPath: string | null; report: DrcReport | null; score: number | null };
type Review = { student_a: string; student_b: string; status: "false_positive" | "discuss" | "confirmed"; note: string | null };
type Pair = { a: Row; b: Row; d: SimilarityDetail };

const STATUS_LABEL: Record<Review["status"], string> = { false_positive: "Fals pozitiv", discuss: "De discutat", confirmed: "Confirmat" };

async function fetchRows(seriesIds: string[]): Promise<Row[]> {
  if (!seriesIds.length) return [];
  const g = await supabase.from("groups").select("id, series_id").in("series_id", seriesIds);
  const gmap = new Map((g.data ?? []).map((x) => [x.id, x.series_id]));
  if (!gmap.size) return [];
  const st = await supabase.from("students").select("id, full_name, theme_name, theme_number, group_id").in("group_id", [...gmap.keys()]);
  const ids = (st.data ?? []).map((s) => s.id);
  const subs = ids.length ? await supabase.from("submissions").select("id, student_id, zip_path, report, drc_score, created_at").eq("kind", "OFFICIAL").in("student_id", ids).order("created_at", { ascending: false }) : { data: [] };
  const latest = new Map<string, { id: string; zip_path: string | null; report: unknown; drc_score: number | null }>();
  for (const s of subs.data ?? []) if (!latest.has(s.student_id)) latest.set(s.student_id, s);
  return (st.data ?? []).map((s) => {
    const sub = latest.get(s.id);
    return {
      studentId: s.id, submissionId: sub?.id ?? null, name: s.full_name, seriesId: gmap.get(s.group_id)!,
      theme: [s.theme_number, s.theme_name].filter(Boolean).join(" ") || "—",
      zipPath: sub?.zip_path ?? null, report: (sub?.report as DrcReport) ?? null, score: sub?.drc_score ?? null,
    };
  });
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

function Insights() {
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const years = structure.data?.years ?? [];
  const allSeries = sortSeriesByYear(structure.data?.series ?? [], years);
  const [seriesId, setSeriesId] = useState("");
  const [withHistory, setWithHistory] = useState(true);
  const [threshold, setThreshold] = useState(80);
  const [sameThemeThreshold, setSameThemeThreshold] = useState(92);
  const [hideFp, setHideFp] = useState(true);
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

  // ---- integrity: stored fingerprints
  const subIds = useMemo(() => (rows.data ?? []).map((r) => r.submissionId).filter(Boolean) as string[], [rows.data]);
  const stored = useQuery({
    queryKey: ["fingerprints", subIds],
    enabled: subIds.length > 0,
    queryFn: async () => {
      const out = new Map<string, Fingerprint>();
      for (let i = 0; i < subIds.length; i += 200) {
        const { data } = await supabase.from("layout_fingerprints").select("submission_id, data, version").in("submission_id", subIds.slice(i, i + 200)).eq("version", FP_VERSION);
        for (const r of data ?? []) out.set(r.submission_id, r.data as unknown as Fingerprint);
      }
      return out;
    },
  });
  const [fps, setFps] = useState<Map<string, Fingerprint>>(new Map());
  useEffect(() => {
    if (!stored.data || !rows.data) return;
    const m = new Map<string, Fingerprint>();
    for (const r of rows.data) { const f = r.submissionId && stored.data.get(r.submissionId); if (f) m.set(r.studentId, f); }
    setFps(m);
  }, [stored.data, rows.data]);

  const reviews = useQuery({
    queryKey: ["integrity_reviews", compareIds],
    enabled: !!rows.data?.length,
    queryFn: async () => {
      const ids = (rows.data ?? []).filter((r) => r.seriesId === seriesId).map((r) => r.studentId);
      const m = new Map<string, Review>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("integrity_reviews").select("student_a, student_b, status, note").in("student_a", ids.slice(i, i + 200));
        for (const r of (data ?? []) as Review[]) m.set(pairKey(r.student_a, r.student_b), r);
      }
      return m;
    },
  });

  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const runFingerprints = async (force = false) => {
    const targets = (rows.data ?? []).filter((r) => r.zipPath && r.submissionId && (force || !fps.has(r.studentId)));
    setProg({ done: 0, total: targets.length });
    const next = new Map(fps);
    let fail = 0, done = 0, cursor = 0;
    const pool = createIntegrityPool();
    const worker = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++]!;
        try {
          const { data, error } = await supabase.storage.from("gerbers").download(t.zipPath!);
          if (error) throw error;
          const fp = await pool.fingerprint(data);
          next.set(t.studentId, fp);
          await supabase.from("layout_fingerprints").upsert({ submission_id: t.submissionId!, student_id: t.studentId, version: FP_VERSION, data: fp as unknown as Json });
        } catch { fail++; }
        setProg({ done: ++done, total: targets.length });
      }
    };
    try { await Promise.all(Array.from({ length: pool.size }, worker)); } finally { pool.close(); }
    setFps(next);
    setProg(null);
    qc.invalidateQueries({ queryKey: ["fingerprints"] });
    toast.success(`Amprente: ${next.size}${fail ? ` · ${fail} arhive nu au putut fi citite` : ""}`);
  };

  const [allPairs, setAllPairs] = useState<Pair[]>([]);
  const [pairsBusy, setPairsBusy] = useState(false);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const fpsKey = useMemo(() => [...fps.keys()].sort().join(","), [fps]);
  useEffect(() => {
    const cur = fpsRef.current;
    const all = (rows.data ?? []).filter((r) => cur.has(r.studentId));
    const mine = all.filter((r) => r.seriesId === seriesId);
    const list: [Row, Row][] = [];
    for (const a of mine)
      for (const b of all) {
        if (a.studentId === b.studentId) continue;
        if (b.seriesId === seriesId && b.studentId < a.studentId) continue;
        list.push([a, b]);
      }
    if (!list.length) { setAllPairs([]); setPairsBusy(false); return; }
    let cancelled = false;
    const pool = createIntegrityPool();
    setPairsBusy(true);
    pool.pairs(Object.fromEntries(cur), list.map(([a, b]) => [a.studentId, b.studentId]))
      .then((ds) => { if (!cancelled) setAllPairs(list.map(([a, b], i) => ({ a, b, d: ds[i]! }))); })
      .catch((e) => { if (!cancelled) toast.error(`Compararea amprentelor a eșuat: ${(e as Error).message}`); })
      .finally(() => { pool.close(); if (!cancelled) setPairsBusy(false); });
    return () => { cancelled = true; pool.close(); setPairsBusy(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.data, fpsKey, seriesId]);

  const baseline = useMemo(() => {
    const v = allPairs.map((p) => p.d.total).sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)]! : 0;
  }, [allPairs]);

  const abovePairs = useMemo(() => allPairs.filter((p) => {
    const same = p.a.theme === p.b.theme && p.a.theme !== "—";
    if (p.d.total < (same ? sameThemeThreshold : threshold)) return false;
    if (hideFp && reviews.data?.get(pairKey(p.a.studentId, p.b.studentId))?.status === "false_positive") return false;
    return true;
  }).sort((x, y) => y.d.total - x.d.total), [allPairs, threshold, sameThemeThreshold, hideFp, reviews.data]);
  const belowOnly = !abovePairs.length && allPairs.length > 0;
  const pairs = useMemo(() => belowOnly ? [...allPairs].sort((x, y) => y.d.total - x.d.total).slice(0, 15) : abovePairs, [belowOnly, allPairs, abovePairs]);

  const clusters = useMemo(() => {
    const parent = new Map<string, string>();
    const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
    for (const p of pairs) parent.set(find(p.a.studentId), find(p.b.studentId));
    const groups = new Map<string, Row[]>();
    const byId = new Map((rows.data ?? []).map((r) => [r.studentId, r]));
    for (const id of new Set(pairs.flatMap((p) => [p.a.studentId, p.b.studentId]))) { const r = find(id); (groups.get(r) ?? groups.set(r, []).get(r)!).push(byId.get(id)!); }
    return [...groups.values()].filter((g) => g.length >= 3);
  }, [pairs, rows.data]);

  const yearOf = (sid: string) => { const s = allSeries.find((x) => x.id === sid); return s ? seriesLabel(s, years) : ""; };

  const saveReview = async (p: Pair, status: Review["status"] | "none", note?: string) => {
    const [a, b] = p.a.studentId < p.b.studentId || p.b.seriesId !== seriesId ? [p.a.studentId, p.b.studentId] : [p.b.studentId, p.a.studentId];
    if (status === "none") {
      await supabase.from("integrity_reviews").delete().or(`and(student_a.eq.${a},student_b.eq.${b}),and(student_a.eq.${b},student_b.eq.${a})`);
    } else {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("integrity_reviews").upsert({ student_a: a, student_b: b, status, note: note ?? null, similarity: p.d.total, reviewed_by: u.user!.id, updated_at: new Date().toISOString() }, { onConflict: "student_a,student_b" });
      if (error) { toast.error(error.message); return; }
      await supabase.from("audit_log").insert({ actor_id: u.user!.id, action: "INTEGRITY_REVIEW", target_entity: "student", target_id: a, details: { other: b, status, similarity: p.d.total } });
    }
    qc.invalidateQueries({ queryKey: ["integrity_reviews"] });
  };

  const exportXlsx = () => {
    const data = pairs.map((p) => {
      const rv = reviews.data?.get(pairKey(p.a.studentId, p.b.studentId));
      return {
        Proiect: p.a.name, "Temă": p.a.theme, "Seamănă cu": p.b.name, "Temă 2": p.b.theme, "Serie/an 2": yearOf(p.b.seriesId),
        "Similaritate %": p.d.total, Verdict: VERDICT_LABEL[p.d.verdict], "Pad-uri %": p.d.pads, "Găuri %": p.d.holes, "Trasee %": p.d.copper, "Serigrafie %": p.d.silk, "Global %": p.d.global,
        "Transformare": `${p.d.transform.rot}°${p.d.transform.mirror ? " oglindit" : ""}`, Decizie: rv ? STATUS_LABEL[rv.status] : "", "Observație": rv?.note ?? "",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Perechi");
    if (clusters.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(clusters.flatMap((g, i) => g.map((r) => ({ Grup: i + 1, Student: r.name, "Temă": r.theme, Serie: yearOf(r.seriesId) })))), "Grupuri");
    XLSX.writeFile(wb, `Integritate_${current ? seriesLabel(current, years).replace(/\W+/g, "_") : "serie"}.xlsx`);
  };

  const [overlay, setOverlay] = useState<Pair | null>(null);

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
              <p className="text-sm text-muted-foreground">Plăcile sunt suprapuse automat (rotire 0/90/180/270°, oglindire, mutare) și se măsoară cât coincid pad-urile, găurile, traseele și textele. Scorul este un indiciu care merită verificat manual, nu o dovadă. Rezultatele sunt vizibile doar cadrelor didactice.</p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm"><Switch checked={withHistory} onCheckedChange={setWithHistory} aria-label="Include anii anteriori" /> Aceeași serie din anii anteriori</label>
                <label className="flex items-center gap-2 text-sm">Prag teme diferite <Input type="number" className="w-20" value={threshold} min={40} max={100} onChange={(e) => setThreshold(+e.target.value || 80)} /> %</label>
                <label className="flex items-center gap-2 text-sm">Prag aceeași temă <Input type="number" className="w-20" value={sameThemeThreshold} min={40} max={100} onChange={(e) => setSameThemeThreshold(+e.target.value || 92)} /> %</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={hideFp} onCheckedChange={setHideFp} aria-label="Ascunde falsurile pozitive" /> Ascunde „Fals pozitiv”</label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => runFingerprints(false)} disabled={!!prog || !rows.data}><Play className="mr-1 h-4 w-4" /> Calculează amprentele lipsă</Button>
                <Button variant="outline" onClick={() => runFingerprints(true)} disabled={!!prog || !rows.data}>Recalculează tot</Button>
                <Button variant="outline" onClick={exportXlsx} disabled={!pairs.length}><Download className="mr-1 h-4 w-4" /> Export Excel</Button>
                <span className="text-sm text-muted-foreground">{fps.size} amprente salvate · media similarității în serie {baseline.toFixed(1)}%</span>
              </div>
              {prog && <Progress value={(prog.done / Math.max(1, prog.total)) * 100} />}
              {pairsBusy && <p className="text-xs text-muted-foreground">Se compară proiectele în fundal…</p>}

              {!!clusters.length && (
                <div className="rounded-md border border-destructive p-3 text-sm">
                  <div className="font-semibold text-destructive">Grupuri de proiecte foarte asemănătoare (3 sau mai multe)</div>
                  {clusters.map((g, i) => <div key={i} className="mt-1">Grup {i + 1}: {g.map((r) => r.name).join(", ")}</div>)}
                </div>
              )}

              {belowOnly && <p className="text-sm text-muted-foreground">Nicio pereche nu depășește pragul. Mai jos sunt cele mai asemănătoare 15 perechi, doar ca reper.</p>}
              <Table>
                <TableHeader><TableRow><TableHead>Proiect</TableHead><TableHead>Seamănă cu</TableHead><TableHead>Detaliu</TableHead><TableHead className="text-right">Similaritate</TableHead><TableHead>Decizie</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {pairs.map((p) => {
                    const sameTheme = p.a.theme === p.b.theme && p.a.theme !== "—";
                    const rv = reviews.data?.get(pairKey(p.a.studentId, p.b.studentId));
                    return (
                      <TableRow key={p.a.studentId + p.b.studentId}>
                        <TableCell><div className="font-medium">{p.a.name}</div><div className="text-xs text-muted-foreground">Temă: {p.a.theme}</div></TableCell>
                        <TableCell><div className="font-medium">{p.b.name}</div><div className="text-xs text-muted-foreground">Temă: {p.b.theme} · {yearOf(p.b.seriesId)}</div></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          Pad-uri {p.d.pads}% · Găuri {p.d.holes}% · Trasee {p.d.copper}%{p.d.silk ? ` · Text ${p.d.silk}%` : ""}
                          <div>{p.d.transform.rot}°{p.d.transform.mirror ? ", oglindit" : ""}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={sameTheme ? "secondary" : "destructive"}>{p.d.total.toFixed(1)}%</Badge>
                          <div className="text-[10px] text-muted-foreground">{VERDICT_LABEL[p.d.verdict]} · {sameTheme ? "aceeași temă" : "teme diferite"}</div>
                        </TableCell>
                        <TableCell>
                          <Select value={rv?.status ?? "none"} onValueChange={(v) => saveReview(p, v as Review["status"] | "none", rv?.note ?? undefined)}>
                            <SelectTrigger className="h-8 w-36" aria-label="Decizie"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nedecis</SelectItem>
                              {Object.entries(STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {rv && <Input className="mt-1 h-7 w-36 text-xs" placeholder="Observație" defaultValue={rv.note ?? ""} onBlur={(e) => e.target.value !== (rv.note ?? "") && saveReview(p, rv.status, e.target.value)} />}
                        </TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => setOverlay(p)} aria-label="Compară vizual"><Eye className="h-4 w-4" /></Button></TableCell>
                      </TableRow>
                    );
                  })}
                  {!pairs.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">{pairsBusy ? "Se compară…" : fps.size ? "Nu există perechi de comparat în seria aleasă." : "Apasă „Calculează amprentele lipsă”."}</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <OverlayDialog pair={overlay} a={overlay ? fps.get(overlay.a.studentId) : undefined} b={overlay ? fps.get(overlay.b.studentId) : undefined} onClose={() => setOverlay(null)} />
    </div>
  );
}

function OverlayDialog({ pair, a, b, onClose }: { pair: Pair | null; a?: Fingerprint | undefined; b?: Fingerprint | undefined; onClose: () => void }) {
  const [mix, setMix] = useState(50);
  const geo = useMemo(() => {
    if (!pair || !a || !b) return null;
    const bp = transformPts(b.padPts ?? [], pair.d.transform);
    const bh = transformPts((b.holePts ?? []).map(([x, y]) => [x, y] as [number, number]), pair.d.transform);
    const bc = transformPts(b.copperPts ?? [], pair.d.transform);
    const ap = a.padPts ?? [], ah = (a.holePts ?? []).map(([x, y]) => [x, y] as [number, number]), ac = a.copperPts ?? [];
    const all = [...ap, ...bp, ...ac, ...bc];
    const ext = Math.max(5, ...all.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) + 2;
    return { ap, ah, ac, bp, bh, bc, ext };
  }, [pair, a, b]);
  return (
    <Dialog open={!!pair} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Comparație vizuală {pair && `— ${pair.d.total.toFixed(1)}%`}</DialogTitle></DialogHeader>
        {pair && !geo?.ap.length && <p className="text-sm text-muted-foreground">Amprentele sunt din versiunea veche — apasă „Recalculează tot”.</p>}
        {pair && geo && !!geo.ap.length && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span><span className="inline-block h-3 w-3 rounded-full bg-primary align-middle" /> {pair.a.name}</span>
              <span><span className="inline-block h-3 w-3 rounded-full bg-destructive align-middle" /> {pair.b.name} (aliniat: {pair.d.transform.rot}°{pair.d.transform.mirror ? ", oglindit" : ""})</span>
            </div>
            <svg viewBox={`${-geo.ext} ${-geo.ext} ${geo.ext * 2} ${geo.ext * 2}`} className="aspect-square w-full rounded-md border border-border bg-muted" role="img" aria-label="Suprapunerea celor două plăci">
              <g transform="scale(1,-1)">
                <g className="text-primary" fill="currentColor" stroke="currentColor" opacity={(100 - mix) / 100}>
                  {geo.ac.map((p, i) => <circle key={`ac${i}`} cx={p[0]} cy={p[1]} r={0.15} />)}
                  {geo.ap.map((p, i) => <circle key={`ap${i}`} cx={p[0]} cy={p[1]} r={0.45} />)}
                  {geo.ah.map((p, i) => <circle key={`ah${i}`} cx={p[0]} cy={p[1]} r={0.3} fill="none" strokeWidth={0.1} />)}
                </g>
                <g className="text-destructive" fill="currentColor" stroke="currentColor" opacity={mix / 100}>
                  {geo.bc.map((p, i) => <circle key={`bc${i}`} cx={p[0]} cy={p[1]} r={0.15} />)}
                  {geo.bp.map((p, i) => <circle key={`bp${i}`} cx={p[0]} cy={p[1]} r={0.3} />)}
                  {geo.bh.map((p, i) => <circle key={`bh${i}`} cx={p[0]} cy={p[1]} r={0.2} fill="none" strokeWidth={0.1} />)}
                </g>
              </g>
            </svg>
            <div className="flex items-center gap-3 text-sm"><span>{pair.a.name}</span><Slider value={[mix]} min={0} max={100} step={5} onValueChange={(v) => setMix(v[0] ?? 50)} aria-label="Transparență" /><span>{pair.b.name}</span></div>
            <p className="text-xs text-muted-foreground">Pad-uri {pair.d.pads}% · Găuri {pair.d.holes}% · Trasee {pair.d.copper}% · Text {pair.d.silk}% · Distribuție globală {pair.d.global}%</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
