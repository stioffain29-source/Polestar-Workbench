// Display-only approximate USD conversion for report surfaces.
//
// Sources write monetary amounts in local currency inside free-text incident
// titles and summaries (e.g. "goods worth Tk 2 million looted", "Rs 50 crore",
// "Rp 500 juta"). The owner requires every price shown in the reports to read in
// USD. There is NO USD column and NO live FX feed, so this module performs an
// APPROXIMATE, display-only conversion:
//
//   * Only amounts carrying an explicit currency indicator (symbol, ISO code, or
//     currency word) are converted. Bare numbers and bare "$"/"US$"/"USD" are
//     left untouched (a "$" figure is already USD; TAPA ingest deliberately
//     embeds "US$<int>" that `parseUsdLoss` reads).
//   * Collision indicators (Rs / rupee -> INR|PKR|LKR|NPR; ¥ -> JPY|CNY) are
//     resolved from the incident's country field. If the country hint cannot
//     resolve the ambiguity, the amount is LEFT UNCHANGED (no guessing —
//     strict no-fabrication).
//   * Output marks the figure approximate and keeps the original for
//     verifiability: "~US$17,000 (Tk 2 million)". Rounded to 2 significant
//     figures.
//   * The transform is idempotent: running it over its own output is a no-op.
//
// IMPORTANT: this is a RENDER-LAYER transform only. It must never be applied to
// values that feed `parseUsdLoss`, dedup/title keys, the per-incident AI-summary
// id-map, or any AI-generation payload. Feed it the final display string only.

type Ccy =
  | "BDT" | "INR" | "PKR" | "LKR" | "NPR" | "IDR" | "MYR" | "PHP" | "THB"
  | "VND" | "SGD" | "CNY" | "JPY" | "KRW" | "MMK" | "KHR" | "TWD" | "HKD"
  | "EUR" | "GBP" | "AUD";

// Approximate USD value of ONE unit of each currency (mid-2020s levels). These
// drive a display-only "~US$" hint and are intentionally coarse; refresh when
// materially stale. Not a live rate — never treat as a settled figure.
const USD_PER: Record<Ccy, number> = {
  BDT: 0.0083,
  INR: 0.0116,
  PKR: 0.0036,
  LKR: 0.0033,
  NPR: 0.0073,
  IDR: 0.000061,
  MYR: 0.222,
  PHP: 0.0172,
  THB: 0.0294,
  VND: 0.0000394,
  SGD: 0.74,
  CNY: 0.139,
  JPY: 0.0065,
  KRW: 0.00072,
  MMK: 0.00048,
  KHR: 0.000247,
  TWD: 0.0313,
  HKD: 0.128,
  EUR: 1.08,
  GBP: 1.27,
  AUD: 0.66,
};

// Unambiguous indicator (symbol / ISO code / currency word, lowercased) -> Ccy.
const DIRECT: Record<string, Ccy> = {
  // Bangladesh
  "tk": "BDT", "৳": "BDT", "taka": "BDT", "bdt": "BDT",
  // India (₹ is India's official symbol; "Rs"/"rupee" are ambiguous — see AMBIG)
  "₹": "INR", "inr": "INR",
  "pkr": "PKR", "lkr": "LKR", "npr": "NPR",
  // Indonesia
  "rp": "IDR", "rupiah": "IDR", "idr": "IDR",
  // Malaysia
  "rm": "MYR", "ringgit": "MYR", "myr": "MYR",
  // Philippines (peso is PHP within this APAC scope)
  "₱": "PHP", "peso": "PHP", "pesos": "PHP", "php": "PHP",
  // Thailand
  "฿": "THB", "baht": "THB", "thb": "THB",
  // Vietnam
  "₫": "VND", "dong": "VND", "vnd": "VND",
  // Singapore
  "s$": "SGD", "sgd": "SGD",
  // China
  "rmb": "CNY", "renminbi": "CNY", "yuan": "CNY", "cny": "CNY",
  // Japan
  "yen": "JPY", "jpy": "JPY",
  // South Korea
  "₩": "KRW", "won": "KRW", "krw": "KRW",
  // Myanmar
  "kyat": "MMK", "mmk": "MMK",
  // Cambodia
  "riel": "KHR", "khr": "KHR",
  // Taiwan
  "nt$": "TWD", "twd": "TWD",
  // Hong Kong
  "hk$": "HKD", "hkd": "HKD",
  // Australia
  "a$": "AUD", "au$": "AUD", "aud": "AUD",
  // Europe / UK
  "€": "EUR", "euro": "EUR", "euros": "EUR", "eur": "EUR",
  "£": "GBP", "gbp": "GBP",
};

