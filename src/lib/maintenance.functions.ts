import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { googleConfigured, platformServices } from "./platform.server";

type Ctx = {
  supabase: {
    from: (t: string) => any;
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
    storage: { listBuckets: () => Promise<{ data: { name: string }[] | null; error: { message: string } | null }> };
  };
  userId: string;
};

const STAFF = ["admin", "series_manager", "instructor", "cam_tech"] as const;

async function requireStaff(ctx: Ctx) {
  const roles = await Promise.all(STAFF.map((r) => ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: r })));
  if (!roles.some((r) => r.data)) throw new Error("Forbidden");
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Maintenance panel healthcheck: database/RLS, storage buckets, Google connectors, AI endpoint, exam mode. */
export const platformHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireStaff(ctx);
    const checks: HealthCheck[] = [];

    try {
      const { error } = await ctx.supabase.from("profiles").select("id").limit(1);
      checks.push({ name: "Bază de date + RLS", ok: !error, detail: error ? error.message : "conectat, politicile RLS active" });
    } catch (e) {
      checks.push({ name: "Bază de date + RLS", ok: false, detail: (e as Error).message });
    }

    try {
      const { data, error } = await ctx.supabase.storage.listBuckets();
      checks.push({ name: "Storage (fișiere Gerber)", ok: !error, detail: error ? error.message : `${data?.length ?? 0} bucket-uri disponibile` });
    } catch (e) {
      checks.push({ name: "Storage (fișiere Gerber)", ok: false, detail: (e as Error).message });
    }

    const svc = platformServices();
    for (const s of ["drive", "sheets"] as const) {
      const ok = googleConfigured(s);
      checks.push({
        name: s === "drive" ? "Google Drive" : "Google Sheets",
        ok: ok || svc.examMode,
        detail: ok ? "configurat" : svc.examMode ? "dezactivat în modul examen — se sincronizează la reconectare" : "neconfigurat (opțional)",
      });
    }
    checks.push({
      name: "Endpoint AI",
      ok: svc.ai.configured || svc.examMode,
      detail: svc.ai.configured
        ? `${svc.ai.mode} · ${svc.ai.baseURL}`
        : svc.examMode
          ? "dezactivat în modul examen (sau conectați un server local Ollama/vLLM prin OPENAI_BASE_URL)"
          : "neconfigurat (opțional) — pentru rețeaua UPB setați OPENAI_BASE_URL către Ollama/vLLM local",
    });
    checks.push({
      name: "Mod examen air-gapped",
      ok: true,
      detail: svc.examMode ? "ACTIV — serviciile externe sunt ocolite grațios" : "inactiv (EXAM_MODE=1 pentru activare la self-hosting)",
    });

    return { checks, at: new Date().toISOString() };
  });

const csv = (rows: (string | number | null | undefined)[][]) =>
  rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");

