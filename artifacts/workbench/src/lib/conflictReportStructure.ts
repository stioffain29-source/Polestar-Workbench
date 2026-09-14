/**
 * The client-facing Conflict Watch reader journey.
 *
 * Keep this small structure shared by the preview and the direct jsPDF
 * exporter.  `situation` remains the persisted/editor key for BLUF so older
 * reports and saved section overrides continue to resolve.
 */
export const CONFLICT_CLIENT_SECTION_ORDER = [
  "cover",
  "fast-facts",
  "bluf",
  "top-activity-areas",
  "other-watched",
  "what-matters",
  "watch-next",
  "polestar-view",
  "related-incidents",
  "disclaimer",
] as const;

export type ConflictClientSection = (typeof CONFLICT_CLIENT_SECTION_ORDER)[number];

export const CONFLICT_CLIENT_SECTION_TITLES = {
  bluf: "BLUF",
  fastFacts: "Fast Facts",
  topActivityAreas: "Top Activity Areas",
  otherWatched: "Other Watched Theatres",
  whatMatters: "What Matters for Business",
  watchNext: "Watch Next",
  polestarView: "Polestar View",
  incidentList: "Incident List",
  disclaimer: "Disclaimer",
} as const;