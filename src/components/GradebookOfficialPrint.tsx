import type { GradeRow } from "@/lib/gradebook";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (n: number | null) => (n == null ? "" : n.toFixed(2));

/** Opens a print-ready A4 grading sheet (one page block per group). */
export function printOfficialSheet(rows: GradeRow[], yearName: string, seriesLabel: string) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const groups = new Map<string, GradeRow[]>();
  for (const r of rows) groups.set(r.groupName, [...(groups.get(r.groupName) ?? []), r]);
  const blocks = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([g, list]) => `
    <section>
      <header>
        <div><b>Universitatea Națională de Știință și Tehnologie POLITEHNICA București</b><br/>Facultatea de Electronică, Telecomunicații și Tehnologia Informației</div>
        <h1>Borderou de notare — Proiect P1 / P1-DCE</h1>
        <p>An universitar: <b>${esc(yearName)}</b> · ${esc(seriesLabel)} · Grupa: <b>${esc(g)}</b></p>
      </header>
      <table>
        <thead><tr><th>Nr.</th><th>Nume și prenume</th><th>Tema</th><th>N</th><th>Pct. DRC</th><th>Schemă</th><th>Doc.</th><th>Nota finală</th></tr></thead>
        <tbody>${list.sort((a, b) => a.fullName.localeCompare(b.fullName, "ro")).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.fullName)}</td><td>${esc(r.themeName)}</td><td>${r.themeNumber ?? ""}</td><td>${r.designPoints ?? ""}</td><td>${fmt(r.gradeSchema)}</td><td>${fmt(r.gradeDoc)}</td><td><b>${fmt(r.gradeFinal)}</b></td></tr>`).join("")}</tbody>
      </table>
      <footer><span>Data: ____________</span><span>Cadru didactic: ______________________ Semnătura: ____________</span></footer>
    </section>`).join("");
  w.document.write(`<!doctype html><html lang="ro"><head><meta charset="utf-8"/><title>Borderou ${esc(seriesLabel)} ${esc(yearName)}</title><style>
    @page{size:A4 portrait;margin:14mm}body{font:11px/1.35 Arial,sans-serif;color:#000}
    section{page-break-after:always}section:last-child{page-break-after:auto}
    h1{font-size:15px;text-align:center;margin:10px 0 4px}header p{text-align:center;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:3px 5px;text-align:left}th{background:#eee}
    footer{display:flex;justify-content:space-between;margin-top:28px}
  </style></head><body>${blocks || "<p>Niciun student.</p>"}<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
  return true;
}
