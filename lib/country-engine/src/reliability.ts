// Source reliability + underlying-publisher resolution (owner brief §28).
//
// §28: assign reliability on a controlled scale (High / Medium / Low /
// Unknown) and NEVER present Google News aggregation as the originating
// source where the underlying publisher is available.
//
// Pure — no runtime dependencies.

import type { CountryEngineConfig, SourceReliability } from "./types";

// Established national / international outlets and official / wire sources are
// treated as High reliability everywhere, independent of the per-country map.
// Substrings are matched case-insensitively against the source name (and, for a
// few, the source host).
const HIGH_RELIABILITY_SOURCES: readonly string[] = [
  "reuters",
  "associated press",
  "ap news",
  "agence france",
  "afp",
  "bbc",
  "abc news",
  "australian broadcasting",
  "al jazeera",
  "aljazeera",
  "the guardian",
  "financial times",
  "new york times",
  "washington post",
  "bloomberg",
  "cnn",
  "the economist",
  "deutsche welle",
  "dw news",
  "nikkei",
  "kyodo",
  "xinhua",
  "the diplomat",
  "benar news",
  "benarnews",
];

// Cues that a source host / name is an official government or institutional
// publisher (High reliability, §28: "official sources").
const OFFICIAL_SOURCE_RE =
  /\b(\.gov\b|\.gov\.|police|constabulary|ministry|govt|government|ministerio|kepolisian|un\.org|who\.int|iom\.int|unhcr|reliefweb)\b/i;

// Regional / mid-tier outlets default to Medium when not otherwise mapped.
const MEDIUM_RELIABILITY_SOURCES: readonly string[] = [
  "antara",
  "jakarta post",
  "kompas",
  "tempo",
  "detik",
  "cnn indonesia",
  "cnbc indonesia",
  "tribun",
  "post-courier",
  "post courier",
  "the national",
  "rnz",
  "radio new zealand",
  "bangkok post",
  "nation thailand",
  "the nation",
  "khaosod",
  "thai pbs",
  "inquirer",
  "rappler",
  "philstar",
  "gma news",
  "abs-cbn",
  "manila bulletin",
  "sunstar",
  "mindanao",
];

// Cues that a source is an unknown blog / aggregator-only host (Low).
const LOW_RELIABILITY_RE =
  /\b(blogspot|wordpress\.com|blogger|medium\.com|substack|\.blog\b|forum|reddit|facebook|twitter|x\.com|tiktok|telegram)\b/i;

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// True when the source is a Google News aggregation surface (name or host).
export function isGoogleNewsAggregation(
  sourceName: string | null | undefined,
  sourceUrl?: string | null,
): boolean {
  const name = normalise(sourceName);
  const url = normalise(sourceUrl);
  return (
    name === "google news" ||
    name.includes("google news") ||
    name === "google" ||
    /news\.google\.com/.test(url)
  );
}

// Extract the underlying publisher from a Google News aggregated title. Google
// News appends the originating masthead as a trailing " - Publisher" segment
// (e.g. "Riot breaks out in Lae - Post-Courier"). Returns the publisher name, or
// null when no trailing masthead is present. NEVER returns "Google News".
export function resolveUnderlyingPublisher(
  sourceName: string | null | undefined,
  title: string | null | undefined,
): string | null {
  const raw = (title ?? "").trim();
  if (!raw) return null;
  // The masthead is the LAST " - " / " — " separated segment. Only treat it as a
  // publisher when it is short (a masthead, not a sentence fragment).
  const parts = raw.split(/\s[-–—]\s/);
  if (parts.length < 2) return null;
  const candidate = parts[parts.length - 1].trim();
  if (!candidate) return null;
  const words = candidate.split(/\s+/);
  if (words.length > 6) return null; // too long to be a masthead
  if (/google news/i.test(candidate)) return null;
  // A masthead should not itself end with sentence punctuation.
  if (/[.!?]$/.test(candidate)) return null;
  return candidate;
}

// Assess source reliability per §28. When the source is Google News, the
// underlying publisher (resolved from the title) drives the assessment; callers
// should also swap the displayed source name via resolveUnderlyingPublisher.
export function assessSourceReliability(
  sourceName: string | null | undefined,
  sourceUrl: string | null | undefined,
  config?: Pick<CountryEngineConfig, "sourceReliability"> | null,
  title?: string | null,
): SourceReliability {
  let name = normalise(sourceName);
  const url = normalise(sourceUrl);

  // Resolve Google News aggregation to its underlying publisher before scoring.
  if (isGoogleNewsAggregation(sourceName, sourceUrl)) {
    const underlying = resolveUnderlyingPublisher(sourceName, title);
    if (underlying) name = normalise(underlying);
    else return "Unknown";
  }

  const haystack = `${name} ${url}`;

  // Per-country approved-source map wins first (name substring -> reliability).
  if (config?.sourceReliability) {
    for (const [key, rel] of Object.entries(config.sourceReliability)) {
      if (name.includes(normalise(key))) return rel;
    }
  }

  if (HIGH_RELIABILITY_SOURCES.some((s) => name.includes(s))) return "High";
  if (OFFICIAL_SOURCE_RE.test(haystack)) return "High";
  if (LOW_RELIABILITY_RE.test(haystack)) return "Low";
  if (MEDIUM_RELIABILITY_SOURCES.some((s) => name.includes(s))) return "Medium";

  if (!name && !url) return "Unknown";
  return "Unknown";
}
