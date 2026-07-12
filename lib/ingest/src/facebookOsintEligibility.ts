// Facebook OSINT — promotion-eligibility + incident-matching helpers.
//
// These are PURE functions (no DB access) so they can be exercised in isolation
// by the unit tests AND shared by BOTH the ingest engine (facebookOsint.ts, which
// pre-computes credibility/corroboration at collection time) and the promote
// route (routes/socialRaw.ts, which RE-DERIVES eligibility from the stored row at
// promotion time — never trusting a client claim). The DB queries that gather the
// candidate incidents live in the engine/route; the scoring logic lives here.
//
// Credibility model (architect-authoritative):
//   - A post is "security-relevant" when its classified category is anything
//     other than "Other security".
//   - A post is "credible" when ANY of:
//       * the monitored page is a CONFIG-DECLARED official or local-media source
//         (sourceTier — NEVER inferred from prose), OR
//       * the post links to a domain on the credible-source allow-list, OR
//       * the post cross-corroborates an existing incident (separate scorer).
//   - "promotable" = security-relevant AND credible. credibilityReason records
//     exactly which signal(s) fired.
//
// Two SEPARATE incident scorers with different thresholds:
//   - Corroboration (~0.5): "does an existing incident support this post?" — a
//     soft cross-feed match that UPGRADES credibility but does NOT block.
//   - Duplicate-block (stricter, 0.65–0.75 + same country + close date +
//     same/near province + same category): "is this post ALREADY an incident?" —
//     a hard match that BLOCKS promotion (409) so a promote can never double-count.

import type { IncidentCategory } from "./structuredExtract";

export type SourceTier = "official" | "local_media" | "osint";

export const SOURCE_TIERS: readonly SourceTier[] = [
  "official",
  "local_media",
  "osint",
];

export function normaliseSourceTier(raw: string | null | undefined): SourceTier {
  const v = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "official") return "official";
  if (v === "local_media" || v === "media" || v === "press") return "local_media";
  return "osint";
}

// ---------------------------------------------------------------------------
// Credible-source domain allow-list
// ---------------------------------------------------------------------------
// A hard, curated allow-list. A post from an unverified OSINT page is upgraded to
// "credible" ONLY when it LINKS to one of these — i.e. the credibility comes from
// a verifiable official/established-media domain, never from the OSINT page's own
// claim. Matched by exact host or a dotted suffix (so subdomains match too).
export const CREDIBLE_DOMAINS: Record<
  string,
  { label: string; tier: "official" | "local_media" }
> = {
  // --- Papua New Guinea: official / government ---
  "gov.pg": { label: "PNG Government", tier: "official" },
  "rpngc.gov.pg": { label: "Royal PNG Constabulary", tier: "official" },
  "police.gov.pg": { label: "Royal PNG Constabulary", tier: "official" },
  // --- Papua New Guinea: established media ---
  "postcourier.com.pg": { label: "Post-Courier", tier: "local_media" },
  "thenational.com.pg": { label: "The National (PNG)", tier: "local_media" },
  "looppng.com": { label: "Loop PNG", tier: "local_media" },
  "emtv.com.pg": { label: "EMTV", tier: "local_media" },
  "pngbusinessnews.com": { label: "PNG Business News", tier: "local_media" },
  // --- Indonesia / Papua: official / government ---
  "go.id": { label: "Indonesian Government", tier: "official" },
  "polri.go.id": { label: "Indonesian National Police", tier: "official" },
  "bnpb.go.id": { label: "BNPB (Indonesia)", tier: "official" },
  // --- Indonesia / Papua: established media ---
  "antaranews.com": { label: "Antara News", tier: "local_media" },
  "jubi.id": { label: "Jubi (Papua)", tier: "local_media" },
  "jubi.co.id": { label: "Jubi (Papua)", tier: "local_media" },
  "kompas.com": { label: "Kompas", tier: "local_media" },
  "detik.com": { label: "Detik", tier: "local_media" },
  "tempo.co": { label: "Tempo", tier: "local_media" },
  "thejakartapost.com": { label: "The Jakarta Post", tier: "local_media" },
  "tribunnews.com": { label: "Tribun News", tier: "local_media" },
  "cnnindonesia.com": { label: "CNN Indonesia", tier: "local_media" },
  // --- International wire / Pacific desks ---
  "reuters.com": { label: "Reuters", tier: "local_media" },
  "apnews.com": { label: "Associated Press", tier: "local_media" },
  "bbc.com": { label: "BBC", tier: "local_media" },
  "bbc.co.uk": { label: "BBC", tier: "local_media" },
  "rnz.co.nz": { label: "RNZ Pacific", tier: "local_media" },
  "abc.net.au": { label: "ABC (Australia)", tier: "local_media" },
  "theguardian.com": { label: "The Guardian", tier: "local_media" },
  "aljazeera.com": { label: "Al Jazeera", tier: "local_media" },
};

