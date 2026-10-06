import { useState } from "react";
import { Calculator, Download, Printer, X } from "lucide-react";
import { parseGrade, type GradeField } from "@/lib/gradebook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  count: number; canEdit: boolean; onClear: () => void; onApply: (field: GradeField, value: number) => void;
  onFinal: () => void; onExport: () => void; onPrint: () => void;
}
export function GradebookBulkBar({ count, canEdit, onClear, onApply, onFinal, onExport, onPrint }: Props) {
  const [field, setField] = useState<GradeField>("grade_schema");
  const [val, setVal] = useState("");
  if (!count) return null;
  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-lg">
      <span className="text-sm font-medium text-foreground">{count} selectați</span>
      {canEdit && (
        <>
          <Select value={field} onValueChange={(v) => setField(v as GradeField)}>
            <SelectTrigger className="w-44" aria-label="Câmp"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="grade_schema">Notă schemă</SelectItem>
              <SelectItem value="grade_doc">Notă documentație</SelectItem>
              <SelectItem value="grade_final">Notă finală</SelectItem>
            </SelectContent>
          </Select>
          <Input className="w-20" placeholder="1–10" value={val} onChange={(e) => setVal(e.target.value)} />
          <Button size="sm" onClick={() => { const p = parseGrade(val); if (p == null) return void toast.error("Notă invalidă (1.00–10.00)."); onApply(field, p); setVal(""); }}>Aplică</Button>
          <Button size="sm" variant="secondary" onClick={onFinal}><Calculator className="mr-1 h-4 w-4" /> Notă finală selecție</Button>
        </>
      )}
      <Button size="sm" variant="secondary" onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export selecție</Button>
      <Button size="sm" variant="secondary" onClick={onPrint}><Printer className="mr-1 h-4 w-4" /> Borderou selecție</Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}><X className="mr-1 h-4 w-4" /> Golește</Button>
    </div>
  );
}
