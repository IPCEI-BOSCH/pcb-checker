# Calibrare DRC — Seria A 2025 (74 proiecte cu verificare manuală)

Sursa: `Situatie proiecte SMT - Seria A - 2025.xlsx` + proiectele Gerber/Excellon (75 dosare, 74 potrivite cu Excel).
Cerințe oficiale: P1DCE rev G — trasee 16/18/26 mil, spațiere 14 mil, via 0.4 mm, FAB cu drill chart + stack-up.

## Reguli noi (built-in, editabile în /rules)
| Regulă | Prag implicit | Acord cu verificarea manuală (detectate / notate) | Alarme fără notă manuală |
|---|---|---|---|
| MASK_EXPANSION — mască pe pad | 0.04–0.20 mm/latură | 53 / 57 | 13 |
| PASTE_SIZE — pastă nereduse | 40–95% din aria pad-ului | 61 / 64 | 5 |
| PASTE_MISSING_PAD — pad SMD fără pastă | — | 36 / 39 | 18 |
| VIA_DIAMETER — via ≠ 0.4 mm | 0.4 ±0.03 mm (găuri < 0.9 mm) | 20 / 31 | 9 |
| FAB_CONTENT — FAB lipsă/gol | ≥ 300 linii desenate | 21 / 58 | 1 |

## Ajustări
- `minClearance` 0.30 → 0.35 mm (14 mil, conform cerinței oficiale).
- Fiducialii (mască ≥ 1.8× pad) sunt excluși din verificarea măștii/pastei.

## Ce rămâne evaluare umană
- „FAB incorect” când FAB are conținut dar e greșit (tabel/secțiune eronată) — doar lipsa/golul se detectează.
- Rutare ineficientă/haotică, via-uri inutile, plane fără net, referințe orientate/incrementate greșit, font ilizibil.
- „BO generat greșit” (conținut greșit al conturului) — doar lipsa și dimensiunea se detectează.

## Observații
- Clearance și fiduciali apar des automat dar rar în notele manuale; sunt cerințe oficiale, deci au rămas.
- Notele manuale nu menționează fiecare abatere, deci „alarmele fără notă” nu sunt neapărat false pozitive.
