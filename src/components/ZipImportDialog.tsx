import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileArchive, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { importProjects, scanZip, type DetectedProject } from "@/lib/zipImport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const NEW = "__NEW__";
const AUTO = "__AUTO__";

export function ZipImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const { user, has } = useAuth();
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure, enabled: open });
  const fileRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<DetectedProject[]>([]);
  const [fileName, setFileName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [yearId, setYearId] = useState<string>("");
  const [newYear, setNewYear] = useState("");
  const [seriesId, setSeriesId] = useState<string>(AUTO);
  const [autoApprove, setAutoApprove] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  );
  const isAdmin = has("admin");

  const s = structure.data;
  const years = s?.years ?? [];
  const yearSel = yearId || (years.find((y) => y.is_active)?.id ?? (isAdmin ? NEW : ""));
  const seriesInYear = (s?.series ?? []).filter((x) => x.academic_year_id === yearSel);

  const scan = async (f: File) => {
    setScanning(true);
    setScanError(null);
    setProjects([]);
    try {
      setFileName(f.name);
      const list = await scanZip(f);
      if (!list.length)
        toast.error(
          "Nu am găsit proiecte: arhiva trebuie să conțină foldere cu fișierele TOP.art, BOTTOM.art, DRILL.drl…",
        );
      setProjects(list);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Arhiva nu a putut fi citită. Încercați un ZIP standard.";
      setScanError(message);
      toast.error(message);
    } finally {
      setScanning(false);
    }
  };
  const patch = (key: string, p: Partial<DetectedProject>) =>
    setProjects((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const setAll = (p: Partial<DetectedProject>) =>
    setProjects((l) => l.map((x) => ({ ...x, ...p })));

  const run = async () => {
    if (yearSel === NEW && !newYear.trim())
      return void toast.error("Introduceți numele anului universitar (ex. 2024-2025).");
    try {
      const res = await importProjects(
        user.id,
        projects,
        {
          yearId: yearSel === NEW ? null : yearSel,
          newYearName: newYear.trim(),
          seriesId: seriesId === AUTO ? null : seriesId,
          autoApprove,
        },
        (label, done, total) => setProgress({ label, done, total }),
      );
      await logAudit(user.id, "ZIP_IMPORT", "archive", null, {
        file: fileName,
        imported: res.imported,
        errors: res.errors.length,
      });
      if (res.errors.length)
        toast.warning(
          `${res.errors.length} proiecte nu au putut fi importate: ${res.errors.slice(0, 2).join("; ")}`,
        );
      toast.success(`${res.imported} proiecte importate și verificate DRC.`);
      setProjects([]);
      setProgress(null);
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
      setProgress(null);
    }
  };

  const included = projects.filter((p) => p.include).length;
  const groups = [...new Set(projects.map((p) => p.group))];

  return (
    <Dialog open={open} onOpenChange={(o) => !progress && !scanning && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importă / arhivează proiecte din ZIP</DialogTitle>
          <DialogDescription>
            Încărcați arhiva cu folderele studenților (ex. Seria
            B/431B/P1_2025_431B_Nume_Prenume_TEMA_N1_OrCAD/Layout/). Studenții, grupele, tema și N
            sunt detectate automat din numele folderelor; le puteți corecta înainte de import.
          </DialogDescription>
        </DialogHeader>
        {scanError && (
          <p role="alert" className="text-sm text-destructive">
            {scanError}
          </p>
        )}
        {scanning && (
          <p role="status" className="text-sm text-muted-foreground">
            Se verifică siguranța și conținutul arhivei…
          </p>
        )}

        {!projects.length ? (
          <button
            type="button"
            disabled={scanning}
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-sm text-muted-foreground hover:bg-accent"
          >
            <Upload className="h-6 w-6" /> Alegeți arhiva ZIP (.zip). Arhivele .7z trebuie mai întâi
            salvate ca .zip.
          </button>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <FileArchive className="h-4 w-4" /> <span className="font-mono">{fileName}</span>
              <Badge variant="secondary">{projects.length} proiecte</Badge>
              <Badge variant="secondary">
                {groups.length} grupe: {groups.join(", ")}
              </Badge>
              <Badge variant={projects.some((p) => p.missing.length) ? "destructive" : "secondary"}>
                {projects.filter((p) => p.missing.length).length} incomplete
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setProjects([]);
                  fileRef.current?.click();
                }}
              >
                Altă arhivă
              </Button>
            </div>

            <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label>An universitar</Label>
                <Select
                  value={yearSel}
                  onValueChange={(v) => {
                    setYearId(v);
                    setSeriesId(AUTO);
                  }}
                >
                  <SelectTrigger aria-label="An universitar">
                    <SelectValue placeholder="Alegeți anul" />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name}
                        {y.is_active ? " (activ)" : ""}
                      </SelectItem>
                    ))}
                    {isAdmin && <SelectItem value={NEW}>+ An nou (arhivă)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {yearSel === NEW && (
                <div className="space-y-1">
                  <Label>Nume an nou</Label>
                  <Input
                    placeholder="2024-2025"
                    value={newYear}
                    onChange={(e) => setNewYear(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label>Serie</Label>
                <Select value={seriesId} onValueChange={setSeriesId}>
                  <SelectTrigger aria-label="Serie">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>
                      {isAdmin
                        ? "Detectată din arhivă (creează dacă lipsește)"
                        : "Detectată din arhivă"}
                    </SelectItem>
                    {seriesInYear.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        Toate în: {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id="auto-approve"
                  checked={autoApprove}
                  onCheckedChange={setAutoApprove}
                  aria-label="Aprobă automat proiectele fără erori blocante"
                />
                <Label htmlFor="auto-approve" className="text-sm">
                  Aprobă automat proiectele fără erori blocante
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Button size="sm" variant="outline" onClick={() => setAll({ include: true })}>
                Selectează tot
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAll({ include: false })}>
                Deselectează tot
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setProjects((l) => l.map((x) => ({ ...x, include: !x.missing.length })))
                }
              >
                Doar complete (9/9)
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAll({ variant: "SMT" })}>
                Toate SMT
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Folder detectat</TableHead>
                    <TableHead>Serie</TableHead>
                    <TableHead>Grupa</TableHead>
                    <TableHead>Nume și prenume</TableHead>
                    <TableHead>Tema</TableHead>
                    <TableHead>N</TableHead>
                    <TableHead>Variantă</TableHead>
                    <TableHead>Fișiere</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.key}>
                      <TableCell>
                        <Checkbox
                          checked={p.include}
                          onCheckedChange={(v) => patch(p.key, { include: !!v })}
                          aria-label={`Include ${p.folder}`}
                        />
                      </TableCell>
                      <TableCell
                        className="max-w-[220px] truncate font-mono text-[11px]"
                        title={p.folder}
                      >
                        {p.folder}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          value={p.series}
                          disabled={seriesId !== AUTO}
                          onChange={(e) => patch(p.key, { series: e.target.value })}
                          aria-label="Serie"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-20"
                          value={p.group}
                          onChange={(e) => patch(p.key, { group: e.target.value.toUpperCase() })}
                          aria-label="Grupa"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 min-w-44"
                          value={p.fullName}
                          onChange={(e) => patch(p.key, { fullName: e.target.value })}
                          aria-label="Nume și prenume"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-24"
                          value={p.theme}
                          onChange={(e) => patch(p.key, { theme: e.target.value })}
                          aria-label="Tema"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          type="number"
                          value={p.n ?? ""}
                          onChange={(e) =>
                            patch(p.key, { n: e.target.value ? +e.target.value : null })
                          }
                          aria-label="N"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={p.variant}
                          onValueChange={(v) => patch(p.key, { variant: v as "SMT" | "THT" })}
                        >
                          <SelectTrigger className="h-8 w-20" aria-label="Variantă">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SMT">SMT</SelectItem>
                            <SelectItem value="THT">THT</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {p.missing.length ? (
                          <Badge variant="destructive" title={`Lipsă: ${p.missing.join(", ")}`}>
                            {9 - p.missing.length}/9
                          </Badge>
                        ) : (
                          <Badge variant="secondary">9/9</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {progress && (
              <div className="space-y-1">
                <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
                <p className="text-xs text-muted-foreground">
                  {progress.done}/{progress.total} {progress.label}
                </p>
              </div>
            )}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) scan(f);
            e.target.value = "";
          }}
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={!!progress || scanning}
          >
            Închide
          </Button>
          <Button onClick={run} disabled={!included || !!progress || scanning || !yearSel}>
            Importă {included} proiecte și rulează DRC
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
