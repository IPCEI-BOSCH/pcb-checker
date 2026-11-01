/**
 * Dual-mode platform adapters (Lovable Cloud vs self-hosted).
 * - Google Drive/Sheets: Lovable connector gateway when its keys exist, otherwise
 *   direct Google APIs with an OAuth refresh token or a service account.
 * - AI: Lovable AI gateway when LOVABLE_API_KEY exists, otherwise any
 *   OpenAI-compatible endpoint (OPENAI_API_KEY, optional OPENAI_BASE_URL / AI_MODEL).
 * Server-only: read env inside functions.
 */

type Service = "drive" | "sheets";

const LOVABLE_GW: Record<Service, string> = {
  drive: "https://connector-gateway.lovable.dev/google_drive",
  sheets: "https://connector-gateway.lovable.dev/google_sheets/v4",
};
const DIRECT: Record<Service, string> = {
  drive: "https://www.googleapis.com",
  sheets: "https://sheets.googleapis.com/v4",
};
const CONN_KEY: Record<Service, string> = { drive: "GOOGLE_DRIVE_API_KEY", sheets: "GOOGLE_SHEETS_API_KEY" };

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined) || undefined;

function lovableGoogle(s: Service) {
  return !!env("LOVABLE_API_KEY") && !!env(CONN_KEY[s]);
}
function directGoogle() {
  return !!(env("GOOGLE_REFRESH_TOKEN") && env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")) || !!env("GOOGLE_SERVICE_ACCOUNT_JSON");
}
export function googleConfigured(s: Service) {
  return lovableGoogle(s) || directGoogle();
}

let cached: { token: string; exp: number } | null = null;

function b64url(buf: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function serviceAccountToken(json: string): Promise<{ token: string; exp: number }> {
  const sa = JSON.parse(json) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    ...(env("GOOGLE_IMPERSONATE") ? { sub: env("GOOGLE_IMPERSONATE") } : {}),
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`Google auth: ${j.error_description ?? res.status}`);
  return { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

async function refreshToken(): Promise<{ token: string; exp: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env("GOOGLE_REFRESH_TOKEN")!,
      client_id: env("GOOGLE_CLIENT_ID")!,
      client_secret: env("GOOGLE_CLIENT_SECRET")!,
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!j.access_token) throw new Error(`Google auth: ${j.error_description ?? res.status}`);
  return { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
}

async function googleAccessToken() {
  if (cached && cached.exp - 60_000 > Date.now()) return cached.token;
  cached = env("GOOGLE_REFRESH_TOKEN") ? await refreshToken() : await serviceAccountToken(env("GOOGLE_SERVICE_ACCOUNT_JSON")!);
  return cached.token;
}

/** Fetch a Google API path (e.g. `/drive/v3/files`, `/spreadsheets/{id}`) through whichever backend is configured. */
export async function googleFetch(s: Service, path: string, init: RequestInit = {}): Promise<Response> {
  const extra = (init.headers as Record<string, string>) ?? {};
  if (lovableGoogle(s)) {
    return fetch(`${LOVABLE_GW[s]}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env("LOVABLE_API_KEY")}`, "X-Connection-Api-Key": env(CONN_KEY[s])!, ...extra },
    });
  }
  if (!directGoogle()) {
    throw new Error(`NOT_CONNECTED: Google ${s === "drive" ? "Drive" : "Sheets"} nu este configurat pe acest server.`);
  }
  const token = await googleAccessToken();
  return fetch(`${DIRECT[s]}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...extra } });
}

/** AI endpoint config. `model` maps Lovable model ids to a self-hosted default when needed. */
export function aiConfig(lovableModel: string) {
  const lk = env("LOVABLE_API_KEY");
  if (lk) {
    return {
      mode: "lovable" as const,
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: lk,
      headers: { "Lovable-API-Key": lk, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } as Record<string, string>,
      model: lovableModel,
    };
  }
  const ok = env("OPENAI_API_KEY");
  if (!ok) return null;
  return {
    mode: "openai" as const,
    baseURL: env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    apiKey: ok,
    headers: {} as Record<string, string>,
    model: env("AI_MODEL") ?? "gpt-4.1-mini",
  };
}

/**
 * Air-Gapped Exam Mode (self-hosted, EXAM_MODE=1): the server runs in an isolated lab
 * network; external services (Google, cloud AI) are expected to be unreachable and the
 * app degrades gracefully — sync queues for reconnect, AI falls back to a local
 * Ollama/vLLM endpoint when OPENAI_BASE_URL points to one.
 */
export function examMode() {
  const v = (env("EXAM_MODE") ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function aiConfigured() {
  return !!env("LOVABLE_API_KEY") || !!env("OPENAI_API_KEY");
}

/** Service overview for the maintenance panel. */
export function platformServices() {
  const ai = aiConfigured();
  return {
    examMode: examMode(),
    google: { drive: googleConfigured("drive"), sheets: googleConfigured("sheets") },
    ai: {
      configured: ai,
      mode: ai ? (env("LOVABLE_API_KEY") ? "lovable" : "openai-compatible") : null,
      baseURL: ai ? (env("LOVABLE_API_KEY") ? "https://ai.gateway.lovable.dev/v1" : env("OPENAI_BASE_URL") ?? "https://api.openai.com/v1") : null,
    },
  };
}
