// Polestar View composer for the shared country-brief dataset builder.
//
// Pure and dependency-free (no runtime imports) so it is safe to unit-test
// directly and to call from buildStructuredReportDataset for EVERY country
// report (PNG, West Papua, Indonesia, Jakarta and all generic countries).
//
// The Polestar View must read as an assessed judgement, not a summary (spec
// §15). It is composed from seven explicit components so the structure is
// auditable in the dataset, then flattened into a single flowing paragraph the
// shared renderer prints (one string → screen == DOM-rasterised PDF):
//   1. current risk direction        2. main driver of risk
//   3. most exposed geography        4. most exposed business activity
//   5. most likely next disruption   6. what would change the assessment
//   7. practical customer judgement
//
// House rules honoured: COUNT-FREE (no record/incident numbers), British
// English, no fabrication — a quiet window yields a standing-assessment
// judgement, never an invented "all clear".

export type PolestarDirection = "stable" | "elevated" | "deteriorating" | "easing";

export interface PolestarViewInput {
  countryName: string;
  // True when no incidents fell in the window — yields the standing assessment.
  empty: boolean;
  direction: PolestarDirection;
  // Lead risk drivers (client-facing phrases), most prominent first.
  drivers: string[];
  // Most exposed areas (friendly location labels), most prominent first.
  exposedAreas: string[];
  // Most exposed business activities (movement / site access / continuity / …).
  exposedActivities: string[];
  // The single most likely next-seven-days disruption scenario.
  likelyDisruption: string;
  // The "would worsen if …" trigger clause (no leading "if").
  trigger: string;
  // The "operators should …" action clause (no leading "should").
  action: string;
}

export interface PolestarViewParts {
  direction: string;
  driver: string;
  exposedGeography: string;
  exposedActivity: string;
  likelyDisruption: string;
  whatWouldChange: string;
  practicalJudgement: string;
  // The seven parts flattened into one flowing paragraph for the renderer.
  paragraph: string;
}

function joinList(parts: string[]): string {
  const xs = parts.filter((p) => p.trim().length > 0);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0]!;
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const DIRECTION_WORD: Record<PolestarDirection, string> = {
  stable: "broadly stable",
  elevated: "elevated",
  deteriorating: "deteriorating",
  easing: "easing, though from an elevated baseline",
};

// Standing action used when the window is quiet — deterministic regardless of
// the caller's populated-window action, so the no-fabrication assessment is
// always a maintain-precautions judgement.
const STANDING_ACTION =
  "maintain current movement and continuity precautions and treat the quiet period as provisional";

export function buildPolestarView(input: PolestarViewInput): PolestarViewParts {
  const name = input.countryName.trim() || "this country";
  const activities = input.exposedActivities.length
    ? joinList(input.exposedActivities)
    : "staff movement and business continuity";

  if (input.empty) {
    const direction = `Operating risk in ${name} holds to its standing pattern; no fresh reporting was identified this period.`;
    const driver =
      "No fresh reporting was identified this period, so the standing risk pattern continues to apply.";
    const exposedGeography =
      "Standing exposures apply across the established areas of concern rather than any newly reported location.";
    const exposedActivity = `Standing business exposures — ${activities} — continue to apply.`;
    const likelyDisruption =
      "The most likely change over the next seven days is a return of reporting rather than a confirmed shift in conditions.";
    const whatWouldChange =
      "The assessment would change if higher-severity or casualty-bearing incidents are confirmed.";
    const practicalJudgement = `For now, operators should ${STANDING_ACTION}.`;
    const paragraph = `With no fresh reporting this period, Polestar holds the standing assessment for ${name}: the established risk pattern persists and the quiet period is read as a coverage signal, not an improvement. ${likelyDisruption} ${whatWouldChange} ${practicalJudgement}`;
    return {
      direction,
      driver,
      exposedGeography,
      exposedActivity,
      likelyDisruption,
      whatWouldChange,
      practicalJudgement,
      paragraph,
    };
  }

  const directionWord = DIRECTION_WORD[input.direction];
  const driverList = joinList(input.drivers);
  const areas = input.exposedAreas.length
    ? joinList(input.exposedAreas)
    : "diffuse, with no single dominant centre";
  const disruption =
    input.likelyDisruption.trim() ||
    "further localised disruption to movement and operations";
  const action =
    input.action.trim() ||
    "keep standard movement and continuity precautions in place";

  const direction = `Operating risk in ${name} is ${directionWord}.`;
  const driver = driverList
    ? `The main driver is ${driverList}.`
    : "Fresh reporting was limited this period, so no single driver dominates.";
  const exposedGeography = `The most exposed areas are ${areas}.`;
  const exposedActivity = `The main business exposure is ${activities}.`;
  const likelyDisruption = `The most likely disruption over the next seven days is ${disruption}.`;
  const whatWouldChange = `The assessment would worsen if ${input.trigger.trim()}.`;
  const practicalJudgement = `For now, operators should ${action}.`;

  const driverClause = driverList ? `, driven by ${driverList}` : "";
  const paragraph = `Polestar assesses that operating risk in ${name} is ${directionWord}${driverClause}. The main business exposure is ${activities}. The most exposed areas are ${areas}. The most likely disruption over the next seven days is ${disruption}. The assessment would worsen if ${input.trigger.trim()}. For now, operators should ${action}.`;

  return {
    direction,
    driver,
    exposedGeography,
    exposedActivity,
    likelyDisruption,
    whatWouldChange,
    practicalJudgement,
    paragraph,
  };
}
