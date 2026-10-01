import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Eye, FlaskConical, Play, ShieldCheck, Upload, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, TITLES, type DrcReport, type Variant } from "@/lib/drc/engine";
import type { Settings } from "@/lib/drc/settings";
import type { Layer } from "@/lib/gerber/types";
import { DrcReportView } from "@/components/DrcReportView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Verdict = "ok" | "wrong" | null;
interface Candidate { key: string; name: string; variant: Variant; zipPath?: string; file?: File }
interface TestRow extends Candidate {
  base?: DrcReport; next?: DrcReport; layers?: Layer[]; error?: string;
  verdict: Verdict; note: string;
}

/** Changed settings between baseline and candidate, as readable lines. */
export function settingsDiff(a: Settings, b: Settings): string[] {
  const out: string[] = [];
  for (const sec of ["rules", "cam"] as const) {
    const A = a[sec] as unknown as Record<string, unknown>, B = b[sec] as unknown as Record<string, unknown>;
    for (const k of Object.keys(B)) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push(`${sec}.${k}: ${A[k]} → ${B[k]}`);
  }
  for (const k of Object.keys(b.penalties)) {
    const x = a.penalties[k], y = b.penalties[k];
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`punctaj ${TITLES[k] ?? k}: ${JSON.stringify(x)} → ${JSON.stringify(y)}`);
  }
  return out;
}

const issueKeys = (r?: DrcReport) => new Map((r?.issues ?? []).reduce<[string, number][]>((m, i) => {
  const e = m.find((x) => x[0] === i.code); if (e) e[1]++; else m.push([i.code, 1]); return m;
}, []));

