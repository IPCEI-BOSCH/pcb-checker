import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export interface SilkReadResult {
  texts: { idx: number; text: string; confidence: number }[];
  mirroredTop: boolean;
  notes: string;
}

/** Reads silkscreen text blocks from a rendered contact sheet (each block labelled #N). Returns readings only — nothing is stored server-side. */
export const aiReadSilk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { image: string; count: number }) => {
    if (typeof i.image !== "string" || !i.image.startsWith("data:image/png;base64,") || i.image.length > 4_000_000) throw new Error("Imagine invalidă");
    return { image: i.image, count: Math.max(1, Math.min(60, Math.round(i.count || 1))) };
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Asistentul AI nu este configurat.");
    const [{ createOpenAI }, { streamText, Output, jsonSchema, NoObjectGeneratedError }, { createLovableAiGatewayRunIdFetch }] = await Promise.all([
      import("@ai-sdk/openai"),
      import("ai"),
      import("./run-id.server"),
    ]);
    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const provider = createOpenAI({
      baseURL: GATEWAY,
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });
    const schema = jsonSchema<SilkReadResult>({
      type: "object",
      additionalProperties: false,
      required: ["texts", "mirroredTop", "notes"],
      properties: {
        texts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["idx", "text", "confidence"],
            properties: { idx: { type: "number" }, text: { type: "string" }, confidence: { type: "number" } },
          },
        },
        mirroredTop: { type: "boolean" },
        notes: { type: "string" },
      },
    });
    const result = streamText({
      model: provider.responses(MODEL),
      system:
        "Citești texte de pe serigrafia unui PCB. Imaginea conține blocuri etichetate cu roșu #N; fiecare bloc e un cuvânt (designator ca R1, C3, U2, nume, an, logo). " +
        "Pentru fiecare bloc întorci exact textul vizibil (fără diacritice adăugate), idx = N, confidence 0..1. Dacă blocul nu e text (simbol, contur) întorci text gol și confidence 0. " +
        "mirroredTop = true dacă majoritatea textelor apar în oglindă. notes: o frază scurtă în română.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Sunt ${data.count} blocuri. Citește-le.` },
            { type: "image", image: data.image, mediaType: "image/png" },
          ],
        },
      ],
      output: Output.object({ schema }),
      providerOptions: {
        openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] },
      },
    });
    try {
      const out = (await result.output) as SilkReadResult;
      return {
        texts: (out.texts ?? []).filter((t) => Number.isFinite(t.idx)).map((t) => ({ idx: Math.round(t.idx), text: String(t.text ?? "").slice(0, 60), confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)) })),
        mirroredTop: !!out.mirroredTop,
        notes: String(out.notes ?? "").slice(0, 300),
      };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) throw new Error("AI nu a putut citi textele.");
      const msg = (e as Error).message ?? "";
      if (/429/.test(msg)) throw new Error("Prea multe cereri către AI — încercați peste un minut.");
      if (/402/.test(msg)) throw new Error("Creditele AI ale spațiului de lucru s-au epuizat (Settings → Plans & credits).");
      if (/403/.test(msg)) throw new Error("Accesul la AI este blocat pentru acest spațiu de lucru.");
      throw new Error(`AI: ${msg}`);
    }
  });
