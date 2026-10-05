import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SHEETS = "https://connector-gateway.lovable.dev/google_sheets/v4";
const AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Ctx = { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string };

async function assertManager(context: Ctx) {
  const [a, m, c] = await Promise.all([
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "series_manager" }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "cam_tech" }),
  ]);
  if (!a.data && !m.data && !c.data) throw new Error("Forbidden");
}

async function sheets(path: string, init: RequestInit = {}) {
  const lk = process.env["LOVABLE_API_KEY"];
  const ck = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lk || !ck) throw new Error("Contul Google Sheets nu este conectat.");
  const res = await fetch(`${SHEETS}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": ck, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Sheets [${res.status}]: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function ensureTab(spreadsheetId: string, tab: string) {
  const meta = await sheets(`/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`);
  const exists = (meta.sheets ?? []).some((s: { properties: { title: string } }) => s.properties.title === tab);
  if (!exists) {
    await sheets(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
  }
}

export const pushSettingsSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { spreadsheetId: string; tab: string; rows: string[][] }) => i)
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    await ensureTab(data.spreadsheetId, data.tab);
    const tab = `'${data.tab.replace(/'/g, "''")}'`;
    await sheets(`/spreadsheets/${data.spreadsheetId}/values/${tab}!A:C:clear`, { method: "POST", body: "{}" });
    const values = [["cheie", "valoare", "descriere"], ...data.rows];
    await sheets(`/spreadsheets/${data.spreadsheetId}/values/${tab}!A1:C${values.length}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values }),
    });
    return { rows: data.rows.length };
  });

export const pullSettingsSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { spreadsheetId: string; tab: string }) => i)
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const tab = `'${data.tab.replace(/'/g, "''")}'`;
    const res = await sheets(`/spreadsheets/${data.spreadsheetId}/values/${tab}!A1:C500`);
    const values = ((res.values ?? []) as string[][]).slice(1);
    return { rows: values };
  });

/** Ask Gemini to propose a JSON patch over the current settings. Returns only the patch; the UI previews before saving. */
export const aiSuggestSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { prompt: string; current: unknown }) => {
    if (!i.prompt || i.prompt.length > 4000) throw new Error("Cerere invalidă");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertManager(context as never);
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Asistentul AI nu este configurat.");
    const system = `Ești expert în proiectare PCB și DFM pentru disciplina P1-DCE (Facultatea de Electronică UPB).
Primești setările curente ale verificatorului (JSON cu secțiunile rules [mm], penalties {points,severity:"blocking"|"warning"|"info",enabled,smtOnly}, cam [mm]).
Poți rescrie și textele regulilor standard (overrides: {COD: {title, what, why, fix, reference}}) — what/why/fix sunt pentru student, fix cu pași OrCAD/Allegro.
Propune modificări conform cererii profesorului. 1 mil = 0.0254 mm. Returnează DOAR câmpurile modificate prin funcția propose_settings, plus o explicație scurtă în română.`;
    const res = await fetch(AI, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Setări curente:\n${JSON.stringify(data.current)}\n\nCerere: ${data.prompt}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "propose_settings",
              description: "Propune un patch parțial peste setări",
              parameters: {
                type: "object",
                properties: {
                  explanation: { type: "string" },
                  rules: { type: "object", additionalProperties: { type: "number" } },
                  cam: { type: "object", additionalProperties: true },
                  overrides: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: { title: { type: "string" }, what: { type: "string" }, why: { type: "string" }, fix: { type: "string" }, reference: { type: "string" } },
                    },
                  },
                  penalties: {
                    type: "object",
                    additionalProperties: {
                      type: "object",
                      properties: {
                        points: { type: "number" },
                        severity: { type: "string", enum: ["blocking", "warning", "info"] },
                        enabled: { type: "boolean" },
                        perIssue: { type: "number" },
                        cap: { type: "number" },
                        critical: { type: "boolean" },
                        appliesTo: { type: "string", enum: ["ALL", "SMT", "THT"] },
                      },
                    },
                  },
                },
                required: ["explanation"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "propose_settings" } },
      }),
    });
    if (res.status === 429) throw new Error("Prea multe cereri către AI — încercați peste un minut.");
    if (res.status === 402) throw new Error("Creditele AI ale spațiului de lucru s-au epuizat.");
    const text = await res.text();
    if (!res.ok) throw new Error(`AI [${res.status}]: ${text}`);
    const json = JSON.parse(text);
    const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("AI nu a returnat o propunere.");
    return JSON.parse(args) as { explanation: string; rules?: Record<string, number>; cam?: Record<string, number | boolean>; penalties?: Record<string, { points?: number; severity?: string; enabled?: boolean; perIssue?: number; cap?: number; critical?: boolean; appliesTo?: string }>; overrides?: Record<string, { title?: string; what?: string; why?: string; fix?: string; reference?: string }> };
  });
