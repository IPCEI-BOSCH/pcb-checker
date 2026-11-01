import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Activity, Archive, Download, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createExamTokens, deleteExamToken, listExamTokens, setExamMode, type ExamToken } from "@/lib/exam";
import { exportSemesterBundle, platformHealth, type HealthCheck } from "@/lib/maintenance.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/maintenance")({
  head: () => ({
    meta: [
      { title: "Mentenanță & Arhivare — PCB Checker UPB" },
      { name: "description", content: "Starea serviciilor platformei, modul examen air-gapped și arhivarea semestrială a unei serii." },
      { property: "og:title", content: "Mentenanță & Arhivare — PCB Checker UPB" },
      { property: "og:description", content: "Healthcheck servicii, coduri de examen și exportul complet de semestru." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Maintenance,
});

function Maintenance() {
  const { has } = useAuth();
  const qc = useQueryClient();
  const healthFn = useServerFn(platformHealth);
  const exportFn = useServerFn(exportSemesterBundle);
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [tokenCount, setTokenCount] = useState(30);
  const [tokenHours, setTokenHours] = useState(4);
  const [tokenLabel, setTokenLabel] = useState("");

  const structure = useQuery({
    queryKey: ["maintenance-structure"],
    queryFn: async () => {
      const [{ data: series }, { data: groups }] = await Promise.all([
        supabase.from("series").select("id, name, is_archived").order("created_at", { ascending: false }),
        supabase.from("groups").select("id, name, series_id, exam_mode").order("name"),
      ]);
      return { series: series ?? [], groups: groups ?? [] };
    },
  });
  const tokens = useQuery({
    queryKey: ["exam-tokens", groupId],
    enabled: !!groupId,
    queryFn: () => listExamTokens(groupId),
  });

  if (!has("admin", "series_manager", "instructor", "cam_tech")) return <p className="text-sm text-muted-foreground">Acces restricționat.</p>;

  const groups = structure.data?.groups ?? [];
  const seriesList = structure.data?.series ?? [];
  const selectedGroup = groups.find((g) => g.id === groupId);

  const runHealth = async () => {
    setBusy("health");
    try {
      const r = await healthFn();
      setChecks(r.checks);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    if (!seriesId) return;
    setBusy("export");
    try {
      const r = await exportFn({ data: { seriesId } });
      const a = document.createElement("a");
      a.href = r.dataUrl;
      a.download = r.fileName;
      a.click();
      toast.success(`Arhivă generată: ${r.counts.studenti} studenți, ${r.counts.predari} predări oficiale, ${r.counts.perechi} perechi de integritate.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Mentenanță & Arhivare</h1>
        <p className="text-sm text-muted-foreground">Starea serviciilor, coduri de acces pentru examen (mod air-gapped) și exportul complet de semestru.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Stare servicii</CardTitle>
          <Button size="sm" variant="outline" onClick={runHealth} disabled={busy === "health"}><RefreshCw className={`mr-1 h-4 w-4 ${busy === "health" ? "animate-spin" : ""}`} /> Verifică acum</Button>
        </CardHeader>
        <CardContent>
          {!checks && <p className="text-sm text-muted-foreground">Rulează verificarea pentru starea bazei de date, storage, Google și AI.</p>}
          {checks && (
            <div className="space-y-1.5">
              {checks.map((c) => (
                <div key={c.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{c.detail}</span>
                    <Badge variant={c.ok ? "secondary" : "destructive"}>{c.ok ? "OK" : "Eroare"}</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Mod examen (air-gapped) & coduri de acces</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            La colocviu, când sala rulează izolat de internet, activează modul examen pe grupă: predarea oficială cere un cod de acces unic,
            generat aici și distribuit studenților. Serviciile externe (Google Sheets, AI cloud) se dezactivează grațios și se sincronizează la reconectare.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Grupă</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger><SelectValue placeholder="Alege grupa" /></SelectTrigger>
                <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedGroup && (
              <div className="flex items-end gap-2 pb-0.5">
                <Switch checked={!!selectedGroup.exam_mode} onCheckedChange={async (v) => { try { await setExamMode(groupId, v); qc.invalidateQueries({ queryKey: ["maintenance-structure"] }); toast.success(v ? "Mod examen ACTIVAT pentru grupă." : "Mod examen dezactivat."); } catch (e) { toast.error((e as Error).message); } }} aria-label="Mod examen" />
                <span>Mod examen {selectedGroup.exam_mode ? <Badge variant="destructive">ACTIV</Badge> : <Badge variant="secondary">inactiv</Badge>}</span>
              </div>
            )}
          </div>
          {selectedGroup && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5"><Label>Număr coduri</Label><Input type="number" min={1} max={100} value={tokenCount} onChange={(e) => setTokenCount(Number(e.target.value) || 1)} /></div>
                <div className="space-y-1.5"><Label>Valabilitate (ore)</Label><Input type="number" min={1} max={72} value={tokenHours} onChange={(e) => setTokenHours(Number(e.target.value) || 1)} /></div>
                <div className="space-y-1.5"><Label>Etichetă (opțional)</Label><Input placeholder="Colocviu 12.01" value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} /></div>
                <div className="flex items-end">
                  <Button onClick={async () => { try { const t = await createExamTokens(groupId, tokenCount, tokenHours, tokenLabel); qc.invalidateQueries({ queryKey: ["exam-tokens", groupId] }); toast.success(`${t.length} coduri generate.`); } catch (e) { toast.error((e as Error).message); } }}>Generează coduri</Button>
                </div>
              </div>
              {!!tokens.data?.length && (
                <div className="max-h-64 overflow-auto rounded-md border border-border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Cod</TableHead><TableHead>Etichetă</TableHead><TableHead>Expiră</TableHead><TableHead>Stare</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {tokens.data.map((t: ExamToken) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono font-semibold tracking-wider">{t.code}</TableCell>
                          <TableCell className="text-xs">{t.label ?? "—"}</TableCell>
                          <TableCell className="text-xs">{new Date(t.expires_at).toLocaleString("ro-RO")}</TableCell>
                          <TableCell>{t.used_at ? <Badge variant="secondary">folosit</Badge> : new Date(t.expires_at) < new Date() ? <Badge variant="outline">expirat</Badge> : <Badge>valid</Badge>}</TableCell>
                          <TableCell className="text-right">{!t.used_at && <Button size="sm" variant="ghost" onClick={async () => { await deleteExamToken(t.id); qc.invalidateQueries({ queryKey: ["exam-tokens", groupId] }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Archive className="h-4 w-4" /> Arhivă de semestru (one-click)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Exportă pentru arhiva departamentului: catalogul de note (CSV), toate rapoartele DRC JSON ale predărilor oficiale, matricea de integritate,
            istoricul modificărilor de note, cererile de reevaluare și termenele — într-o singură arhivă ZIP structurată.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-64 space-y-1.5">
              <Label>Serie</Label>
              <Select value={seriesId} onValueChange={setSeriesId}>
                <SelectTrigger><SelectValue placeholder="Alege seria" /></SelectTrigger>
                <SelectContent>{seriesList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}{s.is_archived ? " (arhivată)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={runExport} disabled={!seriesId || busy === "export"}>
              <Download className="mr-1 h-4 w-4" /> {busy === "export" ? "Se generează…" : "Generează arhiva"}
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Arhivele Gerber ZIP rămân în Storage; arhiva conține căile lor și hash-urile SHA-256 de integritate.</p>
        </CardContent>
      </Card>
    </div>
  );
}
