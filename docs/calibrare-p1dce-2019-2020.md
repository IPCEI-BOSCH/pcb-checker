# Raport DRC P1DCE 2019–2020 — 12 noiembrie 2026

## Proveniență și metodă

Analiză executată pe fișierele reale, nu doar pe documentație. Excel: **168 înregistrări de studenți** în Sheet1; Sheet2 este hartă de șabloane, nu catalog suplimentar. Arhiva: **45 directoare P1_, 43 seturi cu Gerber/Excellon, 41 seturi distincte prin SHA-256**. Drosu și Iorga au variante de nume/directoare; acestea nu reprezintă studenți noi. Toate cele 43 seturi au fost asociate cu rânduri Excel: 37 prin nume normalizat, șase variații verificate individual (Bogdanovici, Panait, Drosu, Iorga, Petu, Stanciu). Cele două directoare fără Gerbere nu pot avea DRC geometric.

Am selectat un singur director de fabricație per proiect (Layout, inclusiv variații de capitalizare), excluzând exporturile alternative din Schematics. Altfel găurile și straturile s-ar suprapune și ar genera erori artificiale. Nu am schimbat proiectele, notele sau regulile persistate în aplicație.

Fișierul `calibrare-p1dce-2019-2020-evidence.json` păstrează pentru fiecare set: numele, rândul Excel (numerotare 1-based), observația și reparația profesorului, lista fișierelor selectate, amprenta setului, scorurile baseline/candidat, fiecare regulă și mesaj cu coordonate. Baseline: motorul existent și DEFAULT_SETTINGS, nu setările actuale ale unei serii. Candidat: aceleași setări plus cele 16 reguli activate în memorie. Valorile persistate pot suprascrie pragurile implicite.

### Amprente ale surselor

- `wetransfer_p1dce_2026-11-11_0940.7z`: `a41de51d9dec28b727ca40b65fb3efe5ccf9d5ed575aecdcb679c6f498738dfd`
- `P1DCE_Situatie_2019_2020.xlsx`: `b9e58745d685eeaec104aff28e99a6656d678912e73e8007b05c9ebb89000939`
- `Cerinte_tehnologice-P1DCE_2026-2027_rev_G.pdf`: `c4c2c5c49e7f98342153f5aed6551a7a6de8018325a6864ca59b647963d04ae5`

## Reguli existente identificate — fără duplicate

`SILK_OVER_PAD`, `SILK_EDGE`, `MASK_EXPANSION`, `PASTE_SIZE`, `PASTE_MISSING_PAD`, `VIA_DIAMETER`, `ANNULAR_RING`, `FAB_CONTENT`, `MIN_TRACE`, `CLEARANCE`, `ACID_TRAPS`, `DANGLING_TRACES`, `FIDUCIALS`.

Acestea acoperă deja serigrafie peste pad, margini, mască/pastă, diametre și inel anular, FAB, lățimi/izolații, unghiuri ascuțite și capete de traseu. ERR_74 este strict traseu mai lat decât pad-ul via, nu un duplicat al ERR_40 sau ERR_57. ERR_78 este preferință de stil, nu defect industrial universal și nu înlocuiește ERR_55. ERR_71 înlocuiește depunctarea diametrului nul prin ERR_06, dar găurile în afara plăcii rămân semnalate.

FAB_CONTENT numără acum numai linii cu grosime pozitivă. Lipsa cuvintelor DRILL/STACK nu se penalizează: textul Gerber este geometrie, OCR-ul existent nu permite certificarea tabelului sau stack-up-ului. Nota FIDUCIALS nu mai recomandă universal lipsa pastei: procesul manual P1DCE cere marker SPTOP suprapus.

Pragurile existente de mască/pastă/via/clearance NU au fost înăsprite: valorile afirmate în planul anterior nu coincid toate cu codul (implicit clearance 0.35, traseu 0.38, pastă 0.4–0.95 arie, mască 0.04–0.2/latură, toleranță via 0.03 mm). O schimbare la 14/16/26 mil se face separat, cu testarea impactului și confirmare, nu ca activare ascunsă.

## Reguli noi și rezultate măsurate

Toate sunt **dezactivate implicit**, cu avertismente și plafon mic (2 puncte/regulă; ERR_71 5). Butonul „Propune calibrarea 2019–2020” pregătește un candidat în formular, nu salvează și nu activează. Seriile păstrează baremul până la testare și confirmare manuală.

