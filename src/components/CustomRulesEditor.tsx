import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHECK_TYPES, blankCustomRule, type CustomRule, type CustomCheckType, type CustomLayer, type CustomCategory, type Settings } from "@/lib/drc/settings";
import { CATEGORY_LABELS } from "@/lib/drc/catalog";
import { LAYER_LABELS } from "@/lib/gerber/types";
import { aiCreateRule } from "@/lib/ai/rule-ai.functions";

export function CustomRulesEditor({ draft, setDraft, onTest }: { draft: Settings; setDraft: (f: (d: Settings) => Settings) => void; onTest: () => void }) {
  const rules = draft.customRules ?? [];
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const create = useServerFn(aiCreateRule);

  const put = (list: CustomRule[]) => setDraft((d) => ({ ...d, customRules: list }));
  const upd = (i: number, patch: Partial<CustomRule>) => put(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const askAi = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await create({ data: { prompt, existingCodes: rules.map((x) => x.code) } });
      const { explanation, ...rest } = r;
      let code = rest.code;
      while (rules.some((x) => x.code === code)) code += "_2";
      put([...rules, { ...blankCustomRule(), ...(rest as Partial<CustomRule>), code, enabled: true }]);
      setAiNote(explanation);
      setPrompt("");
      toast.success("Regula propusă de AI a fost adăugată. Verificați-o și testați-o înainte de activare.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Creează regulă nouă cu AI</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Găurile trebuie să fie la cel puțin 1 mm de marginea plăcii; −10 puncte, blocant, cu explicație de remediere în OrCAD." aria-label="Cerere pentru regulă nouă" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={askAi} disabled={busy || !prompt.trim()}><Sparkles className="mr-2 h-4 w-4" /> {busy ? "Se generează…" : "Generează regula"}</Button>
            <Button variant="outline" onClick={() => put([...rules, blankCustomRule()])}><Plus className="mr-2 h-4 w-4" /> Adaugă manual</Button>
            {rules.length > 0 && <Button variant="secondary" onClick={onTest}>Testează pe proiecte</Button>}
          </div>
          {aiNote && <p className="rounded-md bg-muted p-2 text-xs text-foreground">AI: {aiNote}</p>}
        </CardContent>
      </Card>

      {rules.length === 0 && <p className="text-sm text-muted-foreground">Nu există reguli noi. Regulile adăugate aici intră în punctaj, în raport și în fișa de evaluare, la fel ca regulile standard.</p>}

      {rules.map((r, i) => {
        const meta = CHECK_TYPES[r.checkType];
        return (
          <Card key={r.code + i} className={r.enabled ? "" : "opacity-60"}>
            <CardContent className="space-y-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">{r.code}</Badge>
                <Input value={r.title} onChange={(e) => upd(i, { title: e.target.value })} className="h-8 max-w-md font-semibold" aria-label="Denumire regulă" />
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">Activă <Switch checked={r.enabled} onCheckedChange={(v) => upd(i, { enabled: v })} aria-label="Regulă activă" /></label>
                  <label className="flex items-center gap-1">Critică <Switch checked={r.critical} onCheckedChange={(v) => upd(i, { critical: v })} aria-label="Eroare critică" /></label>
                  <label className="flex items-center gap-1">Doar SMT <Switch checked={r.smtOnly} onCheckedChange={(v) => upd(i, { smtOnly: v })} aria-label="Doar SMT" /></label>
                  <Button size="icon" variant="ghost" aria-label="Șterge regula" onClick={() => put(rules.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Tip verificare</Label>
                  <Select value={r.checkType} onValueChange={(v) => { const ct = v as CustomCheckType; const ls = CHECK_TYPES[ct].layers; upd(i, { checkType: ct, layer: ls.includes(r.layer) ? r.layer : ls[0]! }); }}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(CHECK_TYPES).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Strat</Label>
                  <Select value={r.layer} onValueChange={(v) => upd(i, { layer: v as CustomLayer })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{meta.layers.map((l) => <SelectItem key={l} value={l}>{LAYER_LABELS[l]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {r.checkType !== "layer_required" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Prag {meta.unit && `(${meta.unit})`}</Label>
                    <Input type="number" step="0.01" value={r.value} onChange={(e) => upd(i, { value: Number(e.target.value) })} className="h-8 font-mono" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Categorie</Label>
                  <Select value={r.category} onValueChange={(v) => upd(i, { category: v as CustomCategory })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{meta.help}</p>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-1"><Label className="text-xs">Puncte</Label><Input type="number" value={r.points} onChange={(e) => upd(i, { points: Number(e.target.value) })} className="h-8 font-mono" /></div>
                <div className="space-y-1"><Label className="text-xs">+ per apariție</Label><Input type="number" value={r.perIssue} onChange={(e) => upd(i, { perIssue: Number(e.target.value) })} className="h-8 font-mono" /></div>
                <div className="space-y-1"><Label className="text-xs">Plafon</Label><Input type="number" value={r.cap} onChange={(e) => upd(i, { cap: Number(e.target.value) })} className="h-8 font-mono" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Severitate</Label>
                  <Select value={r.severity} onValueChange={(v) => upd(i, { severity: v as CustomRule["severity"] })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="blocking">Blocant</SelectItem><SelectItem value="warning">Avertisment</SelectItem><SelectItem value="info">Info</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1"><Label className="text-xs">Ce e greșit (pentru student)</Label><Textarea rows={2} value={r.what} onChange={(e) => upd(i, { what: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">De ce contează</Label><Textarea rows={2} value={r.why} onChange={(e) => upd(i, { why: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cum repară (OrCAD / Allegro)</Label><Textarea rows={2} value={r.fix} onChange={(e) => upd(i, { fix: e.target.value })} /></div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
