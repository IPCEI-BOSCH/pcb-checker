export type CadTool = "orcad";

export const CAD_LABELS: Record<CadTool, string> = {
  orcad: "OrCAD / Allegro PCB Editor",
};

export const REMEDIES: Record<string, Partial<Record<CadTool, string>> & { general: string }> = {
  MISSING_LAYER: {
    general: "Exportați toate straturile de fabricație: cupru, mască, serigrafie, pastă, contur și găurire.",
    orcad: "Manufacture → Artwork: adăugați filmele TOP, BOTTOM, SMTOP, SSTOP, SPTOP, OUTLINE. Apoi NC Drill.",
  },
  DRL_COUNT: {
    general: "Trebuie livrat exact un singur fișier de găurire Excellon, care conține toate găurile.",
    orcad: "NC Drill: dezactivați 'Separate files for plated/non-plated holes'.",
  },
  BOARD_SIZE: {
    general: "Placa trebuie să aibă exact 40.00 × 40.00 mm (toleranță ±0.2 mm).",
    orcad: "Setup → Outlines → Board Outline: Create, dimensiune 40×40 mm.",
  },
  ORIGIN: {
    general: "Colțul stânga-jos al plăcii trebuie să fie în originea (0,0).",
    orcad: "Setup → Change Drawing Origin, click pe colțul stânga-jos.",
  },
  OUTLINE_WIDTH: {
    general: "Lățimea liniei de contur trebuie să fie ≤ 0.2 mm (recomandat 0.1 mm).",
    orcad: "Lățimea liniei Board Outline la 0.1 mm sau 0.05 mm.",
  },
  EDGE_CLEARANCE: {
    general: "Păstrați minim 1.00 mm între orice cupru și marginea plăcii.",
    orcad: "Constraint Manager → Spacing → Route Keepin la 1 mm de contur.",
  },
  VIA_IN_PAD: {
    general: "Nu plasați via-uri în pad-uri SMD: pasta se scurge prin gaură. Mutați via-ul la minim 0.25 mm de pad.",
    orcad: "Mutați via-ul la minim 0.25 mm de pad SMD.",
  },
  SSTOP_OVER_PAD: {
    general: "Fiecare pad de cupru trebuie să aibă o deschidere în masca de lipire.",
    orcad: "Setup → Design Parameters → Manufacturing → Clearances; padstack-urile trebuie să conțină SOLDERMASK_TOP.",
  },
  MASK_DUPLICATE: {
    general: "Masca TOP este identică cu stratul de cupru — ați exportat cuprul în locul măștii.",
    orcad: "Filmul SMTOP trebuie să conțină doar PIN/SOLDERMASK_TOP, nu ETCH/TOP.",
  },
  FIDUCIALS: {
    general: "Plasați 2 fiduciali optici pe TOP (pad rotund ~1 mm, deschidere mască ~2 mm, fără gaură), la ~200 mil de margine.",
    orcad: "Plasați simbolul mecanic FID1MM în două colțuri opuse.",
  },
  MIN_TRACE: {
    general: "Lățimea minimă a traseelor pentru tehnologia disponibilă este 0.25 mm.",
    orcad: "Constraint Manager → Physical → Min Line Width 0.25 mm.",
  },
  CLEARANCE: {
    general: "Distanța minimă între elemente de cupru neconectate este 0.2 mm.",
    orcad: "Constraint Manager → Spacing → Line to Line 0.2 mm.",
  },
  ANNULAR_RING: {
    general: "Inelul anular trebuie să fie ≥ 0.15 mm (IPC-6012 Clasa 2).",
    orcad: "Padstack Editor: diametru pad ≥ gaură + 0.3 mm.",
  },
  HOLE_SIZE: {
    general: "Diametrele găurilor trebuie să fie între 0.3 mm și 3.2 mm, iar toate găurile în interiorul plăcii.",
    orcad: "Padstack Editor → Drill diameter.",
  },
  STENCIL_RATIO: {
    general: "Deschiderile de stencil trebuie să respecte IPC-7525B: Aspect Ratio W/T ≥ 1.5, Area Ratio ≥ 0.66 (T = 0.12 mm).",
    orcad: "Padstack: PASTEMASK_TOP de dimensiune corespunzătoare.",
  },
  STENCIL_WINDOWPANE: {
    general: "Pad-urile termice mari trebuie segmentate în stencil (matrice 2×2 sau 3×3, 50–70% din aria pad-ului).",
    orcad: "Creați forme separate pe PASTEMASK_TOP.",
  },
  BOARD_OVERSIZE: {
    general: "Placa depășește formatul stabilit și nu încape în panou/stencil.",
    orcad: "Setup → Outlines → Board Outline: Edit, redesenați la dimensiunea cerută; Change Drawing Origin în colțul stânga-jos.",
  },
  HOLE_OUTSIDE_PAD: {
    general: "Găurile trebuie să cadă pe pad-uri. De regulă formatul/originea fișierului de găurire diferă de Gerbere.",
    orcad: "Manufacture → NC → NC Parameters: format 2.5, Inches, aceeași origine; regenerați NC Drill după Change Drawing Origin.",
  },
  SILK_OVER_PAD: {
    general: "Serigrafia nu are voie să atingă pad-urile.",
    orcad: "Mutați REFDES/contururile de pe Silkscreen_Top; în filmul SSTOP nu includeți PIN.",
  },
  DRILL_TO_DRILL: {
    general: "Marginile găurilor trebuie să fie la distanța minimă una de alta.",
    orcad: "Mutați componentele/via-urile; Constraint Manager → Spacing → Hole to Hole.",
  },
  MISSING_PASTE: {
    general: "Varianta SMT necesită stratul de pastă TOP (SPTOP) pentru stencil.",
    orcad: "Adăugați filmul SPTOP (PASTEMASK_TOP).",
  },
};
