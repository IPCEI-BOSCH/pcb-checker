import type { Hole, Layer, LayerKind, Primitive } from "../gerber/types";
import type { DrcIssue, NetSummary, Variant } from "./engine";
import type { Settings } from "./settings";
import type { SilkBlock } from "../silk/extract";
import { LAB_TITLES, type LabRuleCode } from "./labDefinitions";

type Line = Extract<Primitive, { t: "line" }>;
type Flash = Extract<Primitive, { t: "flash" }>;
type Geometry = {
  gap: (a: Primitive, b: Primitive) => number;
  pointInPoly: (x: number, y: number, pts: [number, number][]) => boolean;
  pointInFlash: (x: number, y: number, p: Flash, tol?: number) => boolean;
  ptSegDist: (x: number, y: number, ax: number, ay: number, bx: number, by: number) => number;
};

/** Geometry proposals; policy and penalties remain in the existing settings/sandbox. */
export function evaluateLabRules(layers: Layer[], variant: Variant, settings: Settings, blocks: SilkBlock[], nets: NetSummary[], g: Geometry): DrcIssue[] {
  const R = settings.rules;
  const tol = R.labGeometryTol;
  const output: DrcIssue[] = [];
  const enabled = (code: LabRuleCode) => {
    const p = settings.penalties[code];
    const a = p?.appliesTo ?? (p?.smtOnly ? "SMT" : "ALL");
    return p?.enabled && (a === "ALL" || a === variant);
  };
  const hit = (code: LabRuleCode, message: string, layer?: LayerKind, x?: number, y?: number) => {
    if (enabled(code)) output.push({ code, title: LAB_TITLES[code], severity: settings.penalties[code]?.severity ?? "warning", message, ...(layer === undefined ? {} : { layer }), ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) });
  };
  const of = (k: LayerKind) => layers.filter((l) => l.kind === k);
  const darkLines = (l: Layer) => l.primitives.filter((p): p is Line => p.t === "line" && !p.clear && p.w > 0);
  const flashes = (l: Layer) => l.primitives.filter((p): p is Flash => p.t === "flash" && !p.clear);
  const holes = of("drill").flatMap((l) => l.holes);
  const copper = layers.filter((l) => l.kind === "top_copper" || l.kind === "bottom_copper");
  const allPads = copper.flatMap(flashes);
  const holed = (p: Flash) => holes.some((h) => g.pointInFlash(h.x, h.y, p, tol));
  const via = (h: Hole) => h.d > 0 && h.d < R.viaMaxDetect && !h.slot && allPads.some((p) => g.pointInFlash(h.x, h.y, p, tol) && Math.max(p.w, p.h) <= R.viaMaxDetect + 2 * R.annularRing + tol && !p.refdes);
  const vias = holes.filter(via);
  // Do not mistake large merged footprint clusters or mostly undecoded strokes for labels.
  const reliableText = (b: SilkBlock) => b.chars >= 2 && b.chars <= 20 && (b.decodeConfidence ?? 0) >= 0.7 &&
    Math.max(b.w, b.h) >= 1.5 * Math.min(b.w, b.h) && Boolean(b.decoded) &&
    (b.decoded?.replace(/[^A-Za-z0-9]/g, "").length ?? 0) >= 0.8 * (b.decoded?.length ?? 1);
  // Composite polarity: a later dark primitive can re-expose an earlier cleared point.
  const contains = (layer: Layer, x: number, y: number) => {
    let yes = false;
    for (const p of layer.primitives) {
      const inside = p.t === "region" ? g.pointInPoly(x, y, p.pts) : p.t === "flash" ? g.pointInFlash(x, y, p) : g.ptSegDist(x, y, p.x1, p.y1, p.x2, p.y2) <= p.w / 2;
      if (inside) yes = !p.clear;
    }
    return yes;
  };

  if (enabled("DRILL_NO_TOOLS")) for (const l of of("drill")) {
    const bad = l.holes.filter((h) => !Number.isFinite(h.d) || h.d <= 0);
    const tools = l.meta?.undefinedTools ?? [];
    if (bad.length || tools.length) hit("DRILL_NO_TOOLS", `${l.fileName}: ${bad.length} găuri cu diametru invalid${tools.length ? `; scule nedefinite ${tools.map((t) => `T${t}`).join(", ")}` : ""}. Regenerați Excellon cu tabelul de scule.`, "drill", bad[0]?.x, bad[0]?.y);
  }
  if (vias.length > R.maxVias) hit("EXCESSIVE_VIAS", `${vias.length} via-uri; prag pedagogic ${R.maxVias}. Confirmați via-urile de stitching.`, "drill");
  if (enabled("UNUSED_VIAS")) for (const h of vias) {
    // Existing net map indexes capsules only. A solid region at the hole is not an orphan.
    if (copper.some((l) => l.primitives.some((p) => p.t === "region" && !p.clear && g.pointInPoly(h.x, h.y, p.pts)) && contains(l, h.x, h.y))) continue;
    const holeId = holes.indexOf(h);
    const net = nets.find((n) => n.holeIds.includes(holeId));
    if (!net) continue;
    const items = copper.flatMap((l) => {
      const ids = l.kind === "top_copper" ? net.primitiveIds.top_copper : net.primitiveIds.bottom_copper;
      return ids.map((i) => l.primitives[i]).filter((p): p is Primitive => Boolean(p));
    });
    if (items.length && items.every((p) => p.t === "flash" && holes.some((v) => via(v) && g.pointInFlash(v.x, v.y, p, tol))))
      hit("UNUSED_VIAS", `Via Ø${h.d.toFixed(3)} mm fără traseu, plan sau pad de componentă în netul geometric. Confirmați în CAD.`, "drill", h.x, h.y);
  }
  if (enabled("ANNULAR_RING_DROWNED")) for (const l of copper) for (const h of vias) {
    const pad = flashes(l).find((p) => g.pointInFlash(h.x, h.y, p, tol));
    if (!pad) continue;
    const line = darkLines(l).find((p) => p.w > Math.max(pad.w, pad.h) + tol && g.ptSegDist(h.x, h.y, p.x1, p.y1, p.x2, p.y2) < tol);
    if (line) hit("ANNULAR_RING_DROWNED", `Traseu ${line.w.toFixed(3)} mm peste pad via ${Math.max(pad.w, pad.h).toFixed(3)} mm. Observație de stil, nu defect al inelului.`, l.kind, h.x, h.y);
  }
  const tht = holes.filter((h) => h.d > R.smtThtMinDiameter && h.d < R.npthMinDiameter && !h.slot && !via(h) && allPads.some((p) => g.pointInFlash(h.x, h.y, p, tol)));
  if (tht.length > R.smtAllowedThtHoles) hit("UNAUTHORIZED_THT", `${tht.length} găuri candidate THT; tema permite ${R.smtAllowedThtHoles}. Metalizarea și autorizarea se confirmă manual.`, "drill", tht[0]?.x, tht[0]?.y);

  if (enabled("SILK_OVER_VIA")) for (const silk of layers.filter((l) => l.kind === "top_silk" || l.kind === "bottom_silk")) {
    const masks = of(silk.kind === "top_silk" ? "top_mask" : "bottom_mask");
    for (const h of vias) {
      if (!masks.some((m) => contains(m, h.x, h.y))) continue;
      const disc: Flash = { t: "flash", shape: "C", x: h.x, y: h.y, w: h.d, h: h.d };
      if (silk.primitives.some((p) => !p.clear && g.gap(p, disc) < -tol)) hit("SILK_OVER_VIA", `Serigrafie peste via deschis Ø${h.d.toFixed(3)} mm.`, silk.kind, h.x, h.y);
    }
  }
  if (enabled("SILK_TEXT_OVERLAP")) for (let i = 0; i < blocks.length; i++) {
    const a = blocks[i]; if (!a || !reliableText(a)) continue;
    for (const b of blocks.slice(i + 1)) {
      if (a.layer !== b.layer || !reliableText(b)) continue;
      if ((a.w + b.w) / 2 - Math.abs(a.x - b.x) > R.silkTextOverlapTol && (a.h + b.h) / 2 - Math.abs(a.y - b.y) > R.silkTextOverlapTol)
        hit("SILK_TEXT_OVERLAP", `Blocurile „${a.decoded ?? a.idx}” și „${b.decoded ?? b.idx}” au zone de text suprapuse; confirmați vizual.`, a.layer, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }
  if (enabled("SILK_MAX_DIRECTIONS")) for (const kind of ["top_silk", "bottom_silk"] as const) {
    const angles: number[] = [];
    for (const b of blocks.filter((b) => b.layer === kind && reliableText(b))) {
      if (b.axisAngleDeg === undefined) continue;
      const a = (b.axisAngleDeg + 180) % 180;
      if (!angles.some((v) => Math.min(Math.abs(v - a), 180 - Math.abs(v - a)) <= R.silkDirectionTolDeg)) angles.push(a);
    }
    if (angles.length > R.silkMaxDirections) hit("SILK_MAX_DIRECTIONS", `${angles.length} axe de text (${angles.map((a) => a.toFixed(0) + "°").join(", ")}), maxim ${R.silkMaxDirections}. Sensurile opuse pe aceeași axă nu se disting.`, kind);
  }
  // Segment containment accepts an outline exported as many smaller pieces.
  if (enabled("OUTLINE_IN_SILK") || enabled("OUTLINE_IN_MASK")) {
    const outline = of("outline").flatMap(darkLines);
    for (const l of layers.filter((l) => ["top_silk", "bottom_silk", "top_mask", "bottom_mask"].includes(l.kind))) {
      const code = l.kind.endsWith("silk") ? "OUTLINE_IN_SILK" : "OUTLINE_IN_MASK";
      let length = 0; let first: Line | undefined;
      for (const s of darkLines(l)) {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (outline.some((o) => g.ptSegDist(s.x1, s.y1, o.x1, o.y1, o.x2, o.y2) <= tol && g.ptSegDist(s.x2, s.y2, o.x1, o.y1, o.x2, o.y2) <= tol)) { length += len; first ??= s; }
      }
      if (length >= R.outlineCopyMinLength) hit(code, `${length.toFixed(2)} mm de segmente coincid cu conturul mecanic.`, l.kind, first?.x1, first?.y1);
    }
  }
  if (enabled("FIDUCIAL_PASTE_MATCH") || enabled("FIDUCIAL_KEEPOUT")) for (const top of of("top_copper")) {
    const masks = of("top_mask"); const paste = of("top_paste");
    const fiducials = flashes(top).filter((p) => p.shape === "C" && !holed(p) && (p.fn?.toLowerCase().includes("fiducial") || (
      Math.abs(p.w - R.fiducialNominalDiameter) <= R.fiducialNominalDiameter * R.fiducialPasteTolerance + tol && !p.refdes &&
      !darkLines(top).some((s) => g.ptSegDist(p.x, p.y, s.x1, s.y1, s.x2, s.y2) <= p.w / 2 + s.w / 2 + tol) &&
      masks.some((m) => flashes(m).some((f) => Math.hypot(f.x - p.x, f.y - p.y) <= tol && Math.min(f.w, f.h) >= p.w + tol))
    )));
    for (const f of fiducials) {
      const aps = paste.flatMap(flashes).filter((p) => Math.hypot(p.x - f.x, p.y - f.y) <= tol);
      const good = R.fiducialPasteMode === 0 ? aps.length === 0 : aps.length === 1 && aps.every((p) => p.shape === "C" && Math.abs(p.w / f.w - 1) <= R.fiducialPasteTolerance + 1e-9 && Math.abs(p.h / f.h - 1) <= R.fiducialPasteTolerance + 1e-9);
      if (!good) hit("FIDUCIAL_PASTE_MATCH", R.fiducialPasteMode === 0 ? "Proces industrial: fiducialul nu trebuie să aibă pastă." : `Șablon manual: o deschidere circulară SPTOP egală cu TOP ±${(R.fiducialPasteTolerance * 100).toFixed(0)}%; găsite ${aps.length}.`, "top_paste", f.x, f.y);
      // Sample the entire keepout annulus, including the opposite side and clear cutouts.
      const radius = f.w * R.fiducialKeepoutRatio / 2;
      let obstructed = false;
      for (let j = 0; j < 3 && !obstructed; j++) {
        const r = f.w / 2 + tol + (radius - f.w / 2 - tol) * j / 2;
        for (let i = 0; i < 64 && !obstructed; i++) {
          const x = f.x + r * Math.cos(i * Math.PI / 32), y = f.y + r * Math.sin(i * Math.PI / 32);
          obstructed = copper.some((l) => contains(l, x, y)) || layers.some((l) => l.kind.endsWith("silk") && contains(l, x, y));
        }
      }
      const maskGood = masks.some((m) => flashes(m).some((p) => p.shape === "C" && Math.hypot(p.x - f.x, p.y - f.y) <= tol && p.w + tol >= radius * 2));
      if (obstructed || !maskGood) hit("FIDUCIAL_KEEPOUT", `Gardare Ø${(radius * 2).toFixed(2)} mm: ${obstructed ? "cupru/serigrafie în zona liberă" : "deschidere circulară de mască insuficientă sau nerecunoscută"}. Verificare geometrică eșantionată.`, "top_copper", f.x, f.y);
    }
  }
  for (const l of copper) {
    const lines = darkLines(l);
    if (enabled("PAD_EXIT_ANGLE") || enabled("PAD_MULTIPLE_EXITS")) for (const p of flashes(l)) {
      if (p.shape !== "R" || holed(p) || p.w * p.h > R.padExitMaxArea || p.w <= 0 || p.h <= 0) continue;
      const exits: { x: number; y: number; angle: number }[] = [];
      for (const s of lines) {
        if (s.arc) continue;
        const a = g.pointInFlash(s.x1, s.y1, p), b = g.pointInFlash(s.x2, s.y2, p);
        if (a === b) continue;
        const ix = a ? s.x1 : s.x2, iy = a ? s.y1 : s.y2;
        const ox = a ? s.x2 : s.x1, oy = a ? s.y2 : s.y1;
        const dx = ox - ix, dy = oy - iy;
        const tx = dx > 0 ? (p.x + p.w / 2 - ix) / dx : dx < 0 ? (p.x - p.w / 2 - ix) / dx : Infinity;
        const ty = dy > 0 ? (p.y + p.h / 2 - iy) / dy : dy < 0 ? (p.y - p.h / 2 - iy) / dy : Infinity;
        const t = Math.min(tx, ty); const x = ix + dx * t, y = iy + dy * t;
        if (exits.some((v) => Math.hypot(v.x - x, v.y - y) <= tol)) continue;
        const angle = Math.atan2(tx <= ty ? Math.abs(dy) : Math.abs(dx), tx <= ty ? Math.abs(dx) : Math.abs(dy)) * 180 / Math.PI;
        exits.push({ x, y, angle });
        if (angle > R.padExitToleranceDeg) hit("PAD_EXIT_ANGLE", `Ieșire la ${angle.toFixed(1)}° față de normala laturii; toleranță ${R.padExitToleranceDeg}°.`, l.kind, x, y);
      }
      if (exits.length > R.padMaxExits) hit("PAD_MULTIPLE_EXITS", `${exits.length} ieșiri directe distincte; maxim ${R.padMaxExits} pentru pad SMD mic.`, l.kind, p.x, p.y);
    }
    if (enabled("RIGHT_ANGLE_TRACES")) {
      const nodes = new Map<string, { x: number; y: number; vectors: [number, number][] }>();
      for (const s of lines.filter((s) => !s.arc)) for (const [x, y, ox, oy] of [[s.x1, s.y1, s.x2, s.y2], [s.x2, s.y2, s.x1, s.y1]]) {
        if (x === undefined || y === undefined || ox === undefined || oy === undefined) continue;
        const key = `${Math.round(x / Math.max(tol, 0.001))},${Math.round(y / Math.max(tol, 0.001))}`;
        const node = nodes.get(key) ?? { x, y, vectors: [] };
        const len = Math.hypot(ox - x, oy - y); if (len <= tol) continue;
        node.vectors.push([(ox - x) / len, (oy - y) / len]); nodes.set(key, node);
      }
      for (const n of nodes.values()) {
        if (n.vectors.length !== 2 || flashes(l).some((p) => g.pointInFlash(n.x, n.y, p, tol)) || holes.some((h) => Math.hypot(n.x - h.x, n.y - h.y) <= h.d / 2 + tol)) continue;
        const [a, b] = n.vectors; if (!a || !b) continue;
        const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180 / Math.PI;
        if (Math.abs(angle - 90) <= R.rightAngleToleranceDeg) hit("RIGHT_ANGLE_TRACES", `Colț de ${angle.toFixed(1)}°; regulă pedagogică (joncțiunile T sunt excluse).`, l.kind, n.x, n.y);
      }
    }
  }
  if (enabled("ARCHIVE_CONVENTION")) {
    const entries = layers.find((l) => l.meta?.archiveEntries)?.meta?.archiveEntries;
    if (entries) {
      const roots = new Set(entries.map((n) => n.split("/")[0]));
      if (roots.size !== 1 || entries.some((n) => !n.includes("/")) || ![...roots].every((n) => n?.startsWith("P1_"))) hit("ARCHIVE_CONVENTION", "Arhiva trebuie să conțină un singur folder rădăcină P1_.");
      if (entries.some((n) => /[ăâîșşțţĂÂÎȘŞȚŢ]/.test(n))) hit("ARCHIVE_CONVENTION", "Nume de fișiere sau directoare cu diacritice.");
      if (entries.some((n) => /(?:^|\/)(?:~\$|\.DS_Store)|\.(?:bak|tmp|log|lck)$|~$/i.test(n))) hit("ARCHIVE_CONVENTION", "Arhiva conține fișiere temporare sau backup CAD.");
    }
  }
  return output;
}