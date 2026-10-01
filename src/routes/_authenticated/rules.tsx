import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, RotateCcw, Save, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit } from "@/lib/data";
import { TITLES } from "@/lib/drc/engine";
import {
  CAM_FIELDS, DEFAULT_SETTINGS, RULE_FIELDS, fetchSettings, flattenSettings, mergeSettings, saveSettings, unflattenSettings,
  type CamValues, type RuleValues, type Settings,
} from "@/lib/drc/settings";
import { aiSuggestSettings, pullSettingsSheet, pushSettingsSheet } from "@/lib/rules.functions";
import { extractSpreadsheetId } from "@/lib/gradebook";
import { createSpreadsheet } from "@/lib/sheets.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/rules")({
  head: () => ({
    meta: [
      { title: "Reguli & Setări — PCB Checker UPB" },
      { name: "description", content: "Configurarea regulilor de verificare, a punctajului și a parametrilor de panou și stencil." },
      { property: "og:title", content: "Reguli & Setări — PCB Checker UPB" },
      { property: "og:description", content: "Reguli DRC editabile, asistent AI și sincronizare Google Sheets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RulesPage,
});

type Patch = Awaited<ReturnType<typeof aiSuggestSettings>>;

function groupBy<T extends string>(fields: Record<T, { group: string }>) {
  const out = new Map<string, T[]>();
  for (const k of Object.keys(fields) as T[]) {
    const g = fields[k].group;
    out.set(g, [...(out.get(g) ?? []), k]);
  }
  return [...out.entries()];
}

function RulesPage() {
  const { user, has } = useAuth();
  const qc = useQueryClient();
  const [scope, setScope] = useState<string>("GLOBAL");
  const [draft, setDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState("");
  const [patch, setPatch] = useState<Patch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [tab, setTab] = useState("Setari_Platforma");
  const ai = useServerFn(aiSuggestSettings);
  const push = useServerFn(pushSettingsSheet);
  const pull = useServerFn(pullSettingsSheet);
  const createSheet = useServerFn(createSpreadsheet);
  const [manualLink, setManualLink] = useState(false);

  const isAdmin = has("admin");
  const allowed = has("admin", "series_manager");
  const structure = useQuery({ queryKey: ["structure"], queryFn: fetchStructure });
  const seriesId = scope === "GLOBAL" ? null : scope;
  const current = useQuery({ queryKey: ["drc-settings", seriesId], queryFn: () => fetchSettings(seriesId) });
  const link = useQuery({
    queryKey: ["sheet-link", seriesId],
    enabled: !!seriesId,
    queryFn: async () => (await supabase.from("sheet_links").select("spreadsheet_id").eq("series_id", seriesId!).maybeSingle()).data,
  });

  useEffect(() => { if (current.data) setDraft(structuredClone(current.data)); }, [current.data]);
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(`rules-sheet-${scope}`) : null;
    setSheetUrl(stored ?? link.data?.spreadsheet_id ?? "");
  }, [link.data, scope]);
  const rememberSheet = (id: string) => { setSheetUrl(id); window.localStorage.setItem(`rules-sheet-${scope}`, id); };
  const doCreate = async () => {
    setBusy("Se creează foaia Google Sheets…");
    try {
      const name = scope === "GLOBAL" ? "Global" : structure.data?.series.find((x) => x.id === scope)?.name ?? "Serie";
      const r = await createSheet({ data: { title: `PCB Checker — Setări ${name}`, tabs: [tab] } });
      rememberSheet(r.spreadsheetId);
      await push({ data: { spreadsheetId: r.spreadsheetId, tab, rows: flattenSettings(draft) } });
      toast.success("Foaia a fost creată și completată cu setările curente.");
      window.open(r.url, "_blank", "noreferrer");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const mySeries = useMemo(() => {
    const s = structure.data;
    if (!s) return [];
    return isAdmin ? s.series : s.series.filter((x) => s.managers.some((m) => m.series_id === x.id && m.user_id === user.id));
  }, [structure.data, isAdmin, user.id]);

  useEffect(() => { if (!isAdmin && scope === "GLOBAL" && mySeries[0]) setScope(mySeries[0].id); }, [isAdmin, scope, mySeries]);

  if (!allowed) return <p className="text-sm text-muted-foreground">Doar Administratorul și Managerii de serie pot modifica regulile.</p>;

  const setRule = (k: keyof RuleValues, v: number) => setDraft((d) => ({ ...d, rules: { ...d.rules, [k]: v } }));
  const setCam = (k: keyof CamValues, v: number | boolean) => setDraft((d) => ({ ...d, cam: { ...d.cam, [k]: v } }));

  const save = async (s: Settings = draft) => {
    setBusy("Se salvează…");
    try {
      await saveSettings(seriesId, s, user.id);
      await logAudit(user.id, "RULES_UPDATE", seriesId ? "series" : "global", seriesId, { rules: s.rules });
      qc.invalidateQueries({ queryKey: ["drc-settings"] });
      toast.success("Setările au fost salvate și se aplică la următoarele verificări.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  };

  const askAi = async () => {
    if (!prompt.trim()) return;
    setBusy("Gemini analizează cererea…");
    try { setPatch(await ai({ data: { prompt, current: draft } })); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const applyPatch = () => {
    if (!patch) return;
    const merged = mergeSettings(draft, { rules: patch.rules as Partial<RuleValues> as RuleValues, cam: patch.cam as Partial<CamValues> as CamValues, penalties: patch.penalties as Settings["penalties"] });
    setDraft(merged);
    setPatch(null);
    toast.success("Propunerea a fost aplicată în formular. Verificați și apăsați Salvează.");
  };

  const sid = extractSpreadsheetId(sheetUrl) ?? sheetUrl.trim();
  const doPush = async () => {
    if (!sid) return void toast.error("Introduceți linkul foii Google Sheets.");
    setBusy("Se trimite în Google Sheets…");
    try { const r = await push({ data: { spreadsheetId: sid, tab, rows: flattenSettings(draft) } }); toast.success(`${r.rows} setări scrise în foaia „${tab}”.`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const doPull = async () => {
    if (!sid) return void toast.error("Introduceți linkul foii Google Sheets.");
    setBusy("Se citește din Google Sheets…");
    try {
      const r = await pull({ data: { spreadsheetId: sid, tab } });
      if (!r.rows.length) throw new Error(`Foaia „${tab}” este goală.`);
      const next = unflattenSettings(r.rows, draft);
      setDraft(next);
      await save(next);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const num = (v: string) => Number(v.replace(",", "."));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Reguli & Setări</h1>
          <p className="text-sm text-muted-foreground">Valorile se aplică la self-check, la evaluarea pe loturi și în generatorul CAM. Setările unei serii au prioritate față de cele generale.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              {isAdmin && <SelectItem value="GLOBAL">Setări generale (toate seriile)</SelectItem>}
              {mySeries.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={() => setDraft(structuredClone(DEFAULT_SETTINGS))}><RotateCcw className="mr-2 h-4 w-4" /> Valori Rev. G</Button>
          <Button onClick={() => save()} disabled={!!busy}><Save className="mr-2 h-4 w-4" /> Salvează</Button>
        </div>
      </div>
      {busy && <p className="text-sm text-muted-foreground">{busy}</p>}

      <Tabs defaultValue="rules">
        <TabsList className="flex-wrap">
          <TabsTrigger value="rules">Reguli DRC</TabsTrigger>
          <TabsTrigger value="score">Punctaj & severitate</TabsTrigger>
          <TabsTrigger value="cam">Panou & Stencil</TabsTrigger>
          <TabsTrigger value="ai">Asistent AI</TabsTrigger>
          <TabsTrigger value="sheets">Google Sheets</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="grid gap-4 md:grid-cols-2">
          {groupBy(RULE_FIELDS).map(([g, keys]) => (
            <Card key={g}>
              <CardHeader className="pb-3"><CardTitle className="text-base">{g}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {keys.map((k) => (
                  <div key={k} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                    <Label className="text-sm">{RULE_FIELDS[k].label}{RULE_FIELDS[k].unit && <span className="text-muted-foreground"> ({RULE_FIELDS[k].unit})</span>}
                      {RULE_FIELDS[k].help && <span className="block text-xs text-muted-foreground">{RULE_FIELDS[k].help}</span>}
                      {RULE_FIELDS[k].unit === "mm" && <span className="block text-xs text-muted-foreground">{(draft.rules[k] / 0.0254).toFixed(1)} mil</span>}
                    </Label>
                    <Input type="number" step={RULE_FIELDS[k].step} value={draft.rules[k]} onChange={(e) => setRule(k, num(e.target.value))} className="font-mono" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="score">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-[1fr_6rem_9rem_5rem_4rem] items-center gap-2 border-b border-border pb-2 text-xs font-medium text-muted-foreground">
                <span>Regulă</span><span>Penalizare</span><span>Severitate</span><span>Activă</span><span>Doar SMT</span>
              </div>
              {Object.entries(draft.penalties).map(([code, p]) => (
                <div key={code} className="grid grid-cols-[1fr_6rem_9rem_5rem_4rem] items-center gap-2 border-b border-border/50 py-1.5 text-sm">
                  <span>{TITLES[code] ?? code} <span className="font-mono text-xs text-muted-foreground">{code}</span></span>
                  <Input type="number" value={p.points} onChange={(e) => setDraft((d) => ({ ...d, penalties: { ...d.penalties, [code]: { ...p, points: num(e.target.value) } } }))} className="h-8 font-mono" />
                  <Select value={p.severity} onValueChange={(v) => setDraft((d) => ({ ...d, penalties: { ...d.penalties, [code]: { ...p, severity: v as typeof p.severity } } }))}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="blocking">Blocant</SelectItem>
                      <SelectItem value="warning">Avertisment</SelectItem>
                      <SelectItem value="info">Informativ</SelectItem>
                    </SelectContent>
                  </Select>
                  <Switch checked={p.enabled} aria-label={`Regulă activă: ${TITLES[code] ?? code}`} onCheckedChange={(v) => setDraft((d) => ({ ...d, penalties: { ...d.penalties, [code]: { ...p, enabled: v } } }))} />
                  <Switch checked={p.smtOnly} aria-label={`Doar SMT: ${TITLES[code] ?? code}`} onCheckedChange={(v) => setDraft((d) => ({ ...d, penalties: { ...d.penalties, [code]: { ...p, smtOnly: v } } }))} />
                </div>
              ))}
              <p className="mt-3 text-xs text-muted-foreground">Scorul = 100 − suma penalizărilor regulilor picate. Regulile blocante împiedică predarea oficială.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cam" className="grid gap-4 md:grid-cols-2">
          {groupBy(CAM_FIELDS).map(([g, keys]) => (
            <Card key={g}>
              <CardHeader className="pb-3"><CardTitle className="text-base">{g}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {keys.map((k) => {
                  const v = draft.cam[k];
                  return (
                    <div key={k} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                      <Label className="text-sm">{CAM_FIELDS[k].label}{CAM_FIELDS[k].unit && <span className="text-muted-foreground"> ({CAM_FIELDS[k].unit})</span>}</Label>
                      {typeof v === "boolean"
                        ? <Switch checked={v} aria-label={CAM_FIELDS[k].label} onCheckedChange={(x) => setCam(k, x)} />
                        : <Input type="number" step={CAM_FIELDS[k].step} value={v} onChange={(e) => setCam(k, num(e.target.value))} className="font-mono" />}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="ai">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Asistent Gemini</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Aplică revizia G: izolație 14 mil, trasee de semnal 16 mil, iar găurile sub 0.6 mm să fie doar avertisment." />
              <Button onClick={askAi} disabled={!!busy || !prompt.trim()}><Sparkles className="mr-2 h-4 w-4" /> Propune modificări</Button>
              {patch && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm">{patch.explanation}</p>
                  <ul className="space-y-1 font-mono text-xs">
                    {Object.entries(patch.rules ?? {}).map(([k, v]) => <li key={k}>rules.{k}: {String(draft.rules[k as keyof RuleValues])} → <b>{v}</b></li>)}
                    {Object.entries(patch.cam ?? {}).map(([k, v]) => <li key={k}>cam.{k}: {String(draft.cam[k as keyof CamValues])} → <b>{String(v)}</b></li>)}
                    {Object.entries(patch.penalties ?? {}).map(([k, v]) => <li key={k}>penalties.{k}: {JSON.stringify(v)}</li>)}
                  </ul>
                  <div className="flex gap-2"><Button size="sm" onClick={applyPatch}>Aplică în formular</Button><Button size="sm" variant="ghost" onClick={() => setPatch(null)}>Renunță</Button></div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sheets">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Sincronizare bidirecțională</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!sid || manualLink ? (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm text-muted-foreground">Nu există încă o foaie de setări pentru acest domeniu. O creez eu sau o folosiți pe a dumneavoastră?</p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={doCreate} disabled={!!busy}>Creează foaie nouă</Button>
                    <Button variant="outline" onClick={() => setManualLink(true)}>Am deja o foaie</Button>
                  </div>
                  {manualLink && (
                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                      <Input aria-label="Link foaie existentă" placeholder="https://docs.google.com/spreadsheets/d/…" onBlur={(e) => { const id = extractSpreadsheetId(e.target.value); if (id) { rememberSheet(id); setManualLink(false); } }} />
                      <Button variant="ghost" onClick={() => setManualLink(false)}>Renunță</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Button asChild variant="outline"><a href={`https://docs.google.com/spreadsheets/d/${sid}/edit`} target="_blank" rel="noreferrer">Deschide în Google Sheets</a></Button>
                  <Button variant="ghost" size="sm" onClick={() => setManualLink(true)}>Schimbă foaia</Button>
                </div>
              )}
              <div className="max-w-xs"><Label>Tab</Label><Input value={tab} onChange={(e) => setTab(e.target.value)} /></div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={doPush} disabled={!!busy}><Upload className="mr-2 h-4 w-4" /> Trimite setările în foaie</Button>
                <Button variant="secondary" onClick={doPull} disabled={!!busy}><Download className="mr-2 h-4 w-4" /> Preia setările din foaie și salvează</Button>
              </div>
              <p className="text-xs text-muted-foreground">Foaia conține coloanele cheie / valoare / descriere. Modificați doar coloana „valoare”; tabul se creează automat.</p>
              <Badge variant="secondary">{flattenSettings(draft).length} setări</Badge>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
