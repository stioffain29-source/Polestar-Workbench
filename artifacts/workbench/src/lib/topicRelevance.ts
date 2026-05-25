// Per-topic relevance filter.
//
// Reports must only include records that match the report's operational
// purpose. A record that merely mentions "fuel" in a hiking obituary is
// not a fuel incident and must not appear in the Fuel report table,
// Fast Facts or prose.
//
// The filter is keyword based: each topic has a list of REQUIRED phrases
// (one must match) plus a shared list of EXCLUDED phrases that mark a
// record as off-topic regardless of keyword hits (live news blogs,
// general death/travel stories, etc).

export interface RelevanceInput {
  topic: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

// Exclusions for clearly off-topic items. Keep these narrow so they only
// strip recognisable noise (live news blogs, hiking obituaries, sports
// and entertainment fluff) and never drop legitimate operational records.
const EXCLUDE_PHRASES: RegExp[] = [
  /\bnews live\b/,
  /\blive (updates?|blog)\b/,
  /^live:/,
  /\bhiking\b/,
  /\binca trail\b/,
  /\btourist who died\b/,
  /\bobituary\b/,
  /\bsport(s)? results?\b/,
  /\bmatch report\b/,
  /\bbox office\b/,
  /\bcelebrity\b/,
  /\bentertainment news\b/,
  /\brecipe\b/,
];

// Fuel-specific exclusions. Pure market speculation, equity/finance news
// and broad oil-price commentary with no operational signal must never
// lead a Fuel Watch. These records may mention "oil" or "fuel" but they
// are not fuel-operational incidents.
const FUEL_EXCLUDE: RegExp[] = [
  /\b(share price|stock price|equity|investor (call|day|update)|earnings|quarterly (result|results|report)|annual report|dividend|buyback|ipo|market cap)/,
  /\b(oil futures|crude futures|brent futures|wti futures|futures contract|options trading|hedge fund|speculat(or|ors|ion|ive))/,
  /\b(analyst (note|target|forecast)|broker (note|target)|price target|sell[- ]side|buy[- ]side rating|upgrade rating|downgrade rating)/,
  /\b(oil (price|prices) (forecast|outlook|view|prediction|projection) (for|to))/,
  // Bank/research-house price-call commentary on crude / Brent / WTI.
  // These read as market projections, not fuel-operational incidents,
  // and were polluting Related Incidents (e.g. "Citi forecasts Brent
  // crude to reach $120 per barrel"). Match any "<verb> <oil/crude>
  // (… to reach|hit|climb|fall|drop|surge|… per barrel|… per bbl|…
  // \$NN)" pattern, plus an explicit list of bank/research names.
  /\b(forecasts?|projects?|projecting|predicts?|predicting|expects?|expecting|sees|seeing|targets?|targeting|raises?|raising|lowers?|lowering|cuts?|cutting|hikes?|hiking) (its )?(brent|wti|crude|oil) .{0,40}(to (reach|hit|rise|climb|fall|drop|surge|touch|near|trade)|at \$|near \$|above \$|below \$|per barrel|per bbl)/,
  // Bank/research-house headlines that are explicitly price-call
  // commentary. We require BOTH a forecast-style verb AND a price-call
  // context word (brent|wti|crude|oil|price|target|per barrel|$NN) in
  // the same headline so we do not suppress legitimate operational
  // headlines such as "Citi raises concerns about refinery outage".
  /\b(citi|citigroup|goldman( sachs)?|jpmorgan|jp morgan|morgan stanley|hsbc|barclays|ubs|deutsche bank|standard chartered|bank of america|baml|wood ?mac(kenzie)?|rystad|argus|s&p global|platts|sp global) (forecasts?|projects?|sees|expects?|predicts?|targets?|raises?|lowers?|cuts?|hikes?) .{0,60}(brent|wti|crude|oil|price target|per barrel|per bbl|\$\d)/,
  // Generic "petrol prices today / diesel rates today" headlines with no
  // change indicator. These read as live-blog tickers, not operational
  // fuel signal, and dilute the Related Incidents table.
  /\b(petrol|diesel|fuel) (price|prices|rate|rates) today\b/,
  /\b(today'?s (petrol|diesel|fuel) (price|prices|rate|rates))/,
  // Records that the upstream classifier dropped into the catch-all
  // "Other fuel incident" bucket carry no operational signal and must
  // not lead a Fuel Watch.
  /^other fuel incident$/i,
];

// Shipping-specific exclusions. Food-price commentary, airline fuel cost
// stories and food-security analysis must never lead a Shipping report,
// even when the text mentions a chokepoint or freight word in passing.
// These records may discuss shipping in macro terms but they are not
// operational maritime incidents.
const SHIPPING_EXCLUDE: RegExp[] = [
  /\bfao\b/,
  /\bfood price (index|inflation|increase|rise|surge)/,
  /\bfood (prices|inflation|security|crisis|insecurity)\b/,
  /\b(world food (program|programme)|wfp)\b/,
  /\bairline (fuel|jet fuel) (cost|price|prices|surcharge)/,
  /\bjet fuel (cost|price|prices|surcharge)/,
  /\b(grain|wheat|rice|corn|soybean|edible oil) (price|prices|market|outlook)\b/,
  /\bcommodity price index\b/,
];

const REQUIRED: Record<string, RegExp[]> = {
  fuel: [
    /\bfuel (shortage|price|prices|protest|protests|supply|stockout|rationing|tanker|truck)/,
    /\bpetrol (shortage|price|prices|station)/,
    /\bdiesel (shortage|price|prices|supply)/,
    /\b(refinery|refineries) (disruption|outage|shutdown|fire|attack|maintenance|closure|halt)/,
    // Narrowed: macro oil/crude commentary is admitted only when it
    // carries an operational signal (disruption, shortage, halt, ban,
    // attack, sanctions or supply-side event). Plain "oil prices rose"
    // commentary is intentionally excluded — it belongs in market notes.
    /\b(oil|crude) (shortage|supply (cut|halt|disruption|squeeze)|export ban|export halt|embargo|sanctions|outage|attack|sabotage|spill)/,
    /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene|jet fuel)/,
    /\b(fuel|petrol|diesel|gas|lpg|kerosene|jet fuel) .{0,30}(subsidy|levy|duty|excise|tax) (cut|hike|raise|removal|removed|reform|reintroduce)/,
    /\btanker (driver|drivers|strike|shortage|attack|convoy|blockade)/,
    /\b(lpg|cng) (shortage|price|supply)/,
    /\bpump (price|prices)\b/,
    /\bforecourt (closure|queue|disruption|shut)/,
    /\bhormuz .{0,40}(oil|crude|tanker|fuel|shipping|supply|price)/,
    /\b(oil|crude|tanker|fuel|shipping|supply|price) .{0,40}hormuz\b/,
  ],
  fertiliser: [
    /\bfertili[sz]er (shortage|price|prices|supply|export|import|stockout|subsidy)/,
    /\b(urea|potash|dap|nitrogen|phosphate|ammonia) (price|prices|export|import|supply|shortage|plant)/,
    /\bfarmer.{0,15}(protest|strike|rally)/,
    /\bplant (closure|shutdown|outage|maintenance) .{0,30}(fertili[sz]er|urea|potash|dap|ammonia|phosphate)/,
    /\bfood security\b/,
  ],
  energy: [
    /\b(power|grid|electricity) (outage|cut|blackout|disruption|failure|shortage|crisis|tariff)/,
    /\bload[ -]shedd/,
    /\bsubstation (fire|attack|failure|outage|sabotage)/,
    /\b(generation|capacity) shortfall/,
    /\b(transmission|pipeline) (attack|sabotage|disruption|outage|failure)/,
    /\b(gas|diesel|coal) .{0,20}power\b/,
    /\benergy (crisis|shortage|tariff|emergency)/,
  ],
  shipping: [
    /\b(vessel|tanker|ship|cargo ship|container ship|bulk carrier) (attack|attacked|seizure|seized|boarding|missile|drone|fire|sinking|collision|adrift)/,
    /\battack (on|against) (a |an |the )?(vessel|tanker|ship|cargo ship|container ship|bulk carrier|crew)/,
    /\b(missile|drone) (strike|attack) .{0,30}(ship|vessel|tanker|maritime|port|hormuz|red sea)/,
    /\bport (closure|shutdown|strike|congestion|disruption|attack|berth|backlog)/,
    /\bchokepoint\b/,
    /\b(strait of hormuz|bab[- ]el[- ]mandeb|suez|malacca|singapore strait)/,
    /\b(naval|maritime) (advisory|warning|alert|patrol|operation)/,
    /\b(war risk|p&i|insurance premium) .{0,30}(shipping|vessel|tanker|maritime)/,
    /\b(route|routing|reroute|diversion) .{0,30}(vessel|tanker|ship|maritime|red sea|hormuz|suez|cape)/,
    /\bfreight rate/,
  ],
  cargo_watch: [
    /\b(cargo|truck|container|warehouse|depot) (theft|robbery|hijack|raid|pilferage|stolen|loss)/,
    /\b(hijack|hijacked|hijacking) .{0,30}(truck|lorry|convoy|cargo|container)/,
    /\bseal tamper/,
    /\binsider .{0,20}(theft|pilferage|tip-off)/,
    /\blogistics crime/,
    /\b(broken seal|seal break|seal broken)/,
  ],
  protests: [
    /\b(protest|demonstration|rally|march|sit[- ]in|strike|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|disorder)/,
    /\b(students?|farmers|workers|union|opposition|civil society) .{0,30}(protest|march|rally|strike|gather)/,
    /\b(police|security forces?) .{0,30}(clash|crackdown|operation|tear gas|baton|rubber bullet)/,
  ],
  flashpoint: [
    /\b(protest|demonstration|rally|march|sit[- ]in|strike|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|disorder|crackdown|clash)/,
    /\b(curfew|state of emergency|martial law|lockdown)/,
    /\b(security forces?|police|military) .{0,30}(deployed|operation|clash|crackdown)/,
  ],
};

function haystack(i: RelevanceInput): string {
  return [
    i.title ?? "",
    i.summary ?? "",
    i.source ?? "",
    (i.sourceUrl ?? "").replace(/[-_/]/g, " "),
    i.location ?? "",
  ].join(" ").toLowerCase();
}

/**
 * Return true when the record is genuinely about the report's topic.
 * Returns true (allows the record through) for topics with no rule, so
 * unknown report families do not silently empty their tables.
 */
export function isTopicRelevant(topic: string, i: RelevanceInput): boolean {
  const text = haystack(i);
  for (const re of EXCLUDE_PHRASES) {
    if (re.test(text)) return false;
  }
  if (topic === "shipping") {
    for (const re of SHIPPING_EXCLUDE) {
      if (re.test(text)) return false;
    }
  }
  if (topic === "fuel") {
    for (const re of FUEL_EXCLUDE) {
      if (re.test(text)) return false;
    }
  }
  const required = REQUIRED[topic];
  if (!required || required.length === 0) return true;
  for (const re of required) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Country reports allow any operational record that mentions the country
 * context but still strip the noisy general-news exclusions above.
 */
export function isCountryRelevant(i: RelevanceInput): boolean {
  const text = haystack(i);
  for (const re of EXCLUDE_PHRASES) {
    if (re.test(text)) return false;
  }
  return true;
}

/**
 * Sanitize fallback labels emitted by the classifier or country counts
 * so the Fast Facts cards never read "Unknown" or "Other fuel incident".
 */
export function sanitizeFactValue(topic: string, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v || v === "-" || v === "--") return "Coverage gap";
  if (/^unknown$/i.test(v)) return "Country not identified";
  if (/^other .* incident$/i.test(v)) {
    // Banned wording removed. Use a neutral signal-quality label so the
    // card reads honestly when the leader is a residual "Other …" bucket.
    if (topic === "fuel") return "Multiple fuel incident types";
    if (topic === "fertiliser") return "Multiple fertiliser incident types";
    if (topic === "energy") return "Multiple energy incident types";
    if (topic === "shipping") return "Multiple maritime incident types";
    if (topic === "cargo_watch") return "Multiple cargo incident types";
    if (topic === "protests" || topic === "flashpoint") return "Multiple public order incident types";
    return "Multiple incident types";
  }
  return v;
}
