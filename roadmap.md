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
- [ ] Anti-plagiat (amprentă layout), OCR serigrafie
