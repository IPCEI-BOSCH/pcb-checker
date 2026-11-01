import { safeCell } from "./csvSafe";
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
export const MANUAL_COLUMNS = ["Nota schema", "Nota documentatie", "Nota interviu", "Nota finala", "Observatii"] as const;

/** Platform-owned link columns, placed after the manual block so existing sheets keep their column layout. */
export const LINK_COLUMNS = ["Folder Google Drive", "Fisiere dosar proiect", "Puncte dosare (Proiect+Fabricatie)"] as const;

export const ALL_COLUMNS = [...AUTO_COLUMNS, ...MANUAL_COLUMNS, ...LINK_COLUMNS];

export const driveFolderUrl = (id: string | null) => (id ? `https://drive.google.com/drive/folders/${id}` : "");

export interface GradeRow {
  studentId: string;
  groupId: string;
  seriesId: string;
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
  gradeInterview: number | null;
  gradeFinal: number | null;
  notes: string;
  driveFolderId: string | null;
  projectFileCount: number;
  folderPoints: number | null;
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
    r.gradeInterview,
    r.gradeFinal,
    r.notes,
    driveFolderUrl(r.driveFolderId),
    r.projectFileCount,
    r.folderPoints,
  ];
}

/** Link cells for Google Sheets: clickable HYPERLINK formulas. */
export function linkCells(r: GradeRow): (string | number | null)[] {
  return [
    r.driveFolderId ? `=HYPERLINK("${driveFolderUrl(r.driveFolderId)}";"Deschide folder")` : "Fără folder",
    r.projectFileCount,
    r.folderPoints,
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

  const { data: pf } = await supabase.from("project_files").select("student_id, points");
  const pfCount = new Map<string, number>();
  const pfPts = new Map<string, number>();
  for (const f of pf ?? []) {
    pfCount.set(f.student_id, (pfCount.get(f.student_id) ?? 0) + 1);
    if (f.points != null) pfPts.set(f.student_id, (pfPts.get(f.student_id) ?? 0) + Number(f.points));
  }

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
        groupId: g.id,
        seriesId: g.series_id,
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
        gradeInterview: st.grade_interview != null ? Number(st.grade_interview) : null,
        gradeFinal: st.grade_final != null ? Number(st.grade_final) : null,
        notes: st.teacher_notes ?? "",
        driveFolderId: st.drive_folder_id ?? null,
        projectFileCount: pfCount.get(st.id) ?? 0,
        folderPoints: pfPts.has(st.id) ? +pfPts.get(st.id)!.toFixed(2) : null,
      } satisfies GradeRow;
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || (a.themeNumber ?? 0) - (b.themeNumber ?? 0) || a.fullName.localeCompare(b.fullName));
}

export function buildSheetMatrix(rows: GradeRow[]): (string | number | null)[][] {
  return [[...ALL_COLUMNS], ...rows.map((r) => rowToArray(r).map(safeCell) as (string | number | null)[])];
}

export function exportWorkbook(rows: GradeRow[], fileName: string, format: "xlsx" | "csv") {
  const ws = XLSX.utils.aoa_to_sheet(buildSheetMatrix(rows));
  ws["!cols"] = ALL_COLUMNS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CEF2-Proiect_Situatie");
  XLSX.writeFile(wb, `${fileName}.${format}`, { bookType: format });
}

/** One workbook per academic year: one tab per series plus a combined tab. */
export function exportYearWorkbook(rows: GradeRow[], yearName: string, seriesTabs: { id: string; name: string }[]) {
  const wb = XLSX.utils.book_new();
  const add = (list: GradeRow[], tab: string) => {
    const ws = XLSX.utils.aoa_to_sheet(buildSheetMatrix(list));
    ws["!cols"] = ALL_COLUMNS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, tab.replace(/[\\/?*[\]:]/g, "-").slice(0, 31));
  };
  add(rows, "CEF2-Proiect_Situatie");
  for (const s of seriesTabs) add(rows.filter((r) => r.seriesId === s.id), `Seria ${s.name}`);
  XLSX.writeFile(wb, `CEF2-Proiect_Situatie-${yearName.replace(/[^\w-]+/g, "_")}.xlsx`);
}

export interface ManualChange {
  studentId: string;
  fullName: string;
  field: "gradeSchema" | "gradeDoc" | "gradeInterview" | "gradeFinal" | "notes";
  label: string;
  from: string;
  to: string;
  value: number | string | null;
}

const MANUAL_FIELDS = [
  { col: "Nota schema", field: "gradeSchema", db: "grade_schema", numeric: true },
  { col: "Nota documentatie", field: "gradeDoc", db: "grade_doc", numeric: true },
  { col: "Nota interviu", field: "gradeInterview", db: "grade_interview", numeric: true },
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
        const current = f.field === "gradeSchema" ? row.gradeSchema : f.field === "gradeDoc" ? row.gradeDoc : f.field === "gradeInterview" ? row.gradeInterview : row.gradeFinal;
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
  gradeInterview: "grade_interview",
  gradeFinal: "grade_final",
  notes: "teacher_notes",
};

/** Writes one row per changed cell into grade_audit_logs (best effort — never blocks the grade write). */
async function auditGradeChanges(logs: { student_id: string; field: string; old_value: string | null; new_value: string | null }[]) {
  if (!logs.length) return;
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase.from("grade_audit_logs").insert(logs.map((l) => ({ ...l, changed_by: u.user!.id })));
}

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
  await auditGradeChanges(changes.map((c) => ({ student_id: c.studentId, field: DB_FIELD[c.field], old_value: c.from === "—" ? null : c.from, new_value: c.to === "—" ? null : c.to })));
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

