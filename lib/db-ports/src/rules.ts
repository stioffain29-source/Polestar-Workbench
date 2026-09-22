import type {
  DbPortsEdition,
  DbPortsEvidence,
  DbPortsImpactArea,
  DbPortsItem,
  DbPortsItemContent,
  DbPortsParameters,
  DbPortsQuality,
  DbPortsSeverity,
  DbPortsTheme,
  DbPortsWarning,
} from "@workspace/api-client-react";

export const DB_PORTS_MAX_SELECTED = 40;
export const DB_PORTS_MAX_WATCH = 5;
export const DB_PORTS_MAX_ITEMS = 200;
export const DB_PORTS_REPORT_NAME = "Ports and Logistics Intelligence";
export const DB_PORTS_ITEM_MIN_WORDS = 150;
export const DB_PORTS_OVERVIEW_MIN_WORDS = 150;
export const DB_PORTS_OVERVIEW_MAX_WORDS = 250;
export const DB_PORTS_DISCLAIMER =
  "This report is produced by Polestar from open-source and subscription reporting collected during the stated period. " +
  "Source-reported statements and analytical judgments are distinguished; where reporting is incomplete this is stated rather than inferred. " +
  "Assessments describe the reported events and their observed consequences, not the recipient's overall organisational risk.";

export const DB_PORTS_THEMES: DbPortsTheme[] = [
  "security_public_order",
  "personnel_safety",
  "port_terminal_operations",
  "maritime_access",
  "landside_logistics",
  "cargo_asset_security",
  "organised_crime_smuggling",
  "industrial_action",
  "supply_chain_continuity",
  "geopolitical_trade",
  "natural_hazards",
  "regulatory_compliance",
  "critical_infrastructure",
];

const THEME_LABELS: Record<DbPortsTheme, string> = {
  security_public_order: "Security and public order",
  personnel_safety: "Personnel safety",
  port_terminal_operations: "Port and terminal operations",
  maritime_access: "Maritime access",
  landside_logistics: "Landside logistics",
  cargo_asset_security: "Cargo and asset security",
  organised_crime_smuggling: "Organised crime and smuggling",
  industrial_action: "Industrial action",
  supply_chain_continuity: "Supply chain continuity",
  geopolitical_trade: "Geopolitical and trade exposure",
  natural_hazards: "Natural hazards affecting operations",
  regulatory_compliance: "Regulatory and compliance change",
  critical_infrastructure: "Critical infrastructure disruption",
};

/** Legacy pilot themes persisted before the report themes were defined. */
const LEGACY_THEMES: Record<string, DbPortsTheme> = {
  security: "security_public_order",
  cargo: "cargo_asset_security",
  operations: "port_terminal_operations",
  geopolitical: "geopolitical_trade",
  hazards: "natural_hazards",
  regulatory: "regulatory_compliance",
};

export function dbPortsThemeLabel(theme: DbPortsTheme): string {
  return THEME_LABELS[theme] ?? theme;
}

export function canonicalDbPortsTheme(value: unknown): DbPortsTheme {
  if (typeof value !== "string") return "port_terminal_operations";
  if ((DB_PORTS_THEMES as string[]).includes(value)) return value as DbPortsTheme;
  return LEGACY_THEMES[value] ?? "port_terminal_operations";
}

export const DB_PORTS_IMPACT_AREAS: DbPortsImpactArea[] = [
  "personnel",
  "port_operations",
  "cargo_assets",
  "landside_access",
  "maritime_access",
  "supply_chain",
  "compliance",
  "business_continuity",
];

const IMPACT_LABELS: Record<DbPortsImpactArea, string> = {
  personnel: "Personnel",
  port_operations: "Port or terminal operations",
  cargo_assets: "Cargo or assets",
  landside_access: "Landside access",
  maritime_access: "Maritime access",
  supply_chain: "Supply chain continuity",
  compliance: "Regulatory compliance",
  business_continuity: "Business continuity",
};

export function dbPortsImpactLabel(area: DbPortsImpactArea): string {
  return IMPACT_LABELS[area] ?? area;
}

export const DB_PORTS_SEVERITIES: DbPortsSeverity[] = [
  "Insignificant",
  "Low",
  "Moderate",
  "High",
  "Extreme",
];

export function severityRank(severity: DbPortsSeverity | null | undefined): number {
  const index = severity ? DB_PORTS_SEVERITIES.indexOf(severity) : -1;
  return index < 0 ? -1 : index;
}