// Collision indicators -> candidate currencies, resolved by country hint.
const AMBIG: Record<string, Ccy[]> = {
  "rs": ["INR", "PKR", "LKR", "NPR"],
  "rs.": ["INR", "PKR", "LKR", "NPR"],
  "rupee": ["INR", "PKR", "LKR", "NPR"],
  "rupees": ["INR", "PKR", "LKR", "NPR"],
  "¥": ["JPY", "CNY"],
};

// Country name (lowercased) -> its currency, used only to resolve AMBIG
// indicators. Countries whose currency is out of the supported set are omitted
// so they can never produce a false hint.
const COUNTRY_CCY: Record<string, Ccy> = {
  "bangladesh": "BDT",
  "india": "INR",
  "pakistan": "PKR",
  "sri lanka": "LKR",
  "nepal": "NPR",
  "indonesia": "IDR",
  "west papua": "IDR",
  "malaysia": "MYR",
  "philippines": "PHP",
  "thailand": "THB",
  "vietnam": "VND",
  "singapore": "SGD",
  "china": "CNY",
  "japan": "JPY",
  "south korea": "KRW",
  "korea": "KRW",
  "myanmar": "MMK",
  "burma": "MMK",
  "cambodia": "KHR",
  "taiwan": "TWD",
  "hong kong": "HKD",
  "australia": "AUD",
};

const SCALE: Record<string, number> = {
  "lakh": 1e5, "lakhs": 1e5, "lac": 1e5,
  "crore": 1e7, "crores": 1e7, "cr": 1e7,
  "ribu": 1e3,
  "juta": 1e6,
  "miliar": 1e9, "milyar": 1e9,
  "thousand": 1e3, "k": 1e3,
  "million": 1e6, "millions": 1e6, "mn": 1e6, "m": 1e6,
  "billion": 1e9, "bn": 1e9, "b": 1e9,
};

// Number: allows 2- or 3-digit thousands grouping (handles both 200,000 and the
// South-Asian 2,00,000 style) and decimals.
const NUM = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

// Scale words, longest-first so "crore" wins over "cr", "million" over "m", etc.
const SCALE_ALT =
  "lakhs?|lac|crores?|cr|ribu|juta|miliar|milyar|millions?|mn|billion|bn|thousand|k|m|b";

// Indicators that appear BEFORE the amount (symbols, codes, and lead words).
const BEFORE_IND =
  "S\\$|A\\$|AU\\$|HK\\$|NT\\$|Tk|৳|₹|Rp|RM|₱|฿|₫|₩|¥|€|£|Rs\\.?|RMB" +
  "|BDT|INR|PKR|LKR|NPR|IDR|MYR|PHP|THB|VND|SGD|CNY|JPY|KRW|MMK|KHR|TWD|HKD|EUR|GBP|AUD";

// Indicators that appear AFTER the amount (currency words + ISO codes; no bare
// symbols, and deliberately no bare "pound"/"dollar" which are too ambiguous).
const AFTER_IND =
  "taka|rupees?|rupiah|ringgit|pesos?|baht|dong|yuan|renminbi|yen|won|kyat|riel|euros?" +
  "|BDT|INR|PKR|LKR|NPR|IDR|MYR|PHP|THB|VND|SGD|CNY|JPY|KRW|MMK|KHR|TWD|HKD|EUR|GBP|AUD";

