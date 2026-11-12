import { LAB_TITLES } from "./labDefinitions";
import { mergeSettings, type Settings } from "./settings";

/** Draft only: the caller must submit it through the existing manual sandbox. */
export function labCalibrationDraft(base: Settings): Settings {
  const next = mergeSettings(base);
  for (const code of Object.keys(LAB_TITLES)) {
    const p = next.penalties[code];
    if (p) p.enabled = true;
  }
  next.rules.fiducialPasteMode = 1;
  return next;
}