export const DB_PORTS_COUNTRIES = [
  "Singapore", "Malaysia", "Indonesia", "Philippines", "Thailand", "Vietnam",
  "Cambodia", "Laos", "Myanmar", "Brunei", "Timor-Leste", "China", "Hong Kong",
  "Taiwan", "Japan", "South Korea", "Australia", "New Zealand", "Papua New Guinea",
  "Fiji", "Solomon Islands", "Vanuatu", "Samoa", "Tonga", "Kiribati", "Tuvalu",
  "Nauru", "Micronesia", "Marshall Islands", "Palau", "Cook Islands", "Niue",
] as const;

const ALIASES: Record<string, string> = {
  "viet nam": "Vietnam", "burma": "Myanmar", "republic of korea": "South Korea",
  "korea, republic of": "South Korea", "south korea": "South Korea",
  "east timor": "Timor-Leste", "timor leste": "Timor-Leste",
  "hong kong sar": "Hong Kong", "hong kong, china": "Hong Kong",
  "pr china": "China", "people's republic of china": "China",
  "papua new guinea": "Papua New Guinea", "png": "Papua New Guinea",
  "federated states of micronesia": "Micronesia",
};

export function canonicalDbPortsCountry(value: string): string | null {
  const key = value.trim().toLowerCase();
  return DB_PORTS_COUNTRIES.find(country => country.toLowerCase() === key) ?? ALIASES[key] ?? null;
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function editionWindow(endDate: string): { startDate: string; endDate: string } {
  if (!isCalendarDate(endDate)) throw new Error("Choose a valid reporting period end date.");
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 13);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function isPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}

