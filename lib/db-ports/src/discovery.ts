import type { DbPortsItem, DbPortsItemContent, DbPortsWatchTarget } from "@workspace/api-client-react";
import { assessDbPortsItem, canonicalDbPortsCountry, DB_PORTS_MAX_ITEMS, emptyDbPortsItem, isPublicSourceUrl } from "./rules.js";

export type DbPortsDiscoveryRow = {
  id: string;
  title: string;
  summary: string;
  country: string;
  location: string;
  sourceName: string;
  sourceUrl: string;
  sourceDate: string | null;
  eventDate: string | null;
  clusterKey?: string | null;
};

const PORT_CONTEXT = /\b(?:ports?|terminals?|harbou?rs?|cargo|freight|container(?:s|ized)?|stevedores?|dockworkers?|dockers?|shipping\s+lane|anchorage|strait|customs|warehouses?|logistics|pelabuhan|bongkar\s+muat|kapal|gudang)\b|港口|碼頭|码头|貨物|货物|港湾|항만|화물/i;
/** PostgreSQL uses \y, not JavaScript's \b, for a word boundary. Keep the
 * bounded database prefilter in lockstep with multilingual admission. */
export const DB_PORTS_DISCOVERY_SQL_PATTERN = PORT_CONTEXT.source.replace(/\\b/g, "\\y");
const HARD_EXCLUDED = /\b(?:red\s+sea|houthi(?:s)?|bab[\s-]+el[\s-]+mandeb)\b/i;
const SPORT = /\b(?:football|cricket|rugby|premier\s+league|champions\s+league|world\s+cup|nrl|afl|goalkeeper|striker)\b/i;

export function canonicalSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch { return raw.trim(); }
}

