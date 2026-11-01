import type { Aperture, BBox, Hole, Layer, LayerKind, Primitive } from "./types";

/** Gerber X2 %TF.FileFunction values → fabrication slot (2-layer boards). */
const FILE_FUNCTION: [RegExp, LayerKind][] = [
  [/^Copper,L1(,Top)?/i, "top_copper"],
  [/^Copper,L\d+,(Bot|Inner)/i, "bottom_copper"],
  [/^Copper,L2/i, "bottom_copper"],
  [/^Soldermask,Top/i, "top_mask"],
  [/^Soldermask,Bot/i, "bottom_mask"],
  [/^Legend,Top/i, "top_silk"],
  [/^Legend,Bot/i, "bottom_silk"],
  [/^Paste,Top/i, "top_paste"],
  [/^Paste,Bot/i, "bottom_paste"],
  [/^Profile/i, "outline"],
  [/^Other,.*(Outline|Edge|Mech)/i, "outline"],
  [/^(AssemblyDrawing|FabDrawing|Drillmap|Other)/i, "fabrication"],
];

/** Read %TF.FileFunction from the header (first 30 lines) when the file name is non-standard. */
export function fileFunctionKind(content: string): LayerKind | null {
  const head = content.split(/\r?\n/).slice(0, 30).join("\n");
  const m = head.match(/%TF\.FileFunction,([^*%]+)\*%/i);
  if (!m) return null;
  const fn = m[1]!.trim();
  for (const [re, kind] of FILE_FUNCTION) if (re.test(fn)) return kind;
  return null;
}

/** True when a .txt / extensionless file looks like an Excellon drill program. */
function looksLikeExcellon(content: string): boolean {
  const head = content.slice(0, 3000);
  if (/M48|T\d+C[\d.]+|FILE_FORMAT/i.test(head)) return true;
  return /^X[+-]?\d+Y[+-]?\d+/m.test(head) && /^(INCH|METRIC|M7[12])/m.test(head);
}

/** Guess the layer function from file name (KiCad, Altium, Eagle, OrCAD conventions) or the Gerber X2 header. */
export function classifyLayer(fileName: string, content: string): LayerKind {
  const n = fileName.toLowerCase();
  if (/m48/i.test(content.slice(0, 400)) || /\.(drl|xln|exc|drd|tap)$/.test(n)) return "drill";
  if (/\.txt$/.test(n) && looksLikeExcellon(content)) return "drill";
  // CETTI/OrCAD naming (Layout/*.art)
  const stem = n.replace(/\.[^.]+$/, "");
  const CETTI: Record<string, LayerKind> = {
    top: "top_copper", bottom: "bottom_copper", bot: "bottom_copper", smtop: "top_mask", smbot: "bottom_mask",
    sstop: "top_silk", ssbot: "bottom_silk", sptop: "top_paste", spbot: "bottom_paste", bo: "outline", fab: "fabrication", mech: "fabrication", mechanical: "fabrication", assy: "fabrication",
  };
  if (CETTI[stem]) return CETTI[stem]!;
  // Prefixed/suffixed student names (431B_SSTOP, Popescu-SPTOP_v2): match whole tokens, longest first.
  const tokens = stem.split(/[^a-z0-9]+/).filter(Boolean);
  for (const k of ["sstop", "ssbot", "sptop", "spbot", "smtop", "smbot", "bottom", "top", "bot", "bo", "fab"]) {
    if (tokens.includes(k)) return CETTI[k]!;
  }
  const has = (...keys: string[]) => keys.some((k) => n.includes(k));
  if (/drl_map|drill_map|-job\.gbrjob/.test(n)) return "fabrication";
  if (has("fab", "fabrication", "assembly", "dwgs", "user.drawings", "drawing") || /\.(fab|gm2|gm3|gd1|gg1)$/.test(n)) return "fabrication";
  if (has("paste") || /\.(gtp|crc)$/.test(n)) return n.includes("b_") || n.includes("bot") || n.endsWith(".gbp") ? "bottom_paste" : "top_paste";
  if (/\.gbp$/.test(n)) return "bottom_paste";
  if (has("mask", "sstop", "smtop", "smbot") || /\.(gts|gbs|stc|sts)$/.test(n)) {
    return has("b_mask", "b.mask", "bot", "smbot") || /\.(gbs|sts)$/.test(n) ? "bottom_mask" : "top_mask";
  }
  if (has("silk", "legend", "overlay") || /\.(gto|gbo|plc|pls)$/.test(n)) {
    return has("b_silk", "b.silk", "bot") || /\.(gbo|pls)$/.test(n) ? "bottom_silk" : "top_silk";
  }
  if (has("edge", "outline", "profile", "mechanical", "board") || /\.(gko|gm1|gml|dim|gm)$/.test(n)) return "outline";
  if (has("b_cu", "b.cu", "bottom", "bot", "copper_bottom") || /\.(gbl|sol)$/.test(n)) return "bottom_copper";
  if (has("f_cu", "f.cu", "top", "copper_top") || /\.(gtl|cmp)$/.test(n)) return "top_copper";
  // Generic extensions (.gbr, .txt, no match): trust the Gerber X2 FileFunction header.
  const x2 = fileFunctionKind(content);
  if (x2) return x2;
  return "unknown";
}

