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
  diffDays: number;
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
  for (const t of postTokens) if (incTokens.has(t)) shared++;

  const dateScore = 1 - diffDays / windowDays;
  // Overlap saturates at 3 shared tokens so a short caption can still match.
  const overlap = Math.min(1, shared / 3);
  const score = 0.5 * overlap + 0.5 * dateScore;
  return { score, shared, diffDays };
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
