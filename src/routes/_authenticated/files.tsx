import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Eye, FolderOpen, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchMyStudent } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/files")({
  head: () => ({
    meta: [
      { title: "Dosarele proiectului — PCB Checker UPB" },
      { name: "description", content: "Fișiere de fabricație și fișiere de proiect, cu descrieri și punctaj acordat de îndrumător." },
      { property: "og:title", content: "Dosarele proiectului — PCB Checker UPB" },
      { property: "og:description", content: "Două dosare per student: fabricație și proiect." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FilesPage,
});

type Folder = "fabrication" | "project";
const FOLDERS: Record<Folder, { title: string; hint: string }> = {
  fabrication: { title: "Fișiere de fabricație", hint: "Gerber, Excellon, BOM, Pick&Place, desene mecanice…" },
  project: { title: "Proiect", hint: "Schemă, documentație, simulări, calcule, poze, sursele CAD…" },
};

function FilesPage() {
  const { user, isStaff } = useAuth();
  const me = useQuery({ queryKey: ["my-student", user.id], queryFn: () => fetchMyStudent(user.id) });
  const [picked, setPicked] = useState("");
  const list = useQuery({
    queryKey: ["file-students"],
    enabled: isStaff,
    queryFn: async () => (await supabase.from("students").select("id, full_name, theme_number, groups(name)").order("full_name")).data ?? [],
  });
  const studentId = isStaff ? picked : me.data?.id ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dosarele proiectului</h1>
        <p className="text-sm text-muted-foreground">Încărcați oricâte fișiere, fiecare cu descrierea sa. Îndrumătorul le poate deschide și puncta separat de punctajul DRC.</p>
      </div>
      {isStaff && (
        <Select value={picked} onValueChange={setPicked}>
          <SelectTrigger className="w-80"><SelectValue placeholder="Alegeți studentul" /></SelectTrigger>
          <SelectContent>
            {list.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.theme_number ?? "—"} · {s.full_name} · {(s.groups as { name: string } | null)?.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {!isStaff && !me.isLoading && !me.data && <p className="text-sm text-muted-foreground">Înscrieți-vă mai întâi într-o grupă.</p>}
      {studentId && (
        <div className="grid gap-6 lg:grid-cols-2">
          {(Object.keys(FOLDERS) as Folder[]).map((f) => <FolderCard key={f} folder={f} studentId={studentId} canUpload={!isStaff} canGrade={isStaff} userId={user.id} />)}
        </div>
      )}
    </div>
  );
}

function FolderCard({ folder, studentId, canUpload, canGrade, userId }: { folder: Folder; studentId: string; canUpload: boolean; canGrade: boolean; userId: string }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null);
  const key = ["project-files", studentId, folder];
  const files = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("project_files").select("*").eq("student_id", studentId).eq("folder", folder).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const upload = async (list: FileList) => {
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const path = `${userId}/files/${folder}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("gerbers").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw up.error;
        const { error } = await supabase.from("project_files").insert({ student_id: studentId, user_id: userId, folder, file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, description: desc || null });
        if (error) throw error;
      }
      setDesc("");
      toast.success("Fișiere încărcate.");
      qc.invalidateQueries({ queryKey: key });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const open = async (path: string, name: string, mime: string | null) => {
    const { data, error } = await supabase.storage.from("gerbers").createSignedUrl(path, 600);
    if (error) return void toast.error("Fișierul nu poate fi deschis.");
    setPreview({ url: data.signedUrl, name, mime: mime ?? "" });
  };

  const remove = async (id: string, path: string) => {
    await supabase.storage.from("gerbers").remove([path]);
    const { error } = await supabase.from("project_files").delete().eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: key });
  };

  const update = async (id: string, patch: { points?: number | null; points_note?: string | null; description?: string | null }) => {
    const { error } = await supabase.from("project_files").update(patch).eq("id", id);
    if (error) toast.error(error.message); else qc.invalidateQueries({ queryKey: key });
  };

  const total = (files.data ?? []).reduce((s, f) => s + (f.points != null ? Number(f.points) : 0), 0);
  const viewable = (m: string) => m.startsWith("image/") || m === "application/pdf" || m.startsWith("text/");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> {FOLDERS[folder].title}</span>
          <Badge variant="secondary">{total} puncte</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{FOLDERS[folder].hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {canUpload && (
          <div className="flex gap-2">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descriere (se aplică fișierelor încărcate)" />
            <Button onClick={() => ref.current?.click()} disabled={busy}><Upload className="mr-2 h-4 w-4" /> Încarcă</Button>
            <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </div>
        )}
        {!files.data?.length && <p className="text-sm text-muted-foreground">Niciun fișier.</p>}
        {files.data?.map((f) => (
          <div key={f.id} className="space-y-1.5 rounded-md border border-border p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{f.file_name}</span>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(f.file_path, f.file_name, f.mime_type)}><Eye className="h-4 w-4" /></Button>
                {canUpload && f.points == null && <Button size="sm" variant="ghost" onClick={() => remove(f.id, f.file_path)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
            {canUpload
              ? <Input defaultValue={f.description ?? ""} placeholder="Descriere" className="h-8" onBlur={(e) => e.target.value !== (f.description ?? "") && update(f.id, { description: e.target.value || null })} />
              : <p className="text-xs text-muted-foreground">{f.description || "Fără descriere"}</p>}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{new Date(f.created_at).toLocaleString("ro-RO")} · {((f.size_bytes ?? 0) / 1024).toFixed(0)} kB</span>
              {canGrade ? (
                <>
                  <Input type="number" step="0.5" defaultValue={f.points ?? ""} placeholder="Puncte" className="h-7 w-20" onBlur={(e) => update(f.id, { points: e.target.value === "" ? null : Number(e.target.value) })} />
                  <Input defaultValue={f.points_note ?? ""} placeholder="Observații" className="h-7" onBlur={(e) => e.target.value !== (f.points_note ?? "") && update(f.id, { points_note: e.target.value || null })} />
                </>
              ) : f.points != null && <Badge>{f.points} p{f.points_note ? ` · ${f.points_note}` : ""}</Badge>}
            </div>
          </div>
        ))}
      </CardContent>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{preview?.name}</DialogTitle></DialogHeader>
          {preview && (viewable(preview.mime)
            ? preview.mime.startsWith("image/") ? <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-full object-contain" /> : <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded border border-border" />
            : <p className="text-sm">Acest tip de fișier nu poate fi afișat în browser. <a className="text-primary underline" href={preview.url} target="_blank" rel="noreferrer">Descarcă</a></p>)}
          {userId && null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
