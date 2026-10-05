import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

type Log = (m: string) => void;

/** Builds a downloadable year archive: all data rows as JSON plus every stored file (Gerber ZIPs, slots, folder files). */
export async function backupYear(yearId: string, yearName: string, log: Log = () => {}) {
  const zip = new JSZip();
  const series = (await supabase.from("series").select("*").eq("academic_year_id", yearId)).data ?? [];
  const sIds = series.map((s) => s.id);
  const groups = sIds.length ? (await supabase.from("groups").select("*").in("series_id", sIds)).data ?? [] : [];
  const gIds = groups.map((g) => g.id);
  const students = gIds.length ? (await supabase.from("students").select("*").in("group_id", gIds)).data ?? [] : [];
  const stIds = students.map((s) => s.id);
  const pick = async <T,>(fn: (ids: string[]) => PromiseLike<{ data: T[] | null }>) => {
    const out: T[] = [];
    for (let i = 0; i < stIds.length; i += 100) out.push(...((await fn(stIds.slice(i, i + 100))).data ?? []));
    return out;
  };
  const submissions = await pick((ids) => supabase.from("submissions").select("*").in("student_id", ids));
  const slots = await pick((ids) => supabase.from("student_fabrication_slots").select("*").in("student_id", ids));
  const files = await pick((ids) => supabase.from("project_files").select("*").in("student_id", ids));
  const data = { exportedAt: new Date().toISOString(), year: yearName, series, groups, students, submissions, slots, files };
  zip.file("date.json", JSON.stringify(data, null, 1));

  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const seriesOf = new Map(series.map((s) => [s.id, s.name]));
  const folderOf = new Map(students.map((s) => {
    const g = groupOf.get(s.group_id);
    const safe = (x: string) => x.replace(/[^\w.-]+/g, "_");
    return [s.id, `Seria_${safe(seriesOf.get(g?.series_id ?? "") ?? "")}/${safe(g?.name ?? "")}/${safe(s.file_prefix || s.full_name)}`];
  }));
  const paths: [string, string][] = [
    ...submissions.filter((x) => x.zip_path).map((x) => [x.zip_path!, `${folderOf.get(x.student_id)}/predari/rev${x.revision}_${x.file_name ?? "gerber.zip"}`] as [string, string]),
    ...slots.map((x) => [x.storage_path, `${folderOf.get(x.student_id)}/fabricatie/${x.file_name}`] as [string, string]),
    ...files.map((x) => [x.file_path, `${folderOf.get(x.student_id)}/${x.folder}/${x.file_name}`] as [string, string]),
  ];
  let fail = 0;
  for (let i = 0; i < paths.length; i++) {
    const [src, dst] = paths[i]!;
    log(`Se descarcă fișierele ${i + 1}/${paths.length}…`);
    const { data: blob, error } = await supabase.storage.from("gerbers").download(src);
    if (error || !blob) { fail++; continue; }
    zip.file(dst, blob);
  }
  log("Se creează arhiva…");
  const out = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(out);
  a.download = `Backup_PCB_${yearName.replace(/[^\w-]+/g, "_")}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return { students: students.length, files: paths.length - fail, fail };
}
