import type { DrcReport } from "@/lib/drc/engine";

export interface InterviewQuestion {
  id: string;
  question: string;
  /** Expected technical answer — visible to staff only. */
  answer: string;
  /** Board coordinate the question refers to, when available. */
  x?: number | undefined;
  y?: number | undefined;
}

const r1 = (v: number) => Math.round(v * 100) / 100;

/**
 * Deterministic oral-interview generator: 3 applied questions derived from the real geometry
 * of the student's board (vias, trace widths, paste area ratio, annular ring, fiducials, warnings).
 * Same report → same questions, so the interview is reproducible and fair across the group.
 */
export function generateInterviewQuestions(report: DrcReport): InterviewQuestion[] {
  const out: InterviewQuestion[] = [];
  const issues = report.issues ?? [];
  const byCode = (c: string) => issues.find((i) => i.code === c);
  const nets = report.nets ?? [];
  const viaNet = nets.reduce((best, n) => (n.holeIds.length > (best?.holeIds.length ?? -1) ? n : best), null as (typeof nets)[number] | null);
  const bbCenter = (b: { minX: number; minY: number; maxX: number; maxY: number }) => ({ x: r1((b.minX + b.maxX) / 2), y: r1((b.minY + b.maxY) / 2) });

  // 1) Vias / layer transitions — anchored on the net with the most vias.
  if (viaNet && viaNet.holeIds.length > 0) {
    const c = bbCenter(viaNet.boundingBox);
    out.push({
      id: "vias",
      question: `Net-ul „${viaNet.name}” are ${viaNet.holeIds.length} treceri între straturi (via-uri). Explică de ce fiecare via introduce o inductanță parazită și cum ai fi putut reduce numărul lor pe acest net.`,
      answer: `Fiecare via ≈ 0,5–1 nH inductanță serie + discontinuitate de impedanță; pe trasee de alimentare/semnal rapid se evită prin rutare pe un singur strat, reordonarea componentelor sau via-uri multiple în paralel pentru curenți mari. Pe placa studentului: ${viaNet.holeIds.length} via-uri pe „${viaNet.name}” (lungime totală ${r1(viaNet.totalLengthMm)} mm, rezistență estimată ${r1(viaNet.estimatedResistanceMilliohm)} mΩ).`,
      x: c.x,
      y: c.y,
    });
  }

  // 2) Trace width vs. current — anchored on the thinnest trace issue or the clearance rule.
  const widthIssue = byCode("TRACE_WIDTH") ?? byCode("MIN_CLEARANCE");
  const minW = report.stats?.minTrace;
  out.push({
    id: "width",
    question: minW != null
      ? `Cel mai subțire traseu de pe placa ta are ${r1(minW)} mm. Ce curent maxim poate duce în siguranță (IPC-2221, exterior, ΔT=10°C) și de ce ai ales această lățime?`
      : "Cum dimensionezi lățimea unui traseu de alimentare în funcție de curent? Ce spune IPC-2221 despre creșterea de temperatură admisă?",
    answer: minW != null
      ? `Pentru ${r1(minW)} mm (≈${Math.round(minW / 0.0254)} mil) pe strat exterior 1oz, IPC-2221 dă ≈0,5–0,8 A la ΔT=10°C. Lățimea se alege din curentul maxim al netului, nu din comoditatea rutării.`
      : "I = k·ΔT^0,44·A^0,725 (IPC-2221); se verifică și căderea de tensiune pe lungimea traseului.",
    x: widthIssue?.x ?? undefined,
    y: widthIssue?.y ?? undefined,
  });

  // 3) Paste / annular ring / fiducials — whatever the board actually shows.
  const annular = byCode("ANNULAR_RING");
  const paste = byCode("PASTE_SIZE") ?? byCode("PASTE_MISSING_PAD");
  const fid = byCode("FIDUCIALS");
  if (annular) {
    out.push({
      id: "annular",
      question: `La coordonata (${annular.x != null ? r1(annular.x) : "?"}, ${annular.y != null ? r1(annular.y) : "?"}) inelul anular este sub minim. Ce este inelul anular și ce se întâmplă la fabricație dacă e prea mic?`,
      answer: "Inelul anular = cuprul rămas între gaura forată și marginea pad-ului. Sub ~0,1 mm, toleranța de forare (±0,1 mm) poate rupe inelul (breakout) → lipitură slabă sau circuit întrerupt.",
      x: annular.x ?? undefined, y: annular.y ?? undefined,
    });
  } else if (paste) {
    out.push({
      id: "paste",
      question: "Ce este raportul de arie (Area Ratio) IPC-7525B pentru aperturile de stencil și de ce contează la componentele tale fine-pitch?",
      answer: "AR = aria aperturii / aria pereților laterali; sub 0,66 pasta nu se desprinde curat din stencil → lipituri insuficiente. Se corectează prin stencil mai subțire sau aperturi rotunjite.",
      x: paste.x ?? undefined, y: paste.y ?? undefined,
    });
  } else {
    out.push({
      id: "fiducials",
      question: fid
        ? "Placa ta nu are fiducial-e (sau sunt greșite). La ce folosesc în linia de asamblare pick-and-place și unde se plasează corect?"
        : "La ce folosesc fiducial-e pe o placă SMT și câte sunt necesare minim pentru o linie pick-and-place?",
      answer: "Fiducial-e = marcaje de cupru (1 mm, cu mască deschisă) citite optic de mașina de asamblat pentru corecția de poziție/rotire. Minim 2 (ideal 3, în colțuri diagonale), plus fiducial-e locale lângă componentele fine-pitch.",
      x: fid?.x ?? undefined, y: fid?.y ?? undefined,
    });
  }

  // Guarantee exactly 3: pad with a clearance question if geometry offered fewer.
  if (out.length < 3) {
    const cl = byCode("MIN_CLEARANCE");
    out.push({
      id: "clearance",
      question: `Care este clearance-ul minim de pe placa ta și ce risc apare dacă două potențiale diferite ajung la ${report.rulesMinClearance ?? 0.35} mm distanță?`,
      answer: "Clearance sub minim → risc de arc electric, scurt la sudarea cu wave/reflow și reject la fabricație. Regula seriei impune ≥ pragul configurat; se rezolvă prin re-rutare, nu prin reducerea pragului.",
      x: cl?.x ?? undefined, y: cl?.y ?? undefined,
    });
  }
  return out.slice(0, 3);
}

/** Interview grade (1–10) from the three per-question marks (100/50/0). */
export function interviewGrade(marks: (100 | 50 | 0)[]): number {
  const avg = marks.reduce((a, m) => a + m, 0) / Math.max(1, marks.length);
  return Math.round((1 + (avg / 100) * 9) * 100) / 100;
}
