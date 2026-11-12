/** P1DCE laboratory checks are opt-in until reviewed in the rule sandbox. */
export const LAB_RULE_VALUES = {
  labGeometryTol: 0.05,
  outlineCopyMinLength: 10,
  silkTextOverlapTol: 0.05,
  silkMaxDirections: 2,
  silkDirectionTolDeg: 10,
  fiducialNominalDiameter: 1,
  fiducialPasteTolerance: 0.1,
  /** 0 = no paste (industrial), 1 = matched paste (manual lab stencil). */
  fiducialPasteMode: 1,
  fiducialKeepoutRatio: 2,
  maxVias: 35,
  smtAllowedThtHoles: 0,
  smtThtMinDiameter: 0.65,
  padExitToleranceDeg: 10,
  padMaxExits: 1,
  padExitMaxArea: 4,
  rightAngleToleranceDeg: 5,
};
export type LabRuleValues = typeof LAB_RULE_VALUES;

export const LAB_RULE_FIELDS = {
  labGeometryTol: { label: "Toleranță geometrică laborator", unit: "mm", group: "Laborator P1DCE", step: 0.01 },
  outlineCopyMinLength: { label: "Lungime minimă contur copiat", unit: "mm", group: "Laborator P1DCE", step: 1 },
  silkTextOverlapTol: { label: "Penetrare minimă între texte", unit: "mm", group: "Laborator P1DCE", step: 0.01 },
  silkMaxDirections: { label: "Număr maxim axe de citire", unit: "buc", group: "Laborator P1DCE", step: 1 },
  silkDirectionTolDeg: { label: "Toleranță grupare axe text", unit: "°", group: "Laborator P1DCE", step: 1 },
  fiducialNominalDiameter: { label: "Diametru fiducial de laborator", unit: "mm", group: "Laborator P1DCE", step: 0.05 },
  fiducialPasteTolerance: { label: "Toleranță relativă pastă fiducial", unit: "raport", group: "Laborator P1DCE", step: 0.01 },
  fiducialPasteMode: { label: "Pastă fiducial: 0 fără / 1 egală cu pad", unit: "mod", group: "Laborator P1DCE", step: 1 },
  fiducialKeepoutRatio: { label: "Diametru gardare / diametru fiducial", unit: "raport", group: "Laborator P1DCE", step: 0.1 },
  maxVias: { label: "Număr maxim via-uri", unit: "buc", group: "Laborator P1DCE", step: 1 },
  smtAllowedThtHoles: { label: "Găuri THT permise în tema SMT", unit: "buc", group: "Laborator P1DCE", step: 1 },
  smtThtMinDiameter: { label: "Diametru minim candidat THT", unit: "mm", group: "Laborator P1DCE", step: 0.05 },
  padExitToleranceDeg: { label: "Abatere ieșire perpendiculară din pad", unit: "°", group: "Laborator P1DCE", step: 1 },
  padMaxExits: { label: "Număr maxim ieșiri directe din pad", unit: "buc", group: "Laborator P1DCE", step: 1 },
  padExitMaxArea: { label: "Arie maximă pad pentru verificarea ieșirilor", unit: "mm²", group: "Laborator P1DCE", step: 0.1 },
  rightAngleToleranceDeg: { label: "Toleranță colț de 90°", unit: "°", group: "Laborator P1DCE", step: 1 },
};

export const LAB_TITLES = {
  SILK_TEXT_OVERLAP: "Suprapunere texte serigrafie",
  SILK_OVER_VIA: "Serigrafie peste via deschis",
  SILK_MAX_DIRECTIONS: "Axe de citire pe serigrafie",
  OUTLINE_IN_SILK: "Contur placă copiat pe serigrafie",
  OUTLINE_IN_MASK: "Contur placă copiat pe mască",
  FIDUCIAL_PASTE_MATCH: "Pastă fiducial conformă procesului",
  FIDUCIAL_KEEPOUT: "Gardare circulară fiducial",
  DRILL_NO_TOOLS: "Scule de găurire lipsă / invalide",
  EXCESSIVE_VIAS: "Număr excesiv de via-uri",
  UNUSED_VIAS: "Via-uri izolate geometric",
  ANNULAR_RING_DROWNED: "Pad via înglobat într-un traseu lat",
  UNAUTHORIZED_THT: "Candidați THT în tema SMT",
  PAD_EXIT_ANGLE: "Ieșire oblică din pad dreptunghiular",
  PAD_MULTIPLE_EXITS: "Ieșiri multiple din pad SMD",
  RIGHT_ANGLE_TRACES: "Colțuri de rutare de 90°",
  ARCHIVE_CONVENTION: "Convenții arhivă de predare",
};
export type LabRuleCode = keyof typeof LAB_TITLES;

