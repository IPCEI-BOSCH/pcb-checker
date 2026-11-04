import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc } from "@/lib/drc/engine";
import { fetchSettings } from "@/lib/drc/settings";
import { parseFolder } from "@/lib/demo";
import { loadSafeZip } from "@/lib/zipSecurity";

/** The 9 department fabrication files and their slot keys (BOT.art is accepted for BOTTOM). */
export const SLOT_OF: Record<string, string> = {
  BO: "BO",
  BOTTOM: "BOTTOM",
  BOT: "BOTTOM",
  DRILL: "DRILL",
  FAB: "FAB",
  SMBOT: "SMBOT",
  SMTOP: "SMTOP",
  SPTOP: "SPTOP",
  SSTOP: "SSTOP",
  TOP: "TOP",
};
export const SLOT_FILE: Record<string, string> = {
  BO: "BO.art",
  BOTTOM: "BOTTOM.art",
  DRILL: "DRILL.drl",
  FAB: "FAB.art",
  SMBOT: "SMBOT.art",
  SMTOP: "SMTOP.art",
  SPTOP: "SPTOP.art",
  SSTOP: "SSTOP.art",
  TOP: "TOP.art",
};
const REQUIRED = Object.keys(SLOT_FILE);

export interface DetectedProject {
  key: string;
  folder: string;
  include: boolean;
  series: string;
  group: string;
  fullName: string;
  theme: string;
  n: number | null;
  cad: string;
  variant: "SMT" | "THT";
  files: Map<string, JSZip.JSZipObject>;
  missing: string[];
}

const slotOf = (base: string) => SLOT_OF[base.replace(/\.[^.]+$/, "").toUpperCase()] ?? null;
const GROUP_RE = /^4\d{2}[A-Z]{1,2}$/i;

/**
 * Detects student projects in a ZIP. Accepted layouts (any depth):
 *  [Seria X]/[43XY]/P1_..._CAD/Layout/<9 files>  — department archive
 *  P1_..._CAD/Layout/<files>  or  P1_..._CAD/<files>  — loose folders
 * Series and group are inferred from parent folder names or from the project folder name.
 */
export async function scanZip(file: File | Blob): Promise<DetectedProject[]> {
  const zip = await loadSafeZip(file);
  const map = new Map<string, DetectedProject>();
  for (const e of Object.values(zip.files)) {
    if (e.dir || e.name.startsWith("__MACOSX")) continue;
    const parts = e.name.split("/").filter(Boolean);
    const base = parts[parts.length - 1]!;
    const slot = slotOf(base);
    if (!slot) continue;
    let dirs = parts.slice(0, -1);
    if (dirs.length && /^layout$/i.test(dirs[dirs.length - 1]!)) dirs = dirs.slice(0, -1);
    const folder = dirs[dirs.length - 1] ?? "Proiect";
    const key = dirs.join("/") || "root";
    let p = map.get(key);
    if (!p) {
      const meta = parseFolder(folder);
      const parentGroup = [...dirs].reverse().find((d) => GROUP_RE.test(d));
      const seriesDir = dirs.find((d) => /seria/i.test(d));
      const group = (
        parentGroup ?? (meta.group && GROUP_RE.test(meta.group) ? meta.group : "")
      ).toUpperCase();
      const series = seriesDir
        ? seriesDir.replace(/^seria[\s_-]*/i, "").trim()
        : group
          ? group.slice(3)
          : "";
      p = {
        key,
        folder,
        include: true,
        series,
        group,
        fullName: meta.fullName || folder,
        theme: meta.tema ?? "",
        n: meta.n,
        cad: meta.cad,
        variant: "SMT",
        files: new Map(),
        missing: [],
      };
      map.set(key, p);
    }
    if (!p.files.has(slot)) p.files.set(slot, e);
  }
  const list = [...map.values()];
  for (const p of list) {
    p.missing = REQUIRED.filter((k) => !p.files.has(k));
    // No paste layer usually means a THT project (no stencil).
    if (!p.files.has("SPTOP")) p.variant = "THT";
  }
  return list.sort(
    (a, b) => a.group.localeCompare(b.group) || a.fullName.localeCompare(b.fullName),
  );
}

export interface ImportTarget {
  yearId: string | null;
  newYearName?: string;
  seriesId: string | null; // existing series; null => create per detected series name
  autoApprove: boolean;
}

/**
 * Creates (or reuses) series/groups/students and stores the 9 slots + an OFFICIAL submission with DRC.
 * Re-importing the same folder name in the same group updates that student instead of duplicating it.
 */