/** Parse the bare registrable-ish host out of each link (www. stripped). */
export function extractHosts(links: readonly string[]): string[] {
  const out = new Set<string>();
  for (const link of links) {
    const raw = (link ?? "").trim();
    if (!raw) continue;
    try {
      const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
      const host = u.hostname.toLowerCase().replace(/^www\./, "");
      if (host) out.add(host);
    } catch {
      // Not a parseable URL — ignore (never throw on adversarial input).
    }
  }
  return [...out];
}

export interface CredibleDomainMatch {
  /** Distinct human-readable labels (e.g. "Reuters", "Post-Courier"). */
  labels: string[];
  /** The matched hosts (for storage/debugging). */
  hosts: string[];
  /** Strongest tier matched, or null when nothing matched. */
  tier: "official" | "local_media" | null;
}

/** Detect credible-source links among a post's outbound links. */
export function detectCredibleDomains(
  links: readonly string[],
): CredibleDomainMatch {
  const hosts = extractHosts(links);
  const labels: string[] = [];
  const matchedHosts: string[] = [];
  let tier: "official" | "local_media" | null = null;
  for (const host of hosts) {
    for (const [key, val] of Object.entries(CREDIBLE_DOMAINS)) {
      if (host === key || host.endsWith(`.${key}`)) {
        if (!labels.includes(val.label)) labels.push(val.label);
        matchedHosts.push(host);
        if (val.tier === "official") tier = "official";
        else if (tier === null) tier = "local_media";
        break;
      }
    }
  }
  return { labels, hosts: matchedHosts, tier };
}

// ---------------------------------------------------------------------------
// Eligibility (pure)
// ---------------------------------------------------------------------------
export interface EligibilityInput {
  category: IncidentCategory;
  /** The config-declared tier of the monitored page. */
  sourceTier: SourceTier;
  /** Human-readable labels of credible domains linked from the post. */
  credibleDomainLabels: readonly string[];
  /** True when a cross-feed incident corroboration was found. */
  corroborated: boolean;
  corroborationReason?: string | null;
}

export interface Eligibility {
  securityRelevant: boolean;
  credible: boolean;
  credibilityReason: string | null;
  promotable: boolean;
}

/**
 * Derive promotion eligibility from the classified category + credibility
 * signals. Pure and deterministic so the ingest engine and the promote route
 * compute IDENTICAL results from the same stored fields.
 */
export function deriveEligibility(input: EligibilityInput): Eligibility {
  const securityRelevant = input.category !== "Other security";

  const reasons: string[] = [];
  let credible = false;
  if (input.sourceTier === "official") {
    credible = true;
    reasons.push("Monitored page is a declared official source");
  } else if (input.sourceTier === "local_media") {
    credible = true;
    reasons.push("Monitored page is a declared local-media source");
  }
  if (input.credibleDomainLabels.length > 0) {
    credible = true;
    reasons.push(
      `Links to credible source(s): ${input.credibleDomainLabels.join(", ")}`,
    );
  }
  if (input.corroborated) {
    credible = true;
    reasons.push(input.corroborationReason ?? "Corroborated by an existing incident");
  }

  const credibilityReason = reasons.length
    ? reasons.join("; ")
    : securityRelevant
      ? "Unverified OSINT page; no credible corroboration"
      : null;

  return {
    securityRelevant,
    credible,
    credibilityReason,
    promotable: securityRelevant && credible,
  };
}