export function RuleSandbox({ seriesId, baseline, candidate, userId, onActivate }: {
  seriesId: string | null; baseline: Settings; candidate: Settings; userId: string;
  onActivate: (s: Settings) => Promise<void>;
}) {
  const [rows, setRows] = useState<TestRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pool, setPool] = useState<Candidate[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [view, setView] = useState<TestRow | null>(null);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const diff = useMemo(() => settingsDiff(baseline, candidate), [baseline, candidate]);
  const testedSig = useMemo(() => JSON.stringify(candidate), [candidate]);
  const [ranSig, setRanSig] = useState<string | null>(null);

  const loadPool = async () => {
    let q = supabase.from("submissions").select("id, zip_path, variant, created_at, student_id, students!inner(full_name, file_prefix, groups!inner(name, series_id))")
      .not("zip_path", "is", null).order("created_at", { ascending: false }).limit(400);
    if (seriesId) q = q.eq("students.groups.series_id", seriesId);
    const { data, error } = await q;
    if (error) return void toast.error(error.message);
    const seen = new Set<string>();
    const list: Candidate[] = [];
    for (const s of (data ?? []) as unknown as { id: string; zip_path: string; variant: Variant; student_id: string; students: { full_name: string; file_prefix: string | null; groups: { name: string } } }[]) {
      if (seen.has(s.student_id)) continue; seen.add(s.student_id);
      list.push({ key: s.id, name: `${s.students.groups.name} · ${s.students.file_prefix ?? s.students.full_name}`, variant: s.variant, zipPath: s.zip_path });
    }
    setPool(list);
    if (!list.length) toast.info("Nu există proiecte predate în acest domeniu. Încărcați arhive ZIP de test.");
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const extra = [...files].map((f) => ({ key: `local-${f.name}-${f.size}`, name: `Local · ${f.name}`, variant: "SMT" as Variant, file: f }));
    setPool((p) => [...extra, ...p.filter((x) => !extra.some((e) => e.key === x.key))]);
    setPicked((s) => new Set([...s, ...extra.map((e) => e.key)]));
  };

  const run = async () => {
    const sel = pool.filter((p) => picked.has(p.key));
    if (!sel.length) return void toast.error("Selectați cel puțin un proiect de test.");
    setProgress(0);
    const out: TestRow[] = [];
    for (let i = 0; i < sel.length; i++) {
      const c = sel[i]!;
      const prev = rows.find((r) => r.key === c.key);
      const row: TestRow = { ...c, verdict: null, note: prev?.note ?? "" };
      try {
        let blob: Blob | undefined = c.file;
        if (!blob && c.zipPath) {
          const dl = await supabase.storage.from("gerbers").download(c.zipPath);
          if (dl.error) throw dl.error;
          blob = dl.data;
        }
        const layers = await loadGerberZip(blob!);
        row.layers = layers; row.base = runDrc(layers, c.variant, baseline); row.next = runDrc(layers, c.variant, candidate);
        // A verdict stays valid only if the candidate's result did not change since it was given.
        if (prev?.next && prev.verdict && prev.next.score === row.next.score && prev.next.wouldPass === row.next.wouldPass) row.verdict = prev.verdict;
      } catch (e) { row.error = (e as Error).message; }
      out.push(row);
      setProgress(Math.round(((i + 1) / sel.length) * 100));
    }
    setRows(out); setRanSig(testedSig); setProgress(null);
    toast.success(`Testul a rulat pe ${out.length} proiecte. Confirmați manual fiecare rezultat.`);
  };

  const setRow = (key: string, p: Partial<TestRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const ruleImpact = useMemo(() => {
    const m = new Map<string, { failBefore: number; failAfter: number }>();
    for (const r of rows) {
      for (const rr of r.next?.rules ?? []) {
        const b = r.base?.rules.find((x) => x.code === rr.code);
        const e = m.get(rr.code) ?? { failBefore: 0, failAfter: 0 };
        if (b && !b.passed) e.failBefore++;
        if (!rr.passed) e.failAfter++;
        m.set(rr.code, e);
      }
    }
    return [...m.entries()].filter(([, v]) => v.failBefore !== v.failAfter || v.failAfter > 0);
  }, [rows]);

  const valid = rows.filter((r) => !r.error);
  const stale = ranSig !== null && ranSig !== testedSig;
  const allConfirmed = valid.length > 0 && valid.every((r) => r.verdict);
  const wrong = valid.filter((r) => r.verdict === "wrong").length;
  const canActivate = !stale && ranSig !== null && allConfirmed && (wrong === 0 || note.trim().length >= 10);

  const persist = async (activated: boolean) => {
    const results = rows.map((r) => ({
      name: r.name, variant: r.variant, error: r.error ?? null, verdict: r.verdict, note: r.note,
      base: r.base ? { score: r.base.score, pass: r.base.wouldPass, blocking: r.base.blockingCount } : null,
      next: r.next ? { score: r.next.score, pass: r.next.wouldPass, blocking: r.next.blockingCount } : null,
    }));
    const { error } = await supabase.from("rule_test_runs").insert({
      series_id: seriesId, tested_by: userId, candidate: candidate as never, baseline: baseline as never, results: results as never,
      project_count: valid.length, confirmed_count: valid.filter((r) => r.verdict === "ok").length, rejected_count: wrong, activated, note: note || null,
    });
    if (error) throw error;
  };

  const activate = async () => {
    try { await persist(true); await onActivate(candidate); toast.success("Regulile testate au fost activate."); }
    catch (e) { toast.error((e as Error).message); }
  };
  const saveRun = async () => {
    try { await persist(false); toast.success("Rezultatul testului a fost salvat în istoric (regulile nu au fost activate)."); }
    catch (e) { toast.error((e as Error).message); }
  };

  const shown = pool.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" /> 1. Modificări de testat</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {!diff.length ? <p className="text-muted-foreground">Formularul este identic cu regulile active. Modificați valori în taburile anterioare (manual sau cu Asistentul AI), apoi testați aici.</p> : (
            <ul className="grid gap-1 font-mono text-xs sm:grid-cols-2">{diff.map((d) => <li key={d} className="rounded bg-muted px-2 py-1 text-foreground">{d}</li>)}</ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base">2. Alegeți proiectele de test ({picked.size} selectate)</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={loadPool}>Încarcă proiectele predate</Button>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
              <Upload className="mr-2 h-4 w-4" /> Adaugă ZIP-uri
              <input type="file" accept=".zip" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">Includeți atât proiecte despre care știți că sunt corecte, cât și proiecte cu defecte cunoscute — așa vedeți dacă regula le prinde pe cele greșite fără să le respingă pe cele bune.</p>
          {pool.length > 0 && (
            <>
              <div className="flex gap-2">
                <Input placeholder="Caută proiect…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
                <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(shown.map((p) => p.key)))}>Selectează tot</Button>
                <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>Golește</Button>
              </div>
              <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                    <input type="checkbox" checked={picked.has(p.key)} aria-label={`Selectează ${p.name}`}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.key); else n.delete(p.key); return n; })} />
                    <span className="truncate text-foreground">{p.name}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">{p.variant}</Badge>
                  </label>
                ))}
              </div>
            </>
          )}
          <Button onClick={run} disabled={progress !== null || !picked.size}><Play className="mr-2 h-4 w-4" /> Rulează testul automat</Button>
          {progress !== null && <Progress value={progress} />}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Rezultate automate și confirmare manuală</CardTitle>
            {stale && <p className="text-sm text-destructive">Ați modificat regulile după test — rulați testul din nou.</p>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="p-2">Proiect</th><th className="p-2">Acum</th><th className="p-2">Cu regulile noi</th><th className="p-2">Schimbări defecte</th><th className="p-2">Verificarea dvs.</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const a = issueKeys(r.base), b = issueKeys(r.next);
                    const changes = [...new Set([...a.keys(), ...b.keys()])].map((k) => [k, (b.get(k) ?? 0) - (a.get(k) ?? 0)] as const).filter(([, d]) => d);
                    const flipped = r.base && r.next && r.base.wouldPass !== r.next.wouldPass;
                    return (
                      <tr key={r.key} className={cn("border-t border-border align-top", flipped && "bg-warning/10")}>
                        <td className="p-2">
                          <div className="font-medium text-foreground">{r.name}</div>
                          {r.error ? <div className="text-xs text-destructive">{r.error}</div> : (
                            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setView(r)}><Eye className="mr-1 h-3 w-3" /> Vizualizează Gerber</Button>
                          )}
                        </td>
                        <td className="p-2 font-mono text-xs">{r.base && <Res r={r.base} />}</td>
                        <td className="p-2 font-mono text-xs">{r.next && <Res r={r.next} />}{flipped && <Badge variant="outline" className="mt-1 text-[10px]">verdict schimbat</Badge>}</td>
                        <td className="p-2 text-xs">
                          {!changes.length ? <span className="text-muted-foreground">fără</span> : changes.map(([k, d]) => (
                            <div key={k} className={d > 0 ? "text-destructive" : "text-success"}>{d > 0 ? "+" : ""}{d} {TITLES[k] ?? k}</div>
                          ))}
                        </td>
                        <td className="p-2">
                          {!r.error && (
                            <div className="space-y-1">
                              <div className="flex gap-1">
                                <Button size="sm" variant={r.verdict === "ok" ? "default" : "outline"} className={cn(r.verdict === "ok" && "bg-success text-success-foreground hover:bg-success/90")} onClick={() => setRow(r.key, { verdict: "ok" })}><CheckCircle2 className="mr-1 h-3 w-3" /> Corect</Button>
                                <Button size="sm" variant={r.verdict === "wrong" ? "destructive" : "outline"} onClick={() => setRow(r.key, { verdict: "wrong" })}><XCircle className="mr-1 h-3 w-3" /> Greșit</Button>
                              </div>
                              <Input placeholder="Observație (opțional)" value={r.note} onChange={(e) => setRow(r.key, { note: e.target.value })} className="h-7 text-xs" />
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {ruleImpact.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">Impact pe fiecare regulă (proiecte care o încalcă)</h3>
                <div className="grid gap-1 text-xs sm:grid-cols-2">
                  {ruleImpact.map(([code, v]) => (
                    <div key={code} className="flex justify-between rounded border border-border px-2 py-1">
                      <span className="text-foreground">{TITLES[code] ?? code}</span>
                      <span className="font-mono">{v.failBefore} → <span className={v.failAfter > v.failBefore ? "text-destructive" : v.failAfter < v.failBefore ? "text-success" : ""}>{v.failAfter}</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> 4. Confirmare și activare</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Confirmate: {valid.filter((r) => r.verdict === "ok").length} · Greșite: {wrong} · Neverificate: {valid.filter((r) => !r.verdict).length} din {valid.length}
            </p>
            {wrong > 0 && <p className="text-warning">Ați marcat rezultate greșite. Corectați regulile și rulați din nou, sau justificați activarea (minim 10 caractere).</p>}
            <Textarea placeholder="Justificare / observații pentru istoric" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={activate} disabled={!canActivate}><ShieldCheck className="mr-2 h-4 w-4" /> Activează regulile testate</Button>
              <Button variant="outline" onClick={saveRun} disabled={ranSig === null}>Salvează doar rezultatul testului</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          <DialogHeader><DialogTitle>{view?.name} — rezultat cu regulile noi</DialogTitle></DialogHeader>
          {view?.next && <DrcReportView report={view.next} layers={view.layers ?? null} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Res({ r }: { r: DrcReport }) {
  return (
    <div>
      <div className={r.score >= 80 ? "text-success" : r.score >= 50 ? "text-warning" : "text-destructive"}>{r.score}/100</div>
      <div className="text-muted-foreground">{r.blockingCount} blocante · {r.manualReview ? "manual" : r.wouldPass ? "trece" : "respins"}</div>
    </div>
  );
}
