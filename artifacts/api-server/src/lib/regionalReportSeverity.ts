import type { RegionalDevelopment } from "../../../workbench/src/lib/regionalWeekly";

export type RegionalSeverity = RegionalDevelopment["severity"];

export interface RegionalSeverityEvidence {
  confirmedFacts: string[];
  severity: RegionalSeverity;
  category?: string;
}

export interface RegionalSeverityAssessment {
  severity: RegionalSeverity;
  rationale: string;
  evidence: string[];
}

const UNCERTAIN_OR_NEGATED_IMPACT_RE =
  /\b(?:may|might|could|would|potential(?:ly)?|forecast|expected|likely|risk of|threat of|unconfirmed|not (?:yet )?confirmed|has not been confirmed|unclear|unknown|(?:no|without|zero) (?:material |reported |confirmed |reports? of )?(?:disruption|interruption|damage|shortage|casualt(?:y|ies)|injur(?:y|ies)|deaths?|fatalit(?:y|ies))|(?:nobody|no one) (?:was |were )?(?:killed|injured|wounded)|(?:not|never) (?:been )?(?:killed|injured|wounded))\b/i;
const ATTACK_RE =
  /\b(?:attack(?:ed|s)?|strike|struck|missile|drone|bomb(?:ed|ing)?|blast|sabotage|armed assault|opened fire|gunfire|shooting|ambush(?:ed)?|clash(?:ed|es)?)\b/i;
const CRITICAL_INFRASTRUCTURE_RE =
  /\b(?:airport|airfield|airspace|port|terminal|fuel depot|refiner(?:y|ies)|pipeline|pumping stations?|power (?:station|plant|grid)|electricity grid|water (?:plant|network)|telecommunications?|critical infrastructure)\b/i;
const DAMAGE_OR_INTERRUPTION_RE =
  /\b(?:damag(?:e|ed)|destroy(?:ed)?|disabled|ablaze|on fire|caught fire|fire broke out|attack-caused fire|offline|shut(?:down)?|closed|halted|suspended|interrupted|disrupted|cancelled|canceled|diverted|operations? (?:stopped|ceased)|outage)\b/i;
const SUPPLY_STRESS_RE =
  /\b(?:shortage|supply (?:stress|constraint|failure|disruption)|scarcity|unavailable|stockout)\b/i;
const WIDESPREAD_SUPPLY_RE =
  /\b(?:nationwide|countrywide|widespread|across (?:the )?(?:country|nation|region))\b/i;
const MULTI_LOCATION_SUPPLY_RE =
  /\b(?:across\s+)?(?:multiple|several) (?:locations|cities|provinces|regions|districts)\b/i;
const SUSTAINED_RE =
  /\b(?:sustained|persistent|prolonged|continuing|continued|for (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:days?|weeks?)|since \w+)\b/i;
const MATERIAL_INTERRUPTION_RE =
  /\b(?:(?:business(?:es)?|factor(?:y|ies)|industrial|manufacturing|production|transport|logistics|freight|flights?|airport|aviation|rail|shipping|commercial operations?)[\s\S]{0,45}(?:halted|suspended|cancelled|canceled|cancellations?|curtailed|stopped|closed|interrupted|disrupted|(?:major )?(?:flight )?disruption|unable to operate)|(?:halted|suspended|cancelled|canceled|cancellations?|curtailed|stopped|closed|interrupted|disrupted|(?:major )?(?:flight )?disruption)[\s\S]{0,45}(?:business(?:es)?|factor(?:y|ies)|industrial|manufacturing|production|transport|logistics|freight|flights?|airport|aviation|rail|shipping|commercial operations?))\b/i;
const EMERGENCY_RESTRICTION_RE =
  /\b(?:emergency (?:restriction|rationing|controls?|measures?)|mandatory rationing|state of emergency|government (?:restricted|suspended|banned|rationed))\b/i;
const MASS_CASUALTY_RE =
  /\b(?:mass casualt(?:y|ies)|(?:dozens|scores|hundreds|thousands)(?: of people)? (?:were )?(?:killed|dead|injured|wounded))\b/i;
const CONFIRMED_CASUALTY_RE =
  /\b(?:(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine)\s+(?:people\s+|personnel\s+|workers?\s+|passengers?\s+)?(?:killed|dead|injured|wounded)|(?:kill(?:s|ed)?|injur(?:es?|ed)|wound(?:s|ed)?)\s+(?:at least\s+)?(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine)\s+(?:people|person|civilians?|workers?|passengers?|police(?: officers?)?|soldiers?|personnel)|(?:was|were|has been|have been|had been)\s+(?:reportedly\s+)?(?:killed|injured|wounded)|shot dead|fatalit(?:y|ies)|deaths?|died)\b/i;

const CASUALTY_NUMBER = String.raw`(?:\d+(?:,\d{3})*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)`;
const CASUALTY_ROLE = String.raw`(?:(?:police|security|military|army|civilian)\s+)?(?:people|person|civilians?|officers?|personnel|police|soldiers?|troops|militants?|insurgents?|fighters?|workers?|passengers?|children|men|women|residents?|suspects?)`;
const COUNTED_CASUALTIES = [
  // "31 police personnel were killed", not an age, reward, date or duration.
  String.raw`\b(${CASUALTY_NUMBER})\s+(?:${CASUALTY_ROLE}\s+)?(?:(?:was|were|are|is|have been|has been|had been|reportedly|reported|confirmed|left|found)\s+){0,3}(?:killed|dead|injured|wounded)\b`,
  // Active-voice and standalone tolls: "killed 31 people" / "injured 24."
  String.raw`\b(?:kill(?:s|ed|ing)?|injur(?:es?|ed|ing)|wound(?:s|ed|ing)?)\s+(?:at least\s+)?(${CASUALTY_NUMBER})(?=\s+${CASUALTY_ROLE}\b|[.,;:]|\s+(?:and|but|in|at|during|after|when)\b|$)`,
  String.raw`\b(?:death toll|fatality toll|casualty toll|deaths|fatalities|injuries|casualties)\s+(?:(?:rose|risen|rises|reached|reach|stands|stood|climbed|increased|was|were|is|are|has|had|been|now|reported|confirmed|at|least|to|of)\s+){0,8}(${CASUALTY_NUMBER})\b`,
];
const CASUALTY_NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];

