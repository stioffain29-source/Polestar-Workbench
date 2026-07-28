// Operational-impact assessment (owner brief §12-13). NEVER invent operational
// effects. confirmedOperationalEffect is populated ONLY from explicit text cues;
// Direct impact requires such a confirmed effect. Indirect for nearby / sector
// effects; Monitor only otherwise.
//
// Pure — no runtime dependencies.

import type { ImpactLevel } from "./types";

export interface ImpactInput {
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  severity?: string | null; // resolved five-tier (advisory)
}

export interface ImpactResult {
  impactLevel: ImpactLevel;
  confirmedOperationalEffect: string | null;
  assessedOperationalRelevance: string | null;
}

function englishText(input: ImpactInput): string {
  const title = (input.displayTitle && input.displayTitle.trim()) || input.title || "";
  return `${title} ${input.summary ?? ""}`;
}

// Confirmed operational-effect cues (§12). Each maps to a short factual phrase.
// Only an explicit cue may be written as a confirmed effect.
const CONFIRMED_EFFECT_RULES: Array<[RegExp, string]> = [
  [/\b(road|highway|route)\s+(?:was\s+)?(?:closed|blocked|shut|cut off)\b/i, "Road closed."],
  [/\b(?:closed|blocked|shut|cut off)\s+(?:the\s+)?(?:[a-z'-]+\s+){0,3}(?:road|highway|route)\b/i, "Road closed."],
  [/\b(?:port|harbour|harbor|wharf|jetty)\s+(?:was\s+)?(?:closed|suspended|shut)\b/i, "Port operations suspended."],
  [/\b(?:airport|runway)\s+(?:was\s+)?(?:closed|shut|suspended)\b/i, "Airport closed."],
  [/\b(?:flights?)\s+(?:were\s+)?(?:cancelled|canceled|suspended|grounded|diverted)\b/i, "Flights suspended."],
  [/\bcurfew\s+(?:imposed|declared|in force|ordered)\b/i, "Curfew imposed."],
  [/\b(?:power|electricity)\s+(?:cut|outage|blackout|failure|supply (?:cut|lost))\b/i, "Power outage."],
  [/\b(?:water supply)\s+(?:cut|disrupted|lost)\b/i, "Water supply disrupted."],
  [/\b(?:internet|network|mobile)\s+(?:outage|shutdown|blackout|down)\b/i, "Communications outage."],
  [/\b(?:school|schools|business|businesses|shops|market)\s+(?:were\s+)?(?:closed|shut)\b/i, "Businesses or schools closed."],
  [/\b(?:rail|train)\s+(?:services?)\s+(?:suspended|halted|cancelled)\b/i, "Rail services suspended."],
  [/\b(?:evacuat\w+)\b.*\b(?:residents|staff|workers|people)\b/i, "Evacuations ordered."],
  [/\bproduction\s+(?:halted|suspended|stopped|shut)\b/i, "Production halted."],
  [/\b(?:mine|plant|factory|refinery)\s+(?:closed|shut|suspended operations)\b/i, "Facility operations suspended."],
];

// Nearby / sector-effect cues (§13) that justify INDIRECT impact even without a
// confirmed effect — the event is close enough or significant enough to affect
// planning.
const INDIRECT_RE =
  /\b(near|close to|approaching|outskirts|on the (?:road|route) to|delays? (?:expected|possible|likely)|disrupt\w* (?:traffic|movement)|heightened security|checkpoints?|police (?:operation|presence)|tensions? (?:remain|persist)|ongoing (?:operation|clash))\b/i;

// Assess operational impact per §12-13.
export function assessImpact(input: ImpactInput): ImpactResult {
  const text = englishText(input);

  // 1. Confirmed operational effect -> Direct (facts only).
  for (const [re, phrase] of CONFIRMED_EFFECT_RULES) {
    if (re.test(text)) {
      return {
        impactLevel: "Direct",
        confirmedOperationalEffect: phrase,
        assessedOperationalRelevance: null,
      };
    }
  }

  // 2. Nearby / sector relevance -> Indirect (assessment wording only, never a
  //    confirmed effect).
  if (INDIRECT_RE.test(text)) {
    return {
      impactLevel: "Indirect",
      confirmedOperationalEffect: null,
      assessedOperationalRelevance:
        "The event is close to, or significant enough for, local movement and planning to be reviewed.",
    };
  }

  // 3. Otherwise Monitor only — relevant reporting with no confirmed or likely
  //    commercial effect. No invented impact.
  return {
    impactLevel: "Monitor only",
    confirmedOperationalEffect: null,
    assessedOperationalRelevance: null,
  };
}
