// The single cargo grouping / clustering authority — pure, no schema, no fabrication.
//
// Takes the already-windowed, topic-filtered cargo incidents and:
//   1. Clusters corroborating reports of the SAME event (conservative + deterministic),
//   2. Enriches each cluster's primary row via cargoEnrichment (cluster size feeds
//      confidence),
//   3. Regroups the clusters into ordered sections:
//        severe_high -> cargo_security_land -> port_related -> watch_items -> new_updated
//      carrying a primary + supporting source links per cluster.
//
// All three surfaces (monitor, report preview, report PDF) CONSUME this so their
// groupings, labels, confidence, status and source links can never disagree. The
// report preview and PDF additionally render these sections in the SAME order.
//
// Clustering is intentionally conservative: two reports only merge when they share
// category, group, country and port AND their significant title tokens overlap AND
// they fall within a short date window. Distinct events never collapse together.

import {
  classifyCargoCategory,
  cargoCategoryGroup,
  cargoCountry,
  recoverCargoPortName,
  type CargoIncidentLike,
  type CargoCategoryGroup,
} from "./cargoAnalysis";
import { significantTitleTokens } from "./relatedIncidents";
import { SEV_RANK, sevKey } from "./pdfChrome";
import {
  enrichCargoIncident,
  isAuthoritativeSource,
  displayCargoField,
  type CargoEnrichment,
  type CargoEnrichmentInput,
} from "./cargoEnrichment";

export interface CargoClusterInput extends CargoEnrichmentInput {
  id?: string | number;
  topic?: string;
  occurredAt: string;
}

export type CargoSectionKey =
  | "severe_high"
  | "cargo_security_land"
  | "port_related"
  | "watch_items"
  | "new_updated";

export interface CargoSourceLink {
  source: string | null;
  url: string | null;
}

export interface CargoIncidentCluster {
  id: string;
  title: string;
  primary: CargoClusterInput;
  supporting: CargoClusterInput[];
  sourceLinks: CargoSourceLink[];
  clusterSize: number;
  enrichment: CargoEnrichment;
  /** Highest stored severity rank (1-5) across the cluster. */
  maxSeverityRank: number;
  latestOccurredAt: string;
  /** The mutually-exclusive partition this cluster belongs to. */
  partition: "severe_high" | "cargo_security_land" | "port_related";
}

export interface CargoGroupedSection {
  key: CargoSectionKey;
  title: string;
  clusters: CargoIncidentCluster[];
}

export interface CargoGroupedDataset {
  clusters: CargoIncidentCluster[];
  sections: CargoGroupedSection[];
  /** De-duplicated recommended watch-item actions, in severity order. */
  watchItems: string[];
}

export interface CargoGroupedOptions {
  /** Reference "now" for status recency (report issue date / current date). */
  referenceDate?: string | Date | null;
  /** Max clusters retained per section (preview == PDF use the same cap). */
  limit?: number;
}

const SECTION_TITLES: Record<CargoSectionKey, string> = {
  severe_high: "Severe & High-Severity Clusters",
  cargo_security_land: "Land-Side Cargo Security",
  port_related: "Port-Related Cargo Security",
  watch_items: "Recommended Watch Items",
  new_updated: "New & Updated This Period",
};

const SECTION_ORDER: CargoSectionKey[] = [
  "severe_high",
  "cargo_security_land",
  "port_related",
  "watch_items",
  "new_updated",
];

// --- Clustering -----------------------------------------------------------

interface Tagged {
  inc: CargoClusterInput;
  tokens: Set<string>;
  category: string;
  group: CargoCategoryGroup;
  country: string | null;
  port: string | null;
  rank: number;
  time: number;
}

