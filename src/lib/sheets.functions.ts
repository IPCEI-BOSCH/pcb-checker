import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

type Cell = string | number | null;

function creds() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovableKey || !connKey) {
    throw new Error("NOT_CONNECTED: Contul Google Sheets nu este conectat la aplicație.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

async function assertStaff(context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> } ; userId: string }) {
  const { data } = await context.supabase.rpc("is_staff", { _uid: context.userId });
  if (!data) throw new Error("Forbidden");
}

async function gateway(path: string, init: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: { ...creds(), ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Sheets [${res.status}]: ${text}`);
  return text ? JSON.parse(text) : {};
}

/** Write only the platform-owned columns (A..L) plus the header row; manual columns stay untouched. */
export const pushGradebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { spreadsheetId: string; sheetName: string; header: string[]; manualHeader: string[]; values: Cell[][]; linkHeader?: string[]; links?: Cell[][] }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const autoCols = data.header.length;
    const lastAuto = String.fromCharCode(64 + autoCols);
    const manualStart = String.fromCharCode(65 + autoCols);
    const manualEnd = String.fromCharCode(64 + autoCols + data.manualHeader.length);
    const sheet = `'${data.sheetName.replace(/'/g, "''")}'`;

    const body = {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${sheet}!A1:${lastAuto}${data.values.length + 1}`, values: [data.header, ...data.values] },
        { range: `${sheet}!${manualStart}1:${manualEnd}1`, values: [data.manualHeader] },
      ],
    };
    if (data.linkHeader?.length && data.links) {
      const col = (n: number) => String.fromCharCode(64 + n);
      const start = autoCols + data.manualHeader.length + 1;
      body.data.push({ range: `${sheet}!${col(start)}1:${col(start + data.linkHeader.length - 1)}${data.links.length + 1}`, values: [data.linkHeader, ...data.links] });
    }
    await gateway(`/spreadsheets/${data.spreadsheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify(body) });
    return { rows: data.values.length };
  });

/** Read the whole sheet back so manual columns can be merged into the platform. */
export const pullGradebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { spreadsheetId: string; sheetName: string }) => input)
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const sheet = `'${data.sheetName.replace(/'/g, "''")}'`;
    const json = (await gateway(`/spreadsheets/${data.spreadsheetId}/values/${sheet}!A1:Z2000`, { method: "GET" })) as { values?: Cell[][] };
    return { values: json.values ?? [] };
  });

export const checkSheetsConnection = createServerFn({ method: "GET" }).handler(async () => ({
  connected: !!process.env["LOVABLE_API_KEY"] && !!process.env["GOOGLE_SHEETS_API_KEY"],
}));

/** Creates a new spreadsheet in the connected Google account with the given tabs; returns its ID. */
export const createSpreadsheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; tabs: string[] }) => {
    const title = String(input.title ?? "").slice(0, 200).trim();
    const tabs = (Array.isArray(input.tabs) ? input.tabs : []).map((t) => String(t).slice(0, 90)).filter(Boolean).slice(0, 10);
    if (!title || !tabs.length) throw new Error("Titlu sau file lipsă.");
    return { title, tabs };
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context as never);
    const json = (await gateway(`/spreadsheets`, {
      method: "POST",
      body: JSON.stringify({ properties: { title: data.title, locale: "ro_RO" }, sheets: data.tabs.map((title) => ({ properties: { title } })) }),
    })) as { spreadsheetId: string; spreadsheetUrl: string };
    return { spreadsheetId: json.spreadsheetId, url: json.spreadsheetUrl };
  });
