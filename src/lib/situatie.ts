import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc } from "@/lib/drc/engine";
import { fetchSettings } from "@/lib/drc/settings";

/** Column layout of the department's official sheet (P1DCE_studenti_MODEL, tab SITUATIE). */
export const SITUATIE_COLUMNS = [
  "Nr. Crt.", "Nume fişier", "Intră în FAB?", "Nume și Prenume Student", "Grupa", "Coordonat de", "Verificat de",
  "Tema", "N", "Simulare", "Proiectare", "Layout - Observații", "Layout - FIȘIERE REFĂCUTE", "Scor DRC", "Erori blocante",
] as const;

export interface SituatieRow {
  series: string;
  group: string;
  fileName: string | null;
  fullName: string;
  fab: "DA" | "NU" | "";
  coordinator: string;
  checkedBy: string;
  theme: string | null;
  n: number | null;
  simulation: number | null;
  design: number | null;
  notes: string | null;
  revisions: number;
  score: number | null;
  blocking: number | null;
}

/** Series header rows carry "SERIA X" in the first column, like the historical sheet. */
export function exportSituatie(rows: SituatieRow[], fileName: string) {
  const aoa: (string | number | null)[][] = [[...SITUATIE_COLUMNS]];
  const bySeries = new Map<string, SituatieRow[]>();
  for (const r of rows) bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), r]);
  for (const [series, list] of bySeries) {
    aoa.push([series.toUpperCase().startsWith("SERIA") ? series.toUpperCase() : `SERIA ${series.toUpperCase()}`]);
    list.sort((a, b) => a.group.localeCompare(b.group) || a.fullName.localeCompare(b.fullName)).forEach((r, i) => aoa.push([
      i + 1, r.fileName, r.fab, r.fullName, r.group, r.coordinator, r.checkedBy, r.theme, r.n, r.simulation, r.design,
      r.notes, r.revisions > 1 ? `DA (rev. ${r.revisions})` : "", r.score, r.blocking,
    ]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = SITUATIE_COLUMNS.map((c) => ({ wch: Math.max(10, c.length + 2) }));
  ws["!cols"][1] = { wch: 48 };
  ws["!cols"][3] = { wch: 30 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "SITUATIE");
  XLSX.writeFile(wb, fileName);
}

/** Builds SITUATIE rows for a set of groups from the database (latest OFFICIAL submission per student). */
export async function fetchSituatieRows(groupIds: string[]): Promise<SituatieRow[]> {
  if (!groupIds.length) return [];
  const [g, st, gi] = await Promise.all([
    supabase.from("groups").select("id, name, series(name)").in("id", groupIds),
    supabase.from("students").select("*").in("group_id", groupIds),
    supabase.from("group_instructors").select("group_id, user_id").in("group_id", groupIds),
  ]);
  if (g.error) throw g.error;
  if (st.error) throw st.error;
  const ids = st.data.map((s) => s.id);
  const subs = ids.length
    ? await supabase.from("submissions").select("student_id, kind, drc_score, blocking_count, review_status, reviewed_by, created_at").in("student_id", ids).eq("kind", "OFFICIAL").order("created_at", { ascending: false })
    : { data: [], error: null };
  if (subs.error) throw subs.error;
  const people = [...new Set([...(gi.data ?? []).map((x) => x.user_id), ...subs.data.map((s) => s.reviewed_by).filter(Boolean) as string[]])];
  const prof = people.length ? await supabase.from("profiles").select("id, full_name, email").in("id", people) : { data: [] };
  const nameOf = (id: string | null) => { const p = (prof.data ?? []).find((x) => x.id === id); return p ? p.full_name || p.email : ""; };
  const groups = new Map(g.data.map((x) => [x.id, x]));
  return st.data.map((s) => {
    const mine = subs.data.filter((x) => x.student_id === s.id);
    const last = mine[0];
    const grp = groups.get(s.group_id);
    return {
      series: (grp?.series as { name: string } | null)?.name ?? "",
      group: grp?.name ?? "",
      fileName: s.file_prefix,
      fullName: s.full_name,
      fab: last ? (last.review_status === "approved" ? "DA" : "NU") : "",
      coordinator: (gi.data ?? []).filter((x) => x.group_id === s.group_id).map((x) => nameOf(x.user_id)).filter(Boolean).join(", "),
      checkedBy: nameOf(last?.reviewed_by ?? null),
      theme: s.theme_name,
      n: s.theme_number,
      simulation: s.grade_schema,
      design: s.grade_doc,
      notes: s.teacher_notes,
      revisions: mine.length,
      score: last?.drc_score ?? null,
      blocking: last?.blocking_count ?? null,
    };
  });
}

export interface BatchTarget { submissionId: string; zipPath: string; variant: "SMT" | "THT"; seriesId: string | null; label: string }

/** Re-runs DRC on many official submissions with the right per-series settings. */
export async function runBatchDrc(targets: BatchTarget[], onProgress: (done: number, total: number, label: string) => void) {
  const cache = new Map<string, Awaited<ReturnType<typeof fetchSettings>>>();
  const errors: string[] = [];
  let done = 0;
  for (const t of targets) {
    onProgress(done, targets.length, t.label);
    try {
      const key = t.seriesId ?? "";
      if (!cache.has(key)) cache.set(key, await fetchSettings(t.seriesId));
      const dl = await supabase.storage.from("gerbers").download(t.zipPath);
      if (dl.error) throw dl.error;
      const report = runDrc(await loadGerberZip(dl.data), t.variant, cache.get(key)!);
      const { error } = await supabase.from("submissions").update({ report: report as never, drc_score: report.score, blocking_count: report.blockingCount }).eq("id", t.submissionId);
      if (error) throw error;
    } catch (e) {
      errors.push(`${t.label}: ${(e as Error).message}`);
    }
    done++;
  }
  onProgress(done, targets.length, "");
  return errors;
}
