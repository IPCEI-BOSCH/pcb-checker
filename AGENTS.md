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
