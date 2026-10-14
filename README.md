# PCB Pro Suite

Construiește platforma web completă PCB Checker & CAM Platform pentru Facultatea de Electronică (P1/P1-DCE) conform cerințelor și specificației finale V4:

1. Autentificare & Securitate Microsoft 365 / Teams:
- Autentificare cu cont universitar (@upb.ro, @student.upb.ro) via Microsoft Entra ID / OIDC.
- Sistem de roluri ierarhic: Administrator General, Manager de Serie, Îndrumător de Grupă, Student și Tehnician CAM.
- Atribuirea și delegarea facilă a rolurilor: Administratorul numește Manageri de Serie, Managerii numesc Îndrumători pe grupe.

2. Management Dinamic al Seriilor și Grupelor:
- Administrare completă din UI: creare, editare, redenumire și arhivare serii (ex: Seria B 2026-2027), grupe (ex: 431B, 432B) și asocieri îndrumători-grupe.
- Gestiune flexibilă a listelor de studenți, atribuire temă (Tema + Nr. N) și comutare variantă proiect (a-SMT/SMD vs b-THT).

3. Modulul Student — Self-Check Pre-Predare & Predare Oficială:
- Self-Check privat nelimitat: încărcare arhivă ZIP cu fișiere Gerber și Excellon, verificare DRC instantanee, vizualizare erori pe PCB și ghid de remediere CAD (KiCad, Altium, Eagle, OrCAD), fără penalizare de notă.
- Predare oficială (cu dată/oră, versionare și raport de conformitate).

4. Motorul Geometric DRC & Inspecție PCB:
- Extragere și parsare multi-strat Gerber RS-274X și Excellon Drill (Top/Bottom Copper, Solder Mask, Silkscreen, Solder Paste/Stencil, Board Outline/Mechanical, Drill).
- Verificări automate de fabricație: dimensiuni exacte PCB (40x40 mm), origine coordonate în colț, distanță de gardă margine (1 mm clearance), prezență fiduciali optici, interdicție via-in-pad, număr și diametre găuri conform cerințelor tehnologice, lățimi minime trasee și izolații.
- Inspecție șablon pastă (Stencil IPC-7525B): aspect ratio, area ratio, segmentare ferestre termice mari.
- Punctare automată și barem de penalizări pentru proiectele SMT; flux separat de evaluare manuală pentru varianta THT.

5. Vizualizator Gerber Interactiv 2D:
- Randare Canvas interactivă: zoom, pan, toggle vizibilitate/opacitate straturi, culori convenționale industriale.
- Marcaje (pin-uri) interactive pe defectele DRC detectate, cu tooltip detaliat, coordonate exacte și sfaturi de remediere.

6. Panoul Profesorului & Evaluare pe Loturi (Batch Evaluation):
- Dashboard organizat pe an universitar, serie, grupă, îndrumător și varianta proiectului (SMT vs THT).
- Rulare verificare în masă (batch DRC) pe toate proiectele încărcate dintr-o grupă sau serie.
- Rapoarte de conformitate, barem notare automată, aprobare sau respingere motivată pentru fabricație.

7. Sincronizare Google Sheets & Excel:
- Sincronizare bi-direcțională cu structura fișierului existent CEF2-Proiect_Situatie (tab-uri SMT, THT, Stencils, Situație).
- Import/export XLSX și sincronizare Google Sheets, protejând coloanele manuale completate de profesori (prezențe, punctaje laborator) și actualizând automat datele DRC/CAM.

8. Generator Industrial CAM (Panelizare & Șabloane Fabricație):
- Asamblare automată a plăcilor SMT validate în panouri industriale de fabricație (grid 40.508 mm pitch, conform cerințelor istorice și fișierelor de configurare date_in_LAYERS.txt).
- Generare panou șablon pastă (date_in_STENCILS.txt, matrice 7x6 / alocare sloturi).
- Unificare fișiere de găurire Excellon pe panou, inserare cupoane test/martori pentru sloturile libere sau respinse.
- Export pachet complet arhivă Gerber CAM gata de trimis la fabricație.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pcb-checker.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/12dde688-c973-4577-96f6-408fbe2c8e34).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
