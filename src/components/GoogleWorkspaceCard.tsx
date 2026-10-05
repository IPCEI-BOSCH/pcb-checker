import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FolderTree, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ensureDriveFolders, googleWorkspaceStatus } from "@/lib/drive.functions";

/** Live Google Drive / Sheets status with a one-click folder initialization for the given students. */
export function GoogleWorkspaceCard({ studentIds, onFoldersCreated }: { studentIds?: string[] | undefined; onFoldersCreated?: (() => void) | undefined }) {
  const status = useServerFn(googleWorkspaceStatus);
  const ensure = useServerFn(ensureDriveFolders);
  const q = useQuery({ queryKey: ["google-status"], queryFn: () => status(), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);

  const init = async () => {
    if (!studentIds?.length) return;
    let ok = 0;
    let bad = 0;
    try {
      for (let i = 0; i < studentIds.length; i += 10) {
        setBusy(`Se creează folderele în Drive… ${i}/${studentIds.length}`);
        const r = await ensure({ data: { studentIds: studentIds.slice(i, i + 10) } });
        ok += r.done.length;
        bad += r.failed.length;
      }
      if (bad) toast.warning(`${ok} foldere pregătite, ${bad} nu au putut fi create.`);
      else toast.success(`${ok} foldere de student sunt gata în Google Drive.`);
      onFoldersCreated?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const d = q.data;
  const Dot = ({ on, label }: { on?: boolean | undefined; label: string }) => (
    <span className="flex items-center gap-1.5 text-sm">
      {on ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <XCircle className="h-4 w-4 text-destructive" />}
      {label}: <b>{q.isLoading ? "se verifică…" : on ? "conectat" : "neconectat"}</b>
    </span>
  );

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 py-3">
        <span className="text-sm font-semibold text-foreground">Google Workspace</span>
        <Dot on={d?.drive} label="Drive" />
        <Dot on={d?.sheets} label="Sheets" />
        {d?.account && <span className="text-xs text-muted-foreground">cont: {d.account}</span>}
        {d?.error && !d.drive && <span className="text-xs text-destructive">{d.error}</span>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Verifică conexiunea</Button>
          {studentIds && (
            <Button size="sm" variant="outline" onClick={init} disabled={!!busy || !d?.drive || !studentIds.length}>
              <FolderTree className="mr-1 h-3.5 w-3.5" /> {busy ?? `Creează foldere Drive (${studentIds.length})`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
