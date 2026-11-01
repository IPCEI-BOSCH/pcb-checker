import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FlaskConical, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CHECK_TYPES, DEFAULT_SETTINGS, GENERAL_FIELDS, RULE_FIELDS, RULE_LINKS, appliesToOf, blankCustomRule, deriveCam,
  type AppliesTo, type CustomCategory, type CustomCheckType, type CustomLayer, type CustomRule, type PenaltyValue, type RuleValues, type Settings,
} from "@/lib/drc/settings";
import { CATALOG, CATEGORY_LABELS } from "@/lib/drc/catalog";
import { TITLES } from "@/lib/drc/engine";
import { LAYER_LABELS } from "@/lib/gerber/types";
import { aiCreateRule } from "@/lib/ai/rule-ai.functions";

type SetDraft = (f: (d: Settings) => Settings) => void;
type Row =
  | { kind: "std"; code: string; title: string; category: string; err: string; p: PenaltyValue; modified: boolean }
  | { kind: "custom"; code: string; title: string; category: string; err: string; p: PenaltyValue; idx: number; rule: CustomRule; modified: boolean };

const SEV_LABEL = { blocking: "Blocant", warning: "Avertisment", info: "Informativ" } as const;
const APPLIES_LABEL: Record<AppliesTo, string> = { ALL: "SMT + THT", SMT: "Doar SMT", THT: "Doar THT" };
const num = (v: string) => Number(v.replace(",", "."));

