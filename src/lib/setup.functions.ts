import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { allowedEmailDomains, deploymentMode, labInviteCode, platformServices, storageLayout } from "./platform.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
type Ctx = {
  supabase: {
    from: (t: string) => any;
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  userId: string;
};

const STAFF_DOMAINS = ["@upb.ro", "@cetti.ro"];

async function countAdmins(admin: Admin): Promise<number> {
  const { count, error } = await admin.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (error) return -1;
  return count ?? 0;
}

/** Public: does this server still need first-run setup? Returns only booleans, never data. */
export const setupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const mode = deploymentMode();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admins = await countAdmins(supabaseAdmin);
  return {
    mode,
    needsSetup: mode === "selfhost" && admins === 0,
    dbReachable: admins >= 0,
    labInviteRequired: !!labInviteCode(),
    allowedDomains: allowedEmailDomains(),
  };
});

/** Public pre-flight check for the setup wizard: table existence, storage, services. Booleans only. */
export const setupHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tables = [
    "profiles",
    "user_roles",
    "academic_years",
    "series",
    "groups",
    "students",
    "submissions",
    "project_files",
    "drc_reports",
    "drc_settings",
    "gradebook_columns",
    "layout_fingerprints",
    "layout_similarity_pairs",
    "integrity_alerts",
    "deadlines",
    "exam_tokens",
  ];
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  let dbOk = true;
  for (const t of tables) {
    const { error } = await supabaseAdmin.from(t).select("*", { count: "exact", head: true });
    if (error) {
      dbOk = false;
      checks.push({ name: `Tabel ${t}`, ok: false, detail: error.message });
    }
  }
  checks.unshift({
    name: "PostgreSQL + schemă aplicație",
    ok: dbOk,
    detail: dbOk ? `toate cele ${tables.length} tabele verificate există` : "lipsesc tabele — rulează selfhost/sql/schema.sql",
  });
  try {
    const { data, error } = await supabaseAdmin.storage.listBuckets();
    checks.push({
      name: "Stocare fișiere (volume local)",
      ok: !error,
      detail: error ? error.message : `${data?.length ?? 0} bucket-uri · ${storageLayout().root}`,
    });
  } catch (e) {
    checks.push({ name: "Stocare fișiere (volume local)", ok: false, detail: (e as Error).message });
  }
  const svc = platformServices();
  checks.push({ name: "Mod de execuție", ok: true, detail: svc.deployment === "selfhost" ? "server local (self-host)" : "Lovable Cloud" });
  return { checks, at: new Date().toISOString() };
});

/** Public: validate the lab invite code without revealing it. */
export const checkInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ code: z.string().max(128) }).parse(input))
  .handler(async ({ data }) => {
    const expected = labInviteCode();
    if (!expected) return { ok: true, required: false };
    return { ok: data.code.trim() === expected, required: true };
  });

/**
 * First-run bootstrap: creates the Super-Admin (admin role) account with local
 * email+password auth. Only works on a self-hosted server with zero admins.
 */
export const createFirstAdmin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        fullName: z.string().min(2).max(120),
        email: z.string().email().max(200),
        password: z.string().min(8).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (deploymentMode() !== "selfhost") throw new Error("Disponibil doar pe serverul local (self-host).");
    const email = data.email.trim().toLowerCase();
    if (!STAFF_DOMAINS.some((d) => email.endsWith(d))) {
      throw new Error("Contul de administrator trebuie să fie pe domeniul @upb.ro sau @cetti.ro.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if ((await countAdmins(supabaseAdmin)) !== 0) throw new Error("Există deja un administrator. Autentifică-te normal.");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    const uid = created.user.id;
    await supabaseAdmin.from("profiles").upsert({ id: uid, email, full_name: data.fullName });
    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    if (roleErr) throw new Error(roleErr.message);
    await supabaseAdmin.from("audit_log").insert({ actor_id: uid, action: "first_admin_bootstrap", target_entity: "profiles", target_id: uid });
    return { ok: true };
  });

const SERIES: { name: string; groups: string[] }[] = [
  { name: "Seria A", groups: ["431A", "432A", "433A", "434A"] },
  { name: "Seria B", groups: ["431B", "432B", "433B", "434B"] },
  { name: "Seria C", groups: ["431C", "432C", "433C", "434C"] },
  { name: "Seria D", groups: ["431D", "432D", "433D", "434D"] },
];

/** Setup wizard step 3: create the standard UPB ETTI academic structure. Idempotent by name. */
export const seedUpbStructure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Doar administratorul poate inițializa structura.");
    const now = new Date();
    const yearName = now.getMonth() >= 8 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const { data: year } = await ctx.supabase.from("academic_years").upsert({ name: yearName }, { onConflict: "name" }).select("id").single();
    if (!year) throw new Error("Nu am putut crea anul universitar.");
    let created = 0;
    for (const s of SERIES) {
      const { data: existing } = await ctx.supabase
        .from("series")
        .select("id")
        .eq("academic_year_id", year.id)
        .eq("name", s.name)
        .maybeSingle();
      const seriesId =
        existing?.id ??
        (
          await ctx.supabase
            .from("series")
            .insert({ academic_year_id: year.id, name: s.name, default_variant: "SMT" })
            .select("id")
            .single()
        ).data?.id;
      if (!seriesId) continue;
      if (!existing) created++;
      for (const g of s.groups) {
        const { data: eg } = await ctx.supabase.from("groups").select("id").eq("series_id", seriesId).eq("name", g).maybeSingle();
        if (!eg) await ctx.supabase.from("groups").insert({ series_id: seriesId, name: g });
      }
    }
    await ctx.supabase.from("audit_log").insert({ actor_id: ctx.userId, action: "seed_upb_structure", details: { year: yearName } });
    return { ok: true, year: yearName, seriesCreated: created };
  });

/** Staff: reset a student's local password (offline lab, no SMTP). Audited. */
export const resetStudentPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studentId: z.string().uuid(), newPassword: z.string().min(8).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = context as unknown as Ctx;
    const roles = await Promise.all(
      (["admin", "series_manager", "instructor"] as const).map((r) => ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: r })),
    );
    if (!roles.some((r) => r.data)) throw new Error("Forbidden");
    const { data: student } = await ctx.supabase.from("students").select("user_id, full_name").eq("id", data.studentId).single();
    if (!student?.user_id) throw new Error("Studentul nu are cont de autentificare asociat.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(student.user_id, { password: data.newPassword });
    if (error) throw new Error(error.message);
    await ctx.supabase.from("audit_log").insert({
      actor_id: ctx.userId,
      action: "student_password_reset",
      target_entity: "students",
      target_id: data.studentId,
      details: { student: student.full_name },
    });
    return { ok: true };
  });
