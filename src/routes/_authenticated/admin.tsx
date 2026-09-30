import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABELS, useAuth, type AppRole } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Administrare — PCB Checker UPB" },
      { name: "description", content: "Administrare serii, grupe, îndrumători, roluri și studenți." },
      { property: "og:title", content: "Administrare — PCB Checker UPB" },
      { property: "og:description", content: "Management dinamic al seriilor și grupelor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Admin,
});

function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const [p, r] = await Promise.all([supabase.from("profiles").select("*").order("email"), supabase.from("user_roles").select("*")]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      return p.data.map((x) => ({ ...x, roles: r.data.filter((y) => y.user_id === x.id).map((y) => y.role as AppRole) }));
    },
  });
}

function Admin() {
  const { has } = useAuth();
  if (!has("admin", "series_manager")) return <p className="text-sm text-muted-foreground">Acces restricționat.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Administrare</h1>
        <p className="text-sm text-muted-foreground">Serii, grupe, îndrumători, roluri și liste de studenți.</p>
      </div>
      <Tabs defaultValue="structure">
        <TabsList>
          <TabsTrigger value="structure">Serii & Grupe</TabsTrigger>
          <TabsTrigger value="students">Studenți</TabsTrigger>
          <TabsTrigger value="roles">Utilizatori & Roluri</TabsTrigger>
          {has("admin") && <TabsTrigger value="audit">Audit</TabsTrigger>}
        </TabsList>
        <TabsContent value="structure"><Structure /></TabsContent>
        <TabsContent value="students"><Students /></TabsContent>
        <TabsContent value="roles"><Roles /></TabsContent>
        {has("admin") && <TabsContent value="audit"><Audit /></TabsContent>}
      </Tabs>
    </div>
  );
}

function InlineEdit({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  if (!edit)
    return (
      <span className="inline-flex items-center gap-1">
        {value}
        <button onClick={() => { setV(value); setEdit(true); }} className="text-muted-foreground hover:text-foreground" aria-label="Redenumește"><Pencil className="h-3 w-3" /></button>
      </span>
    );
  return (
    <form className="inline-flex gap-1" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); setEdit(false); }}>
      <Input className="h-7 w-40" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <Button size="sm" type="submit" className="h-7">OK</Button>
    </form>
  );
}

