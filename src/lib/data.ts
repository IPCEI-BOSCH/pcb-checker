import { supabase } from "@/integrations/supabase/client";

export async function fetchStructure() {
  const [years, series, groups, sm, gi] = await Promise.all([
    supabase.from("academic_years").select("*").order("name", { ascending: false }),
    supabase.from("series").select("*").order("name"),
    supabase.from("groups").select("*").order("name"),
    supabase.from("series_managers").select("*"),
    supabase.from("group_instructors").select("*"),
  ]);
  for (const r of [years, series, groups, sm, gi]) if (r.error) throw r.error;
  return { years: years.data!, series: series.data!, groups: groups.data!, managers: sm.data!, instructors: gi.data! };
}

export async function fetchMyStudent(userId: string) {
  const { data, error } = await supabase.from("students").select("*, groups(name, series_id, exam_mode, series(name))").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function logAudit(actorId: string, action: string, target_entity: string, target_id: string | null, details: Record<string, unknown> = {}) {
  await supabase.from("audit_log").insert({ actor_id: actorId, action, target_entity, target_id, details: details as never });
}

type YearLite = { id: string; name: string };
type SeriesLite = { id: string; name: string; academic_year_id: string };
/** "Seria B · 2024-2025" — series names repeat every year, so always show the year. */
export function seriesLabel(s: SeriesLite, years: YearLite[] | undefined) {
  const y = years?.find((x) => x.id === s.academic_year_id)?.name;
  return y ? `Seria ${s.name} · ${y}` : `Seria ${s.name}`;
}
/** Series sorted newest year first, then by name. */
export function sortSeriesByYear<T extends SeriesLite>(series: T[], years: YearLite[] | undefined) {
  const rank = new Map((years ?? []).map((y, i) => [y.id, i]));
  return [...series].sort((a, b) => (rank.get(a.academic_year_id) ?? 99) - (rank.get(b.academic_year_id) ?? 99) || a.name.localeCompare(b.name));
}
