export interface FileStudent {
  id: string; full_name: string; email: string | null; file_prefix: string | null;
  theme_name: string | null; theme_number: number | null; group_id: string;
  variant: "SMT" | "THT"; projectCount: number; fabricationCount: number;
}
export function normalizeStudentSearch(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
export function filterFileStudents<T extends FileStudent>(students: T[], filters: { query: string; series: string; group: string; variant: string; files: string }, groups: { id: string; name: string; series_id: string }[]) {
  const terms = normalizeStudentSearch(filters.query).split(/\s+/).filter(Boolean);
  const byGroup = new Map(groups.map(g => [g.id, g]));
  return students.filter(s => {
    const g = byGroup.get(s.group_id);
    if (filters.series && g?.series_id !== filters.series || filters.group && s.group_id !== filters.group || filters.variant && s.variant !== filters.variant) return false;
    const total = s.projectCount + s.fabricationCount;
    if (filters.files === "with" && !total || filters.files === "without" && total > 0) return false;
    const haystack = normalizeStudentSearch([s.full_name, s.email, s.file_prefix, s.theme_name, s.theme_number, g?.name].join(" "));
    return terms.every(t => haystack.includes(t));
  });
}