export function sourceHost(value: string): string {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

/** Hosts that republish other publishers' copy. A story seen only here has not
 * been traced to the publisher that reported it. */
const AGGREGATOR_HOSTS = [
  "news.google.com", "google.com", "msn.com", "news.yahoo.com", "yahoo.com",
  "flipboard.com", "smartnews.com", "newsbreak.com", "biztoc.com", "headtopics.com",
  "menafn.com", "zerohedge.com", "onenewspage.com", "eturbonews.com",
];

export function isAggregatorSource(evidence: Pick<DbPortsEvidence, "sourceUrl" | "sourceType">): boolean {
  if (evidence.sourceType === "discovery") return true;
  const host = sourceHost(evidence.sourceUrl);
  return !!host && AGGREGATOR_HOSTS.some(known => host === known || host.endsWith(`.${known}`));
}

export function usableEvidence(evidence: DbPortsEvidence): boolean {
  return !!evidence.sourceName.trim() && isPublicSourceUrl(evidence.sourceUrl);
}

export function evidenceDate(evidence: DbPortsEvidence): string | null {
  if (evidence.publishedDate && isCalendarDate(evidence.publishedDate)) return evidence.publishedDate;
  if (evidence.sourceDate && isCalendarDate(evidence.sourceDate)) return evidence.sourceDate;
  return null;
}

const ROUTINE =
  /\b(?:annual\s+(?:report|results)|quarterly\s+(?:results|earnings)|(?:container\s+)?throughput\s+(?:rose|grew|up|climbed)|new\s+(?:cruise\s+ship|service\s+launch)|port\s+anniversary|memorandum\s+of\s+understanding|award(?:ed)?\s+(?:for|to)\s+excellence|groundbreaking\s+ceremony|signing\s+ceremony)\b/i;
const ACTUAL_DISRUPTION =
  /\b(?:clos(?:ure|ed|ing)|suspend(?:ed|s|sion)|halt(?:ed|s)?|strike|walkout|stoppage|block(?:ed|ade|ading)|attack(?:ed|s)?|theft|stolen|robber|fire|explosion|outage|restrict(?:ion|ed)|evacuat|cyber|ransomware|sanction|embargo|ban(?:ned)?|detain|seiz(?:e|ed|ure)|damag|contaminat|congestion|backlog|delay|diver(?:t|sion)|curfew|protest|unrest|collision|grounding|capsiz|spill|typhoon|cyclone|earthquake|flood|landslide|tsunami|quarantine|inspection\s+regime|tariff|export\s+control)\w*/i;

/** Regions and subjects the default preset excludes. Matched against the item's
 * own text, never inferred from a publisher's location. */
export function matchesExclusion(text: string, exclusions: string[]): string | null {
  const haystack = text.toLowerCase();
  for (const raw of exclusions) {
    const term = raw.trim().toLowerCase();
    if (term.length < 3) continue;
    const pattern = new RegExp(`(?:^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\p{L}]|$)`, "iu");
    if (pattern.test(haystack)) return raw.trim();
  }
  return null;
}

function warning(code: DbPortsWarning["code"], message: string): DbPortsWarning {
  return { code, message };
}

export function itemWordCount(item: DbPortsItemContent): number {
  return wordCount(`${item.summary} ${item.operationalImpact} ${item.polestarView} ${item.outlook}`);
}

/** Editor-only warnings. Nothing here blocks saving, generating or exporting:
 * the analyst decides, and the customer export never shows these. */
export function assessDbPortsItem(
  item: DbPortsItemContent,
  window: { startDate: string; endDate: string },
  parameters?: DbPortsParameters,
): DbPortsWarning[] {
  const warnings: DbPortsWarning[] = [];
  const isWatch = item.disposition === "watch";
  const text = `${item.headline} ${item.summary} ${item.unverifiedClaims} ${item.location} ${item.country}`;
  const sources = item.evidence.filter(usableEvidence);

  if (!sources.length) {
    warnings.push(warning("missing_source", "No source with a usable hyperlink is attached."));
  } else if (!sources.some(entry => evidenceDate(entry))) {
    warnings.push(warning("missing_source", "No source carries a publication date."));
  }
  if (!item.eventDate || !isCalendarDate(item.eventDate)) {
    warnings.push(warning("missing_event_date", "The event date is missing or not a valid date."));
  } else if (item.eventDate > window.endDate) {
    warnings.push(warning("missing_event_date", "The event date falls after the reporting period."));
  }
  if (!item.location.trim() && !item.assets.some(value => value.trim())) {
    warnings.push(warning("missing_location", "No port, terminal, corridor or operating location is identified."));
  }

  const weak =
    !item.impactAreas.length ||
    !item.operationalImpact.trim() ||
    !item.materialityReason.trim() ||
    (ROUTINE.test(item.headline) && !ACTUAL_DISRUPTION.test(text));
  if (weak && !isWatch) {
    warnings.push(warning("weak_operational_connection", "The operational consequence is not established for a named function."));
  }

  const publishers = new Set(sources.filter(entry => !isAggregatorSource(entry)).map(entry => sourceHost(entry.sourceUrl)).filter(Boolean));
  if (sources.length && publishers.size < 2) {
    warnings.push(warning("single_source", "Only one independent publisher supports this item."));
  }
  if (sources.length && sources.every(isAggregatorSource)) {
    warnings.push(warning("aggregator_only", "Every attached source is an aggregator or discovery record."));
  }

  const country = canonicalDbPortsCountry(item.country);
  const included = parameters?.includedCountries.length ? parameters.includedCountries : null;
  if (!country) {
    warnings.push(warning("excluded_geography", "The geography is outside APAC and Oceania or has not been resolved."));
  } else if (included && !included.includes(country)) {
    warnings.push(warning("excluded_geography", `${country} is outside the configured geography.`));
  }
  const excluded = matchesExclusion(text, [
    ...(parameters?.excludedRegions ?? []),
    ...(parameters?.excludedSubjects ?? []),
  ]);
  if (excluded) {
    warnings.push(warning("excluded_geography", `The item matches the excluded term "${excluded}".`));
  }

  if (!isWatch) {
    const words = itemWordCount(item);
    const max = parameters?.itemWordTarget ?? 225;
    if (words && (words < DB_PORTS_ITEM_MIN_WORDS || words > max)) {
      warnings.push(warning("item_length", `The item runs to ${words} words; the target band is ${DB_PORTS_ITEM_MIN_WORDS}–${max}.`));
    }
  }
  return warnings;
}

function duplicateKey(value: string): Set<string> {
  return new Set(
    value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")
      .filter(token => token.length >= 4),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Flags items that look like the same event told twice. Detection is advisory;
 * merging stays an analyst action so corroboration is never silently dropped. */
export function flagDuplicates(items: DbPortsItem[]): DbPortsItem[] {
  const active = items.filter(item => !item.mergedInto && item.disposition !== "rejected");
  const keys = new Map(active.map(item => [item.id, duplicateKey(`${item.headline} ${item.location}`)]));
  const hosts = new Map(
    active.map(item => [item.id, new Set(item.evidence.map(entry => sourceHost(entry.sourceUrl)).filter(Boolean))]),
  );
  const duplicated = new Set<string>();
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i]!;
      const right = active[j]!;
      if (left.country !== right.country) continue;
      const sameUrl = [...(hosts.get(left.id) ?? [])].some(host => hosts.get(right.id)?.has(host)) &&
        left.evidence.some(a => right.evidence.some(b => a.sourceUrl === b.sourceUrl));
      if (sameUrl || overlap(keys.get(left.id)!, keys.get(right.id)!) >= 0.6) {
        duplicated.add(left.id);
        duplicated.add(right.id);
      }
    }
  }
  return items.map(item =>
    duplicated.has(item.id) && !item.warnings.some(entry => entry.code === "possible_duplicate")
      ? { ...item, warnings: [...item.warnings, warning("possible_duplicate", "Another item in this edition describes a closely similar event.")] }
      : item);
}

