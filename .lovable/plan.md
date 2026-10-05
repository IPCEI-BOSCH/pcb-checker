# Plan: Citire text serigrafie (OCR) + Anti-plagiat PCB îmbunătățit

## Partea A — Citirea automată a textului de pe serigrafie

### Ce primește profesorul/studentul
- În raportul DRC și în vizualizator apare lista textelor citite de pe serigrafia TOP (și BOTTOM, dacă există): designatoare (R1, C3, U2), nume student/temă, an, logo-uri text.
- Fiecare text are poziție, înălțime, grosime linie, rotație și un grad de încredere. Click pe un text = zoom în vizualizator.
- Reguli noi, editabile în fereastra DRC unificată (praguri, puncte, severitate, texte pentru student):
  - **Text ilizibil** — înălțime sub prag (implicit 1.0 mm) sau grosime linie sub prag (implicit 0.15 mm).
  - **Identificare lipsă** — pe placă nu apare numele/inițialele studentului sau codul temei (comparat cu datele din platformă; potrivire aproximativă, fără diacritice).
  - **Designatoare lipsă** — pad-uri de componentă fără designator în apropiere (procent configurabil).
  - **Designatoare duplicate** — același R1 de două ori.
  - **Text în oglindă pe TOP / neoglindit pe BOTTOM**.
  - **Text peste pad-uri** — se reutilizează detecția serigrafie-pe-cupru existentă, cu mesajul „textul X acoperă pad-ul”.
- Avertisment, nu depunctare, când încrederea citirii e mică — profesorul confirmă manual.

### Cum se citește (hibrid)
1. **Extragere geometrică (fără AI):** din serigrafie se grupează segmentele în blocuri de text (clustering după proximitate și înălțime), se separă de contururile de componente (linii lungi, dreptunghiuri, cercuri). Se măsoară înălțimea, grosimea, rotația.
2. **Randare:** fiecare bloc se desenează în imagine alb-negru, rotită orizontal, la rezoluție fixă (ambele orientări, normal și oglindit).
3. **OCR local în browser** pe blocuri (bibliotecă OCR rulată local, în firele de lucru paralele deja folosite la DRC) — gratuit, rapid, pentru designatoare simple.
4. **AI la cerere** (buton „Citește cu AI” sau automat doar pentru blocuri cu încredere mică): imagine cu toate blocurile trimisă la modelul AI al platformei, răspuns JSON strict (text, încredere). Costă credite, deci e opțional și limitat per proiect.
5. Rezultatele se salvează în raportul DRC (fără imagini stocate).

### Unde apare
- Raport DRC + fișa A4 de evaluare: secțiune „Text serigrafie”.
- Vizualizator Gerber: strat suprapus „Text citit” cu etichete, activabil.
- Evaluare/Istoric: coloană „Identificare pe placă” (OK / lipsă / neclar).
- Sandbox reguli: noile reguli se testează ca orice altă regulă.

## Partea B — Anti-plagiat PCB îmbunătățit

### Probleme de rezolvat față de varianta curentă
- Amprentele se recalculează la fiecare deschidere (descarcă toate arhivele).
- Comparația folosește doar histograme globale — două plăci simple cu componente standard pot părea similare fals; o copie oglindită/mutată parțial poate scăpa.
- Nu există vedere vizuală alăturată și nici decizie salvată.

### Îmbunătățiri
1. **Amprente salvate:** calculate automat la predarea oficială și la DRC în lot, păstrate în baza de date (doar numerele, nu fișierele). Pagina compară instant, inclusiv cu toți anii anteriori.
2. **Amprentă mai bogată (mai multe semnale):**
   - constelație pad-uri: perechi/triplete de pad-uri cu distanțe și unghiuri relative (invariant la mutare, rotire, oglindire);
   - potrivire efectivă: aliniere a celor două plăci (rotație 0/90/180/270 + oglindă + translație) și procent de pad-uri și găuri care coincid în toleranță (ex. 0.2 mm);
   - trasee: hartă de ocupare a cuprului pe grilă după aliniere (suprapunere procentuală);
   - set de scule de găurire, contur placă, număr straturi, fiduciali;
   - text serigrafie (din Partea A): designatoare identice și poziții identice = indiciu puternic; numele altui student pe placă = alertă imediată.
3. **Scor explicat:** în loc de un singur procent — detaliu pe componente (pad-uri X%, trasee Y%, găuri Z%, text W%) și verdict „Identic / Foarte similar / Similar / Diferit”.
4. **Reducere fals pozitive:** penalizare a similarității „banale” (scheme de referință comune temei) prin comparare cu media seriei; perechile cu aceeași temă au prag separat; excludere manuală a unui proiect de referință dat de profesor.
5. **Vedere alăturată:** cele două plăci aliniate, suprapuse în culori diferite, cu zonele comune evidențiate; glisor transparență.
6. **Decizie salvată:** „Fals pozitiv” / „De discutat” / „Confirmat”, cu observație; jurnal de audit; perechile marcate fals pozitiv nu mai apar.
7. **Alerte:** la predarea oficială, dacă scorul cu altă predare depășește pragul, managerul seriei vede alerta în Evaluare (studentul nu vede nimic).
8. **Export:** raport Excel/PDF al perechilor suspecte pentru dosarul comisiei.
9. **Grupuri:** detectare clustere (3+ proiecte copiate între ele), nu doar perechi.

### Confidențialitate
- Doar Administrator / Manager serie / Îndrumătorul grupei văd rezultatele; studenții nu.
- Scorul rămâne indiciu, nu dovadă — mesajul este afișat explicit.

## Ordine de implementare
1. Extragere blocuri text + măsurători (fără OCR) și reguli înălțime/grosime/oglindire.
2. OCR local în fire paralele + reguli identificare/designatoare; afișare în raport, fișă, vizualizator.
3. „Citește cu AI” opțional pentru blocuri neclare.
4. Tabel amprente salvate + calcul la predare/DRC în lot.
5. Amprentă extinsă + aliniere și scor explicat.
6. Vedere alăturată, decizii, alerte, export, clustere.
7. Verificare pe cele 46 de proiecte demo: niciun verdict DRC schimbat de regulile noi decât dacă sunt activate; copie artificială (proiect rotit/oglindit) detectată ca „Identic”.

## Detalii tehnice
- Module noi: `src/lib/silk/extract.ts` (clustering segmente, măsurători), `src/lib/silk/ocr.ts` (randare OffscreenCanvas + OCR WASM în `drc.worker.ts`/pool), `src/lib/ai/silk-ai.functions.ts` (Responses API, `openai/gpt-6-astra`, input imagine, JSON schema strictă, streaming).
- Reguli noi ca intrări în catalog + `RULE_LINKS`/`drc_settings` (praguri `silk.minTextHeight`, `silk.minStroke`, `silk.designatorCoverage`); evaluare în `engine.ts`, rezultat în `report.silkText`.
- Migrație: tabel `layout_fingerprints` (submission_id, student_id, series_id, version, data jsonb) și `integrity_reviews` (pereche, status, notă, autor), cu GRANT + RLS prin `can_view_group`/`can_manage_group`.
- `fingerprint.ts` v2: păstrează câmpurile actuale, adaugă constelație pad-uri, grilă ocupare cupru, scule, contur, text; `similarity` returnează breakdown; aliniere prin RANSAC pe pad-uri cu 8 transformări discrete.
- Pre-filtru rapid (număr pad-uri/găuri, set scule) înainte de alinierea costisitoare; alinierea rulează în pool-ul de fire.
- AGENTS.md: reguli noi pentru OCR hibrid și amprente stocate.