export function UnifiedRules({ draft, setDraft, baseline, onTest }: { draft: Settings; setDraft: SetDraft; baseline?: Settings | undefined; onTest: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [edit, setEdit] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const codes = [...new Set([...Object.keys(DEFAULT_SETTINGS.penalties), ...Object.keys(draft.penalties)])];
    for (const code of codes) {
      const p = draft.penalties[code] ?? DEFAULT_SETTINGS.penalties[code]!;
      const c = CATALOG[code];
      const o = draft.overrides?.[code];
      const b = baseline?.penalties[code];
      const linkedChanged = (RULE_LINKS[code] ?? []).some((k) => baseline && baseline.rules[k] !== draft.rules[k]);
      out.push({ kind: "std", code, title: o?.title || TITLES[code] || code, category: c?.category ?? "STRUCT", err: c?.err ?? "", p, modified: !!baseline && (JSON.stringify(b) !== JSON.stringify(p) || JSON.stringify(baseline.overrides?.[code]) !== JSON.stringify(o) || linkedChanged) });
    }
    (draft.customRules ?? []).forEach((r, idx) => {
      const b = baseline?.customRules?.find((x) => x.code === r.code);
      out.push({ kind: "custom", code: r.code, title: r.title, category: r.category, err: "NOU", idx, rule: r, p: { points: r.points, severity: r.severity, enabled: r.enabled, smtOnly: r.smtOnly, appliesTo: r.appliesTo, perIssue: r.perIssue, cap: r.cap, critical: r.critical }, modified: !!baseline && JSON.stringify(b) !== JSON.stringify(r) });
    });
    return out;
  }, [draft, baseline]);

  const filtered = rows.filter((r) => {
    if (cat !== "ALL" && r.category !== cat) return false;
    if (status === "ON" && !r.p.enabled) return false;
    if (status === "OFF" && r.p.enabled) return false;
    if (status === "CRIT" && !r.p.critical) return false;
    if (status === "BLOCK" && r.p.severity !== "blocking") return false;
    if (status === "MOD" && !r.modified) return false;
    if (status === "NEW" && r.kind !== "custom") return false;
    if (q && !`${r.code} ${r.err} ${r.title}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const modifiedCount = rows.filter((r) => r.modified).length;

  const setPenalty = (code: string, patch: Partial<PenaltyValue>) =>
    setDraft((d) => {
      const cur = d.penalties[code] ?? DEFAULT_SETTINGS.penalties[code]!;
      const next = { ...cur, ...patch };
      if (patch.appliesTo) next.smtOnly = patch.appliesTo === "SMT";
      return { ...d, penalties: { ...d.penalties, [code]: next } };
    });
  const setCustom = (idx: number, patch: Partial<CustomRule>) =>
    setDraft((d) => ({ ...d, customRules: (d.customRules ?? []).map((r, k) => (k === idx ? { ...r, ...patch, ...(patch.appliesTo ? { smtOnly: patch.appliesTo === "SMT" } : {}) } : r)) }));
  const toggle = (r: Row, v: boolean) => (r.kind === "std" ? setPenalty(r.code, { enabled: v }) : setCustom(r.idx, { enabled: v }));

  const current = rows.find((r) => r.code === edit) ?? null;

  return (
    <div className="space-y-4">
      <GeneralCard draft={draft} setDraft={setDraft} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Toate regulile DRC ({rows.length})</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-4 w-4" /> Adaugă regulă</Button>
              <Button size="sm" variant="secondary" onClick={onTest}><FlaskConical className="mr-1 h-4 w-4" /> Testează modificările{modifiedCount ? ` (${modifiedCount})` : ""}</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Caută cod, ERR sau denumire" className="h-9 w-64 pl-8" aria-label="Caută regulă" />
            </div>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="h-9 w-48" aria-label="Categorie"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toate categoriile</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-48" aria-label="Stare"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Toate</SelectItem>
                <SelectItem value="ON">Active</SelectItem>
                <SelectItem value="OFF">Dezactivate</SelectItem>
                <SelectItem value="CRIT">Critice</SelectItem>
                <SelectItem value="BLOCK">Blocante</SelectItem>
                <SelectItem value="MOD">Modificate (netestate)</SelectItem>
                <SelectItem value="NEW">Reguli noi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2">Regulă</th><th className="pr-2">Categorie</th><th className="pr-2">Prag</th><th className="pr-2">Puncte</th>
                <th className="pr-2">Severitate</th><th className="pr-2">Variantă</th><th className="pr-2">Activă</th><th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.code} className={`border-b border-border/50 ${r.p.enabled ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-2">
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setEdit(r.code)}>{r.title}</button>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <span className="font-mono text-xs text-muted-foreground">{r.err ? `${r.err} · ` : ""}{r.code}</span>
                      {r.p.critical && <Badge variant="destructive" className="h-4 text-[10px]">Critică</Badge>}
                      {r.kind === "custom" && <Badge variant="outline" className="h-4 text-[10px]">Nouă</Badge>}
                      {r.modified && <Badge variant="secondary" className="h-4 text-[10px]">Modificată</Badge>}
                    </div>
                  </td>
                  <td className="pr-2 text-xs">{CATEGORY_LABELS[r.category as CustomCategory] ?? r.category}</td>
                  <td className="pr-2 font-mono text-xs">{thresholdSummary(r, draft)}</td>
                  <td className="pr-2 font-mono text-xs">{r.p.points}{r.p.perIssue ? ` +${r.p.perIssue}` : ""} / {r.p.cap ?? r.p.points}</td>
                  <td className="pr-2 text-xs">{SEV_LABEL[r.p.severity]}</td>
                  <td className="pr-2 text-xs">{APPLIES_LABEL[appliesToOf(r.p)]}</td>
                  <td className="pr-2"><Switch checked={r.p.enabled} onCheckedChange={(v) => toggle(r, v)} aria-label={`Regulă activă: ${r.title}`} /></td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setEdit(r.code)} aria-label={`Editează ${r.title}`}><Pencil className="h-4 w-4" /></Button></td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Nicio regulă pentru filtrele alese.</td></tr>}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Penalizare = puncte + (+/apariție × apariții suplimentare), limitată la plafon. Scor = 100 − suma penalizărilor. O regulă critică picată limitează scorul și respinge fabricația. Modificările se activează după testare pe proiecte.</p>
        </CardContent>
      </Card>

      <Sheet open={!!current} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {current && (
            <>
              <SheetHeader>
                <SheetTitle>{current.title}</SheetTitle>
                <SheetDescription className="font-mono">{current.err ? `${current.err} · ` : ""}{current.code}</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                {current.kind === "std"
                  ? <StdEditor code={current.code} draft={draft} setDraft={setDraft} setPenalty={setPenalty} />
                  : <CustomEditor rule={current.rule} onChange={(patch) => setCustom(current.idx, patch)} onDelete={() => { setDraft((d) => ({ ...d, customRules: (d.customRules ?? []).filter((_, k) => k !== current.idx) })); setEdit(null); }} />}
                <div className="mt-6 flex gap-2">
                  <Button variant="secondary" onClick={() => { setEdit(null); onTest(); }}><FlaskConical className="mr-1 h-4 w-4" /> Testează pe proiecte</Button>
                  <Button variant="ghost" onClick={() => setEdit(null)}>Închide</Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AddRuleDialog open={addOpen} onOpenChange={setAddOpen} existing={rows.map((r) => r.code)} onAdd={(r) => { setDraft((d) => ({ ...d, customRules: [...(d.customRules ?? []), r] })); setAddOpen(false); setEdit(r.code); }} />
    </div>
  );
}

function thresholdSummary(r: Row, d: Settings) {
  if (r.kind === "custom") {
    const m = CHECK_TYPES[r.rule.checkType];
    return r.rule.checkType === "layer_required" ? LAYER_LABELS[r.rule.layer] : `${m.label.split(" ").slice(0, 2).join(" ")} ${r.rule.value}${m.unit ? ` ${m.unit}` : ""}`;
  }
  const keys = RULE_LINKS[r.code] ?? [];
  if (!keys.length) return "—";
  return keys.slice(0, 2).map((k) => `${d.rules[k]}${RULE_FIELDS[k].unit === "mm" ? " mm" : ""}`).join(" · ") + (keys.length > 2 ? " …" : "");
}

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string | undefined }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function ThresholdInput({ k, draft, setDraft }: { k: keyof RuleValues; draft: Settings; setDraft: SetDraft }) {
  const f = RULE_FIELDS[k];
  const v = draft.rules[k];
  return (
    <Field label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} help={[f.help, f.unit === "mm" ? `${(v / 0.0254).toFixed(1)} mil · implicit ${DEFAULT_SETTINGS.rules[k]}` : `implicit ${DEFAULT_SETTINGS.rules[k]}`].filter(Boolean).join(" — ")}>
      <Input type="number" step={f.step} value={v} onChange={(e) => setDraft((d) => deriveCam({ ...d, rules: { ...d.rules, [k]: num(e.target.value) }, cam: { ...d.cam } }))} className="h-8 font-mono" />
    </Field>
  );
}

