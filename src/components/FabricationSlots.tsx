import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import JSZip from "jszip";
import { toast } from "sonner";
import { CheckCircle2, CircleDashed, Cloud, Download, FileArchive, ScanSearch, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { syncToDrive } from "@/lib/drive.functions";
import { loadGerberZip } from "@/lib/gerber/load";
import { runDrc, type DrcReport } from "@/lib/drc/engine";
import { fetchSettings } from "@/lib/drc/settings";
import type { Layer } from "@/lib/gerber/types";
import { DrcReportView } from "@/components/DrcReportView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const SLOTS = [
  { key: "BO", file: "BO.art", label: "Contur placă (Board Outline)" },
  { key: "BOTTOM", file: "BOTTOM.art", label: "Cupru BOT" },
  { key: "DRILL", file: "DRILL.drl", label: "Găurire Excellon" },
  { key: "FAB", file: "FAB.art", label: "Desen fabricație / mecanic" },
  { key: "SMBOT", file: "SMBOT.art", label: "Mască de protecție BOT" },
  { key: "SMTOP", file: "SMTOP.art", label: "Mască de protecție TOP" },
  { key: "SPTOP", file: "SPTOP.art", label: "Pastă (stencil) TOP" },
  { key: "SSTOP", file: "SSTOP.art", label: "Serigrafie TOP" },
  { key: "TOP", file: "TOP.art", label: "Cupru TOP" },
] as const;
type SlotKey = (typeof SLOTS)[number]["key"];

const matchSlot = (name: string): SlotKey | null => {
  const stem = (name.split("/").pop() ?? name).replace(/\.[^.]+$/, "").toUpperCase();
  const s = SLOTS.find((x) => x.key === stem || (stem === "BOT" && x.key === "BOTTOM"));
  return s ? s.key : null;
};

interface Props { studentId: string; userId: string; canUpload: boolean; seriesId: string | null; variant: "SMT" | "THT"; autoCheck?: boolean }

