/** SHA-256 (hex) of a blob or string — the cryptographic proof on the submission receipt. */
export async function sha256Hex(data: Blob | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
  const h = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ReceiptData {
  student: string;
  group: string;
  series: string;
  subject: string; // P1 / P1-DCE
  variant: string; // SMT / THT
  submittedAt: string; // server timestamp (ISO)
  score: number | null;
  verdict: string; // ADMIS / REZERVE / RESPINS
  zipSha256: string | null;
  reportSha256: string | null;
  fileName: string | null;
  revision: number;
  lateDays?: number | null;
}

/** Opens the official A4 submission receipt (print/PDF) with the SHA-256 proof. */
export function printSubmissionReceipt(r: ReceiptData): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const row = (k: string, v: string) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`;
  w.document.write(`<!doctype html><html><head><title>Recipisă predare — ${esc(r.student)}</title><style>
body{font-family:system-ui,sans-serif;margin:18mm;color:#111}h1{font-size:17px;margin:0}h2{font-size:12px;font-weight:normal;margin:2px 0 14px}
table{border-collapse:collapse;width:100%;font-size:13px}td{border:1px solid #ccc;padding:6px 8px;vertical-align:top}
.hash{font-family:ui-monospace,monospace;font-size:10.5px;word-break:break-all}
.box{border:2px solid #111;padding:14px;margin-top:10px}.sig{margin-top:36px;display:flex;justify-content:space-between;font-size:12px}
@page{size:A4}</style></head><body>
<h1>Universitatea Națională de Știință și Tehnologie POLITEHNICA București</h1>
<h2>Facultatea de Electronică, Telecomunicații și Tehnologia Informației — Dovadă Oficială de Predare Proiect PCB</h2>
<div class="box"><table>
${row("Student", r.student)}${row("Grupă / Serie", `${r.group} · Seria ${r.series}`)}${row("Disciplina", r.subject)}${row("Tehnologie", r.variant)}
${row("Predare", `Revizia v${r.revision} · ${r.fileName ?? "arhivă Gerber"}`)}${row("Timestamp server", new Date(r.submittedAt).toLocaleString("ro-RO"))}
${row("Scor DRC", r.score != null ? `${r.score}/100` : "—")}${row("Verdict", r.verdict)}${r.lateDays ? row("Întârziere", `${r.lateDays} zile față de termenul oficial`) : ""}
</table></div>
<h3 style="font-size:13px;margin:14px 0 4px">Amprente criptografice SHA-256</h3>
<table>
<tr><td style="color:#555">Arhivă ZIP</td><td class="hash">${esc(r.zipSha256 ?? "indisponibil (predare anterioară acestui sistem)")}</td></tr>
<tr><td style="color:#555">Raport DRC</td><td class="hash">${esc(r.reportSha256 ?? "indisponibil")}</td></tr>
</table>
<p style="font-size:11px;color:#444;margin-top:10px">Hash-ul SHA-256 garantează că arhiva predată nu a fost modificată după timestamp-ul de mai sus. Orice re-predare generează o recipisă nouă, cu alt hash.</p>
<div class="sig"><span>Student: ____________________</span><span>Cadru didactic: ____________________</span></div>
<script>onload=()=>print()</script></body></html>`);
  w.document.close();
  return true;
}
