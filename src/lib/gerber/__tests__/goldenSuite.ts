import JSZip from "jszip";
import { loadGerberZip } from "../load";
import { runDrc, type DrcReport } from "../../drc/engine";
import { DEFAULT_SETTINGS } from "../../drc/settings";

/**
 * Golden Suite — 12 benchmark-uri sintetice care exercită parserul și motorul DRC.
 * Fișierele Gerber/Excellon sunt generate în memorie; nimic nu se scrie pe disc.
 */

const HDR = "%FSLAX46Y46*%\n%MOMM*%\n";
const AP = (n: number, def: string) => `%ADD${n}${def}*%\n`;
const EOF = "M02*\n";

const baseFiles = (opts: { top?: string; bottom?: string; drill?: string; mask?: string; paste?: string; fab?: string; smt?: boolean }): Record<string, string> => {
  const outline = HDR + AP(10, "C,0.1") + "D10*\n" + "X0Y0D02*\nX60000000Y0D01*\nX60000000Y30000000D01*\nX0Y30000000D01*\nX0Y0D01*\n" + EOF;
  const files: Record<string, string> = { "BOARD.OUT": outline };
  files["TOP.art"] = opts.top ?? HDR + AP(10, "R,1.3,1.3") + AP(11, "R,1.5,1.5") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF;
  files["BOTTOM.art"] = opts.bottom ?? HDR + AP(10, "R,1.3,1.3") + "D10*\nX15000000Y15000000D03*\n" + EOF;
  files["DRILL.drl"] = opts.drill ?? "M48\nMETRIC,TZ\nT1C1.000\n%\nT1\nX15Y15\nX30Y15\nM30\n";
  if (opts.smt) {
    files["SMTOP.art"] = opts.mask ?? HDR + AP(10, "R,1.5,1.5") + AP(11, "R,1.7,1.7") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF;
    files["SPTOP.art"] = opts.paste ?? HDR + AP(10, "R,1.2,1.2") + AP(11, "R,1.35,1.35") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF;
    files["FAB.art"] = opts.fab ?? HDR + AP(10, "C,0.1") + "D10*\n" + Array.from({ length: 320 }, (_, i) => `X${(5000000 + i * 150000)}Y5000000D03*`).join("\n") + "\n" + EOF;
  }
  return files;
};

async function makeZip(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "blob" });
}

export interface GoldenCase {
  name: string;
  description: string;
  files: Record<string, string>;
  expect: { rule: string; passed: boolean }[];
  maxMs: number;
}

export interface GoldenResult {
  name: string;
  description: string;
  ok: boolean;
  ms: number;
  failures: string[];
}

const smtFiles = () => baseFiles({ smt: true });