/** One-click semester bundle: all official reports, gradebook, integrity matrix and audit for a series, as one ZIP. */
export const exportSemesterBundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { seriesId: string }) => {
    if (!i.seriesId) throw new Error("Serie lipsă");
    return { seriesId: i.seriesId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const [{ data: isAdmin }, { data: manages }] = await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("manages_series", { _uid: ctx.userId, _series: data.seriesId }),
    ]);
    if (!isAdmin && !manages) throw new Error("Forbidden");

    const { data: series } = await ctx.supabase.from("series").select("id, name").eq("id", data.seriesId).single();
    if (!series) throw new Error("Seria nu există.");
    const { data: groups } = await ctx.supabase.from("groups").select("id, name").eq("series_id", data.seriesId);
    const groupIds = (groups ?? []).map((g: { id: string }) => g.id);
    if (!groupIds.length) throw new Error("Seria nu are grupe.");
    const groupName = new Map((groups ?? []).map((g: { id: string; name: string }) => [g.id, g.name]));

    const { data: studentsRaw } = await ctx.supabase.from("students").select("*").in("group_id", groupIds);
    const students: any[] = studentsRaw ?? [];
    const studentIds = students.map((s) => s.id as string);
    if (!studentIds.length) throw new Error("Seria nu are studenți.");
    const studentById = new Map<string, any>(students.map((s) => [s.id as string, s]));

    const [subsRes, pairsRes, alertsRes, reviewsRes, auditRes, requestsRes, deadlinesRes] = await Promise.all([
      ctx.supabase.from("submissions").select("id, student_id, user_id, revision, kind, file_name, zip_path, variant, drc_score, blocking_count, review_status, review_reason, zip_sha256, report_sha256, late_days, created_at, report").in("student_id", studentIds).eq("kind", "OFFICIAL").order("created_at"),
      ctx.supabase.from("layout_similarity_pairs").select("*").in("student_a", studentIds),
      ctx.supabase.from("integrity_alerts").select("*").in("student_id", studentIds),
      ctx.supabase.from("integrity_reviews").select("*").in("student_a", studentIds),
      ctx.supabase.from("grade_audit_logs").select("*").in("student_id", studentIds).order("created_at"),
      ctx.supabase.from("review_requests").select("*").in("student_id", studentIds).order("created_at"),
      ctx.supabase.from("deadlines").select("*").eq("series_id", data.seriesId),
    ]);

    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");

    const officials: any[] = subsRes.data ?? [];
    zip.file(
      "manifest.json",
      JSON.stringify(
        {
          platforma: "PCB Checker & CAM — P1/P1-DCE, Fac. Electronică UPB",
          serie: series.name,
          generatLa: new Date().toISOString(),
          continut: {
            studenti: studentIds.length,
            predariOficiale: officials.length,
            perechiIntegritate: (pairsRes.data ?? []).length,
            alerteIntegritate: (alertsRes.data ?? []).length,
            intrariAuditNote: (auditRes.data ?? []).length,
          },
          nota: "Arhivele Gerber ZIP rămân în Storage; căile sunt în predari_oficiale.csv (coloana zip_path).",
        },
        null,
        2,
      ),
    );

    zip.file(
      "catalog_note.csv",
      csv([
        ["Student", "Grupă", "Email", "Variantă", "Notă schemă", "Notă documentație", "Notă finală", "Notă interviu", "Observații"],
        ...(students ?? []).map((s: any) => [s.full_name, groupName.get(s.group_id) ?? "", s.email, s.variant, s.grade_schema, s.grade_doc, s.grade_final, s.grade_interview, s.teacher_notes]),
      ]),
    );

    zip.file(
      "predari_oficiale.csv",
      csv([
        ["Student", "Grupă", "Revizie", "Fișier", "Scor DRC", "Erori blocante", "Status evaluare", "SHA-256 ZIP", "SHA-256 raport", "Zile întârziere", "Data predării", "zip_path"],
        ...officials.map((s: any) => {
          const st = studentById.get(s.student_id);
          return [st?.full_name ?? "", groupName.get(st?.group_id) ?? "", s.revision, s.file_name, s.drc_score, s.blocking_count, s.review_status, s.zip_sha256, s.report_sha256, s.late_days, s.created_at, s.zip_path];
        }),
      ]),
    );

    for (const s of officials as any[]) {
      const st = studentById.get(s.student_id);
      const dir = `rapoarte_drc/${safe(groupName.get(st?.group_id) ?? "fara_grupa")}/${safe(st?.full_name ?? s.student_id)}`;
      zip.file(`${dir}/raport_v${s.revision}.json`, JSON.stringify(s.report, null, 2));
    }

    zip.file("integritate/perechi_similitudine.json", JSON.stringify(pairsRes.data ?? [], null, 2));
    zip.file("integritate/alerte.json", JSON.stringify(alertsRes.data ?? [], null, 2));
    zip.file("integritate/revizuiri_profesor.json", JSON.stringify(reviewsRes.data ?? [], null, 2));
    zip.file("audit/istoric_note.json", JSON.stringify(auditRes.data ?? [], null, 2));
    zip.file("audit/cereri_reevaluare.json", JSON.stringify(requestsRes.data ?? [], null, 2));
    zip.file("termene.json", JSON.stringify(deadlinesRes.data ?? [], null, 2));

    const b64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
    return {
      dataUrl: `data:application/zip;base64,${b64}`,
      fileName: `arhiva_semestru_${safe(series.name)}_${new Date().toISOString().slice(0, 10)}.zip`,
      counts: { studenti: studentIds.length, predari: officials.length, perechi: (pairsRes.data ?? []).length },
    };
  });