interface Fmt {
  xInt: number;
  xDec: number;
  yInt: number;
  yDec: number;
  trailing: boolean;
}

function parseCoord(raw: string, dec: number, int: number, trailing: boolean): number {
  if (raw.includes(".")) return parseFloat(raw);
  let sign = 1;
  let s = raw;
  if (s[0] === "-" || s[0] === "+") {
    if (s[0] === "-") sign = -1;
    s = s.slice(1);
  }
  if (trailing) s = s.padEnd(int + dec, "0");
  return (sign * parseInt(s || "0", 10)) / Math.pow(10, dec);
}

/**
 * Estimate the drawn extent of an aperture macro (%AM) from its primitives
 * (1 circle, 4 outline, 5 polygon, 20 vector line, 21 center line, 22 lower-left rect),
 * honouring the rotation parameter. Used to size macro apertures instead of guessing.
 */
function macroExtent(body: string): { w: number; h: number } {
  let maxR = 0;
  const rotPt = (x: number, y: number, deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
  for (const prim of body.split("*").slice(1)) {
    const p = prim.split(",").map((v) => parseFloat(v));
    if (!p.length || !Number.isFinite(p[0])) continue;
    const code = p[0];
    const reach = (x: number, y: number, extra: number, rot = 0) => {
      const [rx, ry] = rotPt(x, y, rot);
      maxR = Math.max(maxR, Math.hypot(rx, ry) + extra);
    };
    if (code === 1) {
      // exposure, diameter, cx, cy [, rot]
      reach(p[3] ?? 0, p[4] ?? 0, (p[2] ?? 0) / 2, p[5] ?? 0);
    } else if (code === 4) {
      // exposure, npoints, x1, y1, ... [, rot]
      const n = p[2] ?? 0;
      const rot = p[3 + n * 2] ?? 0;
      for (let i = 0; i < n; i++) reach(p[3 + i * 2] ?? 0, p[4 + i * 2] ?? 0, 0, rot);
    } else if (code === 5) {
      // exposure, nverts, cx, cy, diameter, rot
      reach(p[3] ?? 0, p[4] ?? 0, (p[5] ?? 0) / 2, p[6] ?? 0);
    } else if (code === 20) {
      // exposure, width, x1, y1, x2, y2, rot
      const w = (p[2] ?? 0) / 2, rot = p[7] ?? 0;
      reach(p[3] ?? 0, p[4] ?? 0, w, rot);
      reach(p[5] ?? 0, p[6] ?? 0, w, rot);
    } else if (code === 21) {
      // exposure, w, h, cx, cy, rot
      const w = p[2] ?? 0, h = p[3] ?? 0, rot = p[6] ?? 0;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) reach((p[4] ?? 0) + (sx * w) / 2, (p[5] ?? 0) + (sy * h) / 2, 0, rot);
    } else if (code === 22) {
      // exposure, w, h, x lower-left, y lower-left, rot
      const w = p[2] ?? 0, h = p[3] ?? 0, rot = p[6] ?? 0;
      for (const [dx, dy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) reach((p[4] ?? 0) + dx - w / 2, (p[5] ?? 0) + dy - h / 2, 0, rot);
    }
  }
  return { w: maxR * 2, h: maxR * 2 };
}

export function parseGerber(fileName: string, content: string, kind: LayerKind): Layer {
  const primitives: Primitive[] = [];
  const warnings: string[] = [];
  const apertures = new Map<number, Aperture>();
  const macros = new Map<string, { w: number; h: number }>();
  const apFunction = new Map<number, string>();
  let fmt: Fmt = { xInt: 3, xDec: 6, yInt: 3, yDec: 6, trailing: false };
  let scale = 1; // to mm
  let cur: Aperture | null = null;
  let curCode = 0;
  let x = 0;
  let y = 0;
  let interp: "G01" | "G02" | "G03" = "G01";
  let quadMode: "G74" | "G75" = "G75"; // single- vs multi-quadrant arcs
  let region = false;
  let contour: [number, number][] = [];
  let clear = false;
  // Gerber X2 object attributes attached to every primitive until changed.
  let curNet: string | undefined;
  let curRefdes: string | undefined;
  let lastDcode = 0; // aperture selected before a %TA.AperFunction attribute

  const closeContour = () => {
    if (contour.length > 2) primitives.push({ t: "region", pts: contour, clear, ...(curNet ? { net: curNet } : {}), ...(curRefdes ? { refdes: curRefdes } : {}) });
    contour = [];
  };

  const handleExtended = (cmd: string) => {
    if (cmd.startsWith("FS")) {
      const m = cmd.match(/FS([LTD])?([AI])?X(\d)(\d)Y(\d)(\d)/);
      if (m) fmt = { trailing: m[1]! === "T", xInt: +m[3]!, xDec: +m[4]!, yInt: +m[5]!, yDec: +m[6]! };
    } else if (cmd.startsWith("MO")) {
      scale = cmd.includes("IN") ? 25.4 : 1;
    } else if (cmd.startsWith("AD")) {
      const m = cmd.match(/^ADD(\d+)([A-Za-z_$.][\w.$]*)(?:,(.*))?$/);
      if (!m) return;
      const code = +m[1]!;
      const tmpl = m[2]!;
      const params = (m[3]! ?? "").split("X").map((v) => parseFloat(v) * scale);
      if (tmpl === "C") apertures.set(code, { shape: "C", w: params[0] || 0, h: params[0] || 0 });
      else if (tmpl === "R") apertures.set(code, { shape: "R", w: params[0] || 0, h: params[1] ?? params[0] ?? 0 });
      else if (tmpl === "O") apertures.set(code, { shape: "O", w: params[0] || 0, h: params[1] ?? params[0] ?? 0 });
      else if (tmpl === "P") apertures.set(code, { shape: "P", w: params[0] || 0, h: params[0] || 0 });
      else {
        // Aperture macro — size from the macro body extent when known, else largest parameter.
        const ext = macros.get(tmpl);
        const nums = params.filter((v) => Number.isFinite(v) && v > 0);
        const sz = nums.length ? Math.max(...nums.slice(0, 2)) : 0.5;
        apertures.set(code, ext ? { shape: "M", w: ext.w * (nums[0] ?? 1), h: ext.h * (nums[1] ?? nums[0] ?? 1) } : { shape: "C", w: sz, h: nums[1] ?? sz });
      }
    } else if (cmd.startsWith("AM")) {
      const nameEnd = cmd.indexOf("*");
      const name = cmd.slice(2, nameEnd > 0 ? nameEnd : undefined);
      macros.set(name, macroExtent(cmd.slice(nameEnd)));
    } else if (cmd.startsWith("LP")) {
      clear = cmd[2] === "C";
    } else if (cmd.startsWith("TA")) {
      // %TA.AperFunction,ViaPad*% — applies to the most recently defined/selected aperture.
      const m = cmd.match(/^TA\.?AperFunction,?(.*)$/i);
      if (m && lastDcode) apFunction.set(lastDcode, m[1]!.trim());
    } else if (cmd.startsWith("TO")) {
      // %TO.N,NETNAME*% / %TO.C,REFDES*% — object attributes for the following primitives.
      const nm = cmd.match(/^TO\.?N,?(.*)$/i);
      const cm = cmd.match(/^TO\.?C,?(.*)$/i);
      if (nm) curNet = nm[1]!.trim() || undefined;
      else if (cm) curRefdes = cm[1]!.trim() || undefined;
      else if (/^TO\./.test(cmd)) { /* other TO attributes (P, ...) ignored */ }
    }
  };

  const handleWord = (w: string) => {
    if (!w) return;
    if (w.startsWith("G04")) return;
    if (w === "M02" || w === "M00") return;
    let s = w;
    // legacy G54Dnn
    s = s.replace(/^G5[45]/, "");
    const g = s.match(/^G0?(\d+)/);
    if (g) {
      const code = +g[1]!;
      if (code === 1) interp = "G01";
      else if (code === 2) interp = "G02";
      else if (code === 3) interp = "G03";
      else if (code === 36) {
        region = true;
        contour = [];
      } else if (code === 37) {
        closeContour();
        region = false;
      } else if (code === 74) quadMode = "G74";
      else if (code === 75) quadMode = "G75";
      s = s.slice(g[0]!.length);
      if (!s) return;
    }
    const dOnly = s.match(/^D(\d+)$/);
    if (dOnly && +dOnly[1]! >= 10) {
      curCode = +dOnly[1]!;
      lastDcode = curCode;
      cur = apertures.get(curCode) ?? null;
      return;
    }
    const xm = s.match(/X([+-]?[\d.]+)/);
    const ym = s.match(/Y([+-]?[\d.]+)/);
    const im = s.match(/I([+-]?[\d.]+)/);
    const jm = s.match(/J([+-]?[\d.]+)/);
    const dm = s.match(/D0?([123])$/);
    const nx = xm ? parseCoord(xm[1]!, fmt.xDec, fmt.xInt, fmt.trailing) * scale : x;
    const ny = ym ? parseCoord(ym[1]!, fmt.yDec, fmt.yInt, fmt.trailing) * scale : y;
    const op = dm ? +dm[1]! : xm || ym ? 1 : 0;
    if (op === 2) {
      if (region) {
        closeContour();
        contour = [[nx, ny]];
      }
    } else if (op === 1) {
      const pts: [number, number][] = [];
      let arcParams: Primitive extends never ? never : import("./types").ArcParams | undefined;
      if (interp !== "G01" && (im || jm)) {
        const ci = im ? parseCoord(im[1]!, fmt.xDec, fmt.xInt, fmt.trailing) * scale : 0;
        const cj = jm ? parseCoord(jm[1]!, fmt.yDec, fmt.yInt, fmt.trailing) * scale : 0;
        const cx = x + ci;
        const cy = y + cj;
        const r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx);
        let a1 = Math.atan2(ny - cy, nx - cx);
        const cw = interp === "G02";
        if (!cw) {
          if (a1 <= a0) a1 += Math.PI * 2;
        } else if (a1 >= a0) a1 -= Math.PI * 2;
        // G74 single-quadrant: never sweep more than 90°.
        if (quadMode === "G74" && Math.abs(a1 - a0) > Math.PI / 2) a1 = a0 + (cw ? -1 : 1) * Math.PI / 2;
        // Sagittal error <= 0.005 mm: chord half-angle φ with R(1-cos φ) <= 0.005.
        const maxPhi = r > 0.005 ? Math.acos(Math.max(-1, 1 - 0.005 / r)) : Math.PI / 4;
        const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) / (2 * maxPhi)));
        arcParams = { cx, cy, r, a0, a1, cw };
        for (let i = 1; i <= steps; i++) {
          const a = a0 + ((a1 - a0) * i) / steps;
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      } else pts.push([nx, ny]);
      if (region) {
        if (!contour.length) contour.push([x, y]);
        contour.push(...pts);
      } else {
        let px = x;
        let py = y;
        const width = cur ? cur.w : 0;
        for (const [qx, qy] of pts) {
          primitives.push({
            t: "line", x1: px, y1: py, x2: qx, y2: qy, w: width, clear,
            ...(arcParams ? { arc: arcParams } : {}),
            ...(curNet ? { net: curNet } : {}),
            ...(curRefdes ? { refdes: curRefdes } : {}),
          });
          px = qx;
          py = qy;
        }
      }
    } else if (op === 3) {
      if (cur) {
        const fn = apFunction.get(curCode);
        primitives.push({
          t: "flash", x: nx, y: ny, shape: cur.shape, w: cur.w, h: cur.h, clear,
          ...(curNet ? { net: curNet } : {}),
          ...(curRefdes ? { refdes: curRefdes } : {}),
          ...(fn ? { fn } : {}),
        });
      } else warnings.push("Flash fără apertură definită");
    }
    x = nx;
    y = ny;
  };

  let i = 0;
  const len = content.length;
  while (i < len) {
    const c = content[i];
    if (c === "%") {
      const end = content.indexOf("%", i + 1);
      if (end < 0) break;
      const block = content.slice(i + 1, end).replace(/\s+/g, "");
      if (block.startsWith("AM")) handleExtended(block);
      else block.split("*").filter(Boolean).forEach(handleExtended);
      i = end + 1;
    } else if (c === "\n" || c === "\r" || c === " " || c === "\t") {
      i++;
    } else {
      const end = content.indexOf("*", i);
      if (end < 0) break;
      handleWord(content.slice(i, end).replace(/\s+/g, ""));
      i = end + 1;
    }
  }
  if (!primitives.length) warnings.push("Strat fără geometrie");
  return { fileName, kind, primitives, holes: [], warnings };
}

