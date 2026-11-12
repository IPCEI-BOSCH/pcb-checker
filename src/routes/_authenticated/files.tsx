import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ExternalLink, Eye, FolderOpen, Trash2, Upload, X } from "lucide-react";
import { FileStudentPicker } from "@/components/FileStudentPicker";
import { filterFileStudents } from "@/lib/file-student-search";
import { GoogleWorkspaceCard } from "@/components/GoogleWorkspaceCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchMyStudent, fetchStructure, seriesLabel, sortSeriesByYear } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { FabricationSlots } from "@/components/FabricationSlots";
import { deleteFromDrive, syncToDrive } from "@/lib/drive.functions";

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
  fabrication: { title: "Anexe fabricație (opțional)", hint: "BOM, Pick&Place, alte fișiere tehnice — nu intră în panou." },
  project: { title: "Proiect (sincronizat în Google Drive)", hint: "Schemă & breviar PDF, simulări PSpice, BOM, prezentare PPT, sursele CAD… Un fișier cu același nume îl înlocuiește pe cel vechi." },
};

/** Small example documents so a demo student's project folder can be opened and graded. */
function demoDocs(): File[] {
  const mk = (name: string, mime: string, body: string) => new File([body], name, { type: mime });
  return [
    mk("Breviar_de_calcul.txt", "text/plain", "Breviar de calcul (demonstrativ)\n\n1. Tema proiectului\n2. Schema bloc\n3. Calculul componentelor\n4. Concluzii\n"),
    mk("Simulare_PSpice.txt", "text/plain", "Rezultate simulare PSpice (demonstrativ)\nAnaliza DC, AC si tranzitorie.\n"),
    mk("BOM.csv", "text/csv", "Designator,Valoare,Capsula,Cantitate\nR1,10k,0805,1\nC1,100n,0805,1\nU1,LM358,SOIC-8,1\n"),
    mk("Prezentare.txt", "text/plain", "Prezentare proiect (demonstrativ)\nSlide 1: Tema\nSlide 2: Schema\nSlide 3: Layout PCB\n"),
  ];
}