export interface FinalWeights { drc: number; schema: number; doc: number; overwrite: boolean }
export const DEFAULT_WEIGHTS: FinalWeights = { drc: 40, schema: 30, doc: 30, overwrite: false };

/** Proposes "Nota finala" (1–10) from DRC points (0–40) and teacher grades (1–10); returned as a diff for preview, never written directly. */
export function proposeFinalGrades(rows: GradeRow[], w: FinalWeights): ManualChange[] {
  const out: ManualChange[] = [];
  for (const r of rows) {
    if (!w.overwrite && r.gradeFinal != null) continue;
    const parts: [number, number][] = [];
    if (w.drc > 0 && r.designPoints != null) parts.push([(r.designPoints / 40) * 10, w.drc]);
    if (w.schema > 0 && r.gradeSchema != null) parts.push([r.gradeSchema, w.schema]);
    if (w.doc > 0 && r.gradeDoc != null) parts.push([r.gradeDoc, w.doc]);
    const total = w.drc + w.schema + w.doc;
    const have = parts.reduce((a, p) => a + p[1], 0);
    if (!total || have < total) continue; // only when every weighted component exists
    const g = Math.max(1, Math.min(10, Math.round((parts.reduce((a, p) => a + p[0] * p[1], 0) / have) * 100) / 100));
    if (g === r.gradeFinal) continue;
    out.push({ studentId: r.studentId, fullName: r.fullName, field: "gradeFinal", label: "Nota finala", from: r.gradeFinal == null ? "—" : String(r.gradeFinal), to: String(g), value: g });
  }
  return out;
}

export type GradeField = "grade_schema" | "grade_doc" | "grade_interview" | "grade_final" | "teacher_notes";
export const GRADE_FIELD_KEY: Record<GradeField, "gradeSchema" | "gradeDoc" | "gradeInterview" | "gradeFinal" | "notes"> = {
  grade_schema: "gradeSchema", grade_doc: "gradeDoc", grade_interview: "gradeInterview", grade_final: "gradeFinal", teacher_notes: "notes",
};

/** Parses a 1.00–10.00 grade ("9,5" ok); empty -> null; invalid -> undefined. */
export function parseGrade(raw: string): number | null | undefined {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 10) return undefined;
  return Math.round(n * 100) / 100;
}

export async function updateStudentGradeField(studentId: string, field: GradeField, value: number | string | null) {
  const v = field === "teacher_notes" ? (String(value ?? "").trim() || null) : value;
  const { data: cur } = await supabase.from("students").select(field).eq("id", studentId).single();
  const oldV = cur ? String((cur as Record<string, unknown>)[field] ?? "") : null;
  const { data, error } = await supabase.from("students").update({ [field]: v } as never).eq("id", studentId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Nu ai drept de editare pentru acest student.");
  await auditGradeChanges([{ student_id: studentId, field, old_value: oldV || null, new_value: v == null ? null : String(v) }]);
}

export async function bulkUpdateGrades(studentIds: string[], patch: Partial<Record<GradeField, number | string | null>>) {
  if (!studentIds.length) return 0;
  const fields = Object.keys(patch) as GradeField[];
  const { data: cur } = await supabase.from("students").select("*").in("id", studentIds);
  const oldBy = new Map((cur ?? []).map((r) => [r.id as string, r as unknown as Record<string, unknown>]));
  const { data, error } = await supabase.from("students").update(patch as never).in("id", studentIds).select("id");
  if (error) throw error;
  await auditGradeChanges((data ?? []).flatMap((r) =>
    fields.map((f) => ({ student_id: r.id, field: f, old_value: oldBy.get(r.id)?.[f] != null ? String(oldBy.get(r.id)![f]) : null, new_value: patch[f] != null ? String(patch[f]) : null })),
  ));
  return data?.length ?? 0;
}

export interface GradebookKpis {
  total: number; submitted: number; submitRate: number; approved: number; rejected: number; pending: number;
  graded: number; needsGrading: number; avgDrc: number | null; avgSchema: number | null; avgDoc: number | null; avgFinal: number | null;
}
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null; };
export function calculateGradebookKpis(rows: GradeRow[]): GradebookKpis {
  const submitted = rows.filter((r) => r.reviewStatus !== "none").length;
  return {
    total: rows.length, submitted, submitRate: rows.length ? Math.round((submitted / rows.length) * 100) : 0,
    approved: rows.filter((r) => r.reviewStatus === "approved").length,
    rejected: rows.filter((r) => r.reviewStatus === "rejected").length,
    pending: rows.filter((r) => r.reviewStatus === "pending").length,
    graded: rows.filter((r) => r.gradeFinal != null).length,
    needsGrading: rows.filter(needsGrading).length,
    avgDrc: avg(rows.map((r) => r.designPoints)), avgSchema: avg(rows.map((r) => r.gradeSchema)),
    avgDoc: avg(rows.map((r) => r.gradeDoc)), avgFinal: avg(rows.map((r) => r.gradeFinal)),
  };
}
export const needsGrading = (r: GradeRow) => r.reviewStatus !== "none" && (r.gradeSchema == null || r.gradeDoc == null || r.gradeFinal == null);
