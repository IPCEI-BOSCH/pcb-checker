import type { DrcReport } from "./engine";
import { CATALOG, CATEGORY_LABELS } from "./catalog";
import { REMEDIES } from "./remedies";

export interface EvaluationMeta {
  student?: string | undefined;
  group?: string | undefined;
  series?: string | undefined;
  theme?: string | undefined;
  submittedAt?: string | undefined;
  archive?: string | undefined;
}

const FAB_FILES: { name: string; kind: string; label: string }[] = [
  { name: "BO.art", kind: "outline", label: "Contur placă" },
  { name: "TOP.art", kind: "top_copper", label: "Cupru TOP" },
  { name: "BOTTOM.art", kind: "bottom_copper", label: "Cupru BOTTOM" },
  { name: "SMTOP.art", kind: "top_mask", label: "Mască TOP" },
  { name: "SMBOT.art", kind: "bottom_mask", label: "Mască BOTTOM" },
  { name: "SSTOP.art", kind: "top_silk", label: "Serigrafie TOP" },
  { name: "SPTOP.art", kind: "top_paste", label: "Pastă TOP (stencil)" },
  { name: "FAB.art", kind: "fabrication", label: "Desen fabricație" },
  { name: "DRILL.drl", kind: "drill", label: "Găurire Excellon" },
];

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function verdictText(r: DrcReport) {
  if (r.manualReview) return "Evaluare manuală (THT)";
  if (r.verdict === "admis") return "ADMIS FABRICAȚIE";
  if (r.verdict === "rezerve") return "ADMIS CU REZERVE";
  if (r.verdict === "respins") return "RESPINS FABRICAȚIE";
  return r.wouldPass ? "ADMIS FABRICAȚIE" : "RESPINS FABRICAȚIE";
}

