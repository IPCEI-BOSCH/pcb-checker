import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";
import { parseGrade, type GradeField, type GradeRow } from "@/lib/gradebook";
import { driveFolderUrl } from "@/lib/gradebook";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

const STATUS: Record<string, [string, "default" | "destructive" | "secondary" | "outline"]> = {
  approved: ["Aprobat", "default"], rejected: ["Respins", "destructive"], pending: ["În evaluare", "secondary"], none: ["Nepredat", "outline"],
};
export function StatusBadge({ s }: { s: string }) {
  const [l, v] = STATUS[s] ?? [s, "outline"];
  return <Badge variant={v} className="whitespace-nowrap">{l}</Badge>;
}

type Col = { key: keyof GradeRow; label: string; edit?: GradeField; num?: boolean };
const COLS: Col[] = [
  { key: "groupName", label: "Grupa" }, { key: "themeNumber", label: "N", num: true }, { key: "fullName", label: "Student" },
  { key: "themeName", label: "Tema" }, { key: "variant", label: "Var." }, { key: "revision", label: "Rev.", num: true },
  { key: "drcScore", label: "Scor DRC", num: true }, { key: "designPoints", label: "Pct. DRC", num: true }, { key: "reviewStatus", label: "Status" },
  { key: "gradeSchema", label: "Notă schemă", edit: "grade_schema", num: true }, { key: "gradeDoc", label: "Notă doc.", edit: "grade_doc", num: true },
  { key: "gradeFinal", label: "Notă finală", edit: "grade_final", num: true }, { key: "notes", label: "Observații", edit: "teacher_notes" },
  { key: "projectFileCount", label: "Dosar", num: true }, { key: "folderPoints", label: "Pct. dosar", num: true },
];
const EDIT_COLS = COLS.filter((c) => c.edit).map((c) => c.edit!);

interface Props {
  rows: GradeRow[]; canEdit: boolean; selected: Set<string>; setSelected: (s: Set<string>) => void;
  onSave: (studentId: string, field: GradeField, value: number | string | null) => Promise<void>; onInspect: (r: GradeRow) => void;
}

export function GradebookTable({ rows, canEdit, selected, setSelected, onSave, onInspect }: Props) {
  const [sort, setSort] = useState<{ key: keyof GradeRow; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null || x === "") return 1;
      if (y == null || y === "") return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ro")) * sort.dir;
    });
  }, [rows, sort]);
  const allSel = sorted.length > 0 && sorted.every((r) => selected.has(r.studentId));
  const toggleSort = (k: keyof GradeRow) => setSort((s) => (s?.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null));

  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="p-2"><Checkbox checked={allSel} onCheckedChange={(v) => setSelected(v ? new Set(sorted.map((r) => r.studentId)) : new Set())} aria-label="Selectează toți" /></th>
            <th className="p-2" />
            {COLS.map((c) => (
              <th key={c.key} className={`whitespace-nowrap p-2 text-left font-medium ${c.edit ? "text-primary" : "text-muted-foreground"}`}>
                <button className="inline-flex items-center gap-1" onClick={() => toggleSort(c.key)}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, ri) => (
            <tr key={r.studentId} className="border-t border-border hover:bg-muted/40">
              <td className="p-2"><Checkbox checked={selected.has(r.studentId)} onCheckedChange={(v) => { const s = new Set(selected); if (v) s.add(r.studentId); else s.delete(r.studentId); setSelected(s); }} aria-label={`Selectează ${r.fullName}`} /></td>
              <td className="p-1"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onInspect(r)} aria-label="Detalii"><Eye className="h-4 w-4" /></Button></td>
              {COLS.map((c) => (
                <td key={c.key} className="whitespace-nowrap p-1.5">
                  {c.edit && canEdit ? (
                    <EditCell row={ri} field={c.edit} value={r[c.key] as number | string | null} onSave={(v) => onSave(r.studentId, c.edit!, v)} />
                  ) : c.key === "reviewStatus" ? <StatusBadge s={r.reviewStatus} />
                    : c.key === "variant" ? (r.variant === "SMT" ? "a (SMT)" : "b (THT)")
                    : c.key === "projectFileCount" && r.driveFolderId ? <a className="text-primary underline" href={driveFolderUrl(r.driveFolderId)} target="_blank" rel="noreferrer">{r.projectFileCount}</a>
                    : c.key === "fullName" ? <button className="font-medium text-foreground hover:underline" onClick={() => onInspect(r)}>{r.fullName}</button>
                    : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={COLS.length + 2} className="p-6 text-center text-muted-foreground">Niciun student pentru filtrele alese.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function EditCell({ row, field, value, onSave }: { row: number; field: GradeField; value: number | string | null; onSave: (v: number | string | null) => Promise<void> }) {
  const shown = value == null ? "" : field === "teacher_notes" ? String(value) : Number(value).toFixed(2);
  const [text, setText] = useState(shown);
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  useEffect(() => setText(shown), [shown]);
  const isNotes = field === "teacher_notes";
  const commit = async () => {
    if (text === shown) return true;
    let v: number | string | null;
    if (isNotes) v = text;
    else {
      const p = parseGrade(text);
      if (p === undefined) { setState("err"); return false; }
      v = p;
      setText(p == null ? "" : p.toFixed(2));
    }
    setState("saving");
    try { await onSave(v); setState("ok"); setTimeout(() => setState("idle"), 1200); } catch { setState("err"); setText(shown); }
    return true;
  };
  const onKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setText(shown); setState("idle"); e.currentTarget.blur(); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (await commit()) document.querySelector<HTMLInputElement>(`[data-gb="${row + 1}-${EDIT_COLS.indexOf(field)}"]`)?.focus();
    }
  };
  return (
    <span className="relative inline-flex items-center">
      <input
        data-gb={`${row}-${EDIT_COLS.indexOf(field)}`}
        value={text}
        onChange={(e) => { setText(e.target.value); if (state === "err") setState("idle"); }}
        onBlur={commit}
        onKeyDown={onKey}
        inputMode={isNotes ? "text" : "decimal"}
        placeholder="—"
        className={`rounded border bg-background px-1.5 py-1 text-foreground outline-none focus:ring-2 focus:ring-ring ${isNotes ? "w-56" : "w-16 text-right"} ${state === "err" ? "border-destructive" : "border-input"}`}
        aria-label={field}
      />
      {state === "ok" && <span className="absolute -right-2 h-1.5 w-1.5 rounded-full bg-primary" />}
      {state === "saving" && <span className="absolute -right-2 h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />}
    </span>
  );
}
