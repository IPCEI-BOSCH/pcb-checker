import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc } from "@/lib/drc/engine";
import { fetchSettings } from "@/lib/drc/settings";

export const DEMO_YEAR = "2025-2026 (DEMO Seria B)";
const SLOT_FILES: Record<string, string> = {
  "BO.art": "BO", "BOTTOM.art": "BOTTOM", "DRILL.drl": "DRILL", "FAB.art": "FAB", "SMBOT.art": "SMBOT",
  "SMTOP.art": "SMTOP", "SPTOP.art": "SPTOP", "SSTOP.art": "SSTOP", "TOP.art": "TOP",
};

/** P1_2025_431B_Nume_Prenume_TEMA_N3_KICAD -> parts */
export function parseFolder(folder: string) {
  const p = folder.replace(/_Layout$/, "").split("_");
  const nIdx = p.findIndex((x, i) => i > 2 && /^N\d+$/i.test(x));
  const n = nIdx > 0 ? Number(p[nIdx].slice(1)) : null;
  const cad = nIdx > 0 ? p.slice(nIdx + 1).join("_") : "";
  const mid = p.slice(3, nIdx > 0 ? nIdx : undefined);
  const tema = mid.length > 2 ? mid[mid.length - 1] : "";
  const names = mid.length > 2 ? mid.slice(0, -1) : mid;
  return { group: p[2], fullName: names.join(" "), tema, n, cad };
}

export async function importDemo(userId: string, log: (m: string) => void) {
  const { data: existing } = await supabase.from("academic_years").select("id").eq("is_demo", true);
  if (existing?.length) throw new Error("Datele demo există deja. Ștergeți-le înainte de reimport.");
  log("Se descarcă arhiva demo…");
  const zip = await JSZip.loadAsync(await (await fetch("/demo/seria_b_2025.zip")).arrayBuffer());
  const projects = new Map<string, { group: string; folder: string; files: Map<string, JSZip.JSZipObject> }>();
  for (const e of Object.values(zip.files)) {
    if (e.dir) continue;
    const parts = e.name.split("/");
    const li = parts.lastIndexOf("Layout");
    if (li < 2) continue;
    const base = parts[parts.length - 1];
    if (!SLOT_FILES[base]) continue;
    const folder = parts[li - 1] === "Layout" ? parts[li - 2] : parts[li - 1];
    const group = parts[1];
    const p = projects.get(folder) ?? { group, folder, files: new Map() };
    p.files.set(base, e);
    projects.set(folder, p);
  }
  const yr = await supabase.from("academic_years").insert({ name: DEMO_YEAR, is_active: false, is_demo: true }).select("id").single();
  if (yr.error) throw yr.error;
  const se = await supabase.from("series").insert({ academic_year_id: yr.data.id, name: "B", is_archived: true }).select("id").single();
  if (se.error) throw se.error;
  const settings = await fetchSettings(se.data.id);
  const groupIds = new Map<string, string>();
  for (const g of [...new Set([...projects.values()].map((p) => p.group))].sort()) {
    const r = await supabase.from("groups").insert({ series_id: se.data.id, name: g, open_enrollment: false, is_archived: true }).select("id").single();
    if (r.error) throw r.error;
    groupIds.set(g, r.data.id);
  }
  let i = 0;
  for (const p of projects.values()) {
    i++;
    log(`(${i}/${projects.size}) ${p.folder}`);
    const meta = parseFolder(p.folder);
    const st = await supabase.from("students").insert({
      group_id: groupIds.get(p.group)!, full_name: meta.fullName || p.folder, file_prefix: p.folder,
      theme_name: meta.tema || null, theme_number: meta.n, variant: "SMT", status: "active",
    }).select("id").single();
    if (st.error) throw st.error;
    const out = new JSZip();
    for (const [base, entry] of p.files) {
      const blob = await entry.async("blob");
      out.file(base, blob);
      const path = `${userId}/demo/${st.data.id}/${base}`;
      const up = await supabase.storage.from("gerbers").upload(path, blob, { upsert: true, contentType: "application/octet-stream" });
      if (up.error) throw up.error;
      const r = await supabase.from("student_fabrication_slots").insert({ student_id: st.data.id, slot_key: SLOT_FILES[base], file_name: base, storage_path: path, size_bytes: blob.size, uploaded_by: userId });
      if (r.error) throw r.error;
    }
    const zblob = await out.generateAsync({ type: "blob" });
    const zpath = `${userId}/demo/${st.data.id}/Layout.zip`;
    await supabase.storage.from("gerbers").upload(zpath, zblob, { upsert: true });
    const report = runDrc(await loadGerberZip(zblob), "SMT", settings);
    const sub = await supabase.from("submissions").insert({
      student_id: st.data.id, user_id: userId, kind: "OFFICIAL", zip_path: zpath, file_name: "Layout.zip", variant: "SMT",
      drc_score: report.score, blocking_count: report.blockingCount, report: report as never,
      review_status: report.blockingCount === 0 ? "approved" : "pending",
    });
    if (sub.error) throw sub.error;
  }
  return projects.size;
}

export async function deleteDemo(userId: string, log: (m: string) => void) {
  const { data: years } = await supabase.from("academic_years").select("id").eq("is_demo", true);
  for (const y of years ?? []) {
    const { data: series } = await supabase.from("series").select("id").eq("academic_year_id", y.id);
    for (const s of series ?? []) {
      const { data: groups } = await supabase.from("groups").select("id").eq("series_id", s.id);
      for (const g of groups ?? []) {
        const { data: sts } = await supabase.from("students").select("id").eq("group_id", g.id);
        const ids = (sts ?? []).map((x) => x.id);
        if (ids.length) {
          log(`Grupa: ${ids.length} studenți…`);
          for (const id of ids) {
            const { data: files } = await supabase.storage.from("gerbers").list(`${userId}/demo/${id}`);
            if (files?.length) await supabase.storage.from("gerbers").remove(files.map((f) => `${userId}/demo/${id}/${f.name}`));
          }
          await supabase.from("submissions").delete().in("student_id", ids);
          await supabase.from("project_files").delete().in("student_id", ids);
          await supabase.from("student_fabrication_slots").delete().in("student_id", ids);
          const r = await supabase.from("students").delete().in("id", ids);
          if (r.error) throw r.error;
        }
        await supabase.from("group_instructors").delete().eq("group_id", g.id);
        await supabase.from("groups").delete().eq("id", g.id);
      }
      await supabase.from("cam_panels").delete().eq("series_id", s.id);
      await supabase.from("drc_settings").delete().eq("series_id", s.id);
      await supabase.from("sheet_links").delete().eq("series_id", s.id);
      await supabase.from("series_managers").delete().eq("series_id", s.id);
      const r = await supabase.from("series").delete().eq("id", s.id);
      if (r.error) throw r.error;
    }
    const r = await supabase.from("academic_years").delete().eq("id", y.id);
    if (r.error) throw r.error;
  }
}
