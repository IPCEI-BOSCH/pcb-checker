import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/data";

type Log = (m: string) => void;
const chunk = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Deletes students with all their submissions, slots, folder files and stored files. */
export async function deleteStudents(ids: string[], log: Log = () => {}) {
  for (const part of chunk(ids)) {
    const [sl, su, pf] = await Promise.all([
      supabase.from("student_fabrication_slots").select("storage_path").in("student_id", part),
      supabase.from("submissions").select("zip_path").in("student_id", part),
      supabase.from("project_files").select("file_path").in("student_id", part),
    ]);
    const paths = [
      ...(sl.data ?? []).map((x) => x.storage_path),
      ...(su.data ?? []).map((x) => x.zip_path),
      ...(pf.data ?? []).map((x) => x.file_path),
    ].filter((x): x is string => !!x);
    // Demo/import folders may hold extra files (Layout.zip) — include the whole folder of each slot.
    const folders = [...new Set(paths.map((p) => p.split("/").slice(0, -1).join("/")).filter((f) => part.some((id) => f.endsWith(id))))];
    for (const f of folders) {
      const { data } = await supabase.storage.from("gerbers").list(f);
      for (const x of data ?? []) paths.push(`${f}/${x.name}`);
    }
    const uniq = [...new Set(paths)];
    for (const p of chunk(uniq, 500)) await supabase.storage.from("gerbers").remove(p);
    log(`Se șterg ${part.length} proiecte…`);
    await supabase.from("submissions").delete().in("student_id", part);
    await supabase.from("project_files").delete().in("student_id", part);
    await supabase.from("student_fabrication_slots").delete().in("student_id", part);
    const r = await supabase.from("students").delete().in("id", part);
    if (r.error) throw r.error;
  }
}

async function groupIdsOf(seriesId: string) {
  return ((await supabase.from("groups").select("id").eq("series_id", seriesId)).data ?? []).map((g) => g.id);
}

/** Removes every project in a series but keeps the series and its groups. */
export async function emptySeries(seriesId: string, log: Log = () => {}) {
  const gids = await groupIdsOf(seriesId);
  if (!gids.length) return 0;
  const ids = ((await supabase.from("students").select("id").in("group_id", gids)).data ?? []).map((x) => x.id);
  await deleteStudents(ids, log);
  return ids.length;
}

export async function deleteSeries(seriesId: string, log: Log = () => {}) {
  await emptySeries(seriesId, log);
  for (const g of await groupIdsOf(seriesId)) {
    await supabase.from("group_instructors").delete().eq("group_id", g);
    await supabase.from("groups").delete().eq("id", g);
  }
  await supabase.from("cam_panels").delete().eq("series_id", seriesId);
  await supabase.from("drc_settings").delete().eq("series_id", seriesId);
  await supabase.from("sheet_links").delete().eq("series_id", seriesId);
  await supabase.from("series_managers").delete().eq("series_id", seriesId);
  const r = await supabase.from("series").delete().eq("id", seriesId);
  if (r.error) throw r.error;
}

export async function deleteYear(yearId: string, log: Log = () => {}) {
  const series = (await supabase.from("series").select("id, name").eq("academic_year_id", yearId)).data ?? [];
  for (const s of series) { log(`Seria ${s.name}…`); await deleteSeries(s.id, log); }
  const r = await supabase.from("academic_years").delete().eq("id", yearId);
  if (r.error) throw r.error;
}

export async function setArchived(ids: string[], archived: boolean, userId: string) {
  const r = await supabase.from("students").update({ status: archived ? "archived" : "approved" }).in("id", ids);
  if (r.error) throw r.error;
  await logAudit(userId, archived ? "PROJECT_ARCHIVE" : "PROJECT_UNARCHIVE", "student", ids.length === 1 ? ids[0]! : null, { count: ids.length });
}
