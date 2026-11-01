import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, RotateCcw, Save, Sparkles, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchStructure, logAudit , seriesLabel, sortSeriesByYear } from "@/lib/data";
import {
  CAM_FIELDS, DEFAULT_SETTINGS, deriveCam, fetchSettings, flattenSettings, mergeSettings, saveSettings, unflattenSettings,
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
import { UnifiedRules } from "@/components/UnifiedRules";
import { GoldenSuitePanel } from "@/components/GoldenSuitePanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RuleSandbox, settingsDiff } from "@/components/RuleSandbox";

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
  const [activeTab, setActiveTab] = useState("rules");

  const goTest = () => { setActiveTab("rules"); setTimeout(() => document.getElementById("rule-sandbox")?.scrollIntoView({ behavior: "smooth" }), 50); };
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
      const name = scope === "GLOBAL" ? "Global" : (() => { const x = structure.data?.series.find((x) => x.id === scope); return x ? seriesLabel(x, structure.data?.years) : "Serie"; })();
      const r = await createSheet({ data: { title: `PCB Checker — Setări ${name}`, tabs: [tab] } });
      rememberSheet(r.spreadsheetId);
      if (seriesId && !link.data) {
        await supabase.from("sheet_links").insert({ series_id: seriesId, spreadsheet_id: r.spreadsheetId, sheet_name: tab, updated_by: user.id });
        await link.refetch();
      }
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

  const setCam = (k: keyof CamValues, v: number | boolean) => setDraft((d) => deriveCam({ ...d, cam: { ...d.cam, [k]: v } }));

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
    const merged = mergeSettings(draft, { rules: patch.rules as Partial<RuleValues> as RuleValues, cam: patch.cam as Partial<CamValues> as CamValues, penalties: patch.penalties as Settings["penalties"], ...(patch.overrides ? { overrides: patch.overrides } : {}) });
    setDraft(merged);
    setPatch(null);
    goTest();
    toast.success("Propunerea a fost aplicată. Testați-o pe proiecte înainte de activare.");
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
              {sortSeriesByYear(mySeries, structure.data?.years).map((s) => <SelectItem key={s.id} value={s.id}>{seriesLabel(s, structure.data?.years)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={() => setDraft(structuredClone(DEFAULT_SETTINGS))}><RotateCcw className="mr-2 h-4 w-4" /> Valori Rev. G</Button>
          <Button onClick={() => {
            if (current.data && settingsDiff(current.data, draft).length) { goTest(); toast.info("Regulile modificate trebuie testate pe proiecte și confirmate înainte de activare."); return; }
            void save();
          }} disabled={!!busy}><Save className="mr-2 h-4 w-4" /> Salvează</Button>
          {isAdmin && current.data && settingsDiff(current.data, draft).length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { if (window.confirm("Salvați fără testare? Acțiunea se notează în jurnal.")) void save(); }}>Salvează fără test</Button>
          )}
        </div>
      </div>
      {busy && <p className="text-sm text-muted-foreground">{busy}</p>}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="rules">Reguli DRC{current.data && settingsDiff(current.data, draft).length ? ` · ${settingsDiff(current.data, draft).length} de testat` : ""}</TabsTrigger>
          <TabsTrigger value="cam">Panou & Stencil</TabsTrigger>
          <TabsTrigger value="sheets">Google Sheets</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <UnifiedRules draft={draft} setDraft={setDraft} baseline={current.data} onTest={goTest} />
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Asistent AI — modifică regulile existente</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Aplică revizia G: izolație 14 mil, trasee 16 mil; rescrie explicația la serigrafie mai simplu; găurile sub 0.6 mm doar avertisment." aria-label="Cerere pentru asistentul AI" />
              <Button onClick={askAi} disabled={!!busy || !prompt.trim()}><Sparkles className="mr-2 h-4 w-4" /> Propune modificări</Button>
              {patch && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-sm">{patch.explanation}</p>
                  <ul className="space-y-1 font-mono text-xs">
                    {Object.entries(patch.rules ?? {}).map(([k, v]) => <li key={k}>rules.{k}: {String(draft.rules[k as keyof RuleValues])} → <b>{v}</b></li>)}
                    {Object.entries(patch.cam ?? {}).map(([k, v]) => <li key={k}>cam.{k}: {String(draft.cam[k as keyof CamValues])} → <b>{String(v)}</b></li>)}
                    {Object.entries(patch.penalties ?? {}).map(([k, v]) => <li key={k}>penalties.{k}: {JSON.stringify(v)}</li>)}
                    {Object.entries(patch.overrides ?? {}).map(([k, v]) => <li key={k}>texte.{k}: {JSON.stringify(v)}</li>)}
                  </ul>
                  <div className="flex gap-2"><Button size="sm" onClick={applyPatch}>Aplică în formular</Button><Button size="sm" variant="ghost" onClick={() => setPatch(null)}>Renunță</Button></div>
                </div>
              )}
            </CardContent>
          </Card>
          <GoldenSuitePanel />
          <div id="rule-sandbox" className="scroll-mt-4">
            <h2 className="mb-2 text-lg font-semibold text-foreground">Testare pe proiecte înainte de activare</h2>
            {current.data && <RuleSandbox seriesId={seriesId} baseline={current.data} candidate={draft} userId={user.id} onActivate={(x) => save(x)} />}
          </div>
        </TabsContent>

        <TabsContent value="cam" className="grid gap-4 md:grid-cols-2">
          {groupBy(CAM_FIELDS).map(([g, keys]) => (
            <Card key={g}>
              <CardHeader className="pb-3"><CardTitle className="text-base">{g}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {keys.map((k) => {
                  const v = draft.cam[k];
                  const derived = draft.cam.autoFromBoard && ["board", "panelPitch", "stencilPitch", "stencilPitchY"].includes(k);
                  return (
                    <div key={k} className="grid grid-cols-[1fr_8rem] items-center gap-3">
                      <Label className="text-sm">{CAM_FIELDS[k].label}{CAM_FIELDS[k].unit && <span className="text-muted-foreground"> ({CAM_FIELDS[k].unit})</span>}
                        {derived && <span className="block text-xs text-muted-foreground">Calculat automat din dimensiunea plăcii</span>}
                        {CAM_FIELDS[k].help && <span className="block text-xs text-muted-foreground">{CAM_FIELDS[k].help}</span>}</Label>
                      {typeof v === "boolean"
                        ? <Switch checked={v} aria-label={CAM_FIELDS[k].label} onCheckedChange={(x) => setCam(k, x)} />
                        : <Input type="number" step={CAM_FIELDS[k].step} value={v} disabled={derived} aria-label={CAM_FIELDS[k].label} onChange={(e) => setCam(k, num(e.target.value))} className="font-mono" />}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
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
