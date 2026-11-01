import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DrcReport } from "@/lib/drc/engine";
import type { Layer } from "@/lib/gerber/types";
import { normText, renderBlocksSheet } from "@/lib/silk/extract";
import { aiReadSilk } from "@/lib/ai/silk-ai.functions";

const DESIGNATOR = /^(R|C|L|D|U|Q|J|P|K|T|X|Y|F|SW|LED|IC|TP|JP|VR|RV|CN)\d{1,3}[A-Z]?$/i;

/** Silkscreen text found on the board: measured geometry + optional AI reading, identification and designator checks. */
export function SilkTextCard({ report, layers, student, onLocate }: { report: DrcReport; layers: Layer[] | null; student?: string | undefined; onLocate?: (x: number, y: number) => void }) {
  const blocks = report.silkText?.blocks ?? [];
  const [read, setRead] = useState<Record<number, { text: string; confidence: number }>>(report.silkText?.read ?? {});
  const [mirrored, setMirrored] = useState<boolean | null>(report.silkText?.mirrored ?? null);
  const [busy, setBusy] = useState(false);
  const readFn = useServerFn(aiReadSilk);

  const analysis = useMemo(() => {
    // AI readings win where present; otherwise fall back to the local vector pre-OCR from the DRC report.
    const texts = blocks.map((b) => {
      const ai = read[b.idx];
      if (ai && ai.text && ai.confidence >= 0.4) return ai.text.trim();
      if (b.decoded && (b.decodeConfidence ?? 0) >= 0.5) return b.decoded;
      return "";
    }).filter(Boolean);
    const des = texts.filter((t) => DESIGNATOR.test(t)).map((t) => t.toUpperCase());
    const dup = [...new Set(des.filter((d, i) => des.indexOf(d) !== i))];
    let nameFound: boolean | null = null;
    if (student && texts.length) {
      const parts = student.split(/[\s_\-.]+/).map(normText).filter((p) => p.length >= 3);
      const all = normText(texts.join(" "));
      nameFound = parts.some((p) => all.includes(p));
    }
    const lowConf = Object.values(read).filter((t) => t.text && t.confidence < 0.4).length;
    const localCount = blocks.filter((b) => b.decoded && (b.decodeConfidence ?? 0) >= 0.5).length;
    const mirroredLocal = blocks.filter((b) => b.mirrored === true && (b.decodeConfidence ?? 0) >= 0.5 && (b.layer === "top_silk" || b.layer === "top_copper")).length;
    return { des, dup, nameFound, lowConf, localCount, mirroredLocal };
  }, [read, student, blocks]);

  if (!blocks.length) return null;

  const runAi = async () => {
    if (!layers) { toast.error("Fișierele nu sunt încărcate în pagină."); return; }
    const img = renderBlocksSheet(layers, blocks);
    if (!img) return;
    setBusy(true);
    try {
      const r = await readFn({ data: { image: img, count: Math.min(60, blocks.length) } });
      const map: Record<number, { text: string; confidence: number }> = {};
      for (const t of r.texts) map[t.idx] = { text: t.text, confidence: t.confidence };
      setRead(map);
      setMirrored(r.mirroredTop);
      if (report.silkText) Object.assign(report.silkText, { read: map, mirrored: r.mirroredTop });
      toast.success(`Texte citite: ${r.texts.filter((t) => t.text).length}${r.notes ? ` — ${r.notes}` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Type className="h-4 w-4" /> Text serigrafie ({blocks.length})</CardTitle>
        <Button size="sm" variant="outline" onClick={runAi} disabled={busy || !layers}><Sparkles className="mr-1 h-4 w-4" /> {busy ? "Se citește…" : "Citește cu AI"}</Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Dimensiunile și citirea vectorială locală (fără cost AI) sunt automate. Fonturile nestandard sau siglele se citesc la cerere cu AI; verificați vizual cazurile neclare.</p>
        <div className="flex flex-wrap gap-2">
          {student && analysis.nameFound !== null && <Badge variant={analysis.nameFound ? "secondary" : "destructive"}>{analysis.nameFound ? "✓ Numele studentului apare pe placă" : "Numele studentului nu a fost găsit"}</Badge>}
          {!!analysis.localCount && <Badge variant="outline">{analysis.localCount} texte citite local</Badge>}
          {!!analysis.des.length && <Badge variant="secondary">{analysis.des.length} designatoare</Badge>}
          {!!analysis.dup.length && <Badge variant="destructive">Duplicate: {analysis.dup.join(", ")}</Badge>}
          {(mirrored || !!analysis.mirroredLocal) && <Badge variant="destructive">Text TOP în oglindă{analysis.mirroredLocal ? ` (${analysis.mirroredLocal})` : ""}</Badge>}
          {!!analysis.lowConf && <Badge variant="outline">{analysis.lowConf} citiri nesigure</Badge>}
        </div>
        <div className="max-h-72 overflow-auto">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Text</TableHead><TableHead>Strat</TableHead><TableHead className="text-right">Înălțime</TableHead><TableHead className="text-right">Linie</TableHead><TableHead className="text-right">Poziție</TableHead></TableRow></TableHeader>
            <TableBody>
              {blocks.map((b) => {
                const t = read[b.idx];
                const local = !t && b.decoded && (b.decodeConfidence ?? 0) >= 0.5;
                return (
                  <TableRow key={b.idx} className={onLocate ? "cursor-pointer" : undefined} onClick={() => onLocate?.(b.x, b.y)}>
                    <TableCell className="font-mono text-xs">{b.idx}</TableCell>
                    <TableCell>
                      {t ? (t.text ? <span className={t.confidence < 0.4 ? "text-muted-foreground" : "font-medium"}>{t.text}</span> : <span className="text-muted-foreground">(nu e text)</span>)
                        : local ? <span className="font-medium">{b.decoded} <span className="text-xs text-muted-foreground" title="Citire vectorială locală, fără AI">· local {Math.round((b.decodeConfidence ?? 0) * 100)}%{b.mirrored === true ? " · oglindă" : ""}</span></span>
                        : <span className="text-muted-foreground">{b.chars} caractere</span>}
                    </TableCell>
                    <TableCell className="text-xs">{b.layer === "top_silk" ? "TOP" : "BOTTOM"}</TableCell>
                    <TableCell className="text-right">{b.textHeight.toFixed(2)} mm</TableCell>
                    <TableCell className="text-right">{b.stroke.toFixed(2)} mm</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{b.x.toFixed(1)}, {b.y.toFixed(1)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
