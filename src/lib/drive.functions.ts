import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { googleFetch, googleConfigured } from "./platform.server";

const FOLDER = "application/vnd.google-apps.folder";
export const ROOT_NAME = "PCB_DCE";

async function drive(path: string, init: RequestInit = {}) {
  const res = await googleFetch("drive", path, init);
  if (!res.ok) {
    const t = await res.text();
    console.error(`Drive [${res.status}] ${path}: ${t}`);
    throw new Error(`Google Drive [${res.status}]: ${t.slice(0, 300)}`);
  }
  return res;
}

const clean = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

async function ensureFolder(name: string, parent: string): Promise<string> {
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and mimeType='${FOLDER}' and trashed=false`;
  const r = (await (await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)).json()) as { files: { id: string }[] };
  if (r.files[0]) return r.files[0].id;
  const c = await drive(`/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
  });
  return ((await c.json()) as { id: string }).id;
}

async function uploadFile(name: string, parent: string, blob: Blob, existingId: string | null): Promise<string> {
  const boundary = "pcbdce" + Math.random().toString(36).slice(2);
  const meta = existingId ? { name } : { name, parents: [parent] };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const body = new Blob([head, await blob.arrayBuffer(), `\r\n--${boundary}--`]);
  const send = (method: string, url: string) =>
    drive(url, { method, headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  if (existingId) {
    try {
      const r = await send("PATCH", `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id`);
      return ((await r.json()) as { id: string }).id;
    } catch (e) {
      if (!String(e).includes("[404]")) throw e; // file removed in Drive -> recreate
      return uploadFile(name, parent, blob, null);
    }
  }
  // overwrite by name if a same-named file exists in the folder
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parent}' in parents and trashed=false`;
  const found = (await (await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return uploadFile(name, parent, blob, found.files[0].id);
  const r = await send("POST", `/upload/drive/v3/files?uploadType=multipart&fields=id`);
  return ((await r.json()) as { id: string }).id;
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Builds PCB_DCE/<An>/<Serie>/<Grupa>/P1_<an>_<grupa>_<Nume>_N<N>/{Layout,Proiect} once and caches ids on the student. */
async function ensureStudentTree(admin: Admin, studentId: string) {
  const { data: st, error } = await admin
    .from("students")
    .select("id, full_name, theme_number, theme_name, drive_folder_id, drive_layout_folder_id, drive_project_folder_id, groups(name, series(name, academic_years(name)))")
    .eq("id", studentId)
    .single();
  if (error || !st) throw new Error("Student inexistent.");
  if (st.drive_layout_folder_id && st.drive_project_folder_id) return st;
  const g = st.groups as unknown as { name: string; series: { name: string; academic_years: { name: string } | null } | null } | null;
  const year = g?.series?.academic_years?.name ?? "An";
  const root = await ensureFolder(ROOT_NAME, "root");
  const y = await ensureFolder(clean(year), root);
  const s = await ensureFolder(clean(g?.series?.name ?? "Serie"), y);
  const gr = await ensureFolder(clean(g?.name ?? "Grupa"), s);
  const yr = (year.match(/\d{4}/g) ?? [String(new Date().getFullYear())]).slice(-1)[0];
  const name = clean(`P1_${yr}_${g?.name ?? ""}_${st.full_name}${st.theme_name ? "_" + st.theme_name : ""}_N${st.theme_number ?? "x"}`);
  const folder = st.drive_folder_id ?? (await ensureFolder(name, gr));
  const layout = await ensureFolder("Layout", folder);
  const proiect = await ensureFolder("Proiect", folder);
  await admin.from("students").update({ drive_folder_id: folder, drive_layout_folder_id: layout, drive_project_folder_id: proiect }).eq("id", studentId);
  return { ...st, drive_folder_id: folder, drive_layout_folder_id: layout, drive_project_folder_id: proiect };
}

export const SLOT_FILES: Record<string, string> = {
  BO: "BO.art", BOTTOM: "BOTTOM.art", DRILL: "DRILL.drl", FAB: "FAB.art", SMBOT: "SMBOT.art",
  SMTOP: "SMTOP.art", SPTOP: "SPTOP.art", SSTOP: "SSTOP.art", TOP: "TOP.art",
};

/** Copies a just-uploaded slot / project file from storage to the student's Drive folder, overwriting the old one. */
export const syncToDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ kind: z.enum(["slot", "project"]), id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS read as the caller proves access; only the owner may push.
    const table = data.kind === "slot" ? "student_fabrication_slots" : "project_files";
    const { data: row, error } = await context.supabase.from(table).select("*").eq("id", data.id).maybeSingle();
    if (error || !row) throw new Error("Fișier inexistent sau fără acces.");
    const r = row as unknown as { student_id: string; storage_path?: string; file_path?: string; slot_key?: string; file_name?: string; drive_file_id: string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: owner } = await supabaseAdmin.from("students").select("user_id").eq("id", r.student_id!).single();
    if (owner?.user_id !== context.userId) {
      const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
      if (!staff) throw new Error("Doar studentul sau cadrele didactice pot sincroniza fișierele.");
    }
    const st = await ensureStudentTree(supabaseAdmin, r.student_id!);
    const path = (data.kind === "slot" ? r.storage_path : r.file_path)!;
    const dl = await supabaseAdmin.storage.from("gerbers").download(path);
    if (dl.error) throw new Error("Fișierul nu poate fi citit din stocare.");
    const name = data.kind === "slot" ? SLOT_FILES[r.slot_key!]! : r.file_name!;
    const parent = data.kind === "slot" ? st.drive_layout_folder_id! : st.drive_project_folder_id!;
    const id = await uploadFile(name, parent, dl.data, r.drive_file_id);
    await supabaseAdmin.from(table).update({ drive_file_id: id }).eq("id", data.id);
    return { driveFileId: id, folderId: st.drive_folder_id };
  });

/** Removes a project file from Drive (fabrication slots are only ever overwritten). */
export const deleteFromDrive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ driveFileId: z.string().min(5).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: own } = await context.supabase.from("project_files").select("id").eq("drive_file_id", data.driveFileId).eq("user_id", context.userId).maybeSingle();
    if (!own) throw new Error("Fără acces.");
    await drive(`/drive/v3/files/${data.driveFileId}`, { method: "DELETE" }).catch(() => null);
    return { ok: true };
  });