function severityRank(i: CargoIncidentLike & { severity?: string | null }): number {
  const r = SEV_RANK[sevKey(i.severity)];
  return r ?? 1;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// A coarse, stable key used only to BUCKET candidates cheaply before the precise
// token/date check — never the sole merge decision.
export function cargoClusterKey(i: CargoClusterInput): string {
  const category = classifyCargoCategory(i);
  const group = cargoCategoryGroup(category);
  const country = (cargoCountry(i) ?? "").toLowerCase();
  const port = (recoverCargoPortName(i)?.port ?? "").toLowerCase();
  return `${group}::${category}::${country}::${port}`;
}

const CLUSTER_DAY_WINDOW = 3;
const CLUSTER_JACCARD_MIN = 0.5;

function sameEvent(a: Tagged, b: Tagged): boolean {
  if (a.category !== b.category) return false;
  if (a.group !== b.group) return false;
  // Conflicting countries (incl. one attributed, one null) never merge.
  if ((a.country ?? null) !== (b.country ?? null)) return false;
  // Conflicting named ports never merge (both-null is allowed).
  if ((a.port ?? null) !== (b.port ?? null)) return false;
  if (Math.abs(a.time - b.time) > CLUSTER_DAY_WINDOW * 86_400_000) return false;
  return jaccard(a.tokens, b.tokens) >= CLUSTER_JACCARD_MIN;
}

function tag(inc: CargoClusterInput): Tagged {
  const category = classifyCargoCategory(inc);
  const t = new Date(inc.occurredAt).getTime();
  return {
    inc,
    tokens: new Set(significantTitleTokens(`${inc.title} ${inc.summary ?? ""}`)),
    category,
    group: cargoCategoryGroup(category),
    country: cargoCountry(inc),
    port: recoverCargoPortName(inc)?.port ?? null,
    rank: severityRank(inc),
    time: isNaN(t) ? 0 : t,
  };
}

// Primary precedence: highest severity, then an authoritative source, then the
// most recent report. Deterministic ties broken by title then id.
function pickPrimary(members: CargoClusterInput[]): CargoClusterInput {
  return [...members].sort((x, y) => {
    const rs = severityRank(y) - severityRank(x);
    if (rs !== 0) return rs;
    const as = Number(isAuthoritativeSource(y)) - Number(isAuthoritativeSource(x));
    if (as !== 0) return as;
    const td = new Date(y.occurredAt).getTime() - new Date(x.occurredAt).getTime();
    if (td !== 0) return td;
    const tc = (x.title ?? "").localeCompare(y.title ?? "");
    if (tc !== 0) return tc;
    return String(x.id ?? "").localeCompare(String(y.id ?? ""));
  })[0];
}

function dedupeSourceLinks(members: CargoClusterInput[]): CargoSourceLink[] {
  const seen = new Set<string>();
  const out: CargoSourceLink[] = [];
  for (const m of members) {
    const url = m.sourceUrl ?? null;
    const source = m.source ?? null;
    const key = `${source ?? ""}|${url ?? ""}`;
    if (key === "|" || seen.has(key)) continue;
    seen.add(key);
    out.push({ source, url });
  }
  return out;
}

function partitionOf(
  rank: number,
  group: CargoCategoryGroup,
): CargoIncidentCluster["partition"] {
  if (rank >= 4) return "severe_high";
  return group === "port" ? "port_related" : "cargo_security_land";
}

// --- Top-level builder ----------------------------------------------------

export function buildCargoGroupedDataset(
  incidents: CargoClusterInput[],
  opts: CargoGroupedOptions = {},
): CargoGroupedDataset {
  const limit = opts.limit ?? 8;
  const tagged = incidents
    .filter((i) => i && i.title)
    .map(tag)
    // Newest first so a cluster's primary defaults to the latest framing.
    .sort((a, b) => b.time - a.time);

  // Greedy conservative clustering, bucketed by the coarse key.
  const buckets = new Map<string, Tagged[][]>();
  const order: Tagged[][] = [];
  for (const item of tagged) {
    const key = `${item.group}::${item.category}::${item.country ?? ""}::${item.port ?? ""}`;
    const groups = buckets.get(key) ?? [];
    let placed = false;
    for (const g of groups) {
      if (sameEvent(item, g[0])) {
        g.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const g = [item];
      groups.push(g);
      order.push(g);
      buckets.set(key, groups);
    }
  }

  const clusters: CargoIncidentCluster[] = order.map((g) => {
    const members = g.map((t) => t.inc);
    const primary = pickPrimary(members);
    const supporting = members.filter((m) => m !== primary);
    const maxSeverityRank = Math.max(...g.map((t) => t.rank));
    const latestOccurredAt = members
      .map((m) => m.occurredAt)
      .sort()
      .slice(-1)[0];
    const enrichment = enrichCargoIncident(primary, {
      clusterSize: members.length,
      referenceDate: opts.referenceDate ?? null,
    });
    return {
      id: String(primary.id ?? cargoClusterKey(primary)),
      title: primary.title,
      primary,
      supporting,
      sourceLinks: dedupeSourceLinks([primary, ...supporting]),
      clusterSize: members.length,
      enrichment,
      maxSeverityRank,
      latestOccurredAt,
      partition: partitionOf(maxSeverityRank, cargoCategoryGroup(classifyCargoCategory(primary))),
    };
  });

  // Stable cluster sort: severity desc, then most recent.
  const byImpact = (a: CargoIncidentCluster, b: CargoIncidentCluster) => {
    const rs = b.maxSeverityRank - a.maxSeverityRank;
    if (rs !== 0) return rs;
    return (b.latestOccurredAt ?? "").localeCompare(a.latestOccurredAt ?? "");
  };
  const byDate = (a: CargoIncidentCluster, b: CargoIncidentCluster) =>
    (b.latestOccurredAt ?? "").localeCompare(a.latestOccurredAt ?? "");

  const inPartition = (p: CargoIncidentCluster["partition"]) =>
    clusters.filter((c) => c.partition === p);

  const sectionFor = (key: CargoSectionKey): CargoIncidentCluster[] => {
    switch (key) {
      case "severe_high":
        return inPartition("severe_high").sort(byImpact).slice(0, limit);
      case "cargo_security_land":
        return inPartition("cargo_security_land").sort(byImpact).slice(0, limit);
      case "port_related":
        return inPartition("port_related").sort(byImpact).slice(0, limit);
      case "watch_items":
        return clusters
          .filter((c) => c.enrichment.watchItem != null)
          .sort(byImpact)
          .slice(0, limit);
      case "new_updated":
        return clusters
          .filter(
            (c) => c.enrichment.status === "New" || c.enrichment.status === "Updated",
          )
          .sort(byDate)
          .slice(0, limit);
    }
  };

  const sections: CargoGroupedSection[] = SECTION_ORDER.map((key) => ({
    key,
    title: SECTION_TITLES[key],
    clusters: sectionFor(key),
  }));

  // De-duped watch items in severity order (drives the Watch Items list).
  const watchItems: string[] = [];
  const seenWatch = new Set<string>();
  for (const c of [...clusters].sort(byImpact)) {
    const w = c.enrichment.watchItem;
    if (w && !seenWatch.has(w)) {
      seenWatch.add(w);
      watchItems.push(w);
    }
  }

  return { clusters, sections, watchItems };
}

// --- Shared report-render formatters --------------------------------------
// The report preview AND the PDF render the cluster sections from THESE so their
// per-cluster text is byte-identical. ASCII separators only (PDF-sanitize safe).

// The cluster sections the REPORT renders as tables, in this fixed order. The
// monitor consumes the full `sections` array (incl. watch_items + new_updated).
export const REPORT_CLUSTER_SECTION_KEYS: CargoSectionKey[] = [
  "severe_high",
  "cargo_security_land",
  "port_related",
];

export function cargoClusterLocationLabel(c: CargoIncidentCluster): string {
  const base = displayCargoField(c.enrichment.portLocation);
  if (c.enrichment.portLocation && c.enrichment.locationApproximate) {
    return `${base} (approx.)`;
  }
  return base;
}

export function cargoClusterDetailLine(c: CargoIncidentCluster): string {
  const e = c.enrichment;
  return [
    `Cargo: ${displayCargoField(e.cargoType)}`,
    `Vessel: ${displayCargoField(e.vessel)}`,
    `Company: ${displayCargoField(e.company)}`,
    `Time: ${displayCargoField(e.incidentTime)}`,
  ].join(" | ");
}

export function cargoClusterSourceLabel(c: CargoIncidentCluster): string {
  const n = c.sourceLinks.length;
  return n === 1 ? "1 source" : `${n} sources`;
}

const RANK_TO_SEV_KEY: Record<number, string> = {
  1: "insignificant",
  2: "low",
  3: "moderate",
  4: "high",
  5: "extreme",
};

// The cluster's worst stored severity, as a ramp key for SEV_LABEL / SEV_COLOR.
// Both report surfaces colour the chip from THIS so they cannot diverge.
export function cargoClusterSeverityKey(c: CargoIncidentCluster): string {
  return RANK_TO_SEV_KEY[c.maxSeverityRank] ?? "low";
}