function FilesPage() {
  const { user, isStaff } = useAuth();
  const me = useQuery({ queryKey: ["my-student", user.id], queryFn: () => fetchMyStudent(user.id) });
  const [picked, setPicked] = useState("");
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState("");
  const [group, setGroup] = useState("");
  const [variant, setVariant] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure, enabled: isStaff });
  const list = useQuery({
    queryKey: ["file-students"],
    enabled: isStaff,
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("id, full_name, email, file_prefix, theme_name, theme_number, group_id, variant, user_id, drive_folder_id, project_files(folder), student_fabrication_slots(slot_key)").order("full_name");
      if (error) throw error;
      return (data ?? []).map(s => ({ ...s, projectCount: s.project_files.filter(f => f.folder === "project").length, fabricationCount: s.project_files.filter(f => f.folder === "fabrication").length + s.student_fabrication_slots.length }));
    },
  });
  const results = filterFileStudents(list.data ?? [], { query, series, group, variant, files: fileFilter }, structure.data?.groups ?? []);
  const resultIndex = results.findIndex(s => s.id === picked);
  useEffect(() => {
    if (picked && !results.some(s => s.id === picked)) setPicked("");
  }, [picked, query, series, group, variant, fileFilter, list.data, structure.data]);
  const studentId = isStaff ? picked : me.data?.id ?? "";
  const sel = list.data?.find((s) => s.id === picked);
  const ownerFolder = isStaff ? sel?.user_id ?? user.id : user.id;
  const driveId = isStaff ? sel?.drive_folder_id ?? null : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dosarele proiectului</h1>
        <p className="text-sm text-muted-foreground">Încărcați oricâte fișiere, fiecare cu descrierea sa. Îndrumătorul le poate deschide și puncta separat de punctajul DRC.</p>
      </div>
      {isStaff && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={series || "ALL"} onValueChange={v => { setSeries(v === "ALL" ? "" : v); setGroup(""); }}><SelectTrigger aria-label="Filtrează seria" className="w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Toate seriile</SelectItem>{sortSeriesByYear(structure.data?.series ?? [], structure.data?.years).map(s => <SelectItem key={s.id} value={s.id}>{seriesLabel(s, structure.data?.years)}</SelectItem>)}</SelectContent></Select>
            <Select value={group || "ALL"} onValueChange={v => setGroup(v === "ALL" ? "" : v)}><SelectTrigger aria-label="Filtrează grupa" className="w-full sm:w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Toate grupele</SelectItem>{structure.data?.groups.filter(g => !series || g.series_id === series).map(g => <SelectItem key={g.id} value={g.id}>{g.name} · {structure.data?.series.find(s => s.id === g.series_id)?.name}</SelectItem>)}</SelectContent></Select>
            <Select value={variant || "ALL"} onValueChange={v => setVariant(v === "ALL" ? "" : v)}><SelectTrigger aria-label="Filtrează varianta" className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">SMT și THT</SelectItem><SelectItem value="SMT">SMT</SelectItem><SelectItem value="THT">THT</SelectItem></SelectContent></Select>
            <Select value={fileFilter || "ALL"} onValueChange={v => setFileFilter(v === "ALL" ? "" : v)}><SelectTrigger aria-label="Filtrează fișierele" className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">Toate dosarele</SelectItem><SelectItem value="with">Cu fișiere încărcate</SelectItem><SelectItem value="without">Fără fișiere încărcate</SelectItem></SelectContent></Select>
            {(query || series || group || variant || fileFilter) && <Button variant="ghost" size="icon" aria-label="Resetează filtrele" title="Resetează filtrele" onClick={() => { setQuery(""); setSeries(""); setGroup(""); setVariant(""); setFileFilter(""); }}><X className="h-4 w-4" /></Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FileStudentPicker students={results} selected={sel} query={query} onQuery={setQuery} onSelect={setPicked} groupName={id => structure.data?.groups.find(g => g.id === id)?.name ?? "—"} disabled={list.isLoading || structure.isLoading} />
            <Button size="icon" variant="outline" aria-label="Studentul anterior" title="Studentul anterior" disabled={resultIndex <= 0} onClick={() => setPicked(results[resultIndex - 1]?.id ?? "")}><ArrowLeft className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline" aria-label="Studentul următor" title="Studentul următor" disabled={resultIndex < 0 || resultIndex >= results.length - 1} onClick={() => setPicked(results[resultIndex + 1]?.id ?? "")}><ArrowRight className="h-4 w-4" /></Button>
            <span className="text-xs text-muted-foreground" role="status">{list.isLoading ? "Se încarcă…" : `${results.length} / ${list.data?.length ?? 0} studenți${resultIndex >= 0 ? ` · ${resultIndex + 1}/${results.length}` : ""}`}</span>
          </div>
          {query && <Badge variant="secondary">Căutare: {query}</Badge>}
          {sel && <div className="flex flex-wrap items-center gap-2 text-sm"><strong>{sel.full_name}</strong><span className="text-muted-foreground">{sel.email} · {structure.data?.groups.find(g => g.id === sel.group_id)?.name} · {sel.variant} · N{sel.theme_number ?? "—"}</span><Badge variant="secondary">Proiect: {sel.projectCount}</Badge><Badge variant="secondary">Fabricație: {sel.fabricationCount}</Badge></div>}
          {list.isError && <p className="text-sm text-destructive">Lista nu a putut fi încărcată. <Button variant="ghost" size="sm" onClick={() => list.refetch()}>Reîncearcă</Button></p>}
          {!list.isLoading && !results.length && <p className="text-sm text-muted-foreground">Niciun student corespunde filtrelor.</p>}
        </section>
      )}
      {isStaff && <GoogleWorkspaceCard studentIds={picked ? [picked] : undefined} onFoldersCreated={() => list.refetch()} />}
      {isStaff && driveId && (
        <Button asChild size="sm" variant="outline"><a href={`https://drive.google.com/drive/folders/${driveId}`} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Deschide folderul studentului în Google Drive</a></Button>
      )}
      {!isStaff && !me.isLoading && !me.data && <p className="text-sm text-muted-foreground">Înscrieți-vă mai întâi într-o grupă.</p>}
      {studentId && (
        <div className="grid gap-6 lg:grid-cols-2">
          <FabricationSlots key={`slots-${studentId}`} studentId={studentId} userId={user.id} canUpload={!isStaff} seriesId={isStaff ? structure.data?.groups.find(g => g.id === sel?.group_id)?.series_id ?? null : me.data?.groups?.series_id ?? null} variant={(isStaff ? sel?.variant : me.data?.variant) ?? "SMT"} />
          <FolderCard key={`project-${studentId}`} folder="project" studentId={studentId} canUpload canGrade={isStaff} userId={user.id} ownerFolder={ownerFolder} demo={isStaff} />
          <FolderCard key={`fabrication-${studentId}`} folder="fabrication" studentId={studentId} canUpload canGrade={isStaff} userId={user.id} ownerFolder={ownerFolder} demo={false} />
        </div>
      )}
    </div>
  );
}