// Master matcher: indicator-before OR amount-then-indicator. Named groups keep
// the callback readable. `(?<![A-Za-z])` stops "US$" matching "S$" and stops
// indicators embedded inside words (ARMY -> RM, Atkinson -> Tk).
const MATCH = new RegExp(
  `(?<![A-Za-z])(?<bi>${BEFORE_IND})\\s?(?<bn>${NUM})(?:\\s?(?<bs>${SCALE_ALT}))?(?![A-Za-z])` +
    `|(?<![A-Za-z0-9])(?<an>${NUM})(?:\\s?(?<as>${SCALE_ALT}))?\\s?(?<ai>${AFTER_IND})(?![A-Za-z])`,
  "gi",
);

// Already-converted block, so a second pass leaves it untouched (idempotency).
const ALREADY = new RegExp(
  `~US\\$\\s?[\\d.,]+\\s*(?:million|billion|thousand|bn|mn|[kmb])?\\s*\\([^)]*\\)`,
  "gi",
);

export interface UsdifyOptions {
  countryHint?: string | null;
}

function hintCurrencies(hint: string | null | undefined): Set<Ccy> {
  const out = new Set<Ccy>();
  if (!hint) return out;
  for (const part of hint.split(/[;,/]|\band\b/i)) {
    const c = COUNTRY_CCY[part.trim().toLowerCase()];
    if (c) out.add(c);
  }
  return out;
}

function resolveCcy(raw: string, hint: string | null | undefined): Ccy | null {
  const k = raw.toLowerCase();
  const direct = DIRECT[k];
  if (direct) return direct;
  const ambig = AMBIG[k];
  if (ambig) {
    const set = hintCurrencies(hint);
    const cand = ambig.filter((c) => set.has(c));
    return cand.length === 1 ? cand[0] : null;
  }
  return null;
}

function roundSig(v: number, sig: number): number {
  if (v === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(v)));
  const power = sig - d;
  const mag = Math.pow(10, power);
  return Math.round(v * mag) / mag;
}

function withCommas(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimNum(n: number): string {
  return Number(n.toFixed(2)).toString();
}

function formatUsd(value: number): string {
  const s = roundSig(value, 2);
  if (s >= 1e9) return `~US$${trimNum(s / 1e9)}bn`;
  if (s >= 1e6) return `~US$${trimNum(s / 1e6)} million`;
  return `~US$${withCommas(s)}`;
}

function convertSegment(seg: string, hint: string | null | undefined): string {
  if (!seg) return seg;
  return seg.replace(MATCH, (match: string, ...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    const indicatorRaw = groups.bi ?? groups.ai;
    const numRaw = groups.bn ?? groups.an;
    const scaleRaw = groups.bs ?? groups.as;
    if (!indicatorRaw || !numRaw) return match;

    const ccy = resolveCcy(indicatorRaw, hint);
    if (!ccy) return match; // unresolved collision -> leave original

    const base = parseFloat(numRaw.replace(/,/g, ""));
    if (!isFinite(base) || base <= 0) return match;
    const mult = scaleRaw ? SCALE[scaleRaw.toLowerCase()] ?? 1 : 1;
    const usd = base * mult * USD_PER[ccy];
    if (!isFinite(usd) || usd <= 0) return match;

    return `${formatUsd(usd)} (${match.trim()})`;
  });
}

// Convert local-currency amounts in `input` to an approximate USD display,
// keeping the original figure in brackets. `countryHint` (the incident's country
// field) disambiguates collision indicators; without it, ambiguous amounts are
// left unchanged. Idempotent.
export function usdifyAmounts(
  input: string | null | undefined,
  opts?: UsdifyOptions,
): string {
  if (input == null) return input as unknown as string;
  if (typeof input !== "string" || input.length === 0) return input;
  const hint = opts?.countryHint ?? null;

  let out = "";
  let last = 0;
  ALREADY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALREADY.exec(input)) !== null) {
    out += convertSegment(input.slice(last, m.index), hint);
    out += m[0]; // pass an already-converted block through untouched
    last = m.index + m[0].length;
    if (m.index === ALREADY.lastIndex) ALREADY.lastIndex++;
  }
  out += convertSegment(input.slice(last), hint);
  return out;
}
