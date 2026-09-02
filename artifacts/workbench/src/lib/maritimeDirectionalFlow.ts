// Shared directional-flow model for the Red Sea crossings panel.
//
// HONESTY CONTRACT
//   * inbound / outbound are a directional split of each LIVE AIS sample by the
//     vessel's heading (course-over-ground relative to the gateway's reference
//     bearing) — they are NOT a count of completed transits. We therefore only
//     ever label this "directional flow" / "by heading", never "N ships
//     crossed".
//   * A sample only contributes a bar group when the ingest actually observed a
//     direction split (both inbound and outbound are non-null). A sample where
//     direction could not be derived is dropped — it is never drawn as a
//     fabricated zero.
//   * Suez Canal has no history until its first live sample lands; the gateway
//     then carries an honest empty state rather than an invented baseline.
//
// This module is PURE so the Shipping monitor, the Shipping Watch report preview
// and the headless PDF exporter all build the exact same series from the same
// rows — screen == preview == PDF by construction.

import { parseISO } from "date-fns";

import type { MaritimeMovement } from "@workspace/api-client-react";

// The two Red Sea gateways, in geographic order (south gate first). The theatre
// strings MUST match the ingest AIS_THEATRES / BOARD_CHOKEPOINTS names exactly
// so the per-theatre movement query resolves.
export const RED_SEA_GATEWAYS = [
  { theatre: "Bab el-Mandeb", gate: "South gate" },
  { theatre: "Suez Canal", gate: "North gate" },
] as const;

export type RedSeaGateway = (typeof RED_SEA_GATEWAYS)[number];

// One AIS sample: a directional split observed at a point in time.
export interface DirectionalFlowPoint {
  /** ISO timestamp (dataAsOf) the sample is anchored to — used for sort/keys. */
  iso: string;
  /** Short human label for the bar group ("d MMM", or "d MMM HH:mm" intraday). */
  label: string;
  inbound: number;
  outbound: number;
}

export interface GatewayFlowSeries {
  theatre: string;
  gate: string;
  /** Samples in ascending time order; empty when no directional sample exists. */
  points: DirectionalFlowPoint[];
  totalInbound: number;
  totalOutbound: number;
  /** Distinct vessels in the latest sample's directional split, for context. */
  latestSampleTotal: number | null;
  hasData: boolean;
}

// Display constants — single source so monitor, preview and PDF read identically.
export const DIRECTIONAL_FLOW_TITLE = "Red Sea Directional Flow";
export const DIRECTIONAL_FLOW_CAPTION =
  "Inbound vs outbound vessels by heading across the Red Sea's two gateways, over live AIS samples.";
export const DIRECTIONAL_FLOW_DISCLAIMER =
  "Directional flow is the heading split of each live AIS sample (course relative to the gateway), not a count of completed transits. Vessel movement is context only — it never counts as an incident and never raises the risk level on its own.";
export const INBOUND_LABEL = "Inbound";
export const OUTBOUND_LABEL = "Outbound";

export function gatewayEmptyState(gate: string): string {
  return `No directional AIS samples yet for this gateway (${gate.toLowerCase()}). Bars populate automatically once the live feed reports a heading split here.`;
}

function safeTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayLabel(iso: string): string {
  try {
    const d = parseISO(iso);
    return `${d.getUTCDate()} ${UTC_MONTHS[d.getUTCMonth()]}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function dayTimeLabel(iso: string): string {
  try {
    const d = parseISO(iso);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${d.getUTCDate()} ${UTC_MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

/**
 * Build the directional-flow series for ONE gateway from its movement rows.
 * Rows for other theatres are ignored. Only samples that carry an observed
 * direction split (both counts non-null) become bar groups; everything else is
 * dropped so an unobserved sample is never drawn as a zero. Labels collapse to a
 * date, upgrading to date+time only when two samples share a calendar day.
 */
export function buildGatewayFlow(
  rows: MaritimeMovement[],
  theatre: string,
  gate: string,
): GatewayFlowSeries {
  const samples = rows
    .filter(
      (r) =>
        r.theatre === theatre &&
        r.inboundCount != null &&
        r.outboundCount != null,
    )
    .sort((a, b) => safeTime(a.dataAsOf) - safeTime(b.dataAsOf));

  const dayLabels = samples.map((r) => dayLabel(r.dataAsOf));
  const hasDayCollision = new Set(dayLabels).size !== dayLabels.length;

  const points: DirectionalFlowPoint[] = samples.map((r) => ({
    iso: r.dataAsOf,
    label: hasDayCollision ? dayTimeLabel(r.dataAsOf) : dayLabel(r.dataAsOf),
    inbound: r.inboundCount as number,
    outbound: r.outboundCount as number,
  }));

  const totalInbound = points.reduce((s, p) => s + p.inbound, 0);
  const totalOutbound = points.reduce((s, p) => s + p.outbound, 0);
  const latest = points[points.length - 1] ?? null;

  return {
    theatre,
    gate,
    points,
    totalInbound,
    totalOutbound,
    latestSampleTotal: latest ? latest.inbound + latest.outbound : null,
    hasData: points.length > 0,
  };
}

/**
 * Build both Red Sea gateway series, in geographic order, from one pool of
 * movement rows (each gateway self-filters by theatre name). Callers may pass a
 * combined list or per-theatre lists concatenated — the filter is exact-match.
 */
export function buildRedSeaDirectionalFlow(
  rows: MaritimeMovement[],
): GatewayFlowSeries[] {
  return RED_SEA_GATEWAYS.map((g) =>
    buildGatewayFlow(rows, g.theatre, g.gate),
  );
}

/**
 * Shared y-axis maximum across every gateway so the two charts are visually
 * comparable (a tall bar means more vessels regardless of gateway). Never below
 * 1 so an all-empty pair still scales cleanly.
 */
export function sharedFlowMax(series: GatewayFlowSeries[]): number {
  let max = 0;
  for (const s of series) {
    for (const p of s.points) {
      max = Math.max(max, p.inbound, p.outbound);
    }
  }
  return Math.max(max, 1);
}

/** True when at least one gateway has a drawable sample. */
export function hasAnyFlow(series: GatewayFlowSeries[]): boolean {
  return series.some((s) => s.hasData);
}
