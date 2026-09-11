import { stripWireCruft } from "./incidentTitle";
import type { TopicFastFactCard, TopicFastFactsIncident } from "./topicFastFacts";

type Family = "Power Supply" | "Infrastructure Outage" | "Electricity Costs" | "Business Impact" | "Power Demand";
type Evidence = { family: Family; value: string; headline: string; row: TopicFastFactsIncident; score: number };

// These are evidence selectors, not generated assessments. The full headline
// stays with each short value so places, quantities and qualifications survive.
// Only the already-windowed, relevant Energy set may enter this builder.
function classify(row: TopicFastFactsIncident): Evidence | null {
  const headline = stripWireCruft(row.displayTitle?.trim() || row.title)
    .replace(/^DOUBLE WHAMMY:\s*/i, "")
    .replace(/\s*(?:Link to the full story|Link to the full|Read more|Click here)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!headline || headline.length > 220) return null;
  // Do not turn forecasts, commentary, negation or project proposals into
  // observed disruptions. They can remain in the report's outlook instead.
  if (/\b(?:may|might|could|loom\w*|warns?|warning|expected|forecast\w*|vulnerable|risk|eyed|propos\w*|opinion|commentary|accountability|inquir\w*|probe)\b|\btell it to\b|\bto hit\b|\b(?:no|without)\b.{0,30}\b(?:outages?|blackouts?|brownouts?|shortages?)\b/i.test(headline)) return null;
  if (/\b(?:avert\w*|avoid\w*|prevent\w*)\b|\b(?:no|not)\b.{0,25}\b(?:increase|rise|hike|damage|failure|fire|record)\b|\b(?:prices?|bills?|tariffs?|rates?)\b.{0,30}\bto (?:rise|fall|increase|decrease)\b/i.test(headline)) return null;

  const pick = (family: Family, value: string, score: number): Evidence =>
    ({ family, value, headline, row, score });
  const power = /\b(?:power|electricity|grid|blackouts?|brownouts?|load[- ]shedding|outages?)\b/i.test(headline);

  if (power && /\b(?:vendors?|factories|factory|manufacturers?|businesses|production|trading|shops?|hospitals?)\b/i.test(headline)
      && /\b(?:grapple|disrupt\w*|halt\w*|shut\w*|suspend\w*|close[ds]?|brownouts?|blackouts?|outages?)\b/i.test(headline)) {
    return pick("Business Impact",
      /\bvendors?\b/i.test(headline) ? "Market vendors affected"
        : /\b(?:factories|factory|production|manufacturers?)\b/i.test(headline) ? "Production affected"
          : /\bhospitals?\b/i.test(headline) ? "Hospitals affected" : "Business disruption", 10);
  }
  if (/\b(?:substation|transformer|power plant|power station|transmission|grid)\b/i.test(headline)
      && /\b(?:fire|explosion|damage\w*|failure|attack\w*)\b/i.test(headline)) {
    return pick("Infrastructure Outage",
      /\bsubstation\b/i.test(headline) && /\bfire\b/i.test(headline) ? "Substation fire"
        : /\btransformer\b/i.test(headline) ? "Transformer incident"
          : /\bfire\b/i.test(headline) ? "Infrastructure fire" : "Infrastructure damage", 12);
  }
  if (power && /\b(?:prices?|bills?|tariffs?|rates?)\b/i.test(headline)
      && /\b(?:higher|hikes?|ris\w*|up|increas\w*|lower|fall\w*|down|cuts?|reduc\w*)\b/i.test(headline)) {
    const increase = /\b(?:higher|hikes?|ris\w*|up|increas\w*)\b/i.test(headline);
    const decrease = /\b(?:lower|fall\w*|down|cuts?|reduc\w*)\b/i.test(headline);
    return pick("Electricity Costs",
      increase && decrease ? "Electricity price changes"
        : increase ? "Higher electricity costs" : "Lower electricity costs", 10);
  }
  if (power) {
    if (/\bdemand\b/i.test(headline) && /\b(?:hits?|reaches?|sets?|breaks?)\b.{0,25}\brecord\b/i.test(headline))
      return pick("Power Demand", "Record electricity demand", 11);
    if (/\b(?:restored|resumed)\b/i.test(headline))
      return pick("Power Supply", "Supply restored", 9);
    if (/\blonger brownouts?\b/i.test(headline))
      return pick("Power Supply", "Longer brownouts", 13);
    if (/\b(?:rotational|rolling) (?:brownouts?|blackouts?)\b/i.test(headline))
      return pick("Power Supply", "Rotational power cuts", 12);
    if (/\b(?:rationing|load[- ]shedding)\b/i.test(headline))
      return pick("Power Supply", "Power rationing", 10);
    if (/\b(?:outages?|blackouts?|brownouts?)\b/i.test(headline))
      return pick("Power Supply", "Power interruptions", 9);
    if (/\b(?:shortage|shortfall|red alert)\b/i.test(headline))
      return pick("Power Supply", "Electricity supply shortfall", 8);
  }
  return null;
}

function sameDevelopment(a: Evidence, b: Evidence): boolean {
  if (a.headline.toLowerCase() === b.headline.toLowerCase()) return true;
  if (a.row.country !== b.row.country) return false;
  const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const left = tokens(a.headline);
  const right = tokens(b.headline);
  const shared = [...left].filter((t) => right.has(t)).length;
  return shared / (left.size + right.size - shared) >= 0.65;
}

export function buildEnergyEvidenceCards(rows: TopicFastFactsIncident[]): TopicFastFactCard[] {
  const evidence = rows.map(classify).filter((e): e is Evidence => e !== null)
    .sort((a, b) => b.score - a.score ||
      b.row.occurredAt.localeCompare(a.row.occurredAt) || a.headline.localeCompare(b.headline));
  const selected: Evidence[] = [];
  for (const family of ["Power Supply", "Infrastructure Outage", "Electricity Costs", "Business Impact", "Power Demand"] as const) {
    if (selected.length === 4) break;
    const next = evidence.find((e) => e.family === family && !selected.some((s) => sameDevelopment(s, e)));
    if (next) selected.push(next);
  }
  // Sparse windows get other specific developments, not invented impacts or
  // placeholder statistics. Prefer another country before repeating a theatre.
  const remaining = evidence.filter((e) => !selected.some((s) => sameDevelopment(s, e)))
    .sort((a, b) => Number(selected.some((s) => s.row.country === a.row.country)) -
      Number(selected.some((s) => s.row.country === b.row.country)));
  for (const e of remaining) {
    if (selected.length === 4) break;
    if (!selected.some((s) => sameDevelopment(s, e))) selected.push(e);
  }
  const used = new Map<string, number>();
  return selected.map((e) => {
    const index = (used.get(e.family) ?? 0) + 1;
    used.set(e.family, index);
    return {
      label: index === 1 ? e.family : `${e.family} ${index}`,
      value: e.value,
      note: e.headline,
    };
  });
}