async function assertCam(context: { supabase: { rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }; userId: string }) {
  for (const role of ["admin", "series_manager", "cam_tech", "instructor"]) {
    const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: role });
    if (data) return;
  }
  throw new Error("Forbidden");
}

/** Lists what each student's Drive Layout folder contains, for a series or a set of groups. */
export const listDriveLayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ groupIds: z.array(z.string().uuid()).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCam(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: students, error } = await supabaseAdmin
      .from("students")
      .select("id, full_name, theme_number, variant, group_id, drive_folder_id, drive_layout_folder_id, groups(name)")
      .in("group_id", data.groupIds.length ? data.groupIds : ["00000000-0000-0000-0000-000000000000"]);
    if (error) throw error;
    const ids = students.map((s) => s.id);
    const { data: subs } = ids.length
      ? await supabaseAdmin.from("submissions").select("student_id, review_status, created_at").eq("kind", "OFFICIAL").in("student_id", ids).order("created_at", { ascending: false })
      : { data: [] };
    const out = [];
    for (const s of students) {
      let files: { id: string; name: string }[] = [];
      let folderName: string | null = null;
      if (s.drive_layout_folder_id) {
        const q = `'${s.drive_layout_folder_id}' in parents and trashed=false`;
        files = ((await (await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`)).json()) as { files: { id: string; name: string }[] }).files;
        const f = (await (await drive(`/drive/v3/files/${s.drive_folder_id}?fields=name`)).json()) as { name: string };
        folderName = f.name;
      }
      const missing = Object.values(SLOT_FILES).filter((n) => !files.some((f) => f.name.toUpperCase() === n.toUpperCase()));
      const review = subs?.find((x) => x.student_id === s.id)?.review_status ?? null;
      out.push({
        studentId: s.id, name: s.full_name, theme: s.theme_number, variant: s.variant,
        group: (s.groups as { name: string } | null)?.name ?? "", folderName, files, missing, review,
      });
    }
    return out;
  });

/** Downloads one student's Layout files from Drive (base64) for client-side panelization. */
export const fetchDriveLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ studentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCam(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin.from("students").select("drive_layout_folder_id").eq("id", data.studentId).single();
    if (!s?.drive_layout_folder_id) throw new Error("Studentul nu are folder în Drive.");
    const q = `'${s.drive_layout_folder_id}' in parents and trashed=false`;
    const list = ((await (await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`)).json()) as { files: { id: string; name: string }[] }).files;
    const files: { name: string; b64: string }[] = [];
    for (const f of list) {
      const buf = Buffer.from(await (await drive(`/drive/v3/files/${f.id}?alt=media`)).arrayBuffer());
      files.push({ name: f.name, b64: buf.toString("base64") });
    }
    return { files };
  });

export const driveStatus = createServerFn({ method: "GET" }).handler(async () => ({
  connected: googleConfigured("drive"),
}));

/** Live check of the Google connections (Drive ping + Sheets credentials). */
export const googleWorkspaceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const out = { drive: false, sheets: googleConfigured("sheets"), account: null as string | null, error: null as string | null };
    try {
      const r = (await (await drive(`/drive/v3/about?fields=user(emailAddress)`)).json()) as { user?: { emailAddress?: string } };
      out.drive = true;
      out.account = r.user?.emailAddress ?? null;
    } catch (e) {
      out.error = (e as Error).message.slice(0, 200);
    }
    return out;
  });

/** Creates (or reuses) the Drive folder tree for the given students; staff only. */
export const ensureDriveFolders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { studentIds: string[] }) => z.object({ studentIds: z.array(z.string().uuid()).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const done: { id: string; folderId: string | null }[] = [];
    const failed: string[] = [];
    for (const id of data.studentIds) {
      try {
        const st = await ensureStudentTree(supabaseAdmin, id);
        done.push({ id, folderId: st.drive_folder_id });
      } catch (e) {
        console.error("ensureDriveFolders", id, e);
        failed.push(id);
      }
    }
    return { done, failed };
  });
