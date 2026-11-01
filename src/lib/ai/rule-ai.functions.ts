import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiConfig } from "../platform.server";

const MODEL = "openai/gpt-6-astra";

const CHECKS = ["min_hole", "max_hole", "min_line_width", "max_line_width", "min_pad", "max_pad", "layer_required", "max_holes", "min_holes", "hole_to_edge", "copper_to_edge", "max_primitives", "layer_primitive_count", "feature_dimension_range", "cross_layer_clearance", "copper_coverage_ratio", "required_silk_aspect"];
const LAYERS = ["top_copper", "bottom_copper", "top_mask", "top_silk", "bottom_silk", "top_paste", "outline", "drill", "fabrication"];
const CATS = ["STRUCT", "MECH", "DRILL", "COPPER", "SOLDERMASK", "STENCIL", "SILKSCREEN"];

export interface AiRuleDraft {
  code: string;
  title: string;
  category: string;
  checkType: string;
  layer: string;
  value: number;
  value2: number | null;
  layer2: string | null;
  region: { x: number; y: number; w: number; h: number } | null;
  points: number;
  perIssue: number;
  cap: number;
  severity: "blocking" | "warning" | "info";
  critical: boolean;
  smtOnly: boolean;
  appliesTo: "ALL" | "SMT" | "THT";
  tolerance: number;
  minOccurrences: number;
  ignoreHoled: boolean;
  reference: string;
  example: string;
  what: string;
  why: string;
  fix: string;
  explanation: string;
}

