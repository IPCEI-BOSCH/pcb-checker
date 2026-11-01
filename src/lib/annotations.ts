import { supabase } from "@/integrations/supabase/client";

export interface Annotation {
  id: string;
  student_id: string;
  submission_id: string | null;
  x: number;
  y: number;
  note: string;
  created_by: string;
  created_at: string;
}

export async function fetchAnnotations(studentId: string): Promise<Annotation[]> {
  const { data, error } = await supabase.from("review_annotations").select("*").eq("student_id", studentId).order("created_at");
  if (error) throw error;
  return (data ?? []) as Annotation[];
}

export async function addAnnotation(a: { student_id: string; submission_id: string | null; x: number; y: number; note: string; created_by: string }) {
  const { error } = await supabase.from("review_annotations").insert(a);
  if (error) throw error;
}

export async function deleteAnnotation(id: string) {
  const { error } = await supabase.from("review_annotations").delete().eq("id", id);
  if (error) throw error;
}