function titleKey(title: string, country: string): string {
  return `${country}|${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
}

export function themeFor(text: string): DbPortsItemContent["theme"] {
  if (/\b(?:strike|walkout|work\s+stoppage|industrial\s+action|union\s+action|picket)\w*/i.test(text)) return "industrial_action";
  if (/\b(?:smuggl|trafficking|contraband|narcotics|syndicate|organised\s+crime)\w*/i.test(text)) return "organised_crime_smuggling";
  if (/\b(?:theft|stolen|robber|hijack|cargo\s+crime|pilferage)\w*/i.test(text)) return "cargo_asset_security";
  if (/\b(?:customs|sanction|regulat|export\s+(?:ban|control)|tariff|trade\s+restriction|compliance)\w*/i.test(text)) return "regulatory_compliance";
  if (/\b(?:typhoon|cyclone|storm|earthquake|flood|tsunami|landslide|volcan|heatwave)\w*/i.test(text)) return "natural_hazards";
  if (/\b(?:cyber|ransomware|power\s+(?:cut|outage)|grid|blackout|pipeline|telecom|undersea\s+cable)\w*/i.test(text)) return "critical_infrastructure";
  if (/\b(?:military|naval|geopolit|blockade|territorial|incursion|maritime\s+dispute)\w*/i.test(text)) return "geopolitical_trade";
  if (/\b(?:piracy|boarding|armed|attack|bomb|shooting|unrest|riot|protest)\w*/i.test(text)) return "security_public_order";
  if (/\b(?:injur|fatalit|killed|died|death|crush|fell|overboard|worker\s+safety)\w*/i.test(text)) return "personnel_safety";
  if (/\b(?:channel|anchorage|draft\s+restriction|dredg|lock|canal|strait\s+transit|navigation)\w*/i.test(text)) return "maritime_access";
  if (/\b(?:truck|rail|road|highway|haulage|drayage|warehouse|inland\s+depot)\w*/i.test(text)) return "landside_logistics";
  if (/\b(?:shortage|supply\s+chain|backlog|lead\s+time|inventory|capacity\s+crunch)\w*/i.test(text)) return "supply_chain_continuity";
  return "port_terminal_operations";
}

/** Read-only discovery screening. It never upgrades an upstream headline,
 * source date, severity or summary into an analyst-verified assertion. */
export function importDbPortsDiscovery(
  rows: DbPortsDiscoveryRow[],
  previous: DbPortsItem[],
  window: { startDate: string; endDate: string },
  watchlist: DbPortsWatchTarget[],
  nowIso: string,
): { items: DbPortsItem[]; scanned: number; added: number; duplicates: number; truncated: boolean } {
  const items = previous.map(item => ({ ...item, evidence: [...item.evidence] }));
  const recordIds = new Set(items.flatMap(item => item.evidence.map(e => e.sourceRecord).filter(Boolean)));
  const byUrl = new Map<string, number>();
  const byTitle = new Map<string, number>();
  const byCluster = new Map<string, number>();
  const byRecord = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.mergedInto) return;
    for (const evidence of item.evidence) {
      byUrl.set(`${item.country}|${canonicalSourceUrl(evidence.sourceUrl)}`, index);
      if (evidence.sourceRecord) byRecord.set(evidence.sourceRecord, index);
    }
    if (item.headline.length >= 40) byTitle.set(titleKey(item.headline, item.country), index);
  });
  let added = 0;
  let duplicates = 0;
  let truncated = rows.length > 4_000;
  const bounded = rows.slice(0, 4_000);
  // Rebuild explicit cluster links from the current persisted source snapshot
  // before skipping records already imported in an earlier collection pass.
  for (const row of bounded) {
    const existingIndex = byRecord.get(row.id);
    const country = canonicalDbPortsCountry(row.country);
    if (row.clusterKey && existingIndex !== undefined && country === items[existingIndex]!.country) {
      byCluster.set(`${country}|${row.clusterKey}`, existingIndex);
    }
  }
  for (const row of bounded) {
    if (recordIds.has(row.id)) { duplicates += 1; continue; }
    if (!row.sourceDate || row.sourceDate < window.startDate || row.sourceDate > window.endDate) continue;
    if (!isPublicSourceUrl(row.sourceUrl)) continue;
    const text = `${row.title} ${row.summary} ${row.location}`;
    if (!PORT_CONTEXT.test(text) || HARD_EXCLUDED.test(text) || SPORT.test(row.title)) continue;
    const country = canonicalDbPortsCountry(row.country);
    // Unknown and multi-theatre locations remain outside automatic admission.
    // An analyst can add one manually after resolving the source geography.
    if (!country) continue;
    const relevantTargets = watchlist.filter(target => target.active && target.country === country &&
      [target.name, ...target.aliases].some(alias => alias.length >= 4 && text.toLowerCase().includes(alias.toLowerCase())));
    const key = canonicalSourceUrl(row.sourceUrl);
    const title = titleKey(row.title, country);
    const cluster = row.clusterKey ? `${country}|${row.clusterKey}` : null;
    const duplicateIndex = byUrl.get(`${country}|${key}`) ?? (cluster ? byCluster.get(cluster) : undefined) ??
      (row.title.length >= 40 ? byTitle.get(title) : undefined);
    const sourceId = row.id.replace(/[^a-z0-9_-]/gi, "-");
    const evidence = {
      id: `evidence-${sourceId}`, sourceName: row.sourceName || "Publisher not identified",
      sourceUrl: row.sourceUrl, sourceType: "discovery" as const, publishedDate: null,
      sourceDate: row.sourceDate, retrievedAt: nowIso, excerpt: "",
      originalTitle: row.title.slice(0, 1000), sourceRecord: row.id, verified: false,
    };
    if (duplicateIndex !== undefined) {
      duplicates += 1;
      const existing = items[duplicateIndex]!;
      if (!existing.evidence.some(e => canonicalSourceUrl(e.sourceUrl) === key)) {
        if (existing.evidence.length >= 12) { truncated = true; continue; }
        existing.evidence.push(evidence);
        existing.confidence = "unverified";
        if (existing.disposition === "selected") existing.disposition = "hold";
        existing.updatedAt = nowIso;
        existing.warnings = assessDbPortsItem(existing, window);
      }
      recordIds.add(row.id);
      byUrl.set(`${country}|${key}`, duplicateIndex);
      if (cluster) byCluster.set(cluster, duplicateIndex);
      continue;
    }
    if (items.length >= DB_PORTS_MAX_ITEMS) { truncated = true; continue; }
    const content: DbPortsItemContent = {
      ...emptyDbPortsItem(), headline: row.title.slice(0, 500), country,
      location: row.location, assets: relevantTargets.map(target => target.name),
      eventDate: row.eventDate, theme: themeFor(text),
      // A stored summary is discovery material, not a verified fact.
      unverifiedClaims: (row.summary || row.title).slice(0, 4000),
      missingInfo: "Check the original publisher, publication and event dates, affected asset, operating consequence and any corroboration. The stored source date is not a verified publication date.",
      evidence: [evidence],
    };
    const item: DbPortsItem = {
      ...content, id: `candidate-${sourceId}`, mergedInto: null, updatedAt: nowIso,
      drafted: false, warnings: assessDbPortsItem(content, window),
    };
    const index = items.length;
    items.push(item);
    recordIds.add(row.id);
    byUrl.set(`${country}|${key}`, index);
    if (row.title.length >= 40) byTitle.set(title, index);
    if (cluster) byCluster.set(cluster, index);
    added += 1;
  }
  return { items, scanned: bounded.length, added, duplicates, truncated };
}