/** Builds a self-contained A4 HTML evaluation sheet. */
export function buildEvaluationHtml(r: DrcReport, meta: EvaluationMeta = {}) {
  const found = (kind: string) => r.stats.layers.find((l) => l.kind === kind);
  const failed = r.rules.filter((x) => !x.passed).sort((a, b) => Number(!!b.critical) - Number(!!a.critical) || b.penalty - a.penalty);
  const today = new Date().toLocaleString("ro-RO");
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Fișă evaluare DRC ${esc(meta.student ?? "")}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{font-family:Georgia,"Times New Roman",serif;color:#111;font-size:10.5pt;line-height:1.35;margin:0}
h1{font-size:15pt;margin:4px 0}h2{font-size:12pt;margin:14px 0 6px;border-bottom:1.5px solid #111;padding-bottom:2px}
.hdr{text-align:center;border-bottom:2px solid #111;padding-bottom:8px}.hdr small{display:block;font-size:9pt}
table{width:100%;border-collapse:collapse;margin-top:4px}td,th{border:1px solid #555;padding:3px 5px;vertical-align:top;text-align:left;font-size:9.5pt}
th{background:#eee}.mono{font-family:"Courier New",monospace}.ok{color:#14632f;font-weight:bold}.bad{color:#a11;font-weight:bold}.warn{color:#8a5a00;font-weight:bold}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px}.verdict{font-size:14pt;text-align:center;border:2px solid #111;padding:6px;margin-top:8px}
.card{border:1px solid #888;padding:6px 8px;margin:6px 0;page-break-inside:avoid}.card.crit{border:2px solid #a11}
.sig{display:flex;justify-content:space-between;margin-top:28px}.sig div{width:45%;border-top:1px solid #111;text-align:center;padding-top:3px;font-size:9pt}
@media print{.noprint{display:none}}
</style></head><body>
<div class="noprint" style="padding:8px;background:#fffbe6;border-bottom:1px solid #ccc;font-family:sans-serif">
<button onclick="window.print()">Tipărește / Salvează PDF</button></div>
<div class="hdr"><small>Universitatea Națională de Știință și Tehnologie POLITEHNICA București</small>
<small>Facultatea de Electronică, Telecomunicații și Tehnologia Informației</small>
<h1>Fișă de evaluare DRC — Proiect P1 / P1-DCE</h1><small>Generată ${esc(today)}</small></div>
<h2>Date de identificare</h2>
<div class="grid"><div>Student / echipă: <b>${esc(meta.student ?? "—")}</b></div><div>Grupă: <b>${esc(meta.group ?? "—")}</b></div>
<div>Serie: <b>${esc(meta.series ?? "—")}</b></div><div>Temă / variantă: <b>${esc(meta.theme ?? r.variant)}</b></div>
<div>Data predării: <b>${esc(meta.submittedAt ?? "—")}</b></div><div>Arhivă: <b class="mono">${esc(meta.archive ?? "—")}</b></div>
<div>Dimensiune placă: <b class="mono">${r.board ? `${r.board.width} × ${r.board.height} mm` : "—"}</b></div><div>Găuri: <b class="mono">${r.stats.holes}</b></div></div>
<h2>Cele 9 fișiere de fabricație</h2>
<table><tr><th>Fișier</th><th>Rol</th><th>Fișier găsit</th><th>Elemente</th><th>Stare</th></tr>
${FAB_FILES.map((f) => { const l = found(f.kind); return `<tr><td class="mono">${f.name}</td><td>${f.label}</td><td class="mono">${esc(l?.file ?? "—")}</td><td class="mono">${l?.count ?? ""}</td><td class="${l ? "ok" : "bad"}">${l ? "Prezent" : "Lipsă"}</td></tr>`; }).join("")}
</table>
<h2>Barem și punctaj</h2>
<table><tr><th>Scor DRC</th><th>Puncte proiectare</th><th>Erori critice</th><th>Erori blocante</th><th>Defecte</th></tr>
<tr class="mono"><td>${r.score}/100</td><td>${r.designPoints}/40</td><td>${r.criticalCount ?? 0}</td><td>${r.blockingCount}</td><td>${r.issues.length}</td></tr></table>
<div class="verdict ${r.verdict === "rezerve" ? "warn" : r.wouldPass ? "ok" : "bad"}">${verdictText(r)}</div>
<h2>Reguli verificate</h2>
<table><tr><th>Regulă</th><th>Rezultat</th><th>Penalizare</th><th>Constatare</th></tr>
${r.rules.map((x) => `<tr><td>${esc(x.title)}${x.critical ? " <b class=bad>(CRITIC)</b>" : ""}</td><td class="${x.passed ? "ok" : x.severity === "blocking" ? "bad" : "warn"}">${x.passed ? "OK" : x.severity === "blocking" ? "Blocant" : x.severity === "warning" ? "Avertisment" : "Info"}</td><td class="mono">${x.penalty ? `−${x.penalty}p${x.count && x.count > 1 ? ` (${x.count}×)` : ""}` : "0"}</td><td>${esc(x.detail)}</td></tr>`).join("")}
</table>
${failed.length ? `<h2>Ce ai greșit și cum repari</h2>${failed.map((x) => { const c = (CATALOG[x.code] ?? r.customCatalog?.[x.code]) as (typeof CATALOG)[string] | undefined; const fix = REMEDIES[x.code]?.orcad ?? REMEDIES[x.code]?.general; return `<div class="card ${x.critical ? "crit" : ""}"><b>${c ? `[${esc(c.err)}] ${esc(CATEGORY_LABELS[c.category] ?? c.category)} — ` : ""}${esc(x.title)}</b> <span class="mono bad">−${x.penalty}p</span>
<div>Constatat: ${esc(x.detail)}</div>${c ? `<div><b>Ce e greșit:</b> ${esc(c.what)}</div><div><b>De ce contează:</b> ${esc(c.why)}</div><div><b>Cum repari:</b> ${esc(c.fix)}</div>` : ""}${fix ? `<div><b>În OrCAD / Allegro:</b> ${esc(fix)}</div>` : ""}</div>`; }).join("")}` : ""}
<h2>Lista defectelor (${r.issues.length})</h2>
${r.issues.length ? `<table><tr><th>#</th><th>Defect</th><th>Severitate</th><th>X (mm)</th><th>Y (mm)</th><th>Detaliu</th></tr>
${r.issues.map((i, k) => `<tr><td class="mono">${k + 1}</td><td>${esc(i.title)}</td><td>${i.severity === "blocking" ? "Blocant" : i.severity === "warning" ? "Avertisment" : "Info"}</td><td class="mono">${i.x?.toFixed(3) ?? "—"}</td><td class="mono">${i.y?.toFixed(3) ?? "—"}</td><td>${esc(i.message)}</td></tr>`).join("")}</table>` : "<p>Nu au fost detectate defecte.</p>"}
<div class="sig"><div>Cadru didactic</div><div>Student</div></div>
</body></html>`;
}

export function openEvaluationSheet(r: DrcReport, meta?: EvaluationMeta) {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildEvaluationHtml(r, meta));
  w.document.close();
  return true;
}
