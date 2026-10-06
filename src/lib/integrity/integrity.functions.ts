import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FP_VERSION, PAIR_VERSION, similarityDetail, type Fingerprint } from "@/lib/integrity/fingerprint";
import { adjustPair, seriesBaseline } from "@/lib/integrity/adjust";

const ALERT_TOTAL = 85;
const ALERT_ADJUSTED = 55;

/**
 * Called right after a student's official submission. Stores the layout fingerprint and compares it
 * with the same series (all years). Results go only to staff (alerts); the student gets just { ok }.
 */
export const checkSubmissionIntegrity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { submissionId: string; fingerprint: Fingerprint }) => {
    if (typeof i?.submissionId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.submissionId)) throw new Error("Predare invalidă");
    const f = i.fingerprint;
    if (!f || !Array.isArray(f.dist) || !Array.isArray(f.drill) || (f.padPts?.length ?? 0) > 2000) throw new Error("Amprentă invalidă");
    return i;
  })
  .handler(async ({ data, context }) => {
    // Caller must own the submission (read through RLS as the user).
    const { data: sub } = await context.supabase.from("submissions").select("id, student_id, user_id, kind").eq("id", data.submissionId).maybeSingle();
    if (!sub || sub.kind !== "OFFICIAL") throw new Error("Predare inexistentă");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: me } = await db.from("students").select("id, user_id, group_id, groups(series_id, series(name))").eq("id", sub.student_id).single();
    if (!me || (me.user_id !== context.userId && sub.user_id !== context.userId)) throw new Error("Forbidden");
    const fp: Fingerprint = { ...data.fingerprint, v: FP_VERSION };
    await db.from("layout_fingerprints").upsert({ submission_id: sub.id, student_id: me.id, version: FP_VERSION, data: fp as never });

    const seriesName = (me.groups as unknown as { series: { name: string } }).series.name;
    const mySeries = (me.groups as unknown as { series_id: string }).series_id;
    const { data: series } = await db.from("series").select("id").eq("name", seriesName);
    const { data: groups } = await db.from("groups").select("id, series_id").in("series_id", (series ?? []).map((s) => s.id));
    const gSeries = new Map((groups ?? []).map((g) => [g.id, g.series_id]));
    const { data: students } = await db.from("students").select("id, group_id").in("group_id", [...gSeries.keys()]);
    const sSeries = new Map((students ?? []).map((s) => [s.id, gSeries.get(s.group_id)!]));
    const others = (students ?? []).map((s) => s.id).filter((id) => id !== me.id);
    if (!others.length) return { ok: true };
    const latest = new Map<string, string>();
    for (let i = 0; i < others.length; i += 200) {
      const { data: subs } = await db.from("submissions").select("id, student_id, created_at").eq("kind", "OFFICIAL").in("student_id", others.slice(i, i + 200)).order("created_at", { ascending: false });
      for (const s of subs ?? []) if (!latest.has(s.student_id)) latest.set(s.student_id, s.id);
    }
    const fps = new Map<string, { sub: string; fp: Fingerprint }>();
    const subIds = [...latest.values()];
    for (let i = 0; i < subIds.length; i += 200) {
      const { data: rows } = await db.from("layout_fingerprints").select("submission_id, student_id, data").eq("version", FP_VERSION).in("submission_id", subIds.slice(i, i + 200));
      for (const r of rows ?? []) fps.set(r.student_id, { sub: r.submission_id, fp: r.data as unknown as Fingerprint });
    }
    const results = [...fps].map(([sid, o]) => ({ sid, sub: o.sub, d: similarityDetail(fp, o.fp) }));
    if (!results.length) return { ok: true };

    // Persist pair scores (ordered by submission id).
    const pairRows = results.map((r) => {
      const [sa, sb, ta, tb] = sub.id < r.sub ? [sub.id, r.sub, me.id, r.sid] : [r.sub, sub.id, r.sid, me.id];
      return { submission_a: sa, submission_b: sb, student_a: ta, student_b: tb, version: PAIR_VERSION, total: r.d.total, detail: r.d as never };
    });
    await db.from("layout_similarity_pairs").upsert(pairRows);

    // Series-relative baseline from stored pairs of the current series.
    const seriesStudents = (students ?? []).filter((s) => sSeries.get(s.id) === mySeries).map((s) => s.id);
    const { data: stored } = await db.from("layout_similarity_pairs").select("student_a, student_b, total").eq("version", PAIR_VERSION).in("student_a", seriesStudents.slice(0, 300));
    const base = seriesBaseline((stored ?? []).map((p) => ({ a: p.student_a, b: p.student_b, total: Number(p.total) })));
    const { data: refs } = await db.from("integrity_references").select("student_id").in("student_id", [...sSeries.keys()]);
    const refSet = new Set((refs ?? []).map((r) => r.student_id));
    const myRef = Math.max(0, ...results.filter((r) => refSet.has(r.sid)).map((r) => r.d.total));
    const alerts = results
      .filter((r) => !refSet.has(r.sid) && !refSet.has(me.id))
      .map((r) => ({ r, adj: adjustPair({ a: me.id, b: r.sid, total: r.d.total }, base, (id) => (id === me.id ? myRef : myRef)) }))
      .filter(({ r, adj }) => r.d.total >= ALERT_TOTAL || adj.adjusted >= ALERT_ADJUSTED || !!r.d.partial)
      .map(({ r, adj }) => ({ submission_id: sub.id, student_id: me.id, other_student_id: r.sid, similarity: r.d.total, adjusted: adj.adjusted, detail: { ...r.d, ...adj } as never, status: "new" }));
    if (alerts.length) await db.from("integrity_alerts").upsert(alerts, { onConflict: "submission_id,other_student_id" });
    return { ok: true };
  });
