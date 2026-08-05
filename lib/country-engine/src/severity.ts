// Evidence-based severity (owner brief §11). Severity is derived from the
// event, never the tone of the headline. severityReason must cite the evidence.
//
// Fixed five-tier Pole Star vocabulary only. Pure — no runtime dependencies.

import type { IssueCategory, Severity } from "./types";

export interface SeverityResult {
  severity: Severity;
  severityReason: string;
}

export interface SeverityInput {
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
  fatalities?: number | null;
  category?: string | null;
  severity?: string | null; // stored lowercase five-tier (advisory only)
}

function englishText(input: SeverityInput): string {
  const title = (input.displayTitle && input.displayTitle.trim()) || input.title || "";
  return `${title} ${input.summary ?? ""}`;
}

// Pull a leading casualty count from a phrase like "three killed", "12 dead",
// "at least five people were killed". Returns null when no count is present.
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  scores: 40, dozens: 24, hundreds: 100,
};

function extractCount(text: string, subjectRe: string): number | null {
  const lower = text.toLowerCase();
  // "<num> ... killed" or "killed <num>"
  const patterns = [
    new RegExp(`\\b(?:at least |as many as |up to |about |some )?(\\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:[a-z'-]+\\s+){0,3}${subjectRe}`, "i"),
    new RegExp(`${subjectRe}\\s+(?:of\\s+)?(?:at least |as many as )?(\\d{1,4}|${Object.keys(NUMBER_WORDS).join("|")})\\b`, "i"),
  ];
  for (const re of patterns) {
    const m = lower.match(re);
    if (m) {
      const raw = m[1];
      const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
      if (typeof n === "number" && n > 0) return n;
    }
  }
  return null;
}

const FATAL_SUBJECT = "(?:killed|dead|died|deaths?|fatalities|slain|bodies|perished|lives? lost)";
const INJURY_SUBJECT = "(?:injured|wounded|hurt|hospitalised|hospitalized)";

const CEREMONIAL_RE =
  /\b(ceremony|ceremonial|appoint\w*|announc\w*|conference|forum|meeting|launch\w*|signed|memorandum|award\w*|praise\w*)\b/i;

const ARMED_ATTACK_RE =
  /\b(explosion|bombing|blast|bomb\b|open(?:ed)? fire|shoot\w*|gun ?(?:fight|battle|men)|armed attack|ambush\w*|grenade|ied|rocket|artillery|air ?strike)\b/i;

// A manhunt / suspect-search story references a PAST killing as backstory
// ("manhunt for cop killer", "police hunt for gunman who killed officer")
// rather than reporting a fresh one. Left unguarded, the bare-fatality-word
// check below ("reported deaths without a resolved count") cannot tell that
// apart from breaking news of a new death, and returns High for both.
const MANHUNT_FOLLOWUP_RE =
  /\b(manhunt|hunt(?:ing)? (?:is )?(?:on |underway )?for (?:the )?(?:suspect|gunman|attacker|killer|culprit)|search(?:ing)? (?:continues |underway )?for (?:the )?(?:suspect|gunman|attacker|killer|culprit)|wanted in connection with|(?:suspect|gunman|attacker) (?:remains? |is )?at large|police (?:hunt|search) for)\b/i;

const ARMED_ROBBERY_RE = /\b(armed robbery|armed hold[- ]?up|robbery at gunpoint|carjack\w*)\b/i;
const MINOR_RE = /\b(petty theft|minor theft|vandal\w*|graffiti|pickpocket|shoplift\w*|small (?:protest|gathering|rally))\b/i;

// Assess severity per §11. category is the primary IssueCategory already mapped.
export function assessSeverity(
  input: SeverityInput,
  category: IssueCategory,
): SeverityResult {
  const text = englishText(input);

  // Fatalities are the strongest ladder rung. Prefer the explicit field.
  const fatalitiesField =
    typeof input.fatalities === "number" && input.fatalities > 0
      ? input.fatalities
      : null;
  const fatalitiesText = extractCount(text, FATAL_SUBJECT);
  const deaths = fatalitiesField ?? fatalitiesText;

  if (deaths !== null && deaths > 0) {
    if (deaths >= 10) {
      return {
        severity: "Extreme",
        severityReason: `Mass-casualty event with ${deaths} fatalities reported.`,
      };
    }
    return {
      severity: "High",
      severityReason: `${deaths} ${deaths === 1 ? "fatality" : "fatalities"} reported.`,
    };
  }

  // Manhunt / suspect-search framing with no fresh, resolved death count is a
  // policing-operation follow-up to an already-reported killing, not a new
  // fatality event — check this before the bare fatality-word fallback below,
  // which would otherwise treat the backstory reference the same as breaking
  // news of a fresh death.
  if (MANHUNT_FOLLOWUP_RE.test(text)) {
    return {
      severity: "Moderate",
      severityReason: "Active manhunt or policing operation reported; underlying fatality already occurred, no new casualties in this report.",
    };
  }

  // Reported deaths without a resolved count.
  if (new RegExp(`\\b${FATAL_SUBJECT}\\b`, "i").test(text)) {
    return {
      severity: "High",
      severityReason: "Fatalities reported.",
    };
  }

  // Armed attack / explosion without confirmed deaths -> High.
  if (ARMED_ATTACK_RE.test(text)) {
    return {
      severity: "High",
      severityReason: "Armed attack or explosion reported.",
    };
  }

  // Injuries -> Moderate (scaled up if many).
  const injuries = extractCount(text, INJURY_SUBJECT);
  if (injuries !== null && injuries > 0) {
    if (injuries >= 10) {
      return {
        severity: "High",
        severityReason: `${injuries} people injured.`,
      };
    }
    return {
      severity: "Moderate",
      severityReason: `${injuries} ${injuries === 1 ? "person" : "people"} injured.`,
    };
  }
  if (new RegExp(`\\b${INJURY_SUBJECT}\\b`, "i").test(text) || ARMED_ROBBERY_RE.test(text)) {
    return {
      severity: "Moderate",
      severityReason: ARMED_ROBBERY_RE.test(text)
        ? "Armed robbery reported."
        : "Injuries reported.",
    };
  }

  // Natural hazards / disruptions carry inherent moderate weight when they name
  // an occurrence.
  if (
    (category === "Natural hazard" ||
      category === "Aviation" ||
      category === "Maritime" ||
      category === "Infrastructure" ||
      category === "Fire and accident") &&
    !CEREMONIAL_RE.test(text)
  ) {
    return {
      severity: "Moderate",
      severityReason: `${category} incident reported without confirmed casualties.`,
    };
  }

  // Minor theft / vandalism / small protest -> Low.
  if (MINOR_RE.test(text) || category === "Theft and robbery" || category === "Civil unrest") {
    return {
      severity: "Low",
      severityReason: "Minor incident with no reported casualties or major disruption.",
    };
  }

  // Ceremonial / administrative framing -> Insignificant.
  if (CEREMONIAL_RE.test(text) || category === "Governance and regulatory") {
    return {
      severity: "Insignificant",
      severityReason: "Administrative or ceremonial reporting with no operational effect.",
    };
  }

  return {
    severity: "Low",
    severityReason: "No casualties or confirmed disruption reported.",
  };
}
