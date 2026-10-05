# Roadmap — PCB Checker & CAM

## Etapa 1 — Fundație + Self-Check (livrat)
- [x] Login Microsoft 365, allowlist domenii UPB, primul utilizator = Administrator
- [x] Roluri: Admin, Manager serie, Îndrumător, Student, Tehnician CAM
- [x] Serii / grupe / îndrumători / studenți (creare, redenumire, arhivare, mutare)
- [x] Self-check ZIP Gerber+Excellon, DRC, vizualizator 2D cu marcaje, ghid CAD
- [x] Predare oficială versionată, evaluare pe grupă, DRC pe lot, aprobare/respingere motivată

## Etapa 2 — Catalog + CAM (livrat)
- [x] Catalog CEF2-Proiect_Situatie: export Excel/CSV, import note cu previzualizare diferențe, coloane manuale protejate
- [x] Sincronizare Google Sheets bidirecțională (push date automate / pull note manuale)
- [x] Generator CAM: panelizare grid 40.508 mm, 7×6, ramă, fiduciali, cupoane de test, DRL unificat, export ZIP + hartă

## Etapa 3 — Reguli, dosare, panou+stencil (livrat)
- [x] Reguli & Setări editabile (global / serie): praguri DRC, punctaj, severitate, parametri CAM
- [x] Asistent AI Gemini pentru propuneri de reguli, cu previzualizare
- [x] Sincronizare setări cu Google Sheets (tab Setari_Platforma), ambele direcții
- [x] Dosare student: Fabricație + Proiect, descrieri, previzualizare, punctaj îndrumător
- [x] CAM: panou + stencil A3, pagini multiple la depășire, inspector Gerber, tabel/tipărire poziții, date_in_LAYERS/STENCILS

## Etapa următoare
- [ ] Restricționare login la tenantul Microsoft UPB (credențiale proprii Entra ID)
- [ ] Import listă studenți CSV/XLSX
- [x] Anti-plagiat (amprentă layout)
- [ ] OCR serigrafie

## Etapa 4 — Arhivare, evaluare pe loturi, stencil X/Y, light (livrat)
- [x] Excellon 2:5 / 2:4 (inch/mm, fără antet OrCAD) — găurile cad pe placă la toate cele 46 de proiecte demo
- [x] Strat FAB recunoscut (Fabricație / Mecanic), ascuns implicit în vizualizator
- [x] Remediere doar OrCAD / Allegro
- [x] Import / arhivare ZIP de către profesor cu detecție serie/grupă/student/temă/N și corectare înainte de import
- [x] Evaluare: toate seriile / toate grupele / un student; DRC pe toată selecția cu progres; Vizualizează Gerber; butoane aprobare colorate; export SITUATIE Excel
- [x] Istoric: DRC pentru toți, Gerber la click pe nume, export Excel, toate seriile din an
- [x] Google Sheets: Creează foaie nouă / Deschide (Catalog + Reguli)
- [x] Stencil A3: pas X 40 mm, pas Y 50 mm, origine (20, 310), folie 300×400; date_in în sintaxa GerbTool „FOLDER X Y"
- [x] Mod luminos

## Etapa 5 — Testare reguli (livrat)
- [x] Tab „Testare reguli": diferențe față de regulile active, proiecte predate sau ZIP-uri locale, DRC vechi vs nou, impact per regulă
- [x] Confirmare manuală Corect/Greșit per proiect, vizualizare Gerber, activare doar după confirmare (justificare dacă există „Greșit")
- [x] Istoric teste salvat; Salvează / propunerea AI trimit spre testare; admin poate salva fără test

## Etapa 6 — Catalog unificat & erori critice
- [x] Erori critice (găuri în afara pad-urilor, placă supradimensionată) cu scor limitat și respingere
- [x] Dimensiune placă X/Y editabilă → panou și stencil recalculate automat
- [x] Penalizări editabile: puncte, +/apariție, plafon, critică; verdict tri-stare
- [x] Serigrafie peste pad (-20p, blocant), distanță între găuri
- [x] Explicații pe înțelesul studentului pentru fiecare depunctare
- [x] Riglă/perechi de straturi în vizualizator, fișă PDF de evaluare (următoarea etapă)

## Etapa 7 — Calibrare acceptare
- [x] Serigrafie: pe cupru (blocant) separat de atingere margine/mască (info, -2p)
- [x] Praguri implicite: izolație 0.300 mm, traseu 0.380 mm
- [x] Diagnostic fișiere în raport (tip, dimensiune, pad-uri, aperturi, unelte găurire)
- [x] Harta vizuală a panoului în CAM, borderou CETTI

## Etapa 8 — Reguli noi, Google Workspace, dosare
- [x] Reguli noi DRC (manual sau AI) care intră în punctaj, raport și fișă
- [x] Catalog: linkuri foldere Drive + puncte dosare în Excel și Google Sheets
- [x] Card stare Google Drive/Sheets, creare foldere Drive pentru toată selecția
- [x] Dosare: încărcare și de către profesor, documente demonstrative, buton Drive, puncte doar de către cadre
- [x] Verificare: 46 proiecte demo neschimbate (37/9), regulă nouă testată

## Etapa 9 — Fereastră DRC unificată & curățare istoric
- [x] Toate regulile standard + regulile noi într-un singur tabel, cu filtre și editor complet
- [x] Texte editabile pentru regulile standard, variantă SMT/THT, toleranță, prag apariții, ignorare VIA, referință, exemplu, notă
- [x] AI creează reguli noi și rescrie regulile existente; testare în aceeași fereastră
- [x] Istoric: arhivare/ștergere per proiect și în lot, golire/ștergere serie, ștergere an

## Etapa 10 — Statistici, integritate, riglă magnetică
- [x] Pagină „Statistici & Integritate": verdicte, distribuție scor, top erori pe serie
- [x] Amprentă layout anti-plagiat (pad-uri relative, scule, densitate cupru), comparație în serie și cu anii anteriori, prag configurabil
- [x] Riglă magnetică în vizualizatorul Gerber
- [x] Notă finală automată (ponderi, previzualizare înainte de aplicare)
- [x] Copie de siguranță an (date + toate fișierele, ZIP)
- [x] DRC în lot pe fire de lucru paralele (pagina nu mai îngheață)
- [x] Panou: găuri de prindere 3 mm asimetrice în rame, cupoane vizibile și în inspector
