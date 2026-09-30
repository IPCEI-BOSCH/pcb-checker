import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

/** Columns owned by the platform — overwritten on every sync/export. */
export const AUTO_COLUMNS = [
  "Serie",
  "Grupa",
  "Nr. N",
  "Nume student",
  "Email",
  "Tema",
  "Varianta",
  "Revizie",
  "Scor DRC",
  "Puncte DRC (0-40)",
  "Status evaluare",
  "Data predarii",
] as const;

/** Columns owned by the teacher — never written by the platform. */
export const MANUAL_COLUMNS = ["Nota schema", "Nota documentatie", "Nota finala", "Observatii"] as const;

export const ALL_COLUMNS = [...AUTO_COLUMNS, ...MANUAL_COLUMNS];

export interface GradeRow {
  studentId: string;
  seriesName: string;
  groupName: string;
  themeNumber: number | null;
  fullName: string;
  email: string;
  themeName: string;
  variant: string;
  revision: number | null;
  drcScore: number | null;
  designPoints: number | null;
  reviewStatus: string;
  submittedAt: string;
  gradeSchema: number | null;
  gradeDoc: number | null;
  gradeFinal: number | null;
  notes: string;
}

const STATUS_LABEL: Record<string, string> = {
  approved: "Aprobat fabricatie",
  rejected: "Respins",
  pending: "In evaluare",
  none: "Nepredat",
};

export function rowToArray(r: GradeRow): (string | number | null)[] {
  return [
    r.seriesName,
    r.groupName,
    r.themeNumber,
    r.fullName,
    r.email,
    r.themeName,
    r.variant === "SMT" ? "a (SMT)" : "b (THT)",
    r.revision,
    r.drcScore,
    r.designPoints,
    STATUS_LABEL[r.reviewStatus] ?? r.reviewStatus,
    r.submittedAt,
    r.gradeSchema,
    r.gradeDoc,
    r.gradeFinal,
    r.notes,
  ];
}

export function autoCells(r: GradeRow) {
  return rowToArray(r).slice(0, AUTO_COLUMNS.length);
}

/** Build the full gradebook for a series (or all visible groups when seriesId is null). */
export async function fetchGradeRows(seriesId: string | null): Promise<GradeRow[]> {
  const [structureRes, studentsRes] = await Promise.all([
    Promise.all([supabase.from("series").select("*"), supabase.from("groups").select("*")]),
    supabase.from("students").select("*"),
  ]);
  const [seriesRes, groupsRes] = structureRes;
  if (seriesRes.error) throw seriesRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if (studentsRes.error) throw studentsRes.error;

  const groupsById = new Map(groupsRes.data.map((g) => [g.id, g]));
  const seriesById = new Map(seriesRes.data.map((s) => [s.id, s]));
  const students = studentsRes.data.filter((s) => {
    const g = groupsById.get(s.group_id);
    return g && (!seriesId || g.series_id === seriesId);
  });

  const { data: subs, error: subErr } = await supabase
    .from("submissions")
    .select("student_id, kind, revision, drc_score, report, review_status, created_at")
    .eq("kind", "OFFICIAL")
    .order("created_at", { ascending: false });
  if (subErr) throw subErr;
  const latest = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!latest.has(s.student_id)) latest.set(s.student_id, s);

  return students
    .map((st) => {
      const g = groupsById.get(st.group_id)!;
      const ser = seriesById.get(g.series_id);
      const sub = latest.get(st.id);
      const report = sub?.report as { designPoints?: number } | null;
      return {
        studentId: st.id,
        seriesName: ser?.name ?? "",
        groupName: g.name,
        themeNumber: st.theme_number,
        fullName: st.full_name,
        email: st.email ?? "",
        themeName: st.theme_name ?? "",
        variant: st.variant,
        revision: sub?.revision ?? null,
        drcScore: sub?.drc_score != null ? Number(sub.drc_score) : null,
        designPoints: report?.designPoints ?? null,
        reviewStatus: sub?.review_status ?? "none",
        submittedAt: sub ? new Date(sub.created_at).toLocaleString("ro-RO") : "",
        gradeSchema: st.grade_schema != null ? Number(st.grade_schema) : null,
        gradeDoc: st.grade_doc != null ? Number(st.grade_doc) : null,
        gradeFinal: st.grade_final != null ? Number(st.grade_final) : null,
        notes: st.teacher_notes ?? "",
      } satisfies GradeRow;
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || (a.themeNumber ?? 0) - (b.themeNumber ?? 0) || a.fullName.localeCompare(b.fullName));
}

