import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchMyStudent, fetchStructure } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/enroll")({
  head: () => ({
    meta: [
      { title: "Înscriere în grupă — PCB Checker UPB" },
      { name: "description", content: "Alege seria, grupa, tema și varianta proiectului PCB." },
      { property: "og:title", content: "Înscriere în grupă — PCB Checker UPB" },
      { property: "og:description", content: "Asociere la serie și grupă." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Enroll,
});

function Enroll() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const me = useQuery({ queryKey: ["my-student", user.id], queryFn: () => fetchMyStudent(user.id) });
  const [seriesId, setSeriesId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [name, setName] = useState((user.user_metadata?.["full_name"] as string) ?? "");
  const [theme, setTheme] = useState("");
  const [num, setNum] = useState("");
  const [variant, setVariant] = useState<"SMT" | "THT">("SMT");
  const [busy, setBusy] = useState(false);

  if (me.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Înscriere în grupă</h1>
        <Card className="max-w-xl">
        <CardHeader><CardTitle>Ești înscris</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Grupa <span className="text-foreground">{me.data.groups?.name}</span> din <span className="text-foreground">{me.data.groups?.series?.name}</span>.</p>
          <p>Status: {me.data.status === "approved" ? "validat de îndrumător" : "în așteptarea validării"}.</p>
          <p>Pentru mutarea în altă grupă sau schimbarea variantei, contactează îndrumătorul.</p>
        </CardContent>
      </Card>
    );
  }

  const s = structure.data;
  const activeSeries = s?.series.filter((x) => !x.is_archived) ?? [];
  const groups = s?.groups.filter((g) => g.series_id === seriesId && !g.is_archived && g.open_enrollment) ?? [];

  const submit = async () => {
    if (!groupId || !name.trim()) return void toast.error("Completează numele și grupa.");
    setBusy(true);
    const prefix = name.trim().split(/\s+/).map((p) => p.normalize("NFD").replace(/[^\w]/g, "")).join("_");
    const { error } = await supabase.from("students").insert({
      user_id: user.id,
      group_id: groupId,
      full_name: name.trim(),
      email: user.email ?? null,
      theme_name: theme || null,
      theme_number: num ? parseInt(num, 10) : null,
      variant,
      file_prefix: prefix,
    });
    setBusy(false);
    if (error) return void toast.error(error.message.includes("duplicate") ? "Ești deja înscris." : error.message);
    toast.success("Înscriere trimisă.");
    await qc.invalidateQueries({ queryKey: ["my-student"] });
    navigate({ to: "/self-check" });
  };

  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle>Înscriere în serie și grupă</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!activeSeries.length && <p className="text-sm text-muted-foreground">Nu există încă serii active. Revino după ce administratorul le creează.</p>}
        <div className="space-y-1.5">
          <Label>Nume complet</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Serie</Label>
            <Select value={seriesId} onValueChange={(v) => { setSeriesId(v); setGroupId(""); }}>
              <SelectTrigger><SelectValue placeholder="Alege seria" /></SelectTrigger>
              <SelectContent>
                {activeSeries.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} · {s?.years.find((y) => y.id === x.academic_year_id)?.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Grupă</Label>
            <Select value={groupId} onValueChange={setGroupId} disabled={!seriesId}>
              <SelectTrigger><SelectValue placeholder="Alege grupa" /></SelectTrigger>
              <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Tema</Label>
            <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="ex. Amplificator" />
          </div>
          <div className="space-y-1.5">
            <Label>Nr. N</Label>
            <Input type="number" value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Varianta proiectului</Label>
          <Select value={variant} onValueChange={(v) => setVariant(v as "SMT" | "THT")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SMT">a — SMT/SMD pe PCB</SelectItem>
              <SelectItem value="THT">b — THT / Perfo-board</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={submit} disabled={busy}>Trimite înscrierea</Button>
      </CardContent>
    </Card>
  );
}