export const GOLDEN_SUITE: GoldenCase[] = [
  {
    name: "G01 — placă SMT curată",
    description: "Placă SMT 60×30 completă, toate straturile; așteptat: fără erori critice/blocante.",
    files: smtFiles(),
    expect: [
      { rule: "MISSING_LAYER", passed: true },
      { rule: "HOLE_OUTSIDE_PAD", passed: true },
      { rule: "OUTLINE_OPEN_OR_INVALID", passed: true },
      { rule: "BOARD_OVERSIZE", passed: true },
    ],
    maxMs: 3000,
  },
  {
    name: "G02 — placă THT curată",
    description: "Placă THT: fără pastă/stencil, evaluare manuală.",
    files: baseFiles({}),
    expect: [
      { rule: "MISSING_LAYER", passed: true },
      { rule: "PASTE_MISSING_PAD", passed: true },
    ],
    maxMs: 3000,
  },
  {
    name: "G03 — gerbere OrCAD (.art) + drill fără header de format",
    description: "DRILL.drl fără %FS/amplificare explicită; auto-detectia formatului trebuie să alinieze găurile pe pad-uri.",
    files: smtFiles(),
    expect: [{ rule: "HOLE_OUTSIDE_PAD", passed: true }],
    maxMs: 3000,
  },
  {
    name: "G04 — placă prea mare (format depășit)",
    description: "Contur 200×30 mm — depășește formatul maxim.",
    files: { ...smtFiles(), "BOARD.OUT": HDR + AP(10, "C,0.1") + "D10*\nX0Y0D02*\nX200000000Y0D01*\nX200000000Y30000000D01*\nX0Y30000000D01*\nX0Y0D01*\n" + EOF },
    expect: [{ rule: "BOARD_OVERSIZE", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G05 — fișier lipsă (fără BOTTOM)",
    description: "Set incomplet: lipsește cuprul BOTTOM.",
    files: Object.fromEntries(Object.entries(smtFiles()).filter(([k]) => k !== "BOTTOM.art")),
    expect: [{ rule: "MISSING_LAYER", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G06 — două fișiere .drl",
    description: "DRILL.drl + DRILL2.drl — trebuie livrat un singur fișier de găurire.",
    files: { ...smtFiles(), "DRILL2.drl": "M48\nMETRIC,TZ\nT1C2.500\n%\nT1\nX50Y25\nM30\n" },
    expect: [{ rule: "DRL_COUNT", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G07 — via cu diametru greșit",
    description: "Găuri de 0.3 mm în loc de 0.4 mm pe pad-uri mici.",
    files: baseFiles({
      smt: true,
      top: HDR + AP(10, "R,0.8,0.8") + AP(11, "R,1.5,1.5") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF,
      bottom: HDR + AP(10, "R,0.8,0.8") + "D10*\nX15000000Y15000000D03*\n" + EOF,
      drill: "M48\nMETRIC,TZ\nT1C0.300\nT2C1.000\n%\nT1\nX15Y15\nT2\nX30Y15\nM30\n",
      mask: HDR + AP(10, "R,1.0,1.0") + AP(11, "R,1.7,1.7") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF,
      paste: HDR + AP(10, "R,0.7,0.7") + AP(11, "R,1.35,1.35") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\n" + EOF,
    }),
    expect: [{ rule: "VIA_DIAMETER", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G08 — gaură în afara pad-ului",
    description: "A treia gaură la (45,25) fără pad sub ea.",
    files: baseFiles({ smt: true, drill: "M48\nMETRIC,TZ\nT1C1.000\n%\nT1\nX15Y15\nX30Y15\nX45Y25\nM30\n" }),
    expect: [{ rule: "HOLE_OUTSIDE_PAD", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G09 — contur deschis (ERR_60)",
    description: "Conturul nu se închide — capete libere.",
    files: { ...smtFiles(), "BOARD.OUT": HDR + AP(10, "C,0.1") + "D10*\nX0Y0D02*\nX60000000Y0D01*\nX60000000Y30000000D01*\nX0Y30000000D01*\n" + EOF },
    expect: [{ rule: "OUTLINE_OPEN_OR_INVALID", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G10 — punte de mască prea subțire (ERR_54)",
    description: "Două deschideri de mască Ø1.5 la 1.6 mm distanță → punte de 0.1 mm sub prag.",
    files: baseFiles({
      smt: true,
      top: HDR + AP(10, "R,1.3,1.3") + "D10*\nX15000000Y15000000D03*\nX16600000Y15000000D03*\nX30000000Y15000000D03*\n" + EOF,
      drill: "M48\nMETRIC,TZ\nT1C1.000\n%\nT1\nX15Y15\nX16.6Y15\nX30Y15\nM30\n",
      mask: HDR + AP(10, "R,1.5,1.5") + "D10*\nX15000000Y15000000D03*\nX16600000Y15000000D03*\nX30000000Y15000000D03*\n" + EOF,
    }),
    expect: [{ rule: "SOLDER_MASK_SLIVER", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G11 — clearance sub minim (ERR_12)",
    description: "Două trasee paralele de 0.4 mm la 0.2 mm distanță.",
    files: baseFiles({
      smt: true,
      top: HDR + AP(10, "R,1.3,1.3") + AP(11, "R,1.5,1.5") + AP(12, "C,0.4") + "D10*\nX15000000Y15000000D03*\nD11*\nX30000000Y15000000D03*\nD12*\nX10000000Y25000000D02*\nX50000000Y25000000D01*\nX10000000Y25600000D02*\nX50000000Y25600000D01*\n" + EOF,
    }),
    expect: [{ rule: "CLEARANCE", passed: false }],
    maxMs: 3000,
  },
  {
    name: "G12 — pastă lipsă pe un pad (ERR_52)",
    description: "Al doilea pad SMD nu are deschidere în stratul de pastă.",
    files: baseFiles({
      smt: true,
      paste: HDR + AP(10, "R,1.2,1.2") + "D10*\nX15000000Y15000000D03*\n" + EOF,
    }),
    expect: [{ rule: "PASTE_MISSING_PAD", passed: false }],
    maxMs: 3000,
  },
];

async function runCase(c: GoldenCase): Promise<GoldenResult> {
  const t0 = performance.now();
  const failures: string[] = [];
  try {
    const blob = await makeZip(c.files);
    const parsed = await loadGerberZip(blob);
    const report: DrcReport = runDrc(parsed, "smt", DEFAULT_SETTINGS);
    for (const e of c.expect) {
      const rule = report.rules.find((r) => r.code === e.rule);
      if (!rule) failures.push(`regula ${e.rule} nu apare în raport`);
      else if (rule.passed !== e.passed) failures.push(`${e.rule}: așteptat ${e.passed ? "PASS" : "FAIL"}, obținut ${rule.passed ? "PASS" : "FAIL"} (${rule.detail})`);
    }
  } catch (err) {
    failures.push(`excepție: ${err instanceof Error ? err.message : String(err)}`);
  }
  const ms = Math.round(performance.now() - t0);
  if (ms > c.maxMs) failures.push(`timp ${ms} ms > limita ${c.maxMs} ms`);
  return { name: c.name, description: c.description, ok: failures.length === 0, ms, failures };
}

/** Rulează toate benchmark-urile secvențial (browser-safe). */
export async function runGoldenSuite(onProgress?: (done: number, total: number, r: GoldenResult) => void): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (const c of GOLDEN_SUITE) {
    const r = await runCase(c);
    results.push(r);
    onProgress?.(results.length, GOLDEN_SUITE.length, r);
  }
  return results;
}
