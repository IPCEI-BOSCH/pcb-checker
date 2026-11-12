import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import type { FileStudent } from "@/lib/file-student-search";

export function FileStudentPicker({ students, selected, query, onQuery, onSelect, groupName, disabled }: {
  students: FileStudent[]; selected: FileStudent | undefined; query: string; onQuery: (query: string) => void;
  onSelect: (id: string) => void; groupName: (id: string) => string; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={open} aria-label="Alege studentul" disabled={disabled} className="w-full sm:w-96 justify-between">
      <span className="truncate">{selected ? selected.full_name : "Caută și alege studentul…"}</span><ChevronsUpDown className="h-4 w-4 shrink-0" />
    </Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
      <Command shouldFilter={false}><CommandInput aria-label="Caută student" placeholder="Nume, email, grupă, temă, folder…" value={query} onValueChange={onQuery} />
        <CommandList><CommandEmpty>Niciun student găsit.</CommandEmpty>
          {students.map(s => <CommandItem key={s.id} value={s.id} onSelect={() => { onSelect(s.id); setOpen(false); }}>
            <Check className={selected?.id === s.id ? "text-primary" : "invisible"} />
            <div className="min-w-0 flex-1"><div className="break-words font-medium">{s.full_name}</div><div className="text-xs text-muted-foreground break-words">{groupName(s.group_id)} · N{s.theme_number ?? "—"} · {s.variant}</div><div className="text-xs text-muted-foreground">Proiect: {s.projectCount} · Fabricație: {s.fabricationCount}</div></div>
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}