/** null means all available series; [] means none, never all. */
export function resolveSeries(selection: string[] | null, available: string[]): string[] {
  return available.filter((id) => selection === null || selection.includes(id));
}

export function selectedGroups<T extends { id: string; series_id: string; is_archived: boolean }>(groups: T[], seriesIds: string[]): T[] {
  return groups.filter((g) => !g.is_archived && seriesIds.includes(g.series_id));
}

export function eligibleForCam(variant: "SMT" | "THT", mode: "panel" | "stencil") {
  return mode === "panel" || variant === "SMT";
}

export function seriesExportTag(labels: string[]) {
  return labels.map((s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")).join("+") || "FARA_SERII";
}