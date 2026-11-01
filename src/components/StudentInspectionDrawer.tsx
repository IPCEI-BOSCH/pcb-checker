import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FolderOpen, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { driveFolderUrl, type GradeRow } from "@/lib/gradebook";
import { resetStudentPassword } from "@/lib/setup.functions";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/GradebookTable";

const SELF_HOST = import.meta.env["VITE_SELF_HOSTED"] === "true";

type Issue = { code: string; title: string; severity: string; message: string };

export function StudentInspectionDrawer({ row, onClose }: { row: GradeRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["gb-inspect", row?.studentId],
    enabled: !!row,
    queryFn: async () => {
      const [subs, files] = await Promise.all([
        supabase.from("submissions").select("id, revision, kind, created_at, drc_score, blocking_count, review_status, review_reason, report").eq("student_id", row!.studentId).order("created_at", { ascending: false }).limit(20),
        supabase.from("project_files").select("id, folder, file_name, points, created_at").eq("student_id", row!.studentId).order("created_at", { ascending: false }),
      ]);
      if (subs.error) throw subs.error;
      return { subs: subs.data, files: files.data ?? [] };
    },
  });
  const official = q.data?.subs.filter((s) => s.kind === "OFFICIAL") ?? [];
  const last = official[0];
  const issues = ((last?.report as { issues?: Issue[] } | null)?.issues ?? []).filter((i) => i.severity !== "info");

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>{row.fullName}</SheetTitle>
              <p className="text-sm text-muted-foreground">Seria {row.seriesName} · Grupa {row.groupName} · N {row.themeNumber ?? "—"} · {row.themeName || "fără temă"}</p>
            </SheetHeader>
            <div className="mt-4 space-y-5 text-sm">
              <section className="space-y-1">
                <h3 className="font-medium text-foreground">Predare oficială</h3>
                {q.isLoading && <p className="text-muted-foreground">Se încarcă…</p>}
                {!q.isLoading && !last && <p className="text-muted-foreground">Nicio predare oficială.</p>}
                {last && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2"><StatusBadge s={last.review_status} /> <span>Revizia {last.revision} · {new Date(last.created_at).toLocaleString("ro-RO")}</span></div>
                    <p>Scor DRC: <b>{last.drc_score ?? "—"}</b> · Erori blocante: <b>{last.blocking_count}</b> · Puncte: <b>{row.designPoints ?? "—"}</b>/40</p>
                    {last.review_reason && <p className="text-muted-foreground">Motiv: {last.review_reason}</p>}
                  </div>
                )}
              </section>
              {issues.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium text-foreground">Probleme DRC ({issues.length})</h3>
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {issues.slice(0, 40).map((i, k) => (
                      <li key={k} className="rounded border border-border p-1.5">
                        <Badge variant={i.severity === "blocking" || i.severity === "error" ? "destructive" : "secondary"} className="mr-1">{i.title}</Badge>
                        <span className="text-muted-foreground">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="space-y-1">
                <h3 className="font-medium text-foreground">Istoric revizii ({official.length} oficiale, {(q.data?.subs.length ?? 0) - official.length} verificări)</h3>
                {official.map((s) => (
                  <div key={s.id} className="flex justify-between border-b border-border py-1"><span>Rev. {s.revision} · {new Date(s.created_at).toLocaleDateString("ro-RO")}</span><span>{s.drc_score ?? "—"} · <StatusBadge s={s.review_status} /></span></div>
                ))}
              </section>
              <section className="space-y-1">
                <h3 className="font-medium text-foreground">Dosar proiect ({q.data?.files.length ?? row.projectFileCount} fișiere · {row.folderPoints ?? 0} puncte)</h3>
                {q.data?.files.slice(0, 15).map((f) => (
                  <div key={f.id} className="flex justify-between border-b border-border py-1"><span className="truncate">{f.folder} / {f.file_name}</span><span>{f.points ?? ""}</span></div>
                ))}
              </section>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm"><Link to="/review"><ExternalLink className="mr-1 h-4 w-4" /> Deschide la Evaluare</Link></Button>
                {row.driveFolderId && <Button asChild size="sm" variant="outline"><a href={driveFolderUrl(row.driveFolderId)} target="_blank" rel="noreferrer"><FolderOpen className="mr-1 h-4 w-4" /> Folder Drive</a></Button>}
              </div>
              {SELF_HOST && <PasswordReset studentId={row.studentId} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Self-hosted labs run offline (no SMTP): staff reset a student's local password directly. Audited server-side. */
function PasswordReset({ studentId }: { studentId: string }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-2 rounded-md border border-border p-3">
      <h3 className="flex items-center gap-1 font-medium text-foreground"><KeyRound className="h-4 w-4" /> Resetare parolă (server local)</h3>
      <div className="flex gap-2">
        <Input type="text" placeholder="Parolă nouă (min. 8)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || pw.length < 8}
          onClick={async () => {
            setBusy(true);
            try {
              await resetStudentPassword({ data: { studentId, newPassword: pw } });
              toast.success("Parola a fost resetată.");
              setPw("");
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Resetează
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Acțiunea este înregistrată în jurnalul de audit.</p>
    </section>
  );
}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
