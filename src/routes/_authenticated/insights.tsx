import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { ShieldAlert, BarChart3, Play, Download, Eye, Bell, Star, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchStructure, seriesLabel, sortSeriesByYear } from "@/lib/data";
import { adjustPair, seriesBaseline, type Adjusted } from "@/lib/integrity/adjust";
import { FP_VERSION, PAIR_VERSION, VERDICT_LABEL, CLASS_LABEL, CLASS_RANK, classOf, type PairClass, type Fingerprint, type SimilarityDetail } from "@/lib/integrity/fingerprint";
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
import { IntegrityOverlayViewer } from "@/components/IntegrityOverlayViewer";
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
type Pair = { a: Row; b: Row; d: SimilarityDetail; adj?: Adjusted };
type Alert = { id: string; student_id: string; other_student_id: string; similarity: number; adjusted: number; status: string; created_at: string; detail: SimilarityDetail };

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
  useEffect(() => {
    if (seriesId || !allSeries.length) return;
    const active = new Set(years.filter((y) => y.is_active).map((y) => y.id));
    const pick = allSeries.find((s) => active.has(s.academic_year_id) && !s.is_archived) ?? allSeries.find((s) => !s.is_archived) ?? allSeries[0]!;
    setSeriesId(pick.id);
  }, [allSeries, years, seriesId]);
  const [useAdjusted, setUseAdjusted] = useState(true);
  const [adjThreshold, setAdjThreshold] = useState(55);
  const [withHistory, setWithHistory] = useState(true);
  const [threshold, setThreshold] = useState(80);
  const [sameThemeThreshold, setSameThemeThreshold] = useState(92);
  const [hideFp, setHideFp] = useState(true);
  const [clsFilter, setClsFilter] = useState<"suspect" | "all" | PairClass>("suspect");
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

  const refs = useQuery({
    queryKey: ["integrity_refs", compareIds],
    enabled: !!rows.data?.length,
    queryFn: async () => {
      const ids = (rows.data ?? []).map((r) => r.studentId);
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("integrity_references").select("student_id").in("student_id", ids.slice(i, i + 200));
        for (const r of data ?? []) out.add(r.student_id);
      }
      return out;
    },
  });
  const refSet = refs.data ?? new Set<string>();
  const toggleRef = async (studentId: string, on: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = on
      ? await supabase.from("integrity_references").insert({ student_id: studentId, created_by: u.user!.id })
      : await supabase.from("integrity_references").delete().eq("student_id", studentId);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["integrity_refs"] });
  };

  const alerts = useQuery({
    queryKey: ["integrity_alerts", seriesId, rows.data?.length],
    enabled: !!rows.data?.length,
    queryFn: async () => {
      const ids = (rows.data ?? []).filter((r) => r.seriesId === seriesId).map((r) => r.studentId);
      const out: Alert[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from("integrity_alerts").select("id, student_id, other_student_id, similarity, adjusted, status, created_at, detail").in("student_id", ids.slice(i, i + 200)).neq("status", "dismissed").order("created_at", { ascending: false });
        out.push(...((data ?? []) as unknown as Alert[]));
      }
      return out;
    },
  });
  const setAlertStatus = async (id: string, status: "seen" | "dismissed") => {
    const { error } = await supabase.from("integrity_alerts").update({ status }).eq("id", id);
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["integrity_alerts"] });
  };

  const [rawPairs, setRawPairs] = useState<Pair[]>([]);
  const [pairsBusy, setPairsBusy] = useState(false);
  const [pairProg, setPairProg] = useState<{ done: number; total: number; cached: number } | null>(null);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const fpsKey = useMemo(() => [...fps.keys()].sort().join(","), [fps]);
  const [recompute, setRecompute] = useState(0);
  useEffect(() => {
    const cur = fpsRef.current;
    const all = (rows.data ?? []).filter((r) => cur.has(r.studentId) && r.submissionId);
    const mine = all.filter((r) => r.seriesId === seriesId);
    const list: [Row, Row][] = [];
    for (const a of mine)
      for (const b of all) {
        if (a.studentId === b.studentId) continue;
        if (b.seriesId === seriesId && b.studentId < a.studentId) continue;
        list.push([a, b]);
      }
    if (!list.length) { setRawPairs([]); setPairsBusy(false); setPairProg(null); return; }
    let cancelled = false;
    const force = recompute > 0;
    const pool = createIntegrityPool();
    setPairsBusy(true);
    (async () => {
      const sk = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
      // 1) cached scores
      const cache = new Map<string, SimilarityDetail>();
      if (!force) {
        const subs = [...new Set(all.map((r) => r.submissionId!))];
        for (let i = 0; i < subs.length && !cancelled; i += 150) {
          const { data } = await supabase.from("layout_similarity_pairs").select("submission_a, submission_b, detail").eq("version", PAIR_VERSION).in("submission_a", subs.slice(i, i + 150));
          for (const r of data ?? []) cache.set(sk(r.submission_a, r.submission_b), r.detail as unknown as SimilarityDetail);
        }
      }
      const missing = list.filter(([a, b]) => !cache.has(sk(a.submissionId!, b.submissionId!)));
      setPairProg({ done: 0, total: missing.length, cached: list.length - missing.length });
      // 2) compute missing in chunks (progress + persistence)
      const CH = 60;
      for (let i = 0; i < missing.length && !cancelled; i += CH) {
        const sl = missing.slice(i, i + CH);
        const ds = await pool.pairs(Object.fromEntries(cur), sl.map(([a, b]) => [a.studentId, b.studentId]));
        const up = sl.map(([a, b], j) => {
          cache.set(sk(a.submissionId!, b.submissionId!), ds[j]!);
          const [x, y] = a.submissionId! < b.submissionId! ? [a, b] : [b, a];
          return { submission_a: x.submissionId!, submission_b: y.submissionId!, student_a: x.studentId, student_b: y.studentId, version: PAIR_VERSION, total: ds[j]!.total, detail: ds[j]! as unknown as Json };
        });
        const { error: upErr } = await supabase.from("layout_similarity_pairs").upsert(up);
        if (upErr) console.error("save pairs", upErr.message);
        if (!cancelled) setPairProg({ done: Math.min(missing.length, i + CH), total: missing.length, cached: list.length - missing.length });
      }
      if (!cancelled) setRawPairs(list.map(([a, b]) => ({ a, b, d: cache.get(sk(a.submissionId!, b.submissionId!))! })));
    })()
      .catch((e) => { if (!cancelled) toast.error(`Compararea amprentelor a eșuat: ${(e as Error).message}`); })
      .finally(() => { pool.close(); if (!cancelled) { setPairsBusy(false); setPairProg(null); } });
    return () => { cancelled = true; pool.close(); setPairsBusy(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.data, fpsKey, seriesId, recompute]);

  const allPairs = useMemo(() => {
    const scored = rawPairs.map((p) => ({ a: p.a.studentId, b: p.b.studentId, total: p.d.total }));
    const base = seriesBaseline(scored.filter((p) => !refSet.has(p.a) && !refSet.has(p.b)));
    const refSim = new Map<string, number>();
    for (const p of scored) {
      if (refSet.has(p.a)) refSim.set(p.b, Math.max(refSim.get(p.b) ?? 0, p.total));
      if (refSet.has(p.b)) refSim.set(p.a, Math.max(refSim.get(p.a) ?? 0, p.total));
    }
    return rawPairs
      .filter((p) => !refSet.has(p.a.studentId) && !refSet.has(p.b.studentId))
      .map((p) => ({ ...p, adj: adjustPair({ a: p.a.studentId, b: p.b.studentId, total: p.d.total }, base, (id) => refSim.get(id) ?? 0) }));
  }, [rawPairs, refSet]);

  const baseline = useMemo(() => {
    const v = allPairs.map((p) => p.d.total).sort((x, y) => x - y);
    return v.length ? v[Math.floor(v.length / 2)]! : 0;
  }, [allPairs]);

  const scoreOf = (p: Pair) => (useAdjusted ? p.adj?.adjusted ?? p.d.total : p.d.total);
  const classCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of allPairs) { const k = classOf(p.d); c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [allPairs]);
  const abovePairs = useMemo(() => allPairs.filter((p) => {
    const cls = classOf(p.d);
    if (clsFilter === "suspect") { if (cls === "independent") return false; if (cls === "inspectie" && p.d.total < 50 && (p.adj?.adjusted ?? 0) < adjThreshold) return false; }
    else if (clsFilter === "all") {
      const same = p.a.theme === p.b.theme && p.a.theme !== "—";
      const pass = useAdjusted ? (p.adj!.adjusted >= adjThreshold && p.d.total >= (same ? 70 : 60)) || !!p.d.partial || p.d.total >= (same ? sameThemeThreshold : threshold) : p.d.total >= (same ? sameThemeThreshold : threshold);
      if (!pass && cls === "independent") return false;
    } else if (cls !== clsFilter) return false;
    if (hideFp && reviews.data?.get(pairKey(p.a.studentId, p.b.studentId))?.status === "false_positive") return false;
    return true;
  }).sort((x, y) => CLASS_RANK[classOf(y.d)] - CLASS_RANK[classOf(x.d)] || (y.d.routing ?? y.d.traces ?? 0) - (x.d.routing ?? x.d.traces ?? 0) || scoreOf(y) - scoreOf(x)), [allPairs, threshold, sameThemeThreshold, hideFp, reviews.data, useAdjusted, adjThreshold, clsFilter]);
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
        "Clasificare": CLASS_LABEL[classOf(p.d)], "Rutare trasee %": p.d.routing ?? p.d.traces ?? "", "Rutare exactă %": p.d.routingExact ?? "", "Schemă/piese %": p.d.schema ?? "", "Similaritate %": p.d.total, "Peste media seriei %": p.adj?.adjusted ?? "", "Z": p.adj?.z ?? "", "Componente %": p.d.comps ?? "", "Zonă max %": p.d.zoneMax ?? "", "Copie parțială": p.d.partial ? "da" : "", Verdict: VERDICT_LABEL[p.d.verdict], "Pad-uri %": p.d.pads, "Găuri %": p.d.holes, "Trasee %": p.d.traces ?? p.d.copper, "Cupru %": p.d.copper, "Serigrafie %": p.d.silk, "Global %": p.d.global,
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
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Alerte la predare {!!alerts.data?.filter((x) => x.status === "new").length && <Badge variant="destructive">{alerts.data.filter((x) => x.status === "new").length} noi</Badge>}</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">La fiecare predare oficială, placa este comparată automat cu restul seriei (inclusiv anii anteriori). Studentul nu vede nimic.</p>
              <Table>
                <TableHeader><TableRow><TableHead>Predare</TableHead><TableHead>Seamănă cu</TableHead><TableHead className="text-right">Similaritate</TableHead><TableHead>Data</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {(alerts.data ?? []).map((al) => {
                    const ra = rows.data?.find((r) => r.studentId === al.student_id), rb = rows.data?.find((r) => r.studentId === al.other_student_id);
                    return (
                      <TableRow key={al.id} className={al.status === "new" ? "font-medium" : "text-muted-foreground"}>
                        <TableCell>{ra?.name ?? "—"}</TableCell>
                        <TableCell>{rb?.name ?? "alt an"}{rb && <div className="text-xs text-muted-foreground">{yearOf(rb.seriesId)}</div>}</TableCell>
                        <TableCell className="text-right"><Badge variant="destructive">{Number(al.similarity).toFixed(1)}%</Badge><div className="text-[10px] text-muted-foreground">peste medie {Number(al.adjusted).toFixed(0)}%{al.detail?.partial ? " · copie parțială" : ""}</div></TableCell>
                        <TableCell className="text-xs">{new Date(al.created_at).toLocaleString("ro-RO")}</TableCell>
                        <TableCell className="space-x-1 text-right">
                          {al.status === "new" && <Button size="sm" variant="outline" onClick={() => setAlertStatus(al.id, "seen")}>Văzut</Button>}
                          <Button size="sm" variant="ghost" onClick={() => setAlertStatus(al.id, "dismissed")}>Închide</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!alerts.data?.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nicio alertă pentru această serie.</TableCell></TableRow>}
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
                <label className="flex items-center gap-2 text-sm"><Switch checked={useAdjusted} onCheckedChange={setUseAdjusted} aria-label="Scor ajustat după serie" /> Ordonează după cât iese peste media seriei</label>
                {useAdjusted && <label className="flex items-center gap-2 text-sm">Prag peste medie <Input type="number" className="w-20" value={adjThreshold} min={10} max={100} onChange={(e) => setAdjThreshold(+e.target.value || 55)} /> %</label>}
                <label className="flex items-center gap-2 text-sm">Arată
                  <Select value={clsFilter} onValueChange={(v) => setClsFilter(v as typeof clsFilter)}>
                    <SelectTrigger className="h-8 w-64" aria-label="Filtru clasificare"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suspect">Doar suspiciuni (ascunde rutarea independentă)</SelectItem>
                      <SelectItem value="all">Toate peste prag</SelectItem>
                      {(Object.keys(CLASS_LABEL) as PairClass[]).map((k) => <SelectItem key={k} value={k}>{CLASS_LABEL[k]} ({classCounts[k] ?? 0})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={hideFp} onCheckedChange={setHideFp} aria-label="Ascunde falsurile pozitive" /> Ascunde „Fals pozitiv”</label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => runFingerprints(false)} disabled={!!prog || !rows.data}><Play className="mr-1 h-4 w-4" /> Calculează amprentele lipsă</Button>
                <Button variant="outline" onClick={async () => { await runFingerprints(true); setRecompute((n) => n + 1); }} disabled={!!prog || !rows.data}>Recalculează tot</Button>
                <Button variant="outline" onClick={exportXlsx} disabled={!pairs.length}><Download className="mr-1 h-4 w-4" /> Export Excel</Button>
                <span className="text-sm text-muted-foreground">{fps.size} amprente salvate · media similarității în serie {baseline.toFixed(1)}%</span>
              </div>
              {prog && <Progress value={(prog.done / Math.max(1, prog.total)) * 100} />}
              {prog && <p className="text-xs text-muted-foreground">Pas 1/2 — amprente: {prog.done}/{prog.total}</p>}
              {pairProg && (
                <div className="space-y-1">
                  <Progress value={pairProg.total ? (pairProg.done / pairProg.total) * 100 : 100} />
                  <p className="text-xs text-muted-foreground">Pas 2/2 — perechi noi comparate: {pairProg.done}/{pairProg.total} · {pairProg.cached} luate din comparațiile salvate</p>
                </div>
              )}
              {pairsBusy && !pairProg && <p className="text-xs text-muted-foreground">Se încarcă comparațiile salvate…</p>}

              <div className="rounded-md border border-border p-3 text-sm">
                <div className="mb-2 flex items-center gap-2 font-medium"><Star className="h-4 w-4" /> Proiecte de referință (exemplul de la curs)</div>
                <p className="mb-2 text-xs text-muted-foreground">Asemănarea cu un proiect de referință nu se mai consideră copiere: scade scorul perechilor care seamănă amândouă cu el.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {[...refSet].map((id) => { const r = rows.data?.find((x) => x.studentId === id); return r ? <Badge key={id} variant="secondary" className="gap-1">{r.name}<button aria-label={`Scoate ${r.name} din referințe`} onClick={() => toggleRef(id, false)}><X className="h-3 w-3" /></button></Badge> : null; })}
                  <Select value="" onValueChange={(v) => toggleRef(v, true)}>
                    <SelectTrigger className="h-8 w-60" aria-label="Adaugă proiect de referință"><SelectValue placeholder="Adaugă proiect de referință…" /></SelectTrigger>
                    <SelectContent>{(rows.data ?? []).filter((r) => r.submissionId && !refSet.has(r.studentId)).map((r) => <SelectItem key={r.studentId} value={r.studentId}>{r.name} · {yearOf(r.seriesId)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>

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
                          <ScoreBar label="Rutare" v={p.d.routing ?? p.d.traces ?? p.d.copper} strong />
                          <ScoreBar label="Schemă" v={p.d.schema ?? p.d.comps ?? p.d.pads} />
                          <div className="mt-1">Pad-uri {p.d.pads}%{p.d.comps != null ? ` · Componente ${p.d.comps}%` : ""} · Găuri {p.d.holes}%{p.d.routingExact != null ? ` · Rutare exactă ${p.d.routingExact}%` : ""}{p.d.silk ? ` · Text ${p.d.silk}%` : ""}</div>
                          {p.d.zoneMax != null && <div>Cea mai asemănătoare zonă {p.d.zoneMax}% · {p.d.zones ?? 0}/9 zone identice</div>}
                          <Badge variant={CLASS_RANK[classOf(p.d)] >= 3 ? "destructive" : CLASS_RANK[classOf(p.d)] === 2 ? "default" : "secondary"} className="mt-1">{CLASS_LABEL[classOf(p.d)]}</Badge>
                          <div>{p.d.transform.rot}°{p.d.transform.mirror ? ", oglindit" : ""}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={sameTheme ? "secondary" : "destructive"}>{p.d.total.toFixed(1)}%</Badge>
                          <div className="text-[10px] text-muted-foreground">{VERDICT_LABEL[p.d.verdict]} · {sameTheme ? "aceeași temă" : "teme diferite"}</div>
                          {p.adj && <div className="text-[10px] text-muted-foreground">peste media seriei: {p.adj.adjusted}% (z {p.adj.z})</div>}
                        </TableCell>
                        <TableCell>
                          <Select value={rv?.status ?? "none"} onValueChange={(v) => saveReview(p, v as Review["status"] | "none", rv?.note ?? undefined)}>
                            <SelectTrigger className="h-8 w-44" aria-label="Decizie"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Auto: {CLASS_LABEL[classOf(p.d)]}</SelectItem>
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
      <OverlayDialog pair={overlay} meta={yearOf} onClose={() => setOverlay(null)} />
    </div>
  );
}

function OverlayDialog({ pair, onClose, meta }: { pair: Pair | null; onClose: () => void; meta: (sid: string) => string }) {
  return (
    <Dialog open={!!pair} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl">
        <DialogHeader><DialogTitle>Comparație Gerber {pair && `— ${pair.d.total.toFixed(1)}%`}</DialogTitle></DialogHeader>
        {pair && <IntegrityOverlayViewer a={{ name: pair.a.name, zipPath: pair.a.zipPath, meta: `${pair.a.theme} · ${meta(pair.a.seriesId)}` }} b={{ name: pair.b.name, zipPath: pair.b.zipPath, meta: `${pair.b.theme} · ${meta(pair.b.seriesId)}` }} detail={pair.d} />}
      </DialogContent>
    </Dialog>
  );
}

function ScoreBar({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0">{label}</span>
      <div className="h-1.5 w-24 overflow-hidden rounded bg-muted"><div className={strong ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></div>
      <span className={strong ? "font-semibold text-foreground" : ""}>{v.toFixed(0)}%</span>
    </div>
  );
}