// ---------------------------------------------------------------------------
// Review-queue flag (pure)
// ---------------------------------------------------------------------------
// A post is flagged "for analyst review" when it BOTH matches the PNG /
// Indonesian-Papua scope AND classifies into a recognised security category.
// The flag is a TRIAGE signal only — it never promotes anything and never makes
// a row an incident. The reason records WHY it was flagged and whether it is
// already promote-eligible, so the review queue can be read at a glance.
export interface ReviewInput {
  /** True when the post resolved to the PNG / Indonesian-Papua scope. */
  inScope: boolean;
  /** True when the classified category is a real security category. */
  securityRelevant: boolean;
  /** The re-derived promote eligibility (security-relevant AND credible). */
  promotable: boolean;
  category: IncidentCategory;
}

export interface Review {
  reviewFlag: boolean;
  reviewReason: string | null;
}

export function deriveReview(input: ReviewInput): Review {
  if (!input.inScope || !input.securityRelevant) {
    return { reviewFlag: false, reviewReason: null };
  }
  const tail = input.promotable
    ? "promote-eligible (security-relevant and credible)"
    : "needs a credible source or cross-feed corroboration before promotion";
  return {
    reviewFlag: true,
    reviewReason: `Flagged for analyst review — ${input.category} in the Papua/PNG theatre; ${tail}.`,
  };
}

// ---------------------------------------------------------------------------
// Confidence score (pure, 0-100)
// ---------------------------------------------------------------------------
// A deterministic triage score combining the concrete signals already derived
// for the row. It is NOT a probability and NEVER fabricates certainty — it only
// adds points for signals that genuinely fired (precise locality, a security
// category, a credibility signal, cross-feed corroboration, an explicit incident
// date, multiple matched keywords). An out-of-scope post scores 0.
export interface ConfidenceInput {
  inScope: boolean;
  /** A gazetteer province/locality (not just a bare country cue) matched. */
  localityPrecise: boolean;
  securityRelevant: boolean;
  credible: boolean;
  corroborated: boolean;
  hasIncidentDate: boolean;
  keywordCount: number;
}