/** Turns a teacher's free-text request into a complete custom DRC rule. Nothing is saved — the UI previews and tests it first. */
export const aiCreateRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { prompt: string; existingCodes: string[] }) => {
    if (!i.prompt || i.prompt.length > 3000) throw new Error("Cerere invalidă");
    return { prompt: i.prompt, existingCodes: (i.existingCodes ?? []).slice(0, 200) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as { supabase: { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string };
    const roles = await Promise.all(["admin", "series_manager", "cam_tech"].map((r) => ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: r })));
    if (!roles.some((r) => r.data)) throw new Error("Forbidden");

    const ai = aiConfig(MODEL);
    const key = ai?.apiKey;
    if (!ai || !key) throw new Error("Asistentul AI nu este configurat.");

    const [{ createOpenAI }, { streamText, Output, jsonSchema, NoObjectGeneratedError }, { createLovableAiGatewayRunIdFetch }] = await Promise.all([
      import("@ai-sdk/openai"),
      import("ai"),
      import("./run-id.server"),
    ]);
    const runIdFetch = ai.mode === "lovable" ? createLovableAiGatewayRunIdFetch() : null;
    const provider = createOpenAI({
      baseURL: ai.baseURL,
      apiKey: key,
      headers: ai.headers,
      ...(runIdFetch ? { fetch: runIdFetch.fetch } : {}),
    });

    const str = { type: "string" } as const;
    const num = { type: "number" } as const;
    const schema = jsonSchema<AiRuleDraft>({
      type: "object",
      additionalProperties: false,
      required: ["code", "title", "category", "checkType", "layer", "value", "value2", "layer2", "region", "points", "perIssue", "cap", "severity", "critical", "smtOnly", "appliesTo", "tolerance", "minOccurrences", "ignoreHoled", "reference", "example", "what", "why", "fix", "explanation"],
      properties: {
        code: str,
        title: str,
        category: { type: "string", enum: CATS },
        checkType: { type: "string", enum: CHECKS },
        layer: { type: "string", enum: LAYERS },
        value: num,
        value2: { type: ["number", "null"] },
        layer2: { type: ["string", "null"], enum: [...LAYERS, null] },
        region: {
          type: ["object", "null"],
          additionalProperties: false,
          required: ["x", "y", "w", "h"],
          properties: { x: num, y: num, w: num, h: num },
        },
        points: num,
        perIssue: num,
        cap: num,
        severity: { type: "string", enum: ["blocking", "warning", "info"] },
        critical: { type: "boolean" },
        smtOnly: { type: "boolean" },
        appliesTo: { type: "string", enum: ["ALL", "SMT", "THT"] },
        tolerance: num,
        minOccurrences: num,
        ignoreHoled: { type: "boolean" },
        reference: str,
        example: str,
        what: str,
        why: str,
        fix: str,
        explanation: str,
      },
    });

    const system = `Ești expert DFM/PCB pentru disciplina P1-DCE (ETTI, UPB), fabricație la CETTI, proiectare în OrCAD/Allegro.
Transformi cererea profesorului într-O SINGURĂ regulă DRC nouă, evaluabilă automat pe fișiere Gerber/Excellon.
Tipuri de verificare disponibile (checkType) și straturi permise:
- min_hole / max_hole / max_holes / min_holes / hole_to_edge: layer = drill
- min_line_width / max_line_width: top_copper, bottom_copper, top_silk, outline, fabrication
- min_pad / max_pad: top_copper, bottom_copper, top_mask, top_paste
- layer_required: orice strat
- copper_to_edge: top_copper, bottom_copper, top_silk, top_paste
- max_primitives: top_copper, bottom_copper, top_silk, top_mask, top_paste, fabrication
- layer_primitive_count: număr de elemente pe strat între value (minim) și value2 (maxim, opțional). Ex.: „minim 4 via-uri de masă” → layer=drill, value=4, value2=null
- feature_dimension_range: lățimea liniilor / latura pad-urilor / diametrul găurilor în intervalul [value, value2] mm
- cross_layer_clearance: distanță minimă value (mm) între elementele de pe layer și cele de pe layer2
- copper_coverage_ratio: procentul minim din aria plăcii acoperit de cupru pe layer (top_copper/bottom_copper). Ex.: „plan de masă pe BOTTOM minim 40%” → layer=bottom_copper, value=40
- required_silk_aspect: obligă existența unui bloc de text pe layer (top_silk/bottom_silk), opțional într-o zonă region {x,y,w,h} în mm (coordonate absolute pe placă); region=null = toată placa
value: pragul în mm (sau bucăți pentru numărători, sau % pentru copper_coverage_ratio). 1 mil = 0.0254 mm.
value2/layer2/region: null când tipul de verificare nu le folosește.
code: identificator unic MAJUSCULE cu prefix CUSTOM_ (ex. CUSTOM_HOLE_EDGE), diferit de: ${data.existingCodes.join(", ") || "(niciunul)"}.
points = penalizare de bază ca număr POZITIV (0–100), perIssue = puncte per apariție suplimentară, cap = plafon total (≥ points).
appliesTo: ALL implicit, SMT/THT dacă profesorul precizează varianta (smtOnly = appliesTo==="SMT").
tolerance: toleranță de rotunjire în mm (0 dacă nu se cere; ~0.005 pentru praguri în mil).
minOccurrences: de la câte apariții se depunctează (1 implicit).
ignoreHoled: true pentru verificări de pad când trebuie ignorate VIA-urile / pad-urile cu gaură.
reference: standardul invocat (IPC-2221, IPC-7525B, CETTI…) sau "" dacă nu e cazul.
example: un exemplu scurt de proiectare corectă.
critical=true doar dacă profesorul cere explicit ca eroarea să blocheze fabricația.
what/why/fix: explicații în română pentru STUDENT — ce a greșit, de ce contează la fabricație, cum repară pas cu pas în OrCAD/Allegro.
explanation: o frază pentru profesor despre cum ai interpretat cererea. Dacă cererea nu se poate verifica cu tipurile de mai sus, alege cea mai apropiată și spune asta în explanation.`;

    const result = streamText({
      model: provider.responses(ai.model),
      system,
      prompt: data.prompt,
      output: Output.object({ schema }),
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });

    try {
      const out = (await result.output) as AiRuleDraft;
      const code = (out.code || "CUSTOM_RULE").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
      return {
        ...out,
        code: code.startsWith("CUSTOM_") ? code : `CUSTOM_${code}`,
        points: Math.min(100, Math.abs(Number(out.points) || 0)),
        perIssue: Math.abs(Number(out.perIssue) || 0),
        tolerance: Math.abs(Number(out.tolerance) || 0),
        minOccurrences: Math.max(1, Math.round(Number(out.minOccurrences) || 1)),
        smtOnly: out.appliesTo === "SMT",
        cap: Math.max(Math.abs(Number(out.points) || 0), Math.abs(Number(out.cap) || 0)),
        value2: out.value2 != null && Number.isFinite(Number(out.value2)) ? Math.abs(Number(out.value2)) : null,
        layer2: out.layer2 && LAYERS.includes(out.layer2) ? out.layer2 : null,
        region: out.region && [out.region.x, out.region.y, out.region.w, out.region.h].every((n) => Number.isFinite(Number(n)))
          ? { x: Number(out.region.x), y: Number(out.region.y), w: Math.abs(Number(out.region.w)), h: Math.abs(Number(out.region.h)) }
          : null,
      };
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) throw new Error("AI nu a returnat o regulă validă. Reformulați cererea mai concret.");
      const msg = (e as Error).message ?? "";
      if (/429/.test(msg)) throw new Error("Prea multe cereri către AI — încercați peste un minut.");
      if (/402/.test(msg)) throw new Error("Creditele AI ale spațiului de lucru s-au epuizat (Settings → Plans & credits).");
      if (/403/.test(msg)) throw new Error("Accesul la AI este blocat pentru acest spațiu de lucru.");
      throw new Error(`AI: ${msg}`);
    }
  });