/** Detect Excellon integer:decimal format; returns null when it must be inferred. */
function excellonDeclaredFormat(content: string): { int: number; dec: number } | null {
  const m = content.match(/FILE_FORMAT\s*=\s*(\d):(\d)/i) ?? content.match(/FORMAT\s*\{?\s*(\d):(\d)/i);
  if (m) return { int: +m[1]!, dec: +m[2]! };
  const f = content.match(/^(?:METRIC|INCH)\s*,\s*(?:LZ|TZ)\s*,\s*(0+)\.(0+)/im);
  if (f) return { int: f[1]!.length, dec: f[2]!.length };
  return null;
}

/**
 * Parse Excellon. When the decimal count is not declared (e.g. OrCAD "INCH,TZ"),
 * candidate formats 2:5 / 2:4 / 2:3 (inch) or 3:3 / 3:2 / 4:2 (metric) are tried and the one
 * whose holes best fit `fitBox` (board outline, mm) — or a 0..200 mm window — is kept.
 */
export function parseExcellon(fileName: string, content: string, fitBox?: BBox | null, forced?: { int: number; dec: number }): Layer {
  const declared = forced ?? excellonDeclaredFormat(content);
  if (declared) return parseExcellonWith(fileName, content, declared);
  const inch = /^(INCH|M72)/m.test(content);
  const metricDecl = /^(METRIC|M71)/m.test(content);
  const IN = [{ int: 2, dec: 5, inch: true }, { int: 2, dec: 4, inch: true }, { int: 2, dec: 3, inch: true }];
  const MM = [3, 2, 4, 5].map((dec) => ({ int: dec === 5 ? 2 : 3, dec, inch: false }));
  // No unit header at all (bare OrCAD NC drill): inch candidates first, then metric.
  const cands = inch ? IN : metricDecl ? MM : [...IN, ...MM];
  const box = fitBox ?? { minX: -1, minY: -1, maxX: 200, maxY: 200 };
  let best: Layer | null = null;
  let bestScore = -1;
  for (const c of cands) {
    const l = parseExcellonWith(fileName, content, c);
    if (!l.holes.length) { if (!best) best = l; continue; }
    const inside = l.holes.filter((h) => h.x >= box.minX - 0.5 && h.x <= box.maxX + 0.5 && h.y >= box.minY - 0.5 && h.y <= box.maxY + 0.5).length;
    // Tie-break by how much of the board the holes span (a wrong, too-large divisor squeezes them into a corner).
    const xs = l.holes.map((h) => h.x), ys = l.holes.map((h) => h.y);
    const span = Math.min(1, (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys)) / Math.max(1, box.maxX - box.minX + box.maxY - box.minY));
    const score = inside / l.holes.length + 0.01 * span;
    if (score > bestScore + 1e-9) { best = l; bestScore = score; }
  }
  if (!best!.holes.length) return best!;
  best!.warnings.push(`Format coordonate dedus automat: ${best!.fmt?.int}:${best!.fmt?.dec} (${best!.fmt?.inch ? "inch" : "mm"})`);
  return best!;
}

