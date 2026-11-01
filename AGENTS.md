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

Subdirectories `src/lib/drc`, `src/lib/integrity` and `src/lib/silk` have their own `AGENTS.md` — read it before changing files there.

- Gerber/Excellon parsing and DRC run in the browser (`src/lib/gerber`, `src/lib/drc`); only the report JSON and the ZIP are stored — keeps the server stateless and lets batch DRC reuse the same engine.
- All data access goes through the browser client with RLS; permissions live in SQL helpers (`has_role`, `can_view_group`, `can_manage_group`, `manages_series`) — one source of truth for the role hierarchy.
- Role changes only via the `set_role` RPC and profile/first-admin bootstrap via `ensure_profile` (also enforces the UPB domain allowlist) — prevents client-side privilege escalation.
- Signed-in pages live under `src/routes/_authenticated/` (client-only gate) — auth session is client-held.
- Panelization/CAM output is generated in the browser from parsed primitives (`src/lib/cam/panelize.ts`) — reuses the same parser as DRC, no server-side CAD toolchain.
- CAM pages never overwrite: overflowing boards go to a new panel/stencil page, each exporting its own ZIP with `date_in_*.txt` (GerbTool's exact "FOLDER X Y" syntax, no header); board/pitch derive from the DRC board size via `deriveCam` when `cam.autoFromBoard` is on; stencil has independent X/Y pitch and an explicit top-row origin.
- Gradebook columns are split into platform-owned auto columns and teacher-owned manual columns (`src/lib/gradebook.ts`); sync never writes manual columns, imports go through a diff preview, and Sheets link columns (`LINK_COLUMNS`) are written after the teacher's manual columns so existing sheets keep their layout.
- Google Sheets access runs only through server functions (`src/lib/sheets.functions.ts`) over the Lovable connector gateway — connector credentials never reach the browser.
- DRC thresholds, scoring and CAM geometry come from `drc_settings` (defaults <- global row <- series row, `src/lib/drc/settings.ts`); `runDrc` takes settings — no hardcoded rule values.
- Excellon files with undeclared coordinate format are parsed after Gerbers and the candidate format (2:5/2:4/…) that best fits the board outline is chosen (`src/lib/gerber/load.ts`) — OrCAD drills often lack a format header.
- Teacher bulk ZIP import (`src/lib/zipImport.ts`) reuses series/groups by name and updates students by folder name (`file_prefix`), so re-imports never duplicate; staff insert slots/submissions via `can_manage_group` policies.
- Rule changes are activated through the sandbox (`src/components/RuleSandbox.tsx`), which runs baseline vs candidate DRC and requires manual per-project confirmation; runs are stored in `rule_test_runs` — keeps rule edits auditable and evidence-based.
- Board size comes from the largest closed loop in the outline layer (`outlineBBox`), and layer names are matched on whole tokens so prefixed student files classify correctly — dimension text and name prefixes caused false rejections.
- AI rule creation uses the Responses API via `src/lib/ai/rule-ai.functions.ts` (strict JSON schema, returns a draft only) — nothing is saved until tested in the sandbox.
- Folder points on `project_files` are guarded by a DB trigger (staff only); managers can upload into a student's folders via `can_manage_group` policies.
- `/rules` has one unified DRC window (`src/components/UnifiedRules.tsx`): built-in and custom rules in one table with a side editor (threshold via `RULE_LINKS`, scoring, variant, student texts); sandbox sits below in the same tab — avoids duplicated tabs.
- Built-in rule texts are edited via `settings.overrides` and travel to reports through `report.customCatalog`, which takes precedence over `CATALOG` — catalog stays the fallback.
- Deleting projects/series/years goes through `src/lib/purge.ts` (removes DB rows and stored files) — one path for history, demo reset and admin cleanup.
- Silkscreen/copper text is found geometrically (`src/lib/silk/extract.ts`, stroke clustering) with local vector pre-OCR and mirror detection (ERR_63) — see `src/lib/silk/AGENTS.md`; AI reading (`silk-ai.functions.ts`) stays on-demand — no images stored, credits spent only when asked.
- Platform services (Google Drive/Sheets, AI) go through `src/lib/platform.server.ts`, which uses Lovable gateways when their keys exist and direct APIs otherwise; self-hosting files live in `selfhost/`, `install.sh`, `Dockerfile` — keeps the app runnable without Lovable.
- Deadlines live in `deadlines` (group row overrides series row); `deadlineState` (`src/lib/deadlines.ts`) decides open/late/closed, per-student `students.deadline_extension_until` extends only the hard deadline — enforced in `/self-check` before the OFFICIAL insert.
- Official submissions carry `zip_sha256`/`report_sha256`/`late_days`; the A4 receipt (`src/lib/receipt.ts`) prints them — never recompute hashes from storage, use the stored ones.
- Spatial annotations (`review_annotations`, `src/lib/annotations.ts`) render as pins in `GerberViewer` via the `pins`/`onPinRequest`/`focusPoint` props (right-click adds, `DrcReportView` passes through) — staff write via `can_manage_group`, students read their own.
- Every manual grade write (`updateStudentGradeField`, `bulkUpdateGrades`, `applyManualChanges`) and the oral-interview grade (`src/lib/interview.ts`, deterministic questions from `DrcReport`, optimistic-locked write to `students.grade_interview`) insert `grade_audit_logs` rows — the `/gradebook` audit drawer is read-only.
- Student re-evaluation requests live in `review_requests` (student inserts own, staff resolve); open counts badge `/review` rows and `/gradebook`.
- Air-Gapped Exam Mode: `groups.exam_mode` + one-time `exam_tokens` (security-definer RPC `redeem_exam_token`) gate the OFFICIAL submission in `/self-check`; `/maintenance` (staff) hosts exam codes, the service healthcheck (`platformHealth`) and the one-click semester bundle (`exportSemesterBundle`, jszip server-side — Gerber ZIPs stay in Storage, the bundle carries their paths + SHA-256).