export function FabricationSlots({ studentId, userId, canUpload, seriesId, variant, autoCheck }: Props) {
  const qc = useQueryClient();
  const sync = useServerFn(syncToDrive);
  const zipRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<SlotKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drc, setDrc] = useState<{ report: DrcReport; layers: Layer[] } | null>(null);
  const key = ["fab-slots", studentId];
  const slots = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.from("student_fabrication_slots").select("*").eq("student_id", studentId);
      if (error) throw error;
      return data;
    },
  });
  const byKey = new Map((slots.data ?? []).map((s) => [s.slot_key, s]));

  const putSlot = async (slot: SlotKey, blob: Blob, originalName: string) => {
    const old = byKey.get(slot);
    const path = `${userId}/slots/${slot}-${Date.now()}`;
    const up = await supabase.storage.from("gerbers").upload(path, blob, { contentType: "application/octet-stream" });
    if (up.error) throw up.error;
    const { data, error } = await supabase.from("student_fabrication_slots")
      .upsert({ student_id: studentId, slot_key: slot, file_name: originalName, storage_path: path, size_bytes: blob.size, uploaded_by: userId, updated_at: new Date().toISOString(), drive_file_id: old?.drive_file_id ?? null }, { onConflict: "student_id,slot_key" })
      .select("id").single();
    if (error) throw error;
    if (old && old.storage_path !== path) await supabase.storage.from("gerbers").remove([old.storage_path]);
    try { await sync({ data: { kind: "slot", id: data.id } }); }
    catch (e) { toast.warning(`${slot}: salvat, dar sincronizarea Drive a eșuat — ${(e as Error).message}`); }
  };

  const uploadOne = async (file: File) => {
    if (!target) return;
    setBusy(`Se încarcă ${target}…`);
    try { await putSlot(target, file, file.name); toast.success(`${target} înlocuit și sincronizat în Drive.`); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); setTarget(null); qc.invalidateQueries({ queryKey: key }); }
  };

  const uploadZip = async (file: File) => {
    setBusy("Se extrage arhiva…");
    try {
      const zip = await JSZip.loadAsync(file);
      const done: string[] = [];
      for (const e of Object.values(zip.files)) {
        if (e.dir || e.name.startsWith("__MACOSX")) continue;
        const slot = matchSlot(e.name);
        if (!slot || done.includes(slot)) continue;
        setBusy(`Se încarcă ${slot}…`);
        await putSlot(slot, await e.async("blob"), e.name.split("/").pop()!);
        done.push(slot);
      }
      if (!done.length) toast.error("Arhiva nu conține fișiere cu numele cerute (TOP.art, BOTTOM.art, DRILL.drl…).");
      else toast.success(`${done.length} sloturi completate: ${done.join(", ")}`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); qc.invalidateQueries({ queryKey: key }); }
  };

  const buildZip = async () => {
    const zip = new JSZip();
    for (const s of slots.data ?? []) {
      const dl = await supabase.storage.from("gerbers").download(s.storage_path);
      if (dl.error) throw new Error(`${s.slot_key}: nu poate fi descărcat.`);
      zip.file(SLOTS.find((x) => x.key === s.slot_key)!.file, dl.data);
    }
    return zip.generateAsync({ type: "blob" });
  };

  const check = async () => {
    setBusy("Se rulează DRC…");
    try {
      const layers = await loadGerberZip(await buildZip());
      const report = runDrc(layers, variant, await fetchSettings(seriesId));
      setDrc({ report, layers });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    if (autoCheck && !autoDone && slots.data?.length) { setAutoDone(true); void check(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, autoDone, slots.data]);

  const download = async () => {
    const blob = await buildZip();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "Layout.zip"; a.click();
  };

  const view = async (path: string) => {
    const { data } = await supabase.storage.from("gerbers").createSignedUrl(path, 600);
    if (data) window.open(data.signedUrl, "_blank", "noreferrer");
  };

  const count = byKey.size;
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><FileArchive className="h-4 w-4" /> Fișiere de fabricație (Layout)</span>
          <Badge variant={count === 9 ? "default" : "secondary"}>{count}/9 încărcate</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">Doar cele 9 fișiere cerute. O reîncărcare înlocuiește fișierul vechi, inclusiv în Google Drive.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {canUpload && <Button variant="secondary" disabled={!!busy} onClick={() => zipRef.current?.click()}><Upload className="mr-2 h-4 w-4" /> Încarcă arhivă ZIP (completează automat)</Button>}
          <Button disabled={!!busy || !count} onClick={check}><ScanSearch className="mr-2 h-4 w-4" /> Verifică DRC & vizualizează Gerber</Button>
          <Button variant="ghost" disabled={!!busy || !count} onClick={download}><Download className="mr-2 h-4 w-4" /> Descarcă Layout</Button>
          {busy && <span className="self-center text-sm text-muted-foreground">{busy}</span>}
        </div>
        <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadZip(f); e.target.value = ""; }} />
        <input ref={slotRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadOne(f); e.target.value = ""; }} />
        <div className="divide-y divide-border rounded-md border border-border">
          {SLOTS.map((s) => {
            const row = byKey.get(s.key);
            return (
              <div key={s.key} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                {row ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
                <span className="w-28 font-mono font-medium">{s.file}</span>
                <span className="min-w-40 flex-1 text-muted-foreground">{s.label}</span>
                {row ? (
                  <span className="text-xs text-muted-foreground">
                    {new Date(row.updated_at).toLocaleString("ro-RO")} · {(row.size_bytes / 1024).toFixed(1)} kB
                    {row.drive_file_id && <Cloud className="ml-1 inline h-3 w-3 text-primary" aria-label="În Drive" />}
                  </span>
                ) : <Badge variant="outline">Lipsă</Badge>}
                {row && <Button size="sm" variant="ghost" onClick={() => view(row.storage_path)}>Deschide</Button>}
                {canUpload && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setTarget(s.key); slotRef.current?.click(); }}>{row ? "Înlocuiește" : "Încarcă"}</Button>}
              </div>
            );
          })}
        </div>
        {drc && <DrcReportView report={drc.report} layers={drc.layers} />}
      </CardContent>
    </Card>
  );
}