function FolderCard({ folder, studentId, canUpload, canGrade, userId, ownerFolder, demo }: { folder: Folder; studentId: string; canUpload: boolean; canGrade: boolean; userId: string; ownerFolder: string; demo: boolean }) {
  const qc = useQueryClient();
  const sync = useServerFn(syncToDrive);
  const delDrive = useServerFn(deleteFromDrive);
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

  const upload = async (list: FileList | File[]) => {
    setBusy(true);
    try {
      for (const file of Array.from(list)) {
        const path = `${ownerFolder}/files/${folder}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const up = await supabase.storage.from("gerbers").upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw up.error;
        // same name in the same folder => replace the old file (no duplicates in Drive)
        const old = (files.data ?? []).find((f) => f.file_name === file.name && f.points == null);
        const { data, error } = await supabase.from("project_files").insert({ student_id: studentId, user_id: userId, folder, file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size, description: desc || old?.description || null, drive_file_id: old?.drive_file_id ?? null }).select("id").single();
        if (error) throw error;
        if (old) { await supabase.storage.from("gerbers").remove([old.file_path]); await supabase.from("project_files").delete().eq("id", old.id); }
        if (folder === "project") {
          try { await sync({ data: { kind: "project", id: data.id } }); }
          catch (e) { toast.warning(`Salvat, dar sincronizarea Drive a eșuat: ${(e as Error).message}`); }
        }
      }
      setDesc("");
      toast.success("Fișiere salvate.");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["file-students"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const open = async (path: string, name: string, mime: string | null) => {
    const { data, error } = await supabase.storage.from("gerbers").createSignedUrl(path, 600);
    if (error) return void toast.error("Fișierul nu poate fi deschis.");
    setPreview({ url: data.signedUrl, name, mime: mime ?? "" });
  };

  const remove = async (id: string, path: string, driveId: string | null) => {
    if (driveId) await delDrive({ data: { driveFileId: driveId } }).catch(() => null);
    await supabase.storage.from("gerbers").remove([path]);
    const { error } = await supabase.from("project_files").delete().eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["file-students"] });
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
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-0 flex-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descriere (se aplică fișierelor încărcate)" />
            <Button onClick={() => ref.current?.click()} disabled={busy}><Upload className="mr-2 h-4 w-4" /> Încarcă</Button>
            <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
          </div>
        )}
        {!files.data?.length && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            Niciun fișier.
            {demo && canUpload && <Button size="sm" variant="ghost" disabled={busy} onClick={() => upload(demoDocs())}>Adaugă documente demonstrative</Button>}
          </div>
        )}
        {files.data?.map((f) => (
          <div key={f.id} className="space-y-1.5 rounded-md border border-border p-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{f.file_name}</span>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" aria-label={`Vizualizează fișier ${f.file_name}`} onClick={() => open(f.file_path, f.file_name, f.mime_type)}><Eye className="h-4 w-4" /></Button>
                {canUpload && f.points == null && <Button size="sm" variant="ghost" aria-label={`Șterge fișier ${f.file_name}`} onClick={() => remove(f.id, f.file_path, f.drive_file_id)}><Trash2 className="h-4 w-4" /></Button>}
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
            ? preview.mime.startsWith("image/") ? <img src={preview.url} alt={`Previzualizare ${preview.name}`} className="max-h-[70vh] w-full object-contain" /> : <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded border border-border" />
            : <p className="text-sm">Acest tip de fișier nu poate fi afișat în browser. <a className="text-primary underline" href={preview.url} target="_blank" rel="noreferrer">Descarcă</a></p>)}
          {userId && null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
