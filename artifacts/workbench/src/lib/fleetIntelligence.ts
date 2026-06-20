// Aggregate live AIS vessel sightings into honest fleet intelligence.
//
// Every field here is computed ONLY from data the live feed actually carries:
//   * flag-of-registry  -> ITU MID encoded in the MMSI (exact, see maritimeMid)
//   * vessel class      -> AIS ship-type code (tanker 80-89, cargo 70-79); a
//                          vessel with no ship-type is honestly counted as
//                          "type not reported", never guessed.
//   * activity          -> AIS navigational-status code.
//   * theatre           -> the tracked chokepoint the sighting fell inside.
// Nothing is fabricated; a thin feed produces a thin (but truthful) picture.

import type { MaritimeVessel } from "@workspace/api-client-react";
import { flagFromMmsi } from "./maritimeMid";

export interface FlagCount {
  flag: string;
  count: number;
}

export interface TheatreCount {
  theatre: string;
  count: number;
}

export interface FleetIntelligence {
  total: number;
  /** Flags sorted by vessel count, descending. */
  flags: FlagCount[];
  /** Vessels whose MMSI does not resolve to a flag state. */
  flagNotDerivable: number;
  classes: { tanker: number; cargo: number; other: number };
  /** Vessels broadcasting an AIS ship-type (the rest fall to "Other"). */
  typeReported: number;
  theatres: TheatreCount[];
  /** AIS nav-status 1 (at anchor) or 5 (moored). */
  atAnchor: number;
  /** AIS nav-status 0 (under way, engine) or 8 (under way, sailing). */
  underway: number;
  /**
   * Vessels broadcasting ANY usable AIS nav-status. When this is 0 the activity
   * split is unknown (not zero), so the UI must show "not reported", never a
   * fabricated 0 at-anchor / 0 under-way.
   */
  navStatusReported: number;
  /** Vessels transmitting a course-over-ground (a moving-traffic proxy). */
  courseReported: number;
}

function classOf(v: MaritimeVessel): "tanker" | "cargo" | "other" {
  return v.vesselClass === "tanker" || v.vesselClass === "cargo"
    ? v.vesselClass
    : "other";
}

export function buildFleetIntelligence(
  vessels: MaritimeVessel[],
): FleetIntelligence {
  const flagMap = new Map<string, number>();
  const theatreMap = new Map<string, number>();
  const classes = { tanker: 0, cargo: 0, other: 0 };
  let flagNotDerivable = 0;
  let typeReported = 0;
  let atAnchor = 0;
  let underway = 0;
  let navStatusReported = 0;
  let courseReported = 0;

  for (const v of vessels) {
    const flag = flagFromMmsi(v.mmsi);
    if (flag) flagMap.set(flag, (flagMap.get(flag) ?? 0) + 1);
    else flagNotDerivable += 1;

    if (v.theatre)
      theatreMap.set(v.theatre, (theatreMap.get(v.theatre) ?? 0) + 1);

    classes[classOf(v)] += 1;
    if (v.shipType !== null && v.shipType !== undefined) typeReported += 1;

    const nav = v.navStatus;
    if (nav === 1 || nav === 5) {
      atAnchor += 1;
      navStatusReported += 1;
    } else if (nav === 0 || nav === 8) {
      underway += 1;
      navStatusReported += 1;
    } else if (nav !== null && nav !== undefined) {
      // A reported-but-other status (e.g. restricted manoeuvrability, fishing)
      // still counts as "status known" so the activity split isn't called
      // unknown when the feed clearly carries nav data.
      navStatusReported += 1;
    }

    if (v.courseOverGround !== null && v.courseOverGround !== undefined)
      courseReported += 1;
  }

  const flags = [...flagMap.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag));

  const theatres = [...theatreMap.entries()]
    .map(([theatre, count]) => ({ theatre, count }))
    .sort((a, b) => b.count - a.count || a.theatre.localeCompare(b.theatre));

  return {
    total: vessels.length,
    flags,
    flagNotDerivable,
    classes,
    typeReported,
    theatres,
    atAnchor,
    underway,
    navStatusReported,
    courseReported,
  };
}
