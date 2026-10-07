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