export async function importProjects(
  userId: string,
  projects: DetectedProject[],
  target: ImportTarget,
  log: (m: string, done: number, total: number) => void,
) {
  const chosen = projects.filter((p) => p.include);
  let yearId = target.yearId;
  if (!yearId) {
    const r = await supabase
      .from("academic_years")
      .insert({ name: target.newYearName || "Arhivă importată", is_active: false })
      .select("id")
      .single();
    if (r.error) throw r.error;
    yearId = r.data.id;
  }
  const seriesIds = new Map<string, string>();
  const seriesFor = async (name: string) => {
    if (target.seriesId) return target.seriesId;
    const label = name || "Import";
    if (seriesIds.has(label)) return seriesIds.get(label)!;
    const ex = await supabase
      .from("series")
      .select("id")
      .eq("academic_year_id", yearId!)
      .eq("name", label)
      .maybeSingle();
    let id = ex.data?.id;
    if (!id) {
      const r = await supabase
        .from("series")
        .insert({ academic_year_id: yearId!, name: label })
        .select("id")
        .single();
      if (r.error) throw new Error(`Seria ${label}: ${r.error.message}`);
      id = r.data.id;
    }
    seriesIds.set(label, id);
    return id;
  };
  const groupIds = new Map<string, string>();
  const groupFor = async (seriesId: string, name: string) => {
    const label = name || "Fără grupă";
    const k = `${seriesId}|${label}`;
    if (groupIds.has(k)) return groupIds.get(k)!;
    const ex = await supabase
      .from("groups")
      .select("id")
      .eq("series_id", seriesId)
      .eq("name", label)
      .maybeSingle();
    let id = ex.data?.id;
    if (!id) {
      const r = await supabase
        .from("groups")
        .insert({ series_id: seriesId, name: label, open_enrollment: false })
        .select("id")
        .single();
      if (r.error) throw new Error(`Grupa ${label}: ${r.error.message}`);
      id = r.data.id;
    }
    groupIds.set(k, id);
    return id;
  };
  const settingsCache = new Map<string, Awaited<ReturnType<typeof fetchSettings>>>();
  const errors: string[] = [];
  let done = 0;
  for (const p of chosen) {
    log(p.folder, done, chosen.length);
    try {
      const sid = await seriesFor(p.series);
      const gid = await groupFor(sid, p.group);
      const ex = await supabase
        .from("students")
        .select("id")
        .eq("group_id", gid)
        .eq("file_prefix", p.folder)
        .maybeSingle();
      let studentId = ex.data?.id;
      const fields = {
        full_name: p.fullName,
        theme_name: p.theme || null,
        theme_number: p.n,
        variant: p.variant,
        file_prefix: p.folder,
      };
      if (studentId) await supabase.from("students").update(fields).eq("id", studentId);
      else {
        const r = await supabase
          .from("students")
          .insert({ ...fields, group_id: gid, status: "approved" })
          .select("id")
          .single();
        if (r.error) throw r.error;
        studentId = r.data.id;
      }
      const out = new JSZip();
      for (const [slot, entry] of p.files) {
        const blob = await entry.async("blob");
        const name = SLOT_FILE[slot]!;
        out.file(name, blob);
        const path = `${userId}/import/${studentId}/${name}`;
        const up = await supabase.storage
          .from("gerbers")
          .upload(path, blob, { upsert: true, contentType: "application/octet-stream" });
        if (up.error) throw up.error;
        const r = await supabase.from("student_fabrication_slots").upsert(
          {
            student_id: studentId,
            slot_key: slot,
            file_name: entry.name.split("/").pop()!,
            storage_path: path,
            size_bytes: blob.size,
            uploaded_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "student_id,slot_key" },
        );
        if (r.error) throw r.error;
      }
      const zblob = await out.generateAsync({ type: "blob" });
      const zpath = `${userId}/import/${studentId}/Layout-${Date.now()}.zip`;
      const zu = await supabase.storage.from("gerbers").upload(zpath, zblob, { upsert: true });
      if (zu.error) throw zu.error;
      if (!settingsCache.has(sid)) settingsCache.set(sid, await fetchSettings(sid));
      let score: number | null = null,
        blocking = 0,
        report: unknown = null;
      try {
        const r = runDrc(await loadGerberZip(zblob), p.variant, settingsCache.get(sid)!);
        score = r.score;
        blocking = r.blockingCount;
        report = r;
      } catch (e) {
        report = { error: (e as Error).message };
      }
      const prev = await supabase
        .from("submissions")
        .select("revision")
        .eq("student_id", studentId)
        .eq("kind", "OFFICIAL")
        .order("revision", { ascending: false })
        .limit(1);
      const sub = await supabase.from("submissions").insert({
        student_id: studentId,
        user_id: userId,
        kind: "OFFICIAL",
        zip_path: zpath,
        file_name: `${p.folder}.zip`,
        variant: p.variant,
        revision: (prev.data?.[0]?.revision ?? 0) + 1,
        drc_score: score,
        blocking_count: blocking,
        report: report as never,
        review_status:
          target.autoApprove && score !== null && blocking === 0 ? "approved" : "pending",
      });
      if (sub.error) throw sub.error;
    } catch (e) {
      errors.push(`${p.folder}: ${(e as Error).message}`);
    }
    done++;
  }
  log("", done, chosen.length);
  return { imported: chosen.length - errors.length, errors };
}
