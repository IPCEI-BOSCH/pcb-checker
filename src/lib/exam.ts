import { supabase } from "@/integrations/supabase/client";

/** One-time exam access codes ("Air-Gapped Exam Mode"): staff generate per group, students redeem at official submission. */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1 — unambiguous when read aloud or printed

export function generateExamCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const chars: string[] = [];
  for (const b of bytes) {
    if (b < 248) chars.push(ALPHABET.charAt(b % ALPHABET.length)); // 248 = 8*31, unbiased
    if (chars.length === 12) break;
  }
  while (chars.length < 12) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0] ?? 255;
    if (b < 248) chars.push(ALPHABET.charAt(b % ALPHABET.length));
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

export interface ExamToken {
  id: string;
  group_id: string;
  code: string;
  label: string | null;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

export async function listExamTokens(groupId: string): Promise<ExamToken[]> {
  const { data, error } = await supabase.from("exam_tokens").select("*").eq("group_id", groupId).order("created_at", { ascending: false });
  if (error) throw error;
  return data as ExamToken[];
}

export async function createExamTokens(groupId: string, count: number, hoursValid: number, label: string): Promise<ExamToken[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Nu ești autentificat.");
  const rows = Array.from({ length: Math.max(1, Math.min(100, count)) }, () => ({
    group_id: groupId,
    code: generateExamCode(),
    label: label || null,
    expires_at: new Date(Date.now() + Math.max(1, hoursValid) * 3600_000).toISOString(),
    created_by: u.user.id,
  }));
  const { data, error } = await supabase.from("exam_tokens").insert(rows).select();
  if (error) throw error;
  return data as ExamToken[];
}

export async function deleteExamToken(id: string): Promise<void> {
  const { error } = await supabase.from("exam_tokens").delete().eq("id", id);
  if (error) throw error;
}

export async function setExamMode(groupId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from("groups").update({ exam_mode: on }).eq("id", groupId);
  if (error) throw error;
}

/** Student-side: redeems a one-time exam code before the official submission. Returns false when invalid/expired/used. */
export async function redeemExamToken(code: string, studentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("redeem_exam_token", { _code: code, _student: studentId });
  if (error) throw error;
  return !!data;
}
