// Source-based confidence tiering for config-driven news-topic ingest.
//
// The generic news-topic runner hardcoded confidence="low" for every row, which
// is correct as a conservative default for the commodity topics (energy, fuel,
// fertiliser) where a single Google-News publisher carries little weight. A
// broad local feed (indonesia_local) instead surfaces a wide mix of publishers,
// from official emergency agencies (BNPB, BMKG, Basarnas) and major wires
// (Reuters, AFP, Antara) down to small regional outlets — so a source-based tier
// is meaningful there.
//
// This is OPT-IN per NewsTopicConfig: a topic that sets `classifyConfidence`
// gets tiered rows; every existing topic that omits it keeps the unchanged
// "low" default. We only have the publisher NAME from a Google-News item (no
// corroboration count at this layer), so the tier is keyed on publisher
// reputation:
//   high   — official / emergency / disaster-management agency, or a major wire.
//   medium — any other NAMED publisher.
//   low    — unknown / empty source.

export type Confidence = "low" | "medium" | "high";

// Official Indonesian agencies + emergency / disaster-management bodies, and the
// major international wires. A name match here is treated as high-confidence
// reporting. Substring-matched against the lowercased publisher name.
const HIGH_CONFIDENCE_SOURCES = [
  // Indonesian official / emergency / disaster-management agencies
  "bnpb",
  "bmkg",
  "basarnas",
  "bpbd",
  "polri",
  "kepolisian",
  "tni",
  "kemenkes",
  "kementerian",
  "antara", // ANTARA — Indonesian state news agency
  "antaranews",
  // Major international wires / outlets
  "reuters",
  "associated press",
  "ap news",
  "agence france",
  "afp",
  "bloomberg",
  "bbc",
  "al jazeera",
  "cnn",
  "the guardian",
  "anadolu",
];

// Named, established Indonesian and regional media. A match here is medium
// confidence; the fall-through default for any other named publisher is also
// medium, so this list mainly documents the expected outlets.
const MEDIUM_CONFIDENCE_SOURCES = [
  "kompas",
  "detik",
  "tempo",
  "tribun",
  "cnn indonesia",
  "cnbc indonesia",
  "republika",
  "liputan6",
  "okezone",
  "suara",
  "merdeka",
  "sindonews",
  "jawa pos",
  "the jakarta post",
  "jakarta globe",
  "kumparan",
  "viva",
  "metro tv",
  "kontan",
];

/**
 * Tier a row's confidence from its publisher name. Official / emergency agencies
 * and major wires are high; any other named publisher is medium; an empty /
 * unknown source is low. Pure function — safe to share across topics.
 */
export function classifyNewsConfidence(source: string): Confidence {
  const s = source.trim().toLowerCase();
  if (!s) return "low";
  if (HIGH_CONFIDENCE_SOURCES.some((m) => s.includes(m))) return "high";
  if (MEDIUM_CONFIDENCE_SOURCES.some((m) => s.includes(m))) return "medium";
  // A non-empty publisher name that we do not specifically recognise is still a
  // named media source, not anonymous/social content → medium.
  return "medium";
}