function ScoringFields({ p, onChange }: { p: PenaltyValue; onChange: (x: Partial<PenaltyValue>) => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Puncte (prima apariție)"><Input type="number" value={p.points} onChange={(e) => onChange({ points: num(e.target.value) })} className="h-8 font-mono" /></Field>
        <Field label="+ per apariție suplimentară"><Input type="number" value={p.perIssue ?? 0} onChange={(e) => onChange({ perIssue: num(e.target.value) })} className="h-8 font-mono" /></Field>
        <Field label="Plafon total"><Input type="number" value={p.cap ?? p.points} onChange={(e) => onChange({ cap: num(e.target.value) })} className="h-8 font-mono" /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Severitate">
          <Select value={p.severity} onValueChange={(v) => onChange({ severity: v as PenaltyValue["severity"] })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="blocking">Blocant (împiedică aprobarea)</SelectItem><SelectItem value="warning">Avertisment</SelectItem><SelectItem value="info">Informativ</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field label="Se aplică la">
          <Select value={appliesToOf(p)} onValueChange={(v) => onChange({ appliesTo: v as AppliesTo })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(APPLIES_LABEL) as AppliesTo[]).map((k) => <SelectItem key={k} value={k}>{APPLIES_LABEL[k]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2"><Switch checked={p.enabled} onCheckedChange={(v) => onChange({ enabled: v })} aria-label="Activă" /> Activă</label>
        <label className="flex items-center gap-2"><Switch checked={!!p.critical} onCheckedChange={(v) => onChange({ critical: v })} aria-label="Critică" /> Critică (limitează scorul, respinge fabricația)</label>
      </div>
    </>
  );
}

function StdEditor({ code, draft, setDraft, setPenalty }: { code: string; draft: Settings; setDraft: SetDraft; setPenalty: (c: string, p: Partial<PenaltyValue>) => void }) {
  const p = draft.penalties[code] ?? DEFAULT_SETTINGS.penalties[code]!;
  const c = CATALOG[code];
  const o = draft.overrides?.[code] ?? {};
  const setO = (patch: Record<string, string>) => setDraft((d) => ({ ...d, overrides: { ...(d.overrides ?? {}), [code]: { ...(d.overrides?.[code] ?? {}), ...patch } } }));
  const links = RULE_LINKS[code] ?? [];
  return (
    <div className="space-y-5">
      <Section title="Identificare">
        <Field label="Denumire afișată" help={`Implicit: ${TITLES[code] ?? code}`}><Input value={o.title ?? ""} placeholder={TITLES[code]} onChange={(e) => setO({ title: e.target.value })} className="h-8" /></Field>
        {c && <p className="text-xs text-muted-foreground">Categorie: {CATEGORY_LABELS[c.category]} · cod standard {c.err}</p>}
      </Section>
      <Section title="Prag de detecție">
        {links.length ? <div className="grid gap-3 sm:grid-cols-2">{links.map((k) => <ThresholdInput key={k} k={k} draft={draft} setDraft={setDraft} />)}</div>
          : <p className="text-xs text-muted-foreground">Regula este o verificare de prezență/structură, fără prag numeric.</p>}
        {links.some((k) => ["boardSize", "boardHeight"].includes(k)) && <p className="text-xs text-muted-foreground">Dimensiunea plăcii recalculează automat panoul și stencilul.</p>}
      </Section>
      <Section title="Punctaj & severitate"><ScoringFields p={p} onChange={(x) => setPenalty(code, x)} /></Section>
      <Section title="Explicații pentru student (gol = text standard)">
        <Field label="Ce e greșit"><Textarea rows={2} value={o.what ?? ""} placeholder={c?.what} onChange={(e) => setO({ what: e.target.value })} /></Field>
        <Field label="De ce contează la fabricație"><Textarea rows={2} value={o.why ?? ""} placeholder={c?.why} onChange={(e) => setO({ why: e.target.value })} /></Field>
        <Field label="Cum repară în OrCAD / Allegro"><Textarea rows={3} value={o.fix ?? ""} placeholder={c?.fix} onChange={(e) => setO({ fix: e.target.value })} /></Field>
      </Section>
      <Section title="Documentare">
        <Field label="Referință (IPC, CETTI, curs)"><Input value={o.reference ?? ""} onChange={(e) => setO({ reference: e.target.value })} className="h-8" /></Field>
        <Field label="Notă internă profesor (nu apare la student)"><Textarea rows={2} value={o.teacherNote ?? ""} onChange={(e) => setO({ teacherNote: e.target.value })} /></Field>
      </Section>
      <Button variant="ghost" size="sm" onClick={() => setDraft((d) => {
        const ov = { ...(d.overrides ?? {}) }; delete ov[code];
        const rules = { ...d.rules }; for (const k of links) rules[k] = DEFAULT_SETTINGS.rules[k];
        return deriveCam({ ...d, overrides: ov, rules, cam: { ...d.cam }, penalties: { ...d.penalties, [code]: structuredClone(DEFAULT_SETTINGS.penalties[code]!) } });
      })}><RotateCcw className="mr-1 h-4 w-4" /> Revino la valorile standard</Button>
    </div>
  );
}

function CustomEditor({ rule: r, onChange, onDelete }: { rule: CustomRule; onChange: (p: Partial<CustomRule>) => void; onDelete: () => void }) {
  const meta = CHECK_TYPES[r.checkType];
  const isPad = r.checkType === "min_pad" || r.checkType === "max_pad";
  const isCount = ["max_holes", "min_holes", "max_primitives", "layer_required", "layer_primitive_count", "required_silk_aspect"].includes(r.checkType);
  const noValue = ["layer_required", "required_silk_aspect"].includes(r.checkType);
  const hasMax = ["feature_dimension_range", "layer_primitive_count"].includes(r.checkType);
  const hasLayer2 = r.checkType === "cross_layer_clearance";
  const hasRegion = r.checkType === "required_silk_aspect";
  return (
    <div className="space-y-5">
      <Section title="Identificare">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Denumire"><Input value={r.title} onChange={(e) => onChange({ title: e.target.value })} className="h-8" /></Field>
          <Field label="Cod (unic)"><Input value={r.code} disabled className="h-8 font-mono" /></Field>
          <Field label="Categorie">
            <Select value={r.category} onValueChange={(v) => onChange({ category: v as CustomCategory })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CATEGORY_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </Section>
      <Section title="Ce se verifică">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tip verificare" help={meta.help}>
            <Select value={r.checkType} onValueChange={(v) => { const ct = v as CustomCheckType; const ls = CHECK_TYPES[ct].layers; onChange({ checkType: ct, layer: ls.includes(r.layer) ? r.layer : ls[0]! }); }}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CHECK_TYPES).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Strat / fișier">
            <Select value={r.layer} onValueChange={(v) => onChange({ layer: v as CustomLayer })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{meta.layers.map((l) => <SelectItem key={l} value={l}>{LAYER_LABELS[l]}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {!noValue && (
            <Field label={`${hasMax ? "Minim" : "Prag"}${meta.unit ? ` (${meta.unit})` : ""}`} help={meta.unit === "mm" ? `${(r.value / 0.0254).toFixed(1)} mil` : undefined}>
              <Input type="number" step="0.01" value={r.value} onChange={(e) => onChange({ value: num(e.target.value) })} className="h-8 font-mono" />
            </Field>
          )}
          {hasMax && (
            <Field label={`Maxim${meta.unit ? ` (${meta.unit})` : ""}`} help="0 sau gol = fără limită superioară">
              <Input type="number" step="0.01" value={r.value2 ?? 0} onChange={(e) => onChange({ value2: num(e.target.value) })} className="h-8 font-mono" />
            </Field>
          )}
          {hasLayer2 && (
            <Field label="Al doilea strat">
              <Select value={r.layer2 ?? "bottom_copper"} onValueChange={(v) => onChange({ layer2: v as CustomLayer })}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(LAYER_LABELS).map((l) => <SelectItem key={l} value={l}>{LAYER_LABELS[l as CustomLayer]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          {!isCount && (
            <Field label="Toleranță rotunjire (mm)" help="Evită depunctarea pentru diferențe de export (ex. 0.005)">
              <Input type="number" step="0.001" value={r.tolerance ?? 0} onChange={(e) => onChange({ tolerance: num(e.target.value) })} className="h-8 font-mono" />
            </Field>
          )}
          {!isCount && (
            <Field label="Depunctează de la (apariții)" help="Sub acest număr de cazuri regula doar notează">
              <Input type="number" min={1} value={r.minOccurrences ?? 1} onChange={(e) => onChange({ minOccurrences: Math.max(1, num(e.target.value)) })} className="h-8 font-mono" />
            </Field>
          )}
        </div>
        {hasRegion && (
          <div className="grid gap-3 sm:grid-cols-4">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <Field key={k} label={`${k === "w" ? "Lățime" : k === "h" ? "Înălțime" : k.toUpperCase()} (mm)`} help={k === "x" ? "Gol = toată placa" : undefined}>
                <Input type="number" step="0.5" value={r.region?.[k] ?? ""} onChange={(e) => {
                  const v = e.target.value === "" ? undefined : num(e.target.value);
                  const reg = { x: 0, y: 0, w: 0, h: 0, ...(r.region ?? {}) };
                  if (v === undefined) delete reg[k];
                  else reg[k] = v;
                  onChange({ region: Object.keys(reg).length === 4 ? reg as { x: number; y: number; w: number; h: number } : undefined });
                }} className="h-8 font-mono" />
              </Field>
            ))}
          </div>
        )}
        {isPad && <label className="flex items-center gap-2 text-sm"><Switch checked={!!r.ignoreHoled} onCheckedChange={(v) => onChange({ ignoreHoled: v })} aria-label="Ignoră pad-urile cu gaură" /> Ignoră pad-urile cu gaură (VIA / THT)</label>}
      </Section>
      <Section title="Punctaj & severitate">
        <ScoringFields p={{ points: r.points, perIssue: r.perIssue, cap: r.cap, severity: r.severity, enabled: r.enabled, critical: r.critical, smtOnly: r.smtOnly, appliesTo: r.appliesTo }} onChange={(x) => onChange(x as Partial<CustomRule>)} />
      </Section>
      <Section title="Explicații pentru student">
        <Field label="Ce e greșit"><Textarea rows={2} value={r.what} onChange={(e) => onChange({ what: e.target.value })} /></Field>
        <Field label="De ce contează la fabricație"><Textarea rows={2} value={r.why} onChange={(e) => onChange({ why: e.target.value })} /></Field>
        <Field label="Cum repară în OrCAD / Allegro"><Textarea rows={3} value={r.fix} onChange={(e) => onChange({ fix: e.target.value })} /></Field>
        <Field label="Exemplu de proiectare corectă"><Textarea rows={2} value={r.example ?? ""} onChange={(e) => onChange({ example: e.target.value })} /></Field>
      </Section>
      <Section title="Documentare">
        <Field label="Referință (IPC, CETTI, curs)"><Input value={r.reference ?? ""} onChange={(e) => onChange({ reference: e.target.value })} className="h-8" /></Field>
        <Field label="Notă internă profesor"><Textarea rows={2} value={r.teacherNote ?? ""} onChange={(e) => onChange({ teacherNote: e.target.value })} /></Field>
      </Section>
      <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Ștergeți regula ${r.code}?`)) onDelete(); }}><Trash2 className="mr-1 h-4 w-4" /> Șterge regula</Button>
    </div>
  );
}

function GeneralCard({ draft, setDraft }: { draft: Settings; setDraft: SetDraft }) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Verdict și scor</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        {GENERAL_FIELDS.map((k) => <ThresholdInput key={k} k={k} draft={draft} setDraft={setDraft} />)}
      </CardContent>
    </Card>
  );
}

function AddRuleDialog({ open, onOpenChange, existing, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; existing: string[]; onAdd: (r: CustomRule) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const create = useServerFn(aiCreateRule);
  const uniq = (code: string) => { let c = code; while (existing.includes(c)) c += "_2"; return c; };
  const askAi = async () => {
    setBusy(true);
    try {
      const r = await create({ data: { prompt, existingCodes: existing } });
      const { explanation, ...rest } = r;
      onAdd({ ...blankCustomRule(), ...(rest as Partial<CustomRule>), code: uniq(rest.code), enabled: true });
      toast.success(`Regulă propusă de AI: ${explanation}`);
      setPrompt("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Adaugă regulă nouă</DialogTitle>
          <DialogDescription>Descrieți regula în cuvinte (prag, strat, punctaj, dacă e blocantă, la ce variantă se aplică) sau porniți de la un formular gol. Regula se activează doar după testare.</DialogDescription>
        </DialogHeader>
        <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: Găurile trebuie să fie la cel puțin 1 mm de marginea plăcii; −10 puncte, +2 per apariție, maxim 20, blocant, doar THT, toleranță 0.01 mm." aria-label="Descrierea regulii" />
        <div className="flex flex-wrap gap-2">
          <Button onClick={askAi} disabled={busy || !prompt.trim()}><Sparkles className="mr-2 h-4 w-4" /> {busy ? "Se generează…" : "Generează cu AI"}</Button>
          <Button variant="outline" onClick={() => onAdd({ ...blankCustomRule(), code: uniq(blankCustomRule().code) })}><Plus className="mr-2 h-4 w-4" /> Formular gol</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
