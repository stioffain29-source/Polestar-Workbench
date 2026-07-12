// Shared "cargo-theft COMMENTARY / non-incident" detector for the cargo_watch
// topic.
//
// Cargo Watch reports concrete APAC / Middle-East cargo-crime EVENTS — truck,
// container, warehouse and depot theft, hijack, pilferage and port
// cargo-security. It is NOT a feed of US / UK trade-press think-pieces,
// legislation, statistics round-ups, webinars, vendor marketing or
// out-of-region incidents that merely say the words "cargo theft".
//
// Each pattern anchors on the FRAMING of a piece — its cost / statistics /
// legislation / explainer / vendor-trend language — never on a bare currency
// value or the words "cargo theft" alone. A genuine in-region incident that
// quotes a loss figure ("warehouse theft worth $80,000", "loss of Rp1.8
// billion", "Losses Reach Rp23 Million") therefore survives, because those
// carry no "cost(s|ing)" verb, percentage, legislative or explainer framing.
// The loss-aggregate line is deliberately gated on a "$"-denominated
// millions/billions figure ("losses exceed $6B", "losses hit $725M") so a
// local-currency per-incident loss ("Losses Reach IDR 23 Million") is never
// mistaken for industry-aggregate commentary.
//
// Used by BOTH the ingest relevance gate (topicRelevance CARGO exclude, which
// also stamps each row's persisted relevance_status and drives the version-bump
// backfill) AND the frontend scope classifier (cargoAnalysis.classifyScope),
// so the two surfaces cannot drift.

