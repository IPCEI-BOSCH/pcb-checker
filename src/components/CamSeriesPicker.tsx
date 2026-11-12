import { useState } from "react";
import { ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CamSeriesPicker({ options, selected, onChange, disabled }: {
  options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[] | null) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtered = options.filter(o => norm(o.label).includes(norm(query)));
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline" disabled={disabled} className="w-full justify-between sm:w-72" aria-label="Alege seriile CAM">
      <span className="truncate">{selected.length ? `${selected.length} / ${options.length} serii selectate` : "Nicio serie selectată"}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0" />
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3">
      <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Caută serie sau an" placeholder="Caută serie sau an…" className="pl-8" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div className="my-2 flex gap-2"><Button size="sm" variant="ghost" onClick={() => onChange(null)}>Toate seriile</Button><Button size="sm" variant="ghost" onClick={() => onChange([])}>Niciuna</Button></div>
      <div className="max-h-72 overflow-y-auto space-y-1">
        {filtered.map(o => <label key={o.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 text-sm hover:bg-accent">
          <Checkbox aria-label={o.label} checked={selected.includes(o.id)} onCheckedChange={checked => onChange(checked ? [...selected, o.id] : selected.filter(id => id !== o.id))} /><span>{o.label}</span>
        </label>)}
        {!filtered.length && <p className="p-2 text-sm text-muted-foreground">Nicio serie găsită.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}