/** Count only quantities attached to a casualty outcome, never every number in
 * an attack sentence. Keep the complete supporting fact as the audit evidence. */
function casualtyCounts(fact: string): number[] {
  return COUNTED_CASUALTIES.flatMap((pattern) =>
    [...fact.matchAll(new RegExp(pattern, "gi"))].map((match) => {
      const value = match[1].toLowerCase();
      return /^\d/.test(value)
        ? Number(value.replace(/,/g, ""))
        : CASUALTY_NUMBER_WORDS.indexOf(value);
    }),
  ).filter((count) => count > 0);
}

function eligibleFacts(facts: string[]): string[] {
  return facts.map((fact) => fact.trim()).filter((fact) =>
    fact.length > 0 && !UNCERTAIN_OR_NEGATED_IMPACT_RE.test(fact));
}

/**
 * Reassesses regional-weekly severity using confirmed consequences only.
 * The function is pure so persisted grounded facts can be reassessed without
 * source re-ingestion or another model call.
 */
export function reassessRegionalSeverity(
  input: RegionalSeverityEvidence,
): RegionalSeverityAssessment {
  const facts = eligibleFacts(input.confirmedFacts);
  const matching = (pattern: RegExp) => facts.filter((fact) => pattern.test(fact));

   const massCasualties = facts.filter((fact) =>
     MASS_CASUALTY_RE.test(fact) || casualtyCounts(fact).some((count) => count >= 20));
  if (massCasualties.length) {
    return {
      severity: "Extreme",
      rationale: "Confirmed facts establish mass casualties.",
      evidence: massCasualties,
    };
  }

  const casualties = facts.filter((fact) =>
    CONFIRMED_CASUALTY_RE.test(fact) || casualtyCounts(fact).length > 0);
  if (casualties.length) {
    return {
      severity: "High",
      rationale: "Confirmed deaths or injuries support a High rating.",
      evidence: casualties,
    };
  }

  const attackFacts = matching(ATTACK_RE);
  const infrastructureFacts = matching(CRITICAL_INFRASTRUCTURE_RE);
  const damageFacts = matching(DAMAGE_OR_INTERRUPTION_RE);
  const criticalDamage = facts.filter((fact) =>
    (ATTACK_RE.test(fact) && CRITICAL_INFRASTRUCTURE_RE.test(fact) && DAMAGE_OR_INTERRUPTION_RE.test(fact))
    || (attackFacts.length > 0 && infrastructureFacts.length > 0 && damageFacts.includes(fact)));
  if (attackFacts.length && infrastructureFacts.length && damageFacts.length) {
    return {
      severity: "High",
      rationale: "A confirmed attack damaged or interrupted critical infrastructure.",
      evidence: [...new Set([...attackFacts, ...infrastructureFacts, ...criticalDamage])],
    };
  }

  const materialInterruption = matching(MATERIAL_INTERRUPTION_RE);
  if (materialInterruption.length) {
    return {
      severity: "High",
      rationale: "Confirmed facts establish material business, industrial or transport interruption.",
      evidence: materialInterruption,
    };
  }

  const emergencyRestrictions = matching(EMERGENCY_RESTRICTION_RE);
  if (emergencyRestrictions.length) {
    return {
      severity: "High",
      rationale: "Confirmed emergency restrictions materially affect operations.",
      evidence: emergencyRestrictions,
    };
  }

  const supplyFacts = matching(SUPPLY_STRESS_RE);
  if (supplyFacts.length) {
    const widespread = supplyFacts.filter((fact) =>
      WIDESPREAD_SUPPLY_RE.test(fact)
      || (MULTI_LOCATION_SUPPLY_RE.test(fact) && SUSTAINED_RE.test(fact)));
    if (widespread.length) {
      return {
        severity: "High",
        rationale: "Confirmed facts establish widespread or sustained multi-location supply failure.",
        evidence: widespread,
      };
    }
    return {
      severity: "Moderate",
      rationale: "Supply stress is confirmed, but no qualifying material consequence is established.",
      evidence: supplyFacts,
    };
  }

  const limitedCriticalAttack = facts.filter((fact) =>
    ATTACK_RE.test(fact) && CRITICAL_INFRASTRUCTURE_RE.test(fact));
  if (limitedCriticalAttack.length) {
    return {
      severity: "Moderate",
      rationale: "An attack on critical infrastructure is confirmed, but damage or interruption is not.",
      evidence: limitedCriticalAttack,
    };
  }

  if (attackFacts.length) {
    return {
      severity: "Moderate",
      rationale: "An attack is confirmed, but no qualifying casualty, damage or operational consequence is established.",
      evidence: attackFacts,
    };
  }

  return {
    // The publication gate requires consequence evidence for High/Extreme.
    // Retaining either inherited tier with [] made every AI copy-edit retry
    // fail on the same immutable facts. Unsupported tiers must be capped here.
    severity: input.severity === "High" || input.severity === "Extreme" ? "Moderate" : input.severity,
    rationale: facts.length
      ? "No consequence rule changes the evidence-supported baseline rating."
      : "No confirmed consequence evidence is available to escalate the baseline rating.",
    evidence: [],
  };
}