export const CARGO_SLOP_EXCLUDE: RegExp[] = [
  // --- Economic-impact commentary: "cargo theft COSTS trucking $18M a day",
  // "costing supply chains $35 billion a year", "costs everyone, including
  // consumers". Gated on the cost verb PLUS an aggregate / period word.
  /\bcost(?:s|ing)\b[^.]{0,50}(?:\$?\d[\d,.]*\s?(?:m|bn?|billion|million)\b|\bbillions?\b|\bmillions?\b|\ba day\b|\bper day\b|\bdaily\b|\ba year\b|\bper year\b|\bannually\b|\bsupply chains?\b|\bthe economy\b|\bconsumers?\b)/i,
  /\blosses?\b[^.]{0,30}\b(?:exceed|top|reach|surpass|hit|climb|soar|balloon)\b[^.]{0,15}\$\s?\d[\d,.]*\s?(?:m|bn?|billion|million)\b/i,

  // --- Statistics / trend / landscape commentary.
  /\b(?:up|down|rose|fell|jump(?:s|ed)?|surg(?:e|es|ed)|climb(?:s|ed)?|soar(?:s|ed)?|drop(?:s|ped)?|decreas(?:e|es|ed)|declin(?:e|es|ed)|increas(?:e|es|ed))\b[^.]{0,20}\b\d[\d,.]*\s?(?:%|percent|per cent)/i,
  /\b(?:record year|new normal|downward trend|upward trend|get(?:ting|s)? worse|is exploding|explosive rise|on the rise|new frontier|persistent threat|coordinated commercial operation|evolved into|new wave|new era|cyber era)\b/i,
  /\bcargo theft\b[^.]{0,20}\b(?:numbers|data|statistics|figures|landscape|trends?|report|study|survey|dashboard|index|tracker|campaigns?)\b/i,
  /\b(?:new|latest)\b[^.]{0,25}\bcargo theft\b[^.]{0,25}\b(?:study|survey|report|data|database)\b/i,

  // --- Legislation / hearings / government process.
  /\b(?:safer transport act|cargo theft (?:bill|act)|transport act|combating\b[^.]{0,30}\bact)\b/i,
  /\b(?:bill|legislation|act)\b[^.]{0,30}\b(?:advance|advances|advanced|passes|passed|introduc(?:e|ed|es)|takes? aim|clears?|moves? forward)\b/i,
  // Legislative actors are gated on adjacent cargo / freight / supply-chain
  // framing so an in-region incident whose SUMMARY merely names a senator or
  // committee (a Karachi shop raid, an asset-declaration story) is not swept up.
  /(?:\b(?:lawmakers?|legislators?|senators?|congress(?:ional)?|house committee|subcommittee)\b[^.]{0,40}\b(?:cargo|freight|supply chain|trucking)\b)|(?:\b(?:cargo|freight|supply chain|trucking)\b[^.]{0,40}\b(?:lawmakers?|legislators?|senators?|congress(?:ional)?|house committee|subcommittee)\b)/i,
  // A NAMED cargo-theft task force / US DOT process — not a local police "task
  // force" that arrests suspects in a real hijacking.
  /\b(?:cargo theft task force|dot (?:seeks|launch(?:es|ing)?)|database goes live)\b/i,

  // --- Explainer / how-to / opinion / conference collateral.
  /\bhow\b[^.]{0,30}(?:\bcan (?:prevent|protect|combat|fight|mitigate|reduce|stop)\b|\bto (?:prevent|protect|combat|fight|mitigate|reduce|stop|avoid)\b|\b(?:fleets?|carriers?|shippers?|brokers?|companies|businesses)\b[^.]{0,25}\b(?:can|protect|prevent)\b)/i,
  /\bwhy\b[^.]{0,20}\bcargo theft\b/i,
  /\b(?:takeaways|q&a|webinar|on[- ]demand|podcast|playbook|white ?paper|explainer|editorial|op-?ed|guest column|what (?:that number|it signals|to know))\b/i,
  /\b(?:post[- ]?compromise|post[- ]?breach|beyond the breach)\b/i,

  // --- Advisory / warning / vendor-trend / risk-management marketing.
  /\b(?:warns?|warning|alert(?:s|ed|ing)?)\b[^.]{0,20}\b(?:of|over|about|on)\b[^.]{0,25}\b(?:rise|rising|surge|surging|growing|growth|spike|wave|sophistication|threat|epidemic)\b/i,
  /\b(?:red flags? raised|necessitate|proactive[^.]{0,20}risk management|puts?[^.]{0,40}under pressure|leaves?[^.]{0,25}liable|cannot ignore|(?:risks?|threats?)[^.]{0,20}(?:carriers?|shippers?|fleets?|brokers?) face)\b/i,
  /\bstrategic (?:cargo )?theft\b/i,
  /\b(?:amid|amidst|as)\b[^.]{0,25}\b(?:rise|rising|surge|surging|growing|growth|spike|wave|boom)\b[^.]{0,15}\bcargo theft\b/i,
  /\bcargo theft\b[^.]{0,20}\b(?:amid|amidst|as)\b[^.]{0,20}\b(?:rise|rising|surge|surging|growing|growth|spike|wave|boom)\b/i,
  /\b(?:tackles?|tackling|combats?|responds? to|strengthens?|bolsters?|ramps? up)\b[^.]{0,25}(?:anti-?cargo|cargo (?:theft|crime))/i,

  // --- Cyber / AI-enabled trend commentary (trend-gated so a real incident
  // that merely mentions a hacked TMS is not caught).
  /\b(?:ai|artificial intelligence)\b[^.]{0,40}\b(?:surge|wave|rise|spike|boom|drives?|contributes? to|fuels?|behind|new wave)\b[^.]{0,30}\bcargo theft\b/i,
  /\b(?:cyber(?:-?enabled|crime|attacks?)?|hackers?|rmm tools?)\b[^.]{0,30}\bcargo theft\b[^.]{0,30}\b(?:surge|wave|era|campaign|rise|new)\b/i,
  /\bcargo theft\b[^.]{0,30}\b(?:surge|wave|era|campaign|new normal)\b[^.]{0,25}\b(?:cyber|ai|artificial intelligence|hackers?)\b/i,

  // --- Strong out-of-region (US) organisation / place tokens with no in-region
  // anchor. Kept tight to unambiguous US identifiers so an APAC / Middle-East
  // record can never match on them.
  /\b(?:lapd|nypd|so[- ]?cal|los angeles|c-?span|freightwaves|transport topics|land ?line media|cdllife|ttnews)\b/i,
  // Standalone "L.A." (Los Angeles), but NOT the "L.A." embedded in a dotted
  // abbreviation like "M.L.A." (Indian legislator) or "P.L.A." — India is the
  // top in-region cargo source, so those genuine headlines must survive.
  /(?<![a-z]\.)\bl\.a\./i,
  /\bcargo theft in latin america\b/i,
];

// First matching slop pattern, or null. Mirrors the local `firstMatch` used by
// the topic relevance gate so callers get the matched source for logging.
export function matchCargoSlop(text: string): RegExp | null {
  for (const re of CARGO_SLOP_EXCLUDE) {
    if (re.test(text)) return re;
  }
  return null;
}