export function computeConfidence(input: ConfidenceInput): number {
  if (!input.inScope) return 0;
  let score = 25;
  if (input.localityPrecise) score += 18;
  if (input.securityRelevant) score += 22;
  if (input.credible) score += 15;
  if (input.corroborated) score += 12;
  if (input.hasIncidentDate) score += 5;
  if (input.keywordCount >= 3) score += 3;
  return Math.max(5, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Security-event signal guard (pure, multilingual)
// ---------------------------------------------------------------------------
// The theatre extractors classify a post into a security category from a broad
// vocabulary, so community chatter (a lost-property notice, an eviction gripe, a
// governance press release) sometimes lands in a real security category and can
// even be auto-promoted. This guard is a stricter, precision-first second gate:
// it asks whether the caption actually reports a SECURITY EVENT — a crime, act of
// violence, unrest, armed action, or acute political instability — using an
// explicit English + Bahasa Indonesia + Tok Pisin cue list matched against the
// caption text ONLY. It NEVER fabricates: it can only DEMOTE a post the caller
// judges unreadable-as-security, and it is applied solely to `facebook_osint`
// OSINT context rows. Callers must only demote when the text is judgeable
// ({@link isLikelyEnglish} or a translation is present) — a caption we cannot
// confidently read is left untouched, never demoted on a guess.

// NFKC folds unicode-styled letters (bold/italic "mathematical" alphabets,
// small-caps, full-width) down to plain ASCII so a caption written in styled
// glyphs — e.g. "𝗔𝗧𝗧𝗘𝗠𝗣𝗧𝗘𝗗 𝗛𝗢𝗟𝗗𝗨𝗣" — still matches the cue list.
function normaliseForSignal(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

// Curated security-EVENT cues. Each denotes a crime, act of violence, unrest,
// armed action, or acute political instability. Deliberately EXCLUDES civil /
// administrative grievance vocabulary (eviction, corruption, misuse,
// investigation, appointment) — those are governance chatter, not a security
// event, and are the noise this guard exists to drop.
const SECURITY_EVENT_CUES: RegExp[] = [
  // --- English: homicide / violence ---
  /\bkill(?:ed|ing|ings|s)?\b/,
  /\bmurder(?:ed|s)?\b/,
  /\bhomicide\b/,
  /\bshot dead\b/,
  /\bfatal(?:ly|ity|ities)?\b/,
  /\bstab(?:bed|bing|bings)?\b/,
  /\bmachete\b/,
  /\bbush ?knife\b/,
  /\bbeheaded?\b/,
  /\bassault(?:ed|s)?\b/,
  /\battack(?:ed|s|ers|ing)?\b/,
  /\bambush(?:ed|es|ing)?\b/,
  /\braid(?:ed|s|ing)?\b/,
  /\bexecut(?:e|ed|ion|ions)\b/,
  // --- English: firearms / shooting ---
  /\bshoot(?:ing|out|s)?\b/,
  /\bgunfire\b/,
  /\bgunmen\b/,
  /\bgunman\b/,
  /\bgunpoint\b/,
  /\bopen(?:ed)? fire\b/,
  /\bfirearms?\b/,
  /\brifles?\b/,
  /\bpistols?\b/,
  /\bweapons?\b/,
  // --- English: robbery / theft ---
  /\brob(?:bed|bery|beries|bers)?\b/,
  /\bhold[- ]?up\b/,
  /\bheld up\b/,
  /\btheft\b/,
  /\bthief\b/,
  /\bthieves\b/,
  /\bstolen\b/,
  /\bsteal(?:ing)?\b/,
  /\bburglar\w*\b/,
  /\bbreak[- ]?in\b/,
  /\bloot(?:ing|ed|ers)?\b/,
  /\bransack\w*\b/,
  // --- English: unrest / clashes ---
  /\briot(?:s|ing|ers)?\b/,
  /\bunrest\b/,
  /\bclash(?:es|ed|ing)?\b/,
  /\btribal (?:fight|clash|war|conflict|violence)\w*\b/,
  /\b(?:communal|ethnic) (?:violence|clash\w*|conflict)\b/,
  /\bprotest(?:s|ers|ing)?\b/,
  /\bdemonstrat(?:ion|ors|ing|e)\w*\b/,
  /\brally\b/,
  /\bblockade\b/,
  /\broadblock\b/,
  // --- English: arson / explosives ---
  /\barson\b/,
  /\bset (?:on )?fire\b/,
  /\btorch(?:ed|ing)?\b/,
  /\bbomb(?:ing|s|ed)?\b/,
  /\bgrenade\b/,
  /\bexplosion\b/,
  /\bblast\b/,
  // --- English: abduction ---
  /\bkidnap(?:ping|ped|pers)?\b/,
  /\babduct(?:ion|ed)?\b/,
  /\bhostages?\b/,
  // --- English: gangs / groups ---
  /\bgang\b/,
  /\braskol\w*\b/,
  /\bseparatist\w*\b/,
  /\bmilitants?\b/,
  /\binsurgen\w*\b/,
  // --- English: acute political instability ---
  /\bcoup\b/,
  /\bmutiny\b/,
  /\bmartial law\b/,
  /\bstate of emergency\b/,
  /\bcurfew\b/,
  /\bno[- ]confidence\b/,
  /\bvote of no confidence\b/,
  /\bimpeach\w*\b/,
  // --- English: maritime security ---
  /\bpiracy\b/,
  /\bpirates?\b/,
  /\bhijack\w*\b/,
  /\bsea robbery\b/,
  // --- English: sorcery-accusation violence (PNG) ---
  /\bsorcery\w*\b/,
  /\bsanguma\b/,
  // --- Bahasa Indonesia ---
  /\bcuranmor\b/, // curi ranmor — motor-vehicle theft
  /\bpencuri(?:an)?\b/,
  /\bmaling\b/,
  /\bpembobolan\b/,
  /\brampok\b/,
  /\bperampokan\b/,
  /\bbegal\b/,
  /\bpembegalan\b/,
  /\bpembunuhan\b/,
  /\bdibunuh\b/,
  /\bkorban tewas\b/,
  /\bpenembakan\b/,
  /\bbaku ?tembak\b/,
  /\btertembak\b/,
  /\bditembak\b/,
  /\bpenikaman\b/,
  /\bditikam\b/,
  /\bpembacokan\b/,
  /\bdibacok\b/,
  /\bperang suku\b/,
  /\bbentrok(?:an)?\b/,
  /\bkerusuhan\b/,
  /\bricuh\b/,
  /\bpenganiayaan\b/,
  /\bdianiaya\b/,
  /\beksekusi\b/,
  /\bpenculikan\b/,
  /\bdisandera\b/,
  /\bpenyanderaan\b/,
  /\bpembakaran\b/,
  /\bdibakar\b/,
  /\bpenjarahan\b/,
  /\bunjuk rasa\b/,
  /\bdemonstrasi\b/,
  /\baksi (?:demo|protes|massa)\b/,
  /\bmogok\b/,
  /\bseparatis\b/,
  /\bpenyerangan\b/,
  /\bserangan\b/,
  /\bsenjata (?:api|tajam)\b/,
  /\bbersenjata\b/,
  // --- Tok Pisin (PNG) ---
  /\bpait\b/, // fight
  /\bkilim\b/, // kill / hit
  /\bholdap\b/, // hold-up / robbery
  /\bsutim\b/, // stab / shoot
  /\bstil\b/, // steal
];

/**
 * True when the caption text carries an explicit security-EVENT cue (crime,
 * violence, unrest, armed action, or acute political instability) in English,
 * Bahasa Indonesia, or Tok Pisin. Pure and no-fabrication: matched against the
 * given text only, after NFKC-normalising styled unicode glyphs to ASCII.
 */
export function hasSecurityEventSignal(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normaliseForSignal(text);
  return SECURITY_EVENT_CUES.some((re) => re.test(t));
}

// A small, high-frequency English function-word set used only to decide whether
// a caption is confidently READABLE as English — the precondition for the guard
// being allowed to DEMOTE. It is NOT a language classifier; it deliberately errs
// towards "not English" so a non-English caption is never demoted on a guess
// (it is left untouched until a translation is available).
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "in", "a", "is", "for", "on", "with", "at", "by",
  "was", "were", "has", "have", "had", "that", "this", "from", "you", "your",
  "should", "will", "are", "as", "an", "it", "they", "their", "after", "into",
]);

/**
 * Rough heuristic: is this text confidently English? True when it contains at
 * least three DISTINCT common English function words. Used only to gate the
 * security-signal guard's demote decision — never to classify or route.
 */
export function isLikelyEnglish(text: string | null | undefined): boolean {
  if (!text) return false;
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const hits = new Set<string>();
  for (const w of words) {
    if (ENGLISH_FUNCTION_WORDS.has(w)) hits.add(w);
    if (hits.size >= 3) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Security-event guard applied to a classified category (pure)
// ---------------------------------------------------------------------------

export interface SecurityGuardInput {
  /** The category the theatre classifier assigned. */
  category: IncidentCategory;
  /** The original (possibly non-English) caption. */
  caption: string | null | undefined;
  /** The English translation, when available (else null). */
  captionEn: string | null | undefined;
}

export interface SecurityGuardResult {
  /** The category after guarding — demoted to "Other security" when slop. */
  category: IncidentCategory;
  /** True when the guard changed a real category to "Other security". */
  demoted: boolean;
}

/**
 * Second-gate guard: when the classifier assigned a real security category but
 * NEITHER the caption nor its translation carries a security-event cue, AND the
 * text is confidently readable (English or translated), demote the category to
 * "Other security". A non-security category is returned unchanged; an unreadable
 * (untranslated, non-English) caption is left untouched — never demoted on a
 * guess. Pure and deterministic so ingest and the reclassify route agree.
 */
export function applySecurityEventGuard(
  input: SecurityGuardInput,
): SecurityGuardResult {
  if (input.category === "Other security") {
    return { category: input.category, demoted: false };
  }
  const signal =
    hasSecurityEventSignal(input.caption) ||
    hasSecurityEventSignal(input.captionEn);
  if (signal) return { category: input.category, demoted: false };
  const judgeable = !!input.captionEn || isLikelyEnglish(input.caption);
  if (!judgeable) return { category: input.category, demoted: false };
  return { category: "Other security", demoted: true };
}

// ---------------------------------------------------------------------------
// Incident matching (corroboration + duplicate-block)
// ---------------------------------------------------------------------------
// A compact token/date scorer mirroring the reliefweb corroboration approach:
// share of meaningful tokens + date proximity, gated on same country.

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "has", "are",
  "was", "were", "will", "into", "over", "after", "before", "their", "they",
  "them", "then", "than", "been", "being", "about", "near", "also", "amid",
  "said", "says", "say", "more", "most", "some", "such", "but", "not", "you",
  "your", "our", "its", "his", "her", "who", "what", "when", "where", "which",
  "while", "would", "could", "should", "may", "via", "per", "out", "off", "all",
  "new", "two", "one", "three", "four", "five", "people", "police", "papua",
  "guinea", "indonesia", "indonesian", "today", "yesterday", "report",
  "reported", "reports", "news", "update", "breaking",
]);

export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = (text ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ");
  for (const tok of cleaned.split(/\s+/)) {
    if (tok.length >= 4 && !STOPWORDS.has(tok)) out.add(tok);
  }
  return out;
}

function sameCountry(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function provincesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const pa = (a ?? "").trim().toLowerCase();
  const pb = (b ?? "").trim().toLowerCase();
  if (!pa || !pb) return false;
  return pa === pb || pa.includes(pb) || pb.includes(pa);
}

export interface IncidentCandidate {
  id: number;
  title: string;
  summary: string | null;
  country: string;
  province?: string | null;
  category?: string | null;
  occurredAt: Date;
  incidentDate?: Date | null;
}

export interface PostMatchInput {
  text: string;
  country: string;
  province: string | null;
  category: IncidentCategory;
  date: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Corroboration: a soft cross-feed match that upgrades credibility.
export const CORROBORATION_WINDOW_DAYS = 10;
export const CORROBORATION_THRESHOLD = 0.5;
export const CORROBORATION_MIN_SHARED = 2;
// The shared tokens must include at least this many security-EVENT terms. This
// is the precision gate that stops a PR / greeting / announcement post from
// "corroborating" an unrelated same-country incident on incidental place / org /
// generic-word overlap alone: date proximity can no longer clear the bar by
// itself — a real event/action word must appear in BOTH texts.
export const CORROBORATION_MIN_SECURITY_SHARED = 1;

// Duplicate-block: a hard match that blocks promotion. Stricter on every axis.
export const DUPLICATE_WINDOW_DAYS = 4;
export const DUPLICATE_BASE_THRESHOLD = 0.72;
// When the candidate also shares the post's province OR security category the
// match is corroborated on an extra axis, so a slightly lower token/date score is
// already a confident duplicate (kept inside the architect's 0.65–0.75 band).
export const DUPLICATE_CONFIRMED_THRESHOLD = 0.65;
export const DUPLICATE_MIN_SHARED = 3;

interface RawScore {
  score: number;
  shared: number;
  /** How many of the SHARED tokens carry a security-EVENT meaning. */
  securityShared: number;
  diffDays: number;
}

// A shared token is "security-meaningful" when it is itself a security-EVENT cue
// (crime / violence / unrest / armed action / acute instability). Place names,
// org names, generic 4+ char words, and bare years never qualify. Reuses the
// same curated cue list the security-event guard uses, so the two gates agree.
function isSecurityMeaningfulToken(token: string): boolean {
  return hasSecurityEventSignal(token);
}

function scoreCandidate(
  post: PostMatchInput,
  inc: IncidentCandidate,
  windowDays: number,
): RawScore | null {
  if (!sameCountry(post.country, inc.country)) return null;
  const incDate = inc.incidentDate ?? inc.occurredAt;
  const diffMs = Math.abs(incDate.getTime() - post.date.getTime());
  const diffDays = diffMs / DAY_MS;
  if (diffDays > windowDays) return null;

  const postTokens = tokenize(post.text);
  if (postTokens.size === 0) return null;
  const incTokens = tokenize(`${inc.title} ${inc.summary ?? ""}`);
  let shared = 0;
  let securityShared = 0;
  for (const t of postTokens) {
    if (!incTokens.has(t)) continue;
    shared++;
    if (isSecurityMeaningfulToken(t)) securityShared++;
  }

  const dateScore = 1 - diffDays / windowDays;
  // Overlap saturates at 3 shared tokens so a short caption can still match.
  const overlap = Math.min(1, shared / 3);
  const score = 0.5 * overlap + 0.5 * dateScore;
  return { score, shared, securityShared, diffDays };
}

export interface IncidentMatch {
  incident: IncidentCandidate;
  score: number;
  reason: string;
}

function shortTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Find the best CORROBORATING incident (soft, ~0.5). Upgrades credibility; does
 * not block. Returns null when nothing clears the threshold.
 */
export function pickCorroboration(
  post: PostMatchInput,
  candidates: readonly IncidentCandidate[],
): IncidentMatch | null {
  let best: IncidentMatch | null = null;
  for (const inc of candidates) {
    const r = scoreCandidate(post, inc, CORROBORATION_WINDOW_DAYS);
    if (!r) continue;
    if (r.shared < CORROBORATION_MIN_SHARED) continue;
    // Precision gate: the shared vocabulary must include a real security-EVENT
    // term, not just incidental place / org / generic-word overlap. Without this
    // a same-day PR post "corroborates" any unrelated same-country incident.
    if (r.securityShared < CORROBORATION_MIN_SECURITY_SHARED) continue;
    if (r.score < CORROBORATION_THRESHOLD) continue;
    if (!best || r.score > best.score) {
      best = {
        incident: inc,
        score: r.score,
        reason: `Corroborated by incident #${inc.id} "${shortTitle(inc.title)}" (${ymd(
          inc.incidentDate ?? inc.occurredAt,
        )})`,
      };
    }
  }
  return best;
}

/**
 * Find a DUPLICATE incident (hard, stricter). A post that matches one is ALREADY
 * tracked, so promoting it would double-count — the route returns 409. Requires
 * same country + close date + a high token/date score, with the bar lowered into
 * the confirmed band only when province OR security category also agrees.
 */
export function pickDuplicate(
  post: PostMatchInput,
  candidates: readonly IncidentCandidate[],
): IncidentMatch | null {
  let best: IncidentMatch | null = null;
  for (const inc of candidates) {
    const r = scoreCandidate(post, inc, DUPLICATE_WINDOW_DAYS);
    if (!r) continue;
    if (r.shared < DUPLICATE_MIN_SHARED) continue;
    const categoryMatch =
      !!inc.category &&
      inc.category.trim().toLowerCase() === post.category.trim().toLowerCase();
    const provinceMatch = provincesMatch(post.province, inc.province);
    const threshold =
      categoryMatch || provinceMatch
        ? DUPLICATE_CONFIRMED_THRESHOLD
        : DUPLICATE_BASE_THRESHOLD;
    if (r.score < threshold) continue;
    if (!best || r.score > best.score) {
      best = {
        incident: inc,
        score: r.score,
        reason: `Duplicates incident #${inc.id} "${shortTitle(inc.title)}" (${ymd(
          inc.incidentDate ?? inc.occurredAt,
        )})`,
      };
    }
  }
  return best;
}

// Category -> promotion topic. Armed/violent-crime categories file under the
// conflict tracker; protest / policing / governance / disruption categories file
// under the flashpoint (Protests & Civil Unrest) monitor.
const CONFLICT_CATEGORIES = new Set<IncidentCategory>([
  "Armed robbery / hold-up",
  "Tribal / communal violence",
  "Homicide / violent crime",
  "Theft / break-in",
]);

export function categoryToTopic(
  category: IncidentCategory,
): "flashpoint" | "conflict" {
  return CONFLICT_CATEGORIES.has(category) ? "conflict" : "flashpoint";
}