| Cod | Regulă | Seturi semnalate / 43 |
|---|---|---:|
| ERR_64 | `SILK_TEXT_OVERLAP` | 0 |
| ERR_65 | `SILK_OVER_VIA` | 14 |
| ERR_66 | `SILK_MAX_DIRECTIONS` | 0 |
| ERR_67 | `OUTLINE_IN_SILK` | 7 |
| ERR_68 | `OUTLINE_IN_MASK` | 1 |
| ERR_69 | `FIDUCIAL_PASTE_MATCH` | 2 |
| ERR_70 | `FIDUCIAL_KEEPOUT` | 11 |
| ERR_71 | `DRILL_NO_TOOLS` | 14 |
| ERR_72 | `EXCESSIVE_VIAS` | 11 |
| ERR_73 | `UNUSED_VIAS` | 0 |
| ERR_74 | `ANNULAR_RING_DROWNED` | 2 |
| ERR_75 | `UNAUTHORIZED_THT` | 0 |
| ERR_76 | `PAD_EXIT_ANGLE` | 37 |
| ERR_77 | `PAD_MULTIPLE_EXITS` | 42 |
| ERR_78 | `RIGHT_ANGLE_TRACES` | 17 |
| ERR_79 | `ARCHIVE_CONVENTION` | 0 |

Aceste numere sunt **alerte ale candidatului**, nu erori confirmate și nu precizie/recall. Seturile duplicate sunt incluse în denominatorul 43 și identificabile prin hash. Mai multe proiecte au deja scor zero, deci schimbarea scorului nu măsoară singură utilitatea regulilor. Testarea baseline+candidat pe un set a durat maximum 260 ms în această execuție; nu este garanție de performanță pe orice dispozitiv.

## Trasabilitate cu exemple reale

| Exemplu / Excel | Observație manuală | Rezultat pe fișierele disponibile |
|---|---|---|
| Haraga Tudor, 432E, rând 124 | Fără tool pentru DRILL; pasta markerului mai mare decât pad | ERR_71: 25 găuri invalide, sculă T0; ERR_69 la (5.08,5.08) și (34.91992,34.91992) mm |
| State Ionut, 432E, rând 132 | Profesorul a regenerat DRILL | ERR_71 încă detectabil în exportul disponibil; nu presupunem că arhiva include numai versiunea finală reparată |
| Pietricica Andreea, 432E, rând 128 | Contur pe SMTOP, regenerat de profesor | ERR_68: 162.56 mm de contur coincident; conținutul disponibil păstrează defectul |
| Oprisa Alexandru, 433D, rând 103 | Contur pe SSTOP și unghiuri drepte | ERR_67: 160 mm contur; ERR_78 semnalează colțuri distincte de joncțiuni T |
| Drosu Alexandru, 433E, rând 140 | Profesorul a șters conturul de placă din SSTOP | Ambele variante au contur coincident 162.56 mm și același hash de set; nu sunt două cazuri independente |
| Sandru Raluca, 433E, rând 152 | Inele via înglobate în trasee late | ERR_74: traseu 0.457 mm / pad 0.400 mm la (34.671,6.858); 0.610 mm / 0.400 mm la (38.1,15.494) |
| Cicorschi Alexandra, 433E, rând 137 | Fără tool, inele înglobate, lipsă etichete IN/OUT | ERR_71 detectat; ERR_74 nu confirmă observația pe geometria disponibilă. Lipsa etichetelor funcționale rămâne manuală |
| Vaduva Bianca, 433E | Dimensiuni pastă | ERR_69: marker paste neconform în două colțuri; verificare în evidence JSON |

Pentru fiecare set, evidence JSON conține toate observațiile, regulile și coordonatele, inclusiv cazurile nesemnalate. Numele din seriile A/B din Excel nu sunt prezentate ca inspectate geometric: arhiva furnizată conține D/E.

## Limite și protecție contra falselor pozitive

