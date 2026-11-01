import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { fetchDeadline, saveDeadline, type Deadline } from "@/lib/deadlines";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Deadline configuration for a series or a group (group overrides series). */
export function DeadlinesCard({ seriesId, groupId, userId, canEdit }: { seriesId: string | null; groupId: string | null; userId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ["deadline", seriesId, groupId];
  const q = useQuery({ queryKey: key, queryFn: () => fetchDeadline(seriesId, groupId), enabled: !!(seriesId || groupId) });
  const [soft, setSoft] = useState("");
  const [hard, setHard] = useState("");
  const [penalty, setPenalty] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = q.data;
    setSoft(toLocal(d?.soft_deadline ?? null));
    setHard(toLocal(d?.hard_deadline ?? null));
    setPenalty(String(d?.late_penalty_per_day ?? 0));
  }, [q.data]);

  if (!seriesId && !groupId) return null;

  const save = async () => {
    setBusy(true);
    try {
      await saveDeadline({
        id: (q.data as Deadline | null)?.id,
        series_id: groupId ? null : seriesId,
        group_id: groupId,
        soft_deadline: soft ? new Date(soft).toISOString() : null,
        hard_deadline: hard ? new Date(hard).toISOString() : null,
        late_penalty_per_day: Number(penalty.replace(",", ".")) || 0,
      }, userId);
      qc.invalidateQueries({ queryKey: key });
      toast.success("Termenele au fost salvate.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-5 w-5" /> Termene-limită {groupId ? "(grupă — suprascrie seria)" : "(serie)"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Termen oficial (soft)</span>
            <Input type="datetime-local" value={soft} onChange={(e) => setSoft(e.target.value)} disabled={!canEdit} className="w-56" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Termen dur (blochează predarea)</span>
            <Input type="datetime-local" value={hard} onChange={(e) => setHard(e.target.value)} disabled={!canEdit} className="w-56" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Penalizare puncte/zi întârziere (0 = fără)</span>
            <Input type="number" min={0} step={0.5} value={penalty} onChange={(e) => setPenalty(e.target.value)} disabled={!canEdit} className="w-40" />
          </label>
          {canEdit && <Button onClick={save} disabled={busy}>{busy ? "Se salvează…" : "Salvează termenele"}</Button>}
        </div>
        <p className="text-xs text-muted-foreground">
          După termenul oficial predările se marchează cu întârziere și penalizarea se aplică în catalog. După termenul dur butonul de predare se blochează — excepție fac studenții cu derogare individuală (se acordă din rândul studentului, mai jos).
        </p>
      </CardContent>
    </Card>
  );
}