function Structure() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const profiles = useProfiles();
  const [newYear, setNewYear] = useState("");
  const [newSeries, setNewSeries] = useState({ name: "", year: "", variant: "SMT" as "SMT" | "THT" });
  const [newGroup, setNewGroup] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const s = structure.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["structure"] });
  const name = (id: string) => profiles.data?.find((p) => p.id === id)?.full_name || profiles.data?.find((p) => p.id === id)?.email || id.slice(0, 8);
  const staff = profiles.data?.filter((p) => p.roles.some((r) => r !== "student")) ?? [];

  const act = async (p: PromiseLike<{ error: { message: string } | null }>, audit?: [string, string | null, Record<string, unknown>]) => {
    const { error } = await p;
    if (error) return toast.error(error.message);
    if (audit) await logAudit(user.id, "SERIES_MANAGEMENT", audit[0], audit[1], audit[2]);
    refresh();
  };

  const mySeries = useMemo(() => {
    if (!s) return [];
    const managed = new Set(s.managers.filter((m) => m.user_id === user.id).map((m) => m.series_id));
    return s.series.filter((x) => (has("admin") || managed.has(x.id)) && (showArchived || !x.is_archived));
  }, [s, has, user.id, showArchived]);

  if (!s) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;

  return (
    <div className="space-y-4">
      {has("admin") && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Adaugă an universitar sau serie</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newYear.trim()) act(supabase.from("academic_years").insert({ name: newYear.trim() })).then(() => setNewYear("")); }}>
              <Input placeholder="2027-2028" value={newYear} onChange={(e) => setNewYear(e.target.value)} className="w-32" />
              <Button type="submit" variant="secondary"><Plus className="mr-1 h-4 w-4" />An</Button>
            </form>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSeries.name.trim() || !newSeries.year) return toast.error("Completează numele și anul.");
                act(supabase.from("series").insert({ name: newSeries.name.trim(), academic_year_id: newSeries.year, default_variant: newSeries.variant }), ["series", null, { name: newSeries.name }]).then(() => setNewSeries({ ...newSeries, name: "" }));
              }}
            >
              <Input placeholder="Seria B" value={newSeries.name} onChange={(e) => setNewSeries({ ...newSeries, name: e.target.value })} className="w-36" />
              <Select value={newSeries.year} onValueChange={(v) => setNewSeries({ ...newSeries, year: v })}>
                <SelectTrigger className="w-36"><SelectValue placeholder="An" /></SelectTrigger>
                <SelectContent>{s.years.map((y) => <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={newSeries.variant} onValueChange={(v) => setNewSeries({ ...newSeries, variant: v as "SMT" | "THT" })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="SMT">SMT</SelectItem><SelectItem value="THT">THT</SelectItem></SelectContent>
              </Select>
              <Button type="submit"><Plus className="mr-1 h-4 w-4" />Serie</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={showArchived} onCheckedChange={setShowArchived} id="arch" />
        <label htmlFor="arch">Arată seriile arhivate</label>
      </div>

      {!mySeries.length && <p className="text-sm text-muted-foreground">Nicio serie.</p>}

      {mySeries.map((ser) => {
        const groups = s.groups.filter((g) => g.series_id === ser.id);
        const managers = s.managers.filter((m) => m.series_id === ser.id);
        return (
          <Card key={ser.id} className={ser.is_archived ? "opacity-60" : ""}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="text-base">
                <InlineEdit value={ser.name} onSave={(v) => act(supabase.from("series").update({ name: v }).eq("id", ser.id), ["series", ser.id, { rename: v }])} />
                <span className="ml-2 text-xs font-normal text-muted-foreground">{s.years.find((y) => y.id === ser.academic_year_id)?.name} · implicit {ser.default_variant}</span>
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => act(supabase.from("series").update({ is_archived: !ser.is_archived }).eq("id", ser.id), ["series", ser.id, { archived: !ser.is_archived }])}>
                {ser.is_archived ? <><ArchiveRestore className="mr-1 h-4 w-4" />Dezarhivează</> : <><Archive className="mr-1 h-4 w-4" />Arhivează</>}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Manageri:</span>
                {managers.map((m) => (
                  <Badge key={m.id} variant="secondary" className="gap-1">
                    {name(m.user_id)}
                    {has("admin") && <button onClick={() => act(supabase.from("series_managers").delete().eq("id", m.id))} aria-label="Elimină"><X className="h-3 w-3" /></button>}
                  </Badge>
                ))}
                {has("admin") && (
                  <Select
                    value=""
                    onValueChange={async (uid) => {
                      await supabase.rpc("set_role", { _target: uid, _role: "series_manager", _grant: true });
                      act(supabase.from("series_managers").insert({ series_id: ser.id, user_id: uid }), ["series_manager", ser.id, { user: uid }]);
                      qc.invalidateQueries({ queryKey: ["profiles"] });
                    }}
                  >
                    <SelectTrigger className="h-7 w-48"><SelectValue placeholder="+ Numește manager" /></SelectTrigger>
                    <SelectContent>{profiles.data?.filter((p) => !p.email.endsWith("@student.upb.ro") && !managers.some((m) => m.user_id === p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Grupă</TableHead>
                    <TableHead>Îndrumători</TableHead>
                    <TableHead>Înscrieri libere</TableHead>
                    <TableHead className="text-right">Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.filter((g) => showArchived || !g.is_archived).map((g) => {
                    const inst = s.instructors.filter((i) => i.group_id === g.id);
                    return (
                      <TableRow key={g.id} className={g.is_archived ? "opacity-50" : ""}>
                        <TableCell className="font-mono"><InlineEdit value={g.name} onSave={(v) => act(supabase.from("groups").update({ name: v }).eq("id", g.id), ["group", g.id, { rename: v }])} /></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {inst.map((i) => (
                              <Badge key={i.id} variant="secondary" className="gap-1">
                                {name(i.user_id)}
                                <button onClick={() => act(supabase.from("group_instructors").delete().eq("id", i.id))} aria-label="Elimină"><X className="h-3 w-3" /></button>
                              </Badge>
                            ))}
                            <Select
                              value=""
                              onValueChange={async (uid) => {
                                await supabase.rpc("set_role", { _target: uid, _role: "instructor", _grant: true });
                                act(supabase.from("group_instructors").insert({ group_id: g.id, user_id: uid }), ["group_instructor", g.id, { user: uid }]);
                                qc.invalidateQueries({ queryKey: ["profiles"] });
                              }}
                            >
                              <SelectTrigger className="h-7 w-40"><SelectValue placeholder="+ Îndrumător" /></SelectTrigger>
                              <SelectContent>{(staff.length ? staff : profiles.data ?? []).filter((p) => !p.email.endsWith("@student.upb.ro") && !inst.some((i) => i.user_id === p.id)).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                        <TableCell><Switch checked={g.open_enrollment} onCheckedChange={(v) => act(supabase.from("groups").update({ open_enrollment: v }).eq("id", g.id))} /></TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" aria-label="Arhivează" onClick={() => act(supabase.from("groups").update({ is_archived: !g.is_archived }).eq("id", g.id))}>
                            {g.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = newGroup[ser.id]?.trim();
                  if (!v) return;
                  act(supabase.from("groups").insert({ series_id: ser.id, name: v }), ["group", null, { name: v, series: ser.id }]).then(() => setNewGroup({ ...newGroup, [ser.id]: "" }));
                }}
              >
                <Input placeholder="431B" className="w-32" value={newGroup[ser.id] ?? ""} onChange={(e) => setNewGroup({ ...newGroup, [ser.id]: e.target.value })} />
                <Button type="submit" variant="secondary" size="sm"><Plus className="mr-1 h-4 w-4" />Grupă</Button>
              </form>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Students() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const [groupId, setGroupId] = useState("");
  const s = structure.data;
  const managed = new Set(s?.managers.filter((m) => m.user_id === user.id).map((m) => m.series_id));
  const groups = s?.groups.filter((g) => has("admin") || managed.has(g.series_id)) ?? [];
  const students = useQuery({
    queryKey: ["admin-students", groupId],
    enabled: !!groupId,
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("*").eq("group_id", groupId).order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const [add, setAdd] = useState({ name: "", email: "" });
  const upd = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from("students").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await logAudit(user.id, "STUDENT_UPDATE", "student", id, patch);
    qc.invalidateQueries({ queryKey: ["admin-students", groupId] });
  };
  const gname = (g: (typeof groups)[number]) => `${s?.series.find((x) => x.id === g.series_id)?.name} · ${g.name}`;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Lista studenților</CardTitle>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Alege grupa" /></SelectTrigger>
          <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{gname(g)}</SelectItem>)}</SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        {groupId && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nume</TableHead>
                  <TableHead>Temă</TableHead>
                  <TableHead>Nr. N</TableHead>
                  <TableHead>Variantă</TableHead>
                  <TableHead>Grupă</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.data?.map((st) => (
                  <TableRow key={st.id}>
                    <TableCell>
                      <InlineEdit value={st.full_name} onSave={(v) => upd(st.id, { full_name: v })} />
                      <div className="text-xs text-muted-foreground">{st.email ?? "fără cont legat"}</div>
                    </TableCell>
                    <TableCell><InlineEdit value={st.theme_name ?? "—"} onSave={(v) => upd(st.id, { theme_name: v })} /></TableCell>
                    <TableCell><InlineEdit value={st.theme_number?.toString() ?? "—"} onSave={(v) => upd(st.id, { theme_number: parseInt(v, 10) || null })} /></TableCell>
                    <TableCell>
                      <Select value={st.variant} onValueChange={(v) => upd(st.id, { variant: v })}>
                        <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="SMT">a-SMT</SelectItem><SelectItem value="THT">b-THT</SelectItem></SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={st.group_id} onValueChange={(v) => upd(st.id, { group_id: v })}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{gname(g)}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch checked={st.status === "approved"} onCheckedChange={(v) => upd(st.id, { status: v ? "approved" : "pending" })} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label="Șterge" onClick={async () => {
                        if (!confirm(`Ștergi ${st.full_name} și toate predările?`)) return;
                        const { error } = await supabase.from("students").delete().eq("id", st.id);
                        if (error) toast.error(error.message);
                        qc.invalidateQueries({ queryKey: ["admin-students", groupId] });
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!add.name.trim()) return;
                const { error } = await supabase.from("students").insert({ group_id: groupId, full_name: add.name.trim(), email: add.email.trim() || null, status: "approved" });
                if (error) return toast.error(error.message);
                setAdd({ name: "", email: "" });
                qc.invalidateQueries({ queryKey: ["admin-students", groupId] });
              }}
            >
              <Input placeholder="Nume student" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} className="w-48" />
              <Input placeholder="email@stud.etti.upb.ro" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} className="w-60" />
              <Button type="submit" variant="secondary"><Plus className="mr-1 h-4 w-4" />Adaugă în listă</Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Roles() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const profiles = useProfiles();
  const [q, setQ] = useState("");
  const grantable: AppRole[] = has("admin") ? ["admin", "series_manager", "instructor", "cam_tech", "student"] : ["instructor"];
  const toggle = async (uid: string, role: AppRole, grant: boolean) => {
    const { error } = await supabase.rpc("set_role", { _target: uid, _role: role, _grant: grant });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["profiles"] });
    if (uid === user.id) qc.invalidateQueries({ queryKey: ["me"] });
  };
  const list = profiles.data?.filter((p) => !q || `${p.email} ${p.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Conturi Microsoft autentificate</CardTitle>
        <Input placeholder="Caută…" value={q} onChange={(e) => setQ(e.target.value)} className="w-60" />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <p className="mb-3 text-xs text-muted-foreground">Utilizatorii apar aici după prima conectare. {has("admin") ? "" : "Ca manager de serie poți acorda rolul de îndrumător."}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Utilizator</TableHead>
              {grantable.map((r) => <TableHead key={r} className="text-center">{ROLE_LABELS[r]}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium text-foreground">{p.full_name || "—"}</div>
                  <div className="text-xs text-muted-foreground">{p.email}</div>
                </TableCell>
                {grantable.map((r) => (
                  <TableCell key={r} className="text-center">
                    <Switch checked={p.roles.includes(r)} onCheckedChange={(v) => toggle(p.id, r, v)} disabled={r === "admin" && p.id === user.id} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Audit() {
  const log = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const profiles = useProfiles();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Jurnal de audit</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {log.data?.map((l) => (
          <div key={l.id} className="flex flex-wrap gap-2 border-b border-border py-1.5 font-mono text-xs">
            <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString("ro-RO")}</span>
            <span className="text-primary">{l.action}</span>
            <span className="text-foreground">{profiles.data?.find((p) => p.id === l.actor_id)?.email ?? "—"}</span>
            <span className="text-muted-foreground">{l.target_entity} {JSON.stringify(l.details)}</span>
          </div>
        ))}
        {!log.data?.length && <p className="text-sm text-muted-foreground">Gol.</p>}
      </CardContent>
    </Card>
  );
}
