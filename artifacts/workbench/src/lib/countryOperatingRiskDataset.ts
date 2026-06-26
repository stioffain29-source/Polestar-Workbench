// Generic operating-risk dataset builder for every country WITHOUT a curated
// structured-theatre config (i.e. everything other than PNG / West Papua /
// Indonesia / Jakarta). It produces the SAME PngReportDataset the structured
// theatres render, so every country reads as the deterministic, business-voice
// operating-risk brief.
//
// Design: the shared buildStructuredReportDataset already derives every section
// (BLUF, What Matters, Key Developments, Location Watchlist, Priorities,
// Outlook, Polestar View, Reporting Confidence). We only need to feed it a
// generic config:
//   - empty `buckets` — there is no curated sub-national grouping for an
//     arbitrary country, so every item falls into the "other / national"
//     remainder, while the Location Watchlist still derives dynamically from
//     each item's province (the engine falls back to the raw province string
//     when no bucket maps it).
//   - `extractItem` — generic incident rows carry no server-extracted
//     province / category / business-impact columns, so we classify each item
//     with the SAME shared rulebook the structured theatres use
//     (extractStructuredItem), giving generic countries the identical rich set
//     of business themes. Province comes from the incident's own location.
//   - `proseVariant: "operating-risk"` — selects the business-language prose
//     builders and the display-mapped category labels.
//
// No-fabrication is preserved: an empty window yields the standing-caveat
// sections the engine already builds; unlocated items simply never reach the
// watchlist.
import {
  buildStructuredReportDataset,
  type BuildArgs,
  type PngReportDataset,
  type StructuredTheatreConfig,
} from "./pngReportDataset";
import { compileGazetteer, extractStructuredItem } from "@workspace/ingest/structuredExtract";

// A generic country has no curated locality gazetteer; province resolution
// relies solely on the incident's own location field. Compiled once.
const EMPTY_GAZETTEER = compileGazetteer({});

// Location strings that are not real sub-national localities — they must not
// become Location Watchlist rows.
const NON_LOCALITY = new Set(["", "unknown", "n/a", "na", "—", "-", "none", "various"]);

function localityFrom(location: string | null | undefined, countryNameLc: string): string | null {
  const loc = (location ?? "").trim();
  if (!loc) return null;
  const lc = loc.toLowerCase();
  if (NON_LOCALITY.has(lc)) return null;
  // The country itself is not a sub-national locality.
  if (lc === countryNameLc) return null;
  return loc;
}

export function buildCountryOperatingRiskDataset(
  args: BuildArgs,
  countryName: string,
): PngReportDataset {
  const name = countryName.trim() || "this country";
  const nameLc = name.toLowerCase();
  const config: StructuredTheatreConfig = {
    countryName: name,
    buckets: [],
    otherBucketLabel: "Security-Relevant Activity",
    emptyLocationFallback: `No incidents with a confirmed location were identified for ${name} this period.`,
    businessImpactEmptyNote:
      "No fresh incident-driven business impact was identified this period. Standing exposures continue to apply.",
    emptyOutlook: `With no fresh reporting this period, expect the standing risk pattern for ${name} to persist: maintain current movement and continuity precautions and re-test them as fresh reporting comes through.`,
    outlookVolatilityClause:
      "elections and political mobilisation, security-force operations and economic pressure points",
    // Only consulted as a fallback; toItem prefers the extractItem province.
    deriveProvince: (location) => localityFrom(location, nameLc),
    proseVariant: "operating-risk",
    extractItem: (title, summary, location) => {
      const ext = extractStructuredItem(title, summary, location, EMPTY_GAZETTEER);
      return {
        province: localityFrom(location, nameLc) ?? ext.province,
        category: ext.category,
        businessImpact: ext.businessImpact,
      };
    },
  };
  return buildStructuredReportDataset(args, config);
}