export function buildSheetMatrix(rows: GradeRow[]): (string | number | null)[][] {
  return [[...ALL_COLUMNS], ...rows.map(rowToArray)];
}

export function exportWorkbook(rows: GradeRow[], fileName: string, format: "xlsx" | "csv") {
  const ws = XLSX.utils.aoa_to_sheet(buildSheetMatrix(rows));
  ws["!cols"] = ALL_COLUMNS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CEF2-Proiect_Situatie");
  XLSX.writeFile(wb, `${fileName}.${format}`, { bookType: format });
}

export interface ManualChange {
  studentId: string;
  fullName: string;
  field: "gradeSchema" | "gradeDoc" | "gradeFinal" | "notes";
  label: string;
  from: string;
  to: string;
  value: number | string | null;
}

const MANUAL_FIELDS = [
  { col: "Nota schema", field: "gradeSchema", db: "grade_schema", numeric: true },
  { col: "Nota documentatie", field: "gradeDoc", db: "grade_doc", numeric: true },
  { col: "Nota finala", field: "gradeFinal", db: "grade_final", numeric: true },
  { col: "Observatii", field: "teacherNotes", db: "teacher_notes", numeric: false },
] as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Compare an imported matrix against current rows; only manual columns can change. */
export function diffManualColumns(matrix: (string | number | null)[][], rows: GradeRow[]): ManualChange[] {
  if (!matrix.length) return [];
  const header = (matrix[0] ?? []).map((h) => norm(h));
  const idx = (name: string) => header.indexOf(norm(name));
  const emailIdx = idx("Email");
  const nameIdx = idx("Nume student");
  const byEmail = new Map(rows.filter((r) => r.email).map((r) => [norm(r.email), r]));
  const byName = new Map(rows.map((r) => [norm(r.fullName), r]));
  const changes: ManualChange[] = [];

  for (const line of matrix.slice(1)) {
    const row = (emailIdx >= 0 ? byEmail.get(norm(line[emailIdx])) : undefined) ?? (nameIdx >= 0 ? byName.get(norm(line[nameIdx])) : undefined);
    if (!row) continue;
    for (const f of MANUAL_FIELDS) {
      const ci = idx(f.col);
      if (ci < 0) continue;
      const raw = line[ci];
      if (f.numeric) {
        const current = f.field === "gradeSchema" ? row.gradeSchema : f.field === "gradeDoc" ? row.gradeDoc : row.gradeFinal;
        const next = raw === "" || raw == null ? null : Number(String(raw).replace(",", "."));
        if (next != null && Number.isNaN(next)) continue;
        if ((current ?? null) === (next ?? null)) continue;
        changes.push({
          studentId: row.studentId,
          fullName: row.fullName,
          field: f.field as ManualChange["field"],
          label: f.col,
          from: current == null ? "—" : String(current),
          to: next == null ? "—" : String(next),
          value: next,
        });
      } else {
        const next = String(raw ?? "").trim();
        if (next === row.notes.trim()) continue;
        changes.push({
          studentId: row.studentId,
          fullName: row.fullName,
          field: "notes",
          label: f.col,
          from: row.notes || "—",
          to: next || "—",
          value: next,
        });
      }
    }
  }
  return changes;
}

const DB_FIELD: Record<ManualChange["field"], string> = {
  gradeSchema: "grade_schema",
  gradeDoc: "grade_doc",
  gradeFinal: "grade_final",
  notes: "teacher_notes",
};

export async function applyManualChanges(changes: ManualChange[]) {
  const byStudent = new Map<string, Record<string, number | string | null>>();
  for (const c of changes) {
    const patch = byStudent.get(c.studentId) ?? {};
    patch[DB_FIELD[c.field]] = c.value;
    byStudent.set(c.studentId, patch);
  }
  for (const [studentId, patch] of byStudent) {
    const { error } = await supabase.from("students").update(patch as never).eq("id", studentId);
    if (error) throw error;
  }
  return byStudent.size;
}

export async function readSpreadsheetFile(file: File): Promise<(string | number | null)[][]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames.find((n) => n.toLowerCase().includes("situatie")) ?? wb.SheetNames[0];
  if (!first) return [];
  const ws = wb.Sheets[first];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: "" });
}

export function extractSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? input.trim();
}