function parseExcellonWith(fileName: string, content: string, fmtIn: { int: number; dec: number; inch?: boolean }): Layer {
  const holes: Hole[] = [];
  const warnings: string[] = [];
  const tools = new Map<number, number>();
  const toolOrder: number[] = [];
  let metric = fmtIn.inch === undefined ? !/^(INCH|M72)/m.test(content) : !fmtIn.inch;
  const dec = fmtIn.dec;
  const int = fmtIn.int;
  let trailingZerosKept = false; // "LZ" means leading zeros kept => trailing omitted
  let lzMode = false;
  let tool = 0;
  let x = 0;
  let y = 0;
  let header = true;
  let slotMode = false; // M15 ... M16 routed-slot section
  let slotStart: { x: number; y: number } | null = null;
  const lines = content.split(/\r?\n/);
  for (let raw of lines) {
    raw = raw.trim();
    if (!raw) continue;
    if (raw.startsWith(";")) {
      // OrCAD comment tool table: ";T01 Holesize 1. = 15.740000 ... PLATED MILS"
      const ct = raw.match(/^;\s*T(\d+)\s+Holesize[^=]*=\s*([\d.]+).*?\b(MILS|MM|INCH)\b/i);
      if (ct && !tools.has(+ct[1]!)) {
        const v = parseFloat(ct[2]!); const u = ct[3]!.toUpperCase();
        tools.set(+ct[1]!, u === "MILS" ? v * 0.0254 : u === "INCH" ? v * 25.4 : v);
      }
      continue;
    }
    if (raw === "M48") {
      header = true;
      continue;
    }
    if (raw === "%" || raw === "M95") {
      header = false;
      continue;
    }
    if (/^(METRIC|M71)/.test(raw)) {
      metric = true;
      if (raw.includes("LZ")) lzMode = true;
      if (raw.includes("TZ")) trailingZerosKept = true;
      continue;
    }
    if (/^(INCH|M72)/.test(raw)) {
      metric = false;
      if (raw.includes("LZ")) lzMode = true;
      if (raw.includes("TZ")) trailingZerosKept = true;
      continue;
    }
    if (/^(FMAT|G90|G05|ICI,OFF|VER)/.test(raw)) continue;
    if (/^M15/.test(raw)) { slotMode = true; slotStart = { x, y }; continue; }
    if (/^M16/.test(raw)) { slotMode = false; slotStart = null; continue; }
    const tdef = raw.match(/^T(\d+)(?:F\d+)?(?:S\d+)?C([\d.]+)/);
    if (tdef) {
      tools.set(+tdef[1]!, parseFloat(tdef[2]!) * (metric ? 1 : 25.4));
      continue;
    }
    if (raw === "M30" || raw === "M00") break;
    const tsel = raw.match(/^T(\d+)$/);
    if (tsel) {
      tool = +tsel[1]!;
      if (toolOrder[toolOrder.length - 1] !== tool) toolOrder.push(tool);
      header = false;
      continue;
    }
    if (header) continue;
    const xm = raw.match(/X([+-]?[\d.]+)/);
    const ym = raw.match(/Y([+-]?[\d.]+)/);
    if (!xm && !ym) continue;
    const isG85 = raw.includes("G85");
    const conv = (v: string) => {
      let n: number;
      if (v.includes(".")) n = parseFloat(v);
      else {
        let s = v;
        let sign = 1;
        if (s[0] === "-" || s[0] === "+") {
          if (s[0] === "-") sign = -1;
          s = s.slice(1);
        }
        // LZ = leading zeros present, trailing suppressed -> pad right
        if (lzMode && !trailingZerosKept) s = s.padEnd(int + dec, "0");
        n = (sign * parseInt(s, 10)) / Math.pow(10, dec);
      }
      return n * (metric ? 1 : 25.4);
    };
    if (isG85) {
      // Routed slot: X..Y..G85X..Y.. — start point, then end point in the same line.
      const parts = raw.split("G85");
      const sx = parts[0]!.match(/X([+-]?[\d.]+)/);
      const sy = parts[0]!.match(/Y([+-]?[\d.]+)/);
      const ex = parts[1]!.match(/X([+-]?[\d.]+)/);
      const ey = parts[1]!.match(/Y([+-]?[\d.]+)/);
      if (sx) x = conv(sx[1]!);
      if (sy) y = conv(sy[1]!);
      const x2 = ex ? conv(ex[1]!) : x;
      const y2 = ey ? conv(ey[1]!) : y;
      const d = tools.get(tool);
      if (d === undefined) warnings.push(`Sculă T${tool} nedefinită`);
      holes.push({ x, y, d: d ?? 0, slot: { x2, y2 } });
      x = x2;
      y = y2;
      continue;
    }
    if (xm) x = conv(xm[1]!);
    if (ym) y = conv(ym[1]!);
    const d = tools.get(tool);
    if (d === undefined) warnings.push(`Sculă T${tool} nedefinită`);
    if (slotMode && slotStart) {
      holes.push({ x: slotStart.x, y: slotStart.y, d: d ?? 0, slot: { x2: x, y2: y } });
      slotStart = { x, y };
    } else {
      holes.push({ x, y, d: d ?? 0 });
    }
  }
  if (!holes.length) warnings.push("Fișier de găurire fără găuri");
  return { fileName, kind: "drill", primitives: [], holes, warnings, fmt: { int, dec, inch: !metric }, meta: { toolOrder } };
}

