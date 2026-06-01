// Content-based severity classification for ingested incidents.
//
// Both scrapers used to hardcode severity="low", which collapsed the
// Severity Distribution chart into a single bar and made the five-tier
// risk vocabulary (Insignificant, Low, Moderate, High, Extreme)
// meaningless on live data. This module rates each incident from its
// title + summary text so the spread reflects real signal.
//
// Tiers are scanned highest-first; the strongest matching signal wins.
// EXTREME is the only tier that drives the reserved subdued-red (#A33232)
// marker, so its signals are restricted to fatal / mass-casualty /
// emergency-rule language and it stays rare and meaningful by design.

export type Severity = "insignificant" | "low" | "moderate" | "high" | "extreme";

// Fatalities, mass casualties, emergency rule. Reserved tier — drives the
// subdued-red marker only.
const EXTREME: RegExp[] = [
  /\b(killed|dead|deaths?|died|fatal(it(y|ies))?|massacre|killings?|slain|shot dead|gunned down|burn(ed|t) to death|stampede)\b/i,
  /\b(martial law|state of emergency|emergency declared)\b/i,
  /\b(dozens|scores|hundreds|mass) (killed|dead|feared dead)\b/i,
  /\b(mass casualt|multiple (deaths|fatalities))\b/i,
];

// Violence, injuries, weapons, severe coercive response or disruption.
const HIGH: RegExp[] = [
  /\b(injur(y|ies|ed)|wounded|hurt|casualt(y|ies)|trampled|hospitalis(ed)|hospitaliz(ed))\b/i,
  /\b(violent|violence|riot(s|ing|ed)?|clash(es|ed)?|looting|looted|arson|torch(ed)?|set (on )?fire|set ablaze|ransack)\b/i,
  /\b(tear[- ]?gas|rubber bullets?|water cannon|baton[- ]?charge|live (rounds?|fire|ammunition)|gunfire|opened fire|firing|lathi[- ]?charge)\b/i,
  /\b(curfew|crackdown|mass arrests?|state forces (open|fire))\b/i,
  /\b(at gunpoint|armed (robbery|men|gang|hijack|heist)|gunpoint|brandish|machete|hijack(ed|ing) at|held up)\b/i,
  /\b(stormed|besieg(e|ed)|breach(ed)? the|overran)\b/i,
];

// Active confrontation, arrests, blockades, operational disruption.
const MODERATE: RegExp[] = [
  /\b(arrest(s|ed)?|detain(ed|ment)?|roadblock|road block|blockad(e|ed)|barricad(e|ed)|stand[- ]?off|confront(ation|ed)?|scuffle|skirmish)\b/i,
  /\b(general strike|nationwide strike|mass (protest|rally|march)|thousands (of )?(protest|march|rally|gather)|shut(s| |down)|stoppage|walkout|sit[- ]?in occupy|occupy(ing)?)\b/i,
  /\b(seal tamper|tampered seal|broke into|break[- ]?in|forced entry)\b/i,
];

// Forward-looking, advisory, or aftermath-only language with no active
// incident. Genuinely minor — kept rare.
const INSIGNIFICANT: RegExp[] = [
  /\b(plan(s|ned|ning)? to|call(s|ed|ing)? for|threaten(s|ed|ing)? to|vow(s|ed)? to|set to|to hold (a )?(protest|strike|rally)|may (strike|protest)|could (strike|protest)|urg(e|ed|ing)|appeal(ed|s)? for|warn(s|ed|ing) of|advisory|alert issued|postpon(e|ed)|call(ed)? off|suspend(ed)? (the )?strike)\b/i,
];

/**
 * Rate an incident's severity from its text.
 *
 * @param topic  "flashpoint" (civil unrest), "cargo_watch" (cargo crime) or
 *               "shipping" (maritime security / disruption).
 *               Cargo incidents describe a completed theft, so their floor
 *               is "low" (pilferage) rising to "moderate" for a substantive
 *               theft; civil-unrest items default to "low" (peaceful/planned
 *               protest) absent stronger signal. Shipping rates a kinetic
 *               vessel/port attack as "high" and a seizure / closure /
 *               disruption as "moderate" — extreme stays reserved for the
 *               casualty/emergency signals in the EXTREME tier above.
 */
export function classifySeverity(
  title: string,
  summary: string,
  topic: "flashpoint" | "cargo_watch" | "shipping",
): Severity {
  const hay = `${title}\n${summary}`;

  if (EXTREME.some((re) => re.test(hay))) return "extreme";
  if (HIGH.some((re) => re.test(hay))) return "high";
  if (MODERATE.some((re) => re.test(hay))) return "moderate";

  // Cargo crime: an actual theft (stolen/robbery/burglary/heist) without
  // weapons is still a material loss → moderate. Pilferage / petty /
  // attempted / recovered stays low.
  if (topic === "cargo_watch") {
    if (/\b(pilferage|petty|attempted|foiled|recovered|minor)\b/i.test(hay)) return "low";
    if (/\b(theft|stolen|stole|robbery|robbed|burglary|burgl|heist|loot|cargo crime)\b/i.test(hay)) {
      return "moderate";
    }
  }

  // Shipping: a kinetic strike on a vessel or port (missile / drone /
  // projectile / explosion / fire / sinking) is a high-severity maritime
  // incident even without confirmed casualties (those escalate to extreme
  // via the EXTREME tier). A seizure / boarding / hijack / detention or a
  // chokepoint closure / blockade / major disruption is a moderate
  // operational event. Forward-looking / advisory framing falls through to
  // the INSIGNIFICANT / low default below.
  if (topic === "shipping") {
    if (
      /\b(missile|drone|projectile|torpedo|rocket|explosion|explosive|blast|struck|set (on )?fire|set ablaze|ablaze|sinking|sank|sunk|limpet mine|mine attack)\b/i.test(hay)
    ) {
      return "high";
    }
    if (
      /\b(seiz(e|ed|ure|ing)|board(ed|ing)|hijack(ed|ing)?|detain(ed|ment)?|captured|impound(ed)?|commandeer(ed)?|closure|closed|blockad(e|ed)|shutdown|congestion|backlog|reroute|re-?route|divert(ed|s)?|diversion|stoppage|suspend(ed|s)?)\b/i.test(hay)
    ) {
      return "moderate";
    }
  }

  if (INSIGNIFICANT.some((re) => re.test(hay))) return "insignificant";
  return "low";
}
