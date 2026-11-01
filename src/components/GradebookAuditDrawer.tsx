import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { GradeRow } from "@/lib/gradebook";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const FIELD_LABEL: Record<string, string> = {
  grade_schema: "Notă schemă",
  grade_doc: "Notă documentație",
  grade_interview: "Notă interviu",
  grade_final: "Notă finală",
  teacher_notes: "Observații",
};

/** Audit drawer: who changed which grade cell, when, old → new. Visible to staff. */
export function GradebookAuditDrawer({ rows, open, onClose }: { rows: GradeRow[]; open: boolean; onClose: () => void }) {
  const byId = new Map(rows.map((r) => [r.studentId, r.fullName]));
  const q = useQuery({
    queryKey: ["grade_audit", rows.length],
    enabled: open && rows.length > 0,
    queryFn: async () => {
      const ids = rows.map((r) => r.studentId);
      const out: { id: string; student_id: string; field: string; old_value: string | null; new_value: string | null; changed_by: string; created_at: string }[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("grade_audit_logs").select("*").in("student_id", ids.slice(i, i + 150)).order("created_at", { ascending: false }).limit(500);
        if (error) throw error;
        out.push(...(data ?? []));
      }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 500);
    },
  });
  const emails = useQuery({
    queryKey: ["audit_actors"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id, email, full_name");
      return new Map((data ?? []).map((p) => [p.id, p.full_name ?? p.email]));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Istoric Modificări (Audit Log)</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Toate modificările de note din catalog: cine, când, valoarea veche → valoarea nouă. Jurnalul nu poate fi editat sau șters din interfață.</p>
        <Table>
          <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Student</TableHead><TableHead>Câmp</TableHead><TableHead>Modificat de</TableHead><TableHead className="text-right">Vechi → Nou</TableHead></TableRow></TableHeader>
          <TableBody>
            {(q.data ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs">{new Date(l.created_at).toLocaleString("ro-RO")}</TableCell>
                <TableCell>{byId.get(l.student_id) ?? "—"}</TableCell>
                <TableCell><Badge variant="secondary">{FIELD_LABEL[l.field] ?? l.field}</Badge></TableCell>
                <TableCell className="text-xs">{emails.data?.get(l.changed_by) ?? "—"}</TableCell>
                <TableCell className="text-right font-mono text-xs">{l.old_value ?? "—"} → {l.new_value ?? "—"}</TableCell>
              </TableRow>
            ))}
            {!q.isLoading && !q.data?.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nicio modificare înregistrată încă pentru studenții vizibili.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
