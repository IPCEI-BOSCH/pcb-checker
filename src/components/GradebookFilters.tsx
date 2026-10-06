import { Search, X } from "lucide-react";
import { needsGrading, type GradeRow } from "@/lib/gradebook";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type QuickFilter = "" | "needs" | "complete" | "nofiles";
export interface GbFilters { q: string; group: string; status: string; variant: string; quick: QuickFilter }
export const EMPTY_FILTERS: GbFilters = { q: "", group: "", status: "", variant: "", quick: "" };

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function applyFilters(rows: GradeRow[], f: GbFilters) {
  const q = fold(f.q.trim());
  return rows.filter((r) => {
    if (q && !fold(`${r.fullName} ${r.email} ${r.themeName} ${r.themeNumber ?? ""}`).includes(q)) return false;
    if (f.group && r.groupName !== f.group) return false;
    if (f.status && r.reviewStatus !== f.status) return false;
    if (f.variant && r.variant !== f.variant) return false;
    if (f.quick === "needs" && !needsGrading(r)) return false;
    if (f.quick === "complete" && r.gradeFinal == null) return false;
    if (f.quick === "nofiles" && r.projectFileCount > 0) return false;
    return true;
  });
}

export function GradebookFilters({ f, setF, groups, shown, total }: { f: GbFilters; setF: (f: GbFilters) => void; groups: string[]; shown: number; total: number }) {
  const sel = (key: "group" | "status" | "variant", label: string, opts: [string, string][]) => (
    <Select value={f[key] || "ALL"} onValueChange={(v) => setF({ ...f, [key]: v === "ALL" ? "" : v })}>
      <SelectTrigger className="w-44" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">{label}: toate</SelectItem>
        {opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const chip = (q: QuickFilter, label: string) => (
    <Button size="sm" variant={f.quick === q ? "default" : "outline"} onClick={() => setF({ ...f, quick: f.quick === q ? "" : q })}>{label}</Button>
  );
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-72 pl-8" placeholder="Caută nume, email, temă, nr. N…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        {sel("group", "Grupă", groups.map((g) => [g, g]))}
        {sel("status", "Status", [["approved", "Aprobat fabricație"], ["rejected", "Respins"], ["pending", "În evaluare"], ["none", "Nepredat"]])}
        {sel("variant", "Variantă", [["SMT", "a (SMT)"], ["THT", "b (THT)"]])}
        {dirty && <Button size="sm" variant="ghost" onClick={() => setF(EMPTY_FILTERS)}><X className="mr-1 h-4 w-4" /> Resetează</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {chip("needs", "Necesită notare")}
        {chip("complete", "Note finale complete")}
        {chip("nofiles", "Lipsă fișiere dosar")}
        <span className="ml-auto text-sm text-muted-foreground">Afișate {shown} din {total}</span>
      </div>
    </div>
  );
}
