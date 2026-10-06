<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Architecture rules

- Gerber/Excellon parsing and DRC run in the browser (`src/lib/gerber`, `src/lib/drc`); only the report JSON and the ZIP are stored — keeps the server stateless and lets batch DRC reuse the same engine.
- All data access goes through the browser client with RLS; permissions live in SQL helpers (`has_role`, `can_view_group`, `can_manage_group`, `manages_series`) — one source of truth for the role hierarchy.
- Role changes only via the `set_role` RPC and profile/first-admin bootstrap via `ensure_profile` (also enforces the UPB domain allowlist) — prevents client-side privilege escalation.
- Signed-in pages live under `src/routes/_authenticated/` (client-only gate) — auth session is client-held.
- Panelization/CAM output is generated in the browser from parsed primitives (`src/lib/cam/panelize.ts`) — reuses the same parser as DRC, no server-side CAD toolchain.
- Gradebook columns are split into platform-owned auto columns and teacher-owned manual columns (`src/lib/gradebook.ts`); sync never writes manual columns, and imports go through a diff preview.
- Google Sheets access runs only through server functions (`src/lib/sheets.functions.ts`) over the Lovable connector gateway — connector credentials never reach the browser.
- DRC thresholds, scoring and CAM geometry come from `drc_settings` (defaults <- global row <- series row, `src/lib/drc/settings.ts`); `runDrc` takes settings — no hardcoded rule values.
- CAM pages never overwrite: overflowing boards go to a new panel/stencil page; each page exports its own ZIP with `date_in_*.txt`.
- Excellon files with undeclared coordinate format are parsed after Gerbers and the candidate format (2:5/2:4/…) that best fits the board outline is chosen (`src/lib/gerber/load.ts`) — OrCAD drills often lack a format header.
- Teacher bulk ZIP import (`src/lib/zipImport.ts`) reuses series/groups by name and updates students by folder name (`file_prefix`), so re-imports never duplicate; staff insert slots/submissions via `can_manage_group` policies.
- `date_in_*.txt` uses GerbTool's exact "FOLDER X Y" syntax with no header; stencil geometry has independent X/Y pitch and an explicit top-row origin.
- Rule changes are activated through the sandbox (`src/components/RuleSandbox.tsx`), which runs baseline vs candidate DRC and requires manual per-project confirmation; runs are stored in `rule_test_runs` — keeps rule edits auditable and evidence-based.
- DRC scoring: per rule `points + perIssue × extra occurrences`, capped by `cap`; rules flagged `critical` cap the total score at `rules.criticalScoreCap` and force "respins" — all values live in `drc_settings`, student explanations in `src/lib/drc/catalog.ts`.
- CAM board/pitch are derived from DRC board width/height via `deriveCam` when `cam.autoFromBoard` is on — one board size drives DRC, panel and stencil.
- Board size comes from the largest closed loop in the outline layer (`outlineBBox`), and layer names are matched on whole tokens so prefixed student files classify correctly — dimension text and name prefixes caused false rejections.
- Teacher-defined DRC rules live in `settings.customRules` (generic check types in `CHECK_TYPES`, evaluated by `evalCustomRule` in `engine.ts`) and are scored like built-in penalties; their student explanations travel in `report.customCatalog` — rules can be added without code changes.
- AI rule creation uses the Responses API via `src/lib/ai/rule-ai.functions.ts` (strict JSON schema, returns a draft only) — nothing is saved until tested in the sandbox.
- Google Sheets link columns (`LINK_COLUMNS`) are written after the teacher's manual columns, so existing sheets keep their layout.
- Folder points on `project_files` are guarded by a DB trigger (staff only); managers can upload into a student's folders via `can_manage_group` policies.
- `/rules` has one unified DRC window (`src/components/UnifiedRules.tsx`): built-in and custom rules in one table with a side editor (threshold via `RULE_LINKS`, scoring, variant, student texts); sandbox sits below in the same tab — avoids duplicated tabs.
- Built-in rule texts are edited via `settings.overrides` and travel to reports through `report.customCatalog`, which takes precedence over `CATALOG` — catalog stays the fallback.
- Deleting projects/series/years goes through `src/lib/purge.ts` (removes DB rows and stored files) — one path for history, demo reset and admin cleanup.
- Anti-plagiarism lives in `src/lib/integrity` (browser fingerprints, cached pair scores, staff-only alerts) — see its AGENTS.md.
- Silkscreen text is found geometrically (`src/lib/silk/extract.ts`, stroke clustering) inside DRC; reading the text is on-demand via AI (`src/lib/ai/silk-ai.functions.ts`) on a rendered contact sheet — no images stored, credits spent only when asked.
