# Integrity module rules
- Layout similarity (anti-plagiarism) is computed in the browser (`src/lib/integrity/fingerprint.ts`): point sets are aligned over 8 discrete rotations/mirrors plus translation; fingerprints (numbers only, versioned by `FP_VERSION`) are cached in `layout_fingerprints` and staff decisions in `integrity_reviews` — avoids re-downloading every archive.
- Pair similarity scores are cached in `layout_similarity_pairs` keyed by submission pair + `PAIR_VERSION`; bump the version when `similarityDetail` changes — avoids recomparing every pair on each visit.
- Suspicion is series-relative (`src/lib/integrity/adjust.ts`: median/MAD, per-project mean, teacher reference projects in `integrity_references`) — simple themes make all boards look alike.
- Official submissions trigger `checkSubmissionIntegrity` (server fn, ownership verified, admin client) which writes staff-only `integrity_alerts`; students never receive scores.
- v4: trace segments (midpoint+direction+width, length-weighted) feed the copper score; comparison dialog renders real Gerber primitives from the stored ZIPs (`src/components/IntegrityOverlayViewer.tsx`) mapped with the fingerprint centroid + pair transform — no synthetic dots.

## v5 (FP 4 / PAIR 5)
- Point sets are centred on the board outline centre (fallback copper centroid) — stable alignment reference for scoring and the Gerber overlay.
- Score separates `schema` (parts/holes, normal for same theme) from `routing` (width-independent trace centre lines); `cls` pre-classifies every pair and server alerts fire only on routing evidence.
- Mounting holes (≥2.8 mm) are excluded as boilerplate.
- Overlay renders each board offscreen per layer group with clear polarity as destination-out and even-odd regions, so copper pours show their cut-outs.

## v6 (FP 5 / PAIR 6)
- Vias (≤0.65 mm holes with copper on both layers) are a separate `vias` set feeding routing (15%), not schema.
- Fingerprints carry staff-only `forensic` metadata (aperture order, CAD header, ZIP mtimes) collected by `loadGerberZip` into `layer.meta`; pairs get `forensicFlags` — indicators only, never alert triggers.
- Layer-swap camouflage = cross-layer routing ≥70% and ≥20 pts above same-layer routing → class `obfuscare`.
- Partial copy uses 5x5 half-overlapping windows; `bestZoneRect` (A's centred frame) drives the viewer's Diff mode zone and zoom.

## v7 (FP 6 / PAIR 7)
- Scale camouflage: RMS pad-cloud ratio λ∈[0.85,1.15], |λ−1|>0.015 → re-align with B scaled by λ; routing gain >18% → class `obfuscare`, subtype `scalare_artificiala`, `scaleFactor` recorded.
- Rubber-band invariance: `topo` signature (length quantiles, length-weighted angle histogram, junction/via density — all scale/rotation invariant); `topological` ≥60% blends 50/50 with the geometric Chamfer score into `routing` (`routingGeo` keeps the pure geometric value).
- CAD export-order forensic: `flashSeq` (consecutive D03 distances, 0.2 mm bins) + `drillSeq` (diameter/count per tool) + aperture order → `cadSequenceScore` (LCS); ≥85% sets `forensicFlags.identicalCadSequence` — indicator only, never an alert trigger.
- `/insights` "Harta Clusterelor" (`IntegrityNetwork.tsx`): nodes coloured by group, sized by DRC score; edge thickness ∝ routing, dashed orange = camouflage; source→copy arrows from `inferDirection` (self-check chronology: first appearance + iteration count + score growth) — hint, not proof.
- A4 evidence sheet prints 3 offscreen captures (overlay, Diff, `bestZoneRect` zoom), the full metric table (schema/geometric/topological/CAD-sequence/D₄ transform/Z robust) and both students' attempt chronologies; `printDiff` toggle removed (captures are always all three).
