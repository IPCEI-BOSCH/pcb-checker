import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MessageSquareWarning, ReceiptText, Send, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchMyStudent } from "@/lib/data";
import { fetchSettings } from "@/lib/drc/settings";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, type DrcReport } from "@/lib/drc/engine";
import type { Layer } from "@/lib/gerber/types";
import { DrcReportView } from "@/components/DrcReportView";
import { OrcadExportGuide } from "@/components/OrcadExportGuide";
import { fetchDeadline, deadlineState } from "@/lib/deadlines";
import { printSubmissionReceipt, sha256Hex } from "@/lib/receipt";
import { fetchAnnotations } from "@/lib/annotations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/self-check")({
  head: () => ({
    meta: [
      { title: "Self-Check & Predare — PCB Checker UPB" },
      { name: "description", content: "Verificare DRC nelimitată a arhivei Gerber și predare oficială a proiectului PCB." },
      { property: "og:title", content: "Self-Check & Predare — PCB Checker UPB" },
      { property: "og:description", content: "Verificare DRC nelimitată și predare oficială." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SelfCheck,
});

type Current = { report: DrcReport; layers: Layer[] | null; submissionId: string; zipPath: string | null; fileName: string | null };

function SelfCheck() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [contest, setContest] = useState<{ submissionId: string } | null>(null);
  const [contestMsg, setContestMsg] = useState("");

  const student = useQuery({ queryKey: ["my-student", user.id], queryFn: () => fetchMyStudent(user.id) });
  const history = useQuery({
    queryKey: ["my-subs-all", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("submissions").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (student.isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (!student.data) {
    return (
      <Card className="max-w-xl">
        <CardHeader><CardTitle>Înscrie-te mai întâi</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Pentru a rula self-check trebuie să fii asociat unei grupe.</p>
          <Button asChild><Link to="/enroll">Înscriere în grupă</Link></Button>
        </CardContent>
      </Card>
    );
  }
  const st = student.data;
  const pins = useQuery({ queryKey: ["my-annotations", st.id], queryFn: () => fetchAnnotations(st.id) });

  const run = async (file: File) => {
    if (!/\.zip$/i.test(file.name)) return void toast.error("Încarcă o arhivă .zip cu fișierele Gerber și Excellon.");
    lastFile.current = file;
    try {
      setBusy("Se parsează straturile…");
      const layers = await loadGerberZip(file);
      if (!layers.length) throw new Error("Arhiva nu conține fișiere Gerber/Excellon recunoscute.");
      setBusy("Se rulează DRC…");
      const settings = await fetchSettings(st.groups?.series_id ?? null);
      const report = runDrc(layers, st.variant, settings);
      setBusy("Se salvează revizia…");
      const path = `${user.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const up = await supabase.storage.from("gerbers").upload(path, file, { contentType: "application/zip" });
      if (up.error) throw up.error;
      const revision = (history.data?.filter((h) => h.kind === "SELF_CHECK").length ?? 0) + 1;
      const { data, error } = await supabase
        .from("submissions")
        .insert({
          student_id: st.id,
          user_id: user.id,
          kind: "SELF_CHECK",
          revision,
          zip_path: path,
          file_name: file.name,
          variant: st.variant,
          drc_score: report.score,
          blocking_count: report.blockingCount,
          report: report as never,
        })
        .select("id")
        .single();
      if (error) throw error;
      setCurrent({ report, layers, submissionId: data.id, zipPath: path, fileName: file.name });
      qc.invalidateQueries({ queryKey: ["my-subs-all"] });
      qc.invalidateQueries({ queryKey: ["my-subs"] });
      toast.success(`Rev.${revision}: scor ${report.score}/100`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openPast = async (s: NonNullable<typeof history.data>[number]) => {
    setBusy("Se încarcă revizia…");
    try {
      let layers: Layer[] | null = null;
      if (s.zip_path) {
        const dl = await supabase.storage.from("gerbers").download(s.zip_path);
        if (!dl.error) layers = await loadGerberZip(dl.data);
      }
      setCurrent({ report: s.report as unknown as DrcReport, layers, submissionId: s.id, zipPath: s.zip_path, fileName: s.file_name });
    } finally {
      setBusy(null);
    }
  };

  const submitOfficial = async () => {
    if (!current) return;
    setBusy("Se verifică termenul-limită…");
    // Deadline enforcement: hard deadline blocks the button, soft deadline records lateness.
    const dl = await fetchDeadline(st.groups?.series_id ?? null, st.group_id);
    const ds = deadlineState(dl, st.deadline_extension_until);
    if (ds.phase === "closed") {
      setBusy(null);
      return void toast.error(`Termenul dur de predare a expirat${ds.hard ? ` (${ds.hard.toLocaleString("ro-RO")})` : ""}. Doar profesorul îți poate acorda o derogare individuală.`);
    }
    setBusy("Se semnează criptografic predarea…");
    const zipHash = lastFile.current ? await sha256Hex(lastFile.current) : null;
    const reportHash = await sha256Hex(JSON.stringify(current.report));
    setBusy("Se trimite predarea oficială…");
    const revision = (history.data?.filter((h) => h.kind === "OFFICIAL").length ?? 0) + 1;
    const { data: inserted, error } = await supabase.from("submissions").insert({
      student_id: st.id,
      user_id: user.id,
      kind: "OFFICIAL",
      revision,
      zip_path: current.zipPath,
      file_name: current.fileName,
      variant: st.variant,
      drc_score: current.report.score,
      blocking_count: current.report.blockingCount,
      report: current.report as never,
      zip_sha256: zipHash,
      report_sha256: reportHash,
      late_days: ds.lateDays || null,
    }).select("id").single();
    setBusy(null);
    if (error) return void toast.error(error.message);
    if (ds.phase === "late") toast.warning(`Predare cu ${ds.lateDays} ${ds.lateDays === 1 ? "zi" : "zile"} întârziere${ds.penalty ? ` — penalizare ${ds.penalty} puncte` : ""}.`);
    // Background integrity check (results visible to staff only).
    if (inserted && current.layers) {
      const layers = current.layers;
      void (async () => {
        try {
          const [{ fingerprint }, { checkSubmissionIntegrity }] = await Promise.all([import("@/lib/integrity/fingerprint"), import("@/lib/integrity/integrity.functions")]);
          await checkSubmissionIntegrity({ data: { submissionId: inserted.id, fingerprint: fingerprint(layers) } });
        } catch (e) { console.warn("integrity check skipped", e); }
      })();
    }
    toast.success(`Predare oficială v${revision} înregistrată.`);
    qc.invalidateQueries({ queryKey: ["my-subs-all"] });
  };

  const selfChecks = history.data?.filter((h) => h.kind === "SELF_CHECK") ?? [];
  const officials = history.data?.filter((h) => h.kind === "OFFICIAL") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Self-Check & Predare</h1>
          <p className="text-sm text-muted-foreground">
            {st.groups?.series?.name} · {st.groups?.name} · Varianta {st.variant === "SMT" ? "a (SMT)" : "b (THT)"} — verificările self-check nu afectează nota.
          </p>
        </div>
        {current && (
          <Button onClick={submitOfficial} disabled={!!busy || current.report.blockingCount > 0} title={current.report.blockingCount ? "Remediază erorile blocante pentru a preda" : ""}>
            <Send className="mr-2 h-4 w-4" /> Trimite pentru evaluare finală
          </Button>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) run(f); }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${drag ? "border-primary bg-accent" : "border-border bg-card"}`}
      >
        <Upload className="h-8 w-8 text-primary" />
        <p className="mt-3 font-medium text-card-foreground">{busy ?? "Trage aici arhiva ZIP cu Gerber + Excellon"}</p>
        <p className="mt-1 text-xs text-muted-foreground">Cupru, mască, serigrafie, pastă, contur și un singur fișier DRL.</p>
        <Button className="mt-4" variant="secondary" disabled={!!busy} onClick={() => inputRef.current?.click()}>Alege fișier</Button>
        <input ref={inputRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }} />
      </div>

      {current && current.report.blockingCount > 0 && (
        <p className="text-sm text-destructive">Predarea oficială devine disponibilă după eliminarea tuturor erorilor blocante.</p>
      )}

      {current && <OrcadExportGuide codes={[...new Set([...current.report.issues.map((i) => i.code), ...current.report.rules.filter((r) => !r.passed).map((r) => r.code)])]} />}

      {!!pins.data?.length && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Observații de la profesor pe placă ({pins.data.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {pins.data.map((p, i) => (
              <button key={p.id} onClick={() => setFocusPoint({ x: Number(p.x), y: Number(p.y) })} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-warning font-mono text-[11px] font-bold text-black" style={{ transform: "rotate(45deg)" }}><span style={{ transform: "rotate(-45deg)" }}>{i + 1}</span></span>
                <span className="min-w-0 flex-1 truncate">{p.note}</span>
                <span className="font-mono text-xs text-muted-foreground">({Number(p.x).toFixed(1)}, {Number(p.y).toFixed(1)}) mm</span>
              </button>
            ))}
            <p className="text-xs text-muted-foreground">Click pe o observație → vizualizatorul face zoom direct pe coordonata indicată.</p>
          </CardContent>
        </Card>
      )}

      {current && <DrcReportView report={current.report} layers={current.layers} meta={{ student: st.file_prefix ?? st.email ?? undefined, group: st.groups?.name ?? undefined, series: st.groups?.series?.name ?? undefined, archive: current.fileName ?? undefined }} pins={(pins.data ?? []).map((p, i) => ({ x: Number(p.x), y: Number(p.y), label: String(i + 1), title: p.note }))} focusPoint={focusPoint} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Istoric self-check ({selfChecks.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {!selfChecks.length && <p className="text-sm text-muted-foreground">Nicio verificare încă.</p>}
            {selfChecks.length > 1 && (
              <p className="font-mono text-xs text-muted-foreground">
                Evoluție: {[...selfChecks].reverse().map((s) => `Rev.${s.revision}: ${Number(s.drc_score)}p`).join(" → ")}
              </p>
            )}
            {selfChecks.map((s) => (
              <button key={s.id} onClick={() => openPast(s)} className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent">
                <span className="truncate"><span className="font-mono">Rev.{s.revision}</span> · <span className="text-muted-foreground">{s.file_name}</span></span>
                <span className="font-mono">{Number(s.drc_score)}/100{s.blocking_count ? <span className="ml-2 text-destructive">{s.blocking_count}✕</span> : null}</span>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Predări oficiale ({officials.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {!officials.length && <p className="text-sm text-muted-foreground">Nicio predare oficială.</p>}
            {officials.map((s) => {
              const rep = s.report as unknown as DrcReport | null;
              const verdict = rep?.verdict === "admis" ? "ADMIS" : rep?.verdict === "rezerve" ? "REZERVE" : rep?.verdict === "respins" ? "RESPINS" : rep?.wouldPass ? "ADMIS" : "RESPINS";
              return (
                <div key={s.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <button onClick={() => openPast(s)} className="flex w-full items-center justify-between text-left hover:underline">
                    <span className="font-mono">v{s.revision} · {new Date(s.created_at).toLocaleString("ro-RO")}</span>
                    <Badge variant={s.review_status === "approved" ? "default" : s.review_status === "rejected" ? "destructive" : "secondary"}>
                      {s.review_status === "approved" ? "Aprobat fabricație" : s.review_status === "rejected" ? "Respins" : "În evaluare"}
                    </Badge>
                  </button>
                  {s.late_days ? <div className="mt-1 text-xs text-warning">Predat cu {s.late_days} {s.late_days === 1 ? "zi" : "zile"} întârziere.</div> : null}
                  {s.review_reason && <div className="mt-1 text-xs text-muted-foreground">Motiv: {s.review_reason}</div>}
                  <div className="mt-1.5 flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => printSubmissionReceipt({ student: st.full_name, group: st.groups?.name ?? "", series: st.groups?.series?.name ?? "", subject: "P1 / P1-DCE", variant: s.variant, submittedAt: s.created_at, score: s.drc_score != null ? Number(s.drc_score) : null, verdict, zipSha256: s.zip_sha256, reportSha256: s.report_sha256, fileName: s.file_name, revision: s.revision, lateDays: s.late_days })}>
                      <ReceiptText className="mr-1 h-3.5 w-3.5" /> Recipisă SHA-256
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setContest({ submissionId: s.id }); setContestMsg(""); }}>
                      <MessageSquareWarning className="mr-1 h-3.5 w-3.5" /> Cere reevaluare
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
