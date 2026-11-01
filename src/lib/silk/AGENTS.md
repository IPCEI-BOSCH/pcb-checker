# Silk / text module rules

- `extract.ts` clusters stroke segments into glyphs and words (`extractTextBlocks`); it accepts `top_silk`, `bottom_silk` and the copper layers, and stores `decoded`/`decodeConfidence`/`mirrored` on each `SilkBlock`.
- Local vector pre-OCR lives in `ocr.ts`: 5×7 stroke-font templates (A–Z, 0–9), rasterize + dice matching against normal and horizontally flipped templates; the mirror verdict is voted ONLY by confidently matched left/right-asymmetric glyphs (`ASYMMETRIC_GLYPHS`) — never decide mirroring from symmetric glyphs.
- ERR_63 (`MIRRORED_TEXT_ORIENTATION`) is evaluated in the DRC engine from these blocks: mirrored text on TOP or non-mirrored text on BOTTOM fails; blocks with `decodeConfidence < 0.5` or under 2 chars are ignored.
- AI reading (`src/lib/ai/silk-ai.functions.ts`) remains the on-demand fallback for non-standard fonts/logos on a rendered contact sheet — no images stored, credits spent only when asked.
