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
  const { data, error } = await supabase.from("students").select("*, groups(name, series(name))").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function logAudit(actorId: string, action: string, target_entity: string, target_id: string | null, details: Record<string, unknown> = {}) {
  await supabase.from("audit_log").insert({ actor_id: actorId, action, target_entity, target_id, details: details as never });
}