export function primitiveBBox(p: Primitive): BBox {
  if (p.t === "line") {
    const r = p.w / 2;
    return {
      minX: Math.min(p.x1, p.x2) - r,
      maxX: Math.max(p.x1, p.x2) + r,
      minY: Math.min(p.y1, p.y2) - r,
      maxY: Math.max(p.y1, p.y2) + r,
    };
  }
  if (p.t === "flash") {
    return { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y - p.h / 2, maxY: p.y + p.h / 2 };
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [a, b] of p.pts) {
    minX = Math.min(minX, a);
    maxX = Math.max(maxX, a);
    minY = Math.min(minY, b);
    maxY = Math.max(maxY, b);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Board outline box: the largest closed loop of line segments in the outline layer,
 * ignoring dimension text, arrows and alignment marks. Falls back to the full box.
 */
export function outlineBBox(layer: Layer): BBox | null {
  const lines = layer.primitives.filter((p): p is Extract<typeof p, { t: "line" }> => p.t === "line" && !p.clear);
  if (lines.length < 3) return layerBBox(layer, true);
  const key = (x: number, y: number) => `${Math.round(x * 50)},${Math.round(y * 50)}`;
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r)! !== r) r = parent.get(r)!; parent.set(a, r); return r; };
  const deg = new Map<string, number>();
  for (const l of lines) {
    const a = key(l.x1, l.y1), b = key(l.x2, l.y2);
    for (const k of [a, b]) { if (!parent.has(k)) parent.set(k, k); deg.set(k, (deg.get(k) ?? 0) + 1); }
    parent.set(find(a), find(b));
  }
  const comps = new Map<string, { box: BBox; open: number }>();
  for (const l of lines) {
    const r = find(key(l.x1, l.y1));
    const c = comps.get(r) ?? { box: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, open: 0 };
    c.box.minX = Math.min(c.box.minX, l.x1, l.x2); c.box.maxX = Math.max(c.box.maxX, l.x1, l.x2);
    c.box.minY = Math.min(c.box.minY, l.y1, l.y2); c.box.maxY = Math.max(c.box.maxY, l.y1, l.y2);
    comps.set(r, c);
  }
  for (const [k, d] of deg) if (d % 2) comps.get(find(k))!.open++;
  const area = (b: BBox) => (b.maxX - b.minX) * (b.maxY - b.minY);
  const closed = [...comps.values()].filter((c) => c.open === 0 && area(c.box) > 1).sort((a, b) => area(b.box) - area(a.box));
  return closed[0]?.box ?? layerBBox(layer, true);
}

export function layerBBox(layer: Layer, centerline = false): BBox | null {
  let b: BBox | null = null;
  const add = (o: BBox) => {
    if (!b) b = { ...o };
    else {
      b.minX = Math.min(b.minX, o.minX);
      b.minY = Math.min(b.minY, o.minY);
      b.maxX = Math.max(b.maxX, o.maxX);
      b.maxY = Math.max(b.maxY, o.maxY);
    }
  };
  for (const p of layer.primitives) {
    if (centerline && p.t === "line") {
      add({ minX: Math.min(p.x1, p.x2), maxX: Math.max(p.x1, p.x2), minY: Math.min(p.y1, p.y2), maxY: Math.max(p.y1, p.y2) });
    } else add(primitiveBBox(p));
  }
  for (const h of layer.holes) add({ minX: h.x - h.d / 2, maxX: h.x + h.d / 2, minY: h.y - h.d / 2, maxY: h.y + h.d / 2 });
  return b;
}
