import { supabase } from "@/integrations/supabase/client";

export interface Deadline {
  id: string;
  series_id: string | null;
  group_id: string | null;
  soft_deadline: string | null;
  hard_deadline: string | null;
  late_penalty_per_day: number;
}

export type DeadlinePhase = "open" | "late" | "closed";

export interface DeadlineState {
  phase: DeadlinePhase;
  /** Whole days past the soft deadline (0 when on time). */
  lateDays: number;
  /** Points subtracted per the series/group rule (0 when no penalty applies). */
  penalty: number;
  soft: Date | null;
  hard: Date | null;
}

/** Group-level deadline overrides the series-level one. */
export async function fetchDeadline(seriesId: string | null, groupId: string | null): Promise<Deadline | null> {
  if (!seriesId && !groupId) return null;
  const { data, error } = await supabase.from("deadlines").select("*").or(
    [groupId ? `group_id.eq.${groupId}` : "", seriesId ? `and(series_id.eq.${seriesId},group_id.is.null)` : ""].filter(Boolean).join(","),
  );
  if (error) throw error;
  const rows = (data ?? []) as Deadline[];
  return rows.find((r) => r.group_id === groupId) ?? rows.find((r) => r.series_id === seriesId && !r.group_id) ?? null;
}

/** Effective deadline state for a submission at `at` (default now), with an optional per-student extension. */
export function deadlineState(dl: Deadline | null, extensionUntil: string | null | undefined, at: Date = new Date()): DeadlineState {
  if (!dl) return { phase: "open", lateDays: 0, penalty: 0, soft: null, hard: null };
  const soft = dl.soft_deadline ? new Date(dl.soft_deadline) : null;
  const hard0 = dl.hard_deadline ? new Date(dl.hard_deadline) : null;
  const ext = extensionUntil ? new Date(extensionUntil) : null;
  const hard = ext && (!hard0 || ext > hard0) ? ext : hard0;
  if (hard && at > hard) return { phase: "closed", lateDays: 0, penalty: 0, soft, hard };
  if (soft && at > soft) {
    const lateDays = Math.max(1, Math.ceil((at.getTime() - soft.getTime()) / 86_400_000));
    return { phase: "late", lateDays, penalty: Math.round(lateDays * Number(dl.late_penalty_per_day) * 100) / 100, soft, hard };
  }
  return { phase: "open", lateDays: 0, penalty: 0, soft, hard };
}

export async function saveDeadline(dl: Partial<Deadline> & { series_id: string | null; group_id: string | null }, userId: string) {
  const payload = {
    series_id: dl.series_id,
    group_id: dl.group_id,
    soft_deadline: dl.soft_deadline ?? null,
    hard_deadline: dl.hard_deadline ?? null,
    late_penalty_per_day: dl.late_penalty_per_day ?? 0,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const { error } = dl.id
    ? await supabase.from("deadlines").update(payload).eq("id", dl.id)
    : await supabase.from("deadlines").insert(payload);
  if (error) throw error;
}

export async function setExtension(studentId: string, until: string | null) {
  const { error } = await supabase.from("students").update({ deadline_extension_until: until }).eq("id", studentId);
  if (error) throw error;
}