export const LAB_RULE_LINKS: Record<LabRuleCode, (keyof LabRuleValues)[]> = {
  SILK_TEXT_OVERLAP: ["silkTextOverlapTol"],
  SILK_OVER_VIA: ["labGeometryTol"],
  SILK_MAX_DIRECTIONS: ["silkMaxDirections", "silkDirectionTolDeg"],
  OUTLINE_IN_SILK: ["labGeometryTol", "outlineCopyMinLength"],
  OUTLINE_IN_MASK: ["labGeometryTol", "outlineCopyMinLength"],
  FIDUCIAL_PASTE_MATCH: ["fiducialNominalDiameter", "fiducialPasteMode", "fiducialPasteTolerance", "labGeometryTol"],
  FIDUCIAL_KEEPOUT: ["fiducialKeepoutRatio", "fiducialNominalDiameter", "labGeometryTol"],
  DRILL_NO_TOOLS: [],
  EXCESSIVE_VIAS: ["maxVias"],
  UNUSED_VIAS: ["labGeometryTol"],
  ANNULAR_RING_DROWNED: ["labGeometryTol"],
  UNAUTHORIZED_THT: ["smtAllowedThtHoles", "smtThtMinDiameter"],
  PAD_EXIT_ANGLE: ["padExitToleranceDeg", "padExitMaxArea", "labGeometryTol"],
  PAD_MULTIPLE_EXITS: ["padMaxExits", "padExitMaxArea", "labGeometryTol"],
  RIGHT_ANGLE_TRACES: ["rightAngleToleranceDeg", "labGeometryTol"],
  ARCHIVE_CONVENTION: [],
};

