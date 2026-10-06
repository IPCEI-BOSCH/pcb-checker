# DRC module rules
- DRC scoring: per rule `points + perIssue × extra occurrences`, capped by `cap`; rules flagged `critical` cap the total score at `rules.criticalScoreCap` and force "respins" — all values live in `drc_settings`, student explanations in `src/lib/drc/catalog.ts`.
- Teacher-defined DRC rules live in `settings.customRules` (generic check types in `CHECK_TYPES`, evaluated by `evalCustomRule` in `engine.ts`) and are scored like built-in penalties; their student explanations travel in `report.customCatalog` — rules can be added without code changes.