- **ERR_64/66:** extractorul poate contopi litere cu amprente/alte texte și OCR poate greși. Filtrarea conservatoare cere blocuri alungite, ≥70% încredere și ≥80% caractere recunoscute. După calibrare, niciun set real nu oferă alertă suficient de sigură. Implementarea este verificată sintetic, NU validată pozitiv pe arhiva reală. Axele 0°/180° sunt indistincte; detecția >2 direcții exacte și a textelor contopite necesită CAD/OCR mai bun și confirmare vizuală. Nu am păstrat cele 31/42 alerte brute inițiale, majoritar nesigure.
- **ERR_65:** deschiderea în masca feței corespunzătoare este obligatorie; via-urile tented nu sunt semnalate. Distanța exactă reutilizează engine `gapBetween` pentru linii/flashes; serigrafia exportată în regiuni poate scăpa.
- **ERR_67/68:** coincid segmentele de contur, inclusiv împărțirea lor în subsegmente; nu certifică orice reprezentare region/macro sau potrivire între segmente concatenate în sens invers.
- **ERR_69/70:** recunoaștere X2 sau geometrie circulară izolată, cu mască mai mare. Fiducialul fără mască ori conectat la traseu poate să nu fie recunoscut (ERR_36 acoperă lipsa). Keepout este eșantionat în 64 direcții ×3 raze și ține cont de polarity; obiectele foarte mici între probe pot scăpa. Masca circulară exportată ca region este candidat de revizuire, nu certitudine.
- **ERR_72:** pragul 35 este pedagogic, editabil; nu este limită industrială. Clasificarea pad mic/gaură/refdes poate confunda conectori miniaturali fără atribute X2.
- **ERR_73:** reutilizează harta de neturi existentă, nu reconstruiește alta. Pad-urile izolate sunt semnalate; via-urile în plan plin sunt exceptate prin geometria locală. Harta existentă este capsule-only; netlist-ul CAD rămâne necesar pentru conectivitate completă a regiunilor și semnificația electrică.
- **ERR_74:** observație de stil, nu dispariție fizică a inelului. Nu verifică thermal relief și nu presupune automat defect de fabricație.
- **ERR_75:** candidate geometrice, nu autorizare electrică. Găuri de montaj/slots sunt excluse; limita permisă se configurează pe temă. Fără date CAD nu putem decide dacă un conector este excepție permisă.
- **ERR_76/77:** pad-uri dreptunghiulare mici și linii cu un capăt în pad, fără arcs; pad-uri rotite/macro/region, trasee traversante și conexiuni în plan necesită control manual. Cele 37/42 seturi semnalate cer revizuire: nu recomandăm activare în masă fără confirmarea cazurilor.
- **ERR_78:** numai noduri cu două segmente, fără pad/via; unghiul de 90° este stil de laborator. Nu penalizează joncțiuni T.
- **ERR_79:** original ZIP entry names sunt păstrate; regula verifică folder P1_, diacritice, temporare. Numele ZIP exterior nu este disponibil motorului. ZIP-urile de calibrare au fost reconstruite din directoare, deci 0/43 NU validează convenția arhivelor originale. Fără metadate ZIP regula este declarată neevaluată.
- Gerber nu certifică valorile componentelor, numele neturilor fără X2, schema, simularea, funcționalitatea, poziția textului „sub componentă” fără courtyard, existența reală a tabelului FAB sau a etichetelor VIN/GND/OUT.
- Format Excellon, lipsa sculelor și corecțiile profesorului se tratează separat. Nu inventăm diametre și nu folosim observația istorică drept dovadă că defectul încă există în versiunea primită.

## Validare și mod de lucru

1. În Reguli & Setări alegeți domeniul (general/serie), apoi „Propune calibrarea 2019–2020”. Nu se salvează nimic în acest pas.
2. Dezactivați în candidat regulile pedagogice/nevalidate pe care nu le doriți; pragurile sunt în același editor cu explicațiile și punctajul.
3. Încărcați ZIP-uri cu un singur set de fabricație, rulați comparația, deschideți Gerber și confirmați fiecare rezultat Corect/Greșit.
4. Activați numai după confirmare și justificarea excepțiilor. Rapoartele vechi și notele nu sunt recalculate automat.
5. Teste: 18 teste noi pozitive/negative, 6 benchmark-uri Gerber/Excellon suplimentare (18 total Golden Suite). Suita completă: 47 teste trecute. Nu afirmăm că toate codurile au fixture Gerber real pozitiv; ERR_64/66 au acoperire sintetică a evaluatorului.
6. Test autentic în browser: /rules, proiectul Oprisa din arhivă, baseline/candidat, alerte noi și Gerber vizibil; activarea blocată cu proiect neverificat; zero erori runtime. Nu am apăsat „Corect” sau „Activează” și nu am salvat în baza de date.

## Reproducere

Dezarhivați cu 7z; identificați directoarele P1_; asociați numele cu coloana B din Sheet1 și păstrați variațiile manual verificate. Creați câte un ZIP cu fișierele unui singur director Layout. Rulați `loadGerberZip`, apoi `runDrc(layers, "SMT", DEFAULT_SETTINGS)` și `runDrc(layers, "SMT", labCalibrationDraft(DEFAULT_SETTINGS))`. Comparați mesajele/coord. cu Excel coloanele L/M și amprentele din evidence JSON. Folosiți aceleași valori implicite și comparați hash-ul setului înainte de a interpreta schimbări de rezultat.