type Category = "STRUCT" | "MECH" | "DRILL" | "COPPER" | "SOLDERMASK" | "STENCIL" | "SILKSCREEN";
const explanation = (err: number, category: Category, what: string, why: string, fix: string) => ({ err: `ERR_${err}`, category, what, why, fix });
export const LAB_CATALOG = {
  SILK_TEXT_OVERLAP: explanation(64, "SILKSCREEN", "Două blocuri de text recunoscute se suprapun pe aceeași față.", "Referințele devin greu de citit. Cazul trebuie confirmat vizual; textele contopite pot scăpa extracției.", "Separați referințele: OrCAD Edit → Move REFDES; Altium mutați Designator pe Overlay; KiCad mutați Reference pe Silkscreen."),
  SILK_OVER_VIA: explanation(65, "SILKSCREEN", "Cerneala intersectează o gaură via cu deschidere în mască.", "Marcajul se întrerupe în gaură; un via acoperit de mască nu este semnalat.", "Mutați textul/conturul: OrCAD SILKSCREEN_TOP/BOTTOM; Altium Top/Bottom Overlay; KiCad F/B.Silkscreen, sau acoperiți via-ul cu mască dacă procesul permite."),
  SILK_MAX_DIRECTIONS: explanation(66, "SILKSCREEN", "Textul are prea multe axe geometrice de citire.", "O orientare consecventă simplifică inspecția. Sensurile 0°/180° nu pot fi deosebite sigur din geometrie.", "Uniformizați rotația textelor: OrCAD Edit → Spin; Altium Properties → Rotation; KiCad Text Properties → Orientation."),
  OUTLINE_IN_SILK: explanation(67, "SILKSCREEN", "Segmente de serigrafie coincid cu conturul mecanic al plăcii.", "Conturul mecanic nu trebuie copiat în filmul de inscripționare al laboratorului.", "OrCAD Artwork SSTOP: eliminați BOARD GEOMETRY/OUTLINE; Altium exportați Overlay fără Mechanical; KiCad dezactivați Plot drawing sheet și păstrați conturul pe Edge.Cuts."),
  OUTLINE_IN_MASK: explanation(68, "SOLDERMASK", "Deschideri liniare din mască urmăresc conturul plăcii.", "Exportul conturului în mască lasă marginea neprotejată; nu este același lucru cu duplicarea cuprului.", "OrCAD Artwork SMTOP/SMBOT: eliminați OUTLINE; Altium exportați numai Solder Mask; KiCad numai F/B.Mask, fără Edge.Cuts."),
  FIDUCIAL_PASTE_MATCH: explanation(69, "STENCIL", "Pastă fiducial lipsă, supradimensionată sau neconformă procesului ales.", "Șablonul manual P1DCE cere marker SPTOP egal cu TOP; procesul industrial poate cere fără pastă.", "OrCAD Padstack → PASTEMASK_TOP; Altium Paste Mask / apertură separată; KiCad pad F.Paste. Alegeți modul procesului: laborator 1 mm ±10%, industrial fără pastă."),
  FIDUCIAL_KEEPOUT: explanation(70, "SOLDERMASK", "Zona circulară din jurul fiducialului conține cupru/serigrafie ori masca este prea mică.", "Markerul trebuie izolat pentru aliniere: diametrul zonei libere este cel puțin dublul markerului.", "OrCAD Route/Package Keepout și SOLDERMASK; Altium Keep-Out și Mask Expansion; KiCad Rule Area și mask clearance. Marker 1 mm: zonă liberă Ø2 mm."),
  DRILL_NO_TOOLS: explanation(71, "DRILL", "O gaură folosește o sculă nedefinită sau cu diametru nul.", "Fișierul CNC nu conține instrucțiuni executabile complete. Nu ghiciți diametrele din pad-uri.", "OrCAD regenerați NC Drill cu tool table; Altium NC Drill Files; KiCad Generate Drill Files (Excellon). Includeți TnnCdiametru; verificați toate sculele."),
  EXCESSIVE_VIAS: explanation(72, "DRILL", "Numărul de via-uri depășește pragul pedagogic configurat.", "Nu este o limită universală de fabricație; via-urile de stitching pot fi intenționate.", "Revizuiți rutarea și necesitatea via-urilor în OrCAD/Altium/KiCad; profesorul adaptează pragul temei."),
  UNUSED_VIAS: explanation(73, "COPPER", "Netul geometric al unui via nu conține trasee, planuri sau pad-uri de componentă.", "Un via izolat poate fi un rest de rutare. Nu se penalizează automat via-urile legate numai la un plan.", "OrCAD Quick Reports → Dangling Vias; Altium PCB Panel → Nets; KiCad DRC → Unconnected items. Confirmați în schema sursă înainte de ștergere."),
  ANNULAR_RING_DROWNED: explanation(74, "COPPER", "Un traseu este mai lat decât pad-ul via-ului pe care îl traversează.", "Observație didactică de rutare, nu dispariția fizică a inelului și nu eroare de thermal relief.", "OrCAD/Altium/KiCad: reduceți local lățimea traseului sau adaptați padstack-ul via-ului, păstrând inelul anular cerut."),
  UNAUTHORIZED_THT: explanation(75, "DRILL", "Tema SMT conține găuri cu pad-uri, candidate la componente THT, peste numărul permis.", "Gerber nu spune dacă o gaură este conector, montaj sau componentă autorizată; confirmați cu tema/CAD.", "Verificați amprentele în OrCAD/Altium/KiCad. Folosiți variantele SMT cerute sau configurați numărul de găuri THT autorizate de profesor."),
  PAD_EXIT_ANGLE: explanation(76, "COPPER", "Un traseu părăsește oblic un pad SMD dreptunghiular mic.", "Este o preferință pedagogică de rutare; pad-urile rotite, macro și conexiunile în plan necesită control manual.", "OrCAD Add Connect, Altium Interactive Routing, KiCad Interactive Router: ieșiți perpendicular din latura pad-ului, apoi faceți cotul de 45°."),
  PAD_MULTIPLE_EXITS: explanation(77, "COPPER", "Dintr-un pad SMD mic pleacă mai multe ieșiri geometrice distincte.", "Ramificațiile directe pot îngreuna lipirea și inspecția; unele sunt intenționate electric.", "OrCAD/Altium/KiCad: ieșiți cu un singur traseu scurt și ramificați în exteriorul pad-ului; confirmați excepțiile de putere."),
  RIGHT_ANGLE_TRACES: explanation(78, "COPPER", "Două segmente formează un colț de 90° fără pad/via la joncțiune.", "Regulă de stil pentru laborator, distinctă de acid traps. Ramificațiile T nu sunt semnalate.", "OrCAD/Altium/KiCad: înlocuiți colțul cu două coturi de 45°. Nu modificați fără motiv joncțiunile T sau conexiunile din pad-uri."),
  ARCHIVE_CONVENTION: explanation(79, "STRUCT", "Arhiva nu are un singur folder P1_ sau include nume cu diacritice/fișiere temporare.", "Convenția de laborator simplifică importul CAM; ZIP-urile plate rămân acceptate când această regulă este dezactivată.", "Împachetați un singur folder P1_an_grupa_nume_tema_N_CAD, fără diacritice; eliminați backup-urile și fișierele temporare înainte de export ZIP."),
};

export const LAB_PENALTIES = Object.fromEntries(Object.keys(LAB_TITLES).map((code) => [code, {
  points: code === "DRILL_NO_TOOLS" ? 5 : 2,
  severity: "warning" as const,
  enabled: false,
  smtOnly: ["FIDUCIAL_PASTE_MATCH", "FIDUCIAL_KEEPOUT", "UNAUTHORIZED_THT", "PAD_EXIT_ANGLE", "PAD_MULTIPLE_EXITS"].includes(code),
  perIssue: 0,
  cap: code === "DRILL_NO_TOOLS" ? 5 : 2,
}]));