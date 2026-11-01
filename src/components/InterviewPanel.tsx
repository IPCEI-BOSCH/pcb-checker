import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduationCap, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateInterviewQuestions, interviewGrade } from "@/lib/interview";
import type { DrcReport } from "@/lib/drc/engine";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Mark = 100 | 50 | 0;

/**
 * Oral lab-interview assistant: 3 deterministic questions from the student's real board geometry,
 * with expected answers visible to staff only, and quick grading that writes the interview grade
 * into the gradebook manual column with optimistic locking.
 */
export function InterviewPanel({ report, studentId, studentName, canGrade, onFocusPoint }: {
  report: DrcReport;
  studentId: string;
  studentName: string;
  canGrade: boolean;
  onFocusPoint?: (x: number, y: number) => void;
}) {
  const qc = useQueryClient();
  const questions = useMemo(() => generateInterviewQuestions(report), [report]);
  const [marks, setMarks] = useState<(Mark | null)[]>([null, null, null]);
  const [showAnswers, setShowAnswers] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = useQuery({
    queryKey: ["interview-grade", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("grade_interview").eq("id", studentId).single();
      if (error) throw error;
      return data.grade_interview != null ? Number(data.grade_interview) : null;
    },
  });

  const done = marks.every((m) => m !== null);
  const grade = done ? interviewGrade(marks as Mark[]) : null;

  const save = async () => {
    if (grade == null) return;
    setSaving(true);
    try {
      const prev = current.data ?? null;
      // Optimistic locking: the update only lands if the cell still holds the value we read.
      let q = supabase.from("students").update({ grade_interview: grade }).eq("id", studentId);
      q = prev == null ? q.is("grade_interview", null) : q.eq("grade_interview", prev);
      const { data, error } = await q.select("id");
      if (error) throw error;
      if (!data?.length) {
        toast.error("Alt coleg a modificat nota de interviu între timp — reîncarcă și reia.");
        qc.invalidateQueries({ queryKey: ["interview-grade", studentId] });
        return;
      }
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("grade_audit_logs").insert({ student_id: studentId, field: "grade_interview", old_value: prev == null ? null : String(prev), new_value: String(grade), changed_by: u.user!.id });
      qc.invalidateQueries({ queryKey: ["interview-grade", studentId] });
      qc.invalidateQueries({ queryKey: ["gradebook"] });
      toast.success(`Nota de interviu ${grade} salvată pentru ${studentName}.`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-5 w-5" /> Asistent Interviu Oral — 3 întrebări din proiectul curent</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAnswers((v) => !v)}>
            <Lock className="mr-1 h-3.5 w-3.5" /> {showAnswers ? "Ascunde răspunsurile" : "Arată răspunsurile (doar staff)"}
          </Button>
        </div>
        {current.data != null && <p className="text-xs text-muted-foreground">Nota de interviu existentă: <b>{current.data}</b> — o nouă salvare o suprascrie (cu protecție la editare simultană).</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-foreground">Î{i + 1}. {q.question}</p>
              {q.x != null && q.y != null && onFocusPoint && (
                <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-xs" onClick={() => onFocusPoint(q.x!, q.y!)}>Pe placă</Button>
              )}
            </div>
            {showAnswers && <p className="mt-1.5 rounded bg-muted p-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Răspuns așteptat: </span>{q.answer}</p>}
            {canGrade && (
              <div className="mt-2 flex gap-1.5">
                {([100, 50, 0] as Mark[]).map((m) => (
                  <Button key={m} size="sm" variant={marks[i] === m ? "default" : "outline"} className="h-7 text-xs" onClick={() => setMarks((ms) => ms.map((x, j) => (j === i ? m : x)))}>
                    {m === 100 ? "Corect 100%" : m === 50 ? "Parțial 50%" : "Greșit 0%"}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {canGrade && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <div className="text-sm">
              {grade != null ? <>Nota de interviu calculată: <Badge variant="secondary" className="font-mono text-sm">{grade}</Badge></> : <span className="text-muted-foreground">Marchează cele 3 răspunsuri pentru a calcula nota.</span>}
            </div>
            <Button onClick={save} disabled={grade == null || saving}>{saving ? "Se salvează…" : "Salvează în catalog"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