// The report standard forbids calling anything the highest severity, whoever
// wrote the words. The check runs on the customer-facing text only.
const BANNED_REPORT_WORDING = /\bhighest[\s-]+severity\b/i;

/** Returns the banned phrase found in customer-facing text, or null. */
export function findDbPortsBannedWording(text: string): string | null {
  return BANNED_REPORT_WORDING.exec(text)?.[0] ?? null;
}

function customerText(item: DbPortsItem): string {
  return [
    item.headline, item.location, item.summary, item.operationalImpact,
    item.polestarView, item.outlook, item.materialityReason,
  ].join(" ");
}

export function buildDbPortsQuality(
  edition: Pick<DbPortsEdition, "overview" | "items" | "coverage" | "parameters"> & { title?: string },
): DbPortsQuality {
  const active = edition.items.filter(item => !item.mergedInto);
  const selected = active.filter(item => item.disposition === "selected");
  const watch = active.filter(item => item.disposition === "watch");
  const warnings: string[] = [];
  const words = wordCount(edition.overview);
  // The configured overview length is the ceiling the editor counter shows and
  // the generator writes to, held inside the report standard of 150–250.
  const overviewMax = Math.min(
    Math.max(edition.parameters.overviewWordTarget, DB_PORTS_OVERVIEW_MIN_WORDS),
    DB_PORTS_OVERVIEW_MAX_WORDS,
  );
  if (edition.overview.trim() && (words < DB_PORTS_OVERVIEW_MIN_WORDS || words > overviewMax)) {
    warnings.push(`The Regional Overview runs to ${words} words; the configured length is ${DB_PORTS_OVERVIEW_MIN_WORDS}–${overviewMax}.`);
  }
  if (!selected.length) {
    warnings.push("No priority item has been selected yet.");
  } else if (selected.length < edition.parameters.targetItems) {
    warnings.push(`${selected.length} of ${edition.parameters.targetItems} priority items are selected. A shorter report is preferable to padding.`);
  }
  if (watch.length > DB_PORTS_MAX_WATCH) {
    warnings.push(`The Watchlist holds ${watch.length} entries; the report allows five.`);
  }
  const banned = new Set<string>();
  const documentText = [
    edition.overview, edition.title ?? "",
    edition.parameters.reportTitle, edition.parameters.customerName,
  ].join(" ");
  for (const phrase of [findDbPortsBannedWording(documentText)]) if (phrase) banned.add(phrase.toLowerCase());
  for (const item of [...selected, ...watch]) {
    const phrase = findDbPortsBannedWording(customerText(item));
    if (phrase) banned.add(phrase.toLowerCase());
  }
  if (banned.size) {
    warnings.push(`The report text uses wording the report standard forbids (${[...banned].map(phrase => `"${phrase}"`).join(", ")}). Word and PDF export is blocked until it is rewritten.`);
  }
  const sourceFailures = edition.coverage.filter(check => check.status === "unavailable").length;
  if (sourceFailures) {
    warnings.push(`${sourceFailures} source check(s) were unavailable; that is a coverage gap, not evidence of no events.`);
  }
  return {
    warnings,
    selectedCount: selected.length,
    watchCount: watch.length,
    heldCount: active.filter(item => item.disposition === "hold").length,
    inboxCount: active.filter(item => item.disposition === "inbox").length,
    rejectedCount: edition.items.filter(item => item.disposition === "rejected").length,
    itemWarningCount: [...selected, ...watch].reduce((sum, item) => sum + item.warnings.length, 0),
    sourceFailures,
  };
}

export function emptyDbPortsItem(): DbPortsItemContent {
  return {
    headline: "", country: "", location: "", assets: [], eventDate: null,
    theme: "port_terminal_operations", disposition: "inbox", severity: null, confidence: "unverified",
    summary: "", unverifiedClaims: "", operationalImpact: "", polestarView: "", outlook: "",
    materialityReason: "", impactAreas: [], missingInfo: "", analystNotes: "", evidence: [],
  };
}
