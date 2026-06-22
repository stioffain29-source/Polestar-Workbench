// Operational fuel-disruption alert dataset.
//
// This is an ANALYST-COMPILED regional alert, NOT live-feed data. Every field
// below is a faithful transcription of the South Asia fuel-shortage alert; where
// the alert is silent on a dimension the field is left undefined and the UI
// renders "Not reported" — nothing is invented or inferred into a hard value.
// This deliberately mirrors the honesty posture that replaced the old fabricated
// FUEL_MARKET_DATA_SAMPLE prices: surfaced context is always attributable.

import type { SeverityTier } from "@/lib/topics";

export interface FuelDisruptionCountry {
  country: string;
  /** Concern tier, drawn from the regional Polestar View ranking. */
  concern: SeverityTier;
  eventType: string;
  status: string;
  timeFrame: string;
  /** Undefined → UI shows "Not reported". */
  fuelAvailability?: string;
  governmentMeasures: string[];
  transportImpact?: string;
  businessImpact?: string;
  aviationImpact?: string;
  powerImpact?: string;
  protestRisk?: string;
  operationalImpact: string;
  /** Per-country assessment, extracted from the regional Polestar View. */
  polestarView: string;
  advice: string[];
  /** Country-specific Watch Next items, when the regional list names this country. */
  watchNext?: string[];
}

export interface FuelDisruptionAlert {
  region: string;
  event: string;
  /** Peak regional concern (driven by the highest-concern country). */
  severity: SeverityTier;
  highestConcern: string;
  timeFrame: string;
  alertBegan: string;
  alertExpires: string;
  /** ISO instant used to compute the Active/Expired status pill. */
  alertExpiresAt: string;
  drivers: string[];
  primaryImpacts: string[];
  countries: FuelDisruptionCountry[];
  /** Region-level operational rollup (one line per country, verbatim). */
  operationalImpact: { country: string; impact: string }[];
  travellerAdvice: string[];
  /** Regional assessment — verbatim. */
  polestarView: string;
  /** Regional watch-next flags — verbatim. */
  watchNext: string[];
  sourceNote: string;
}

// Countries ordered highest concern first so the cards lead with India, matching
// the Polestar View narrative.
const COUNTRIES: FuelDisruptionCountry[] = [
  {
    country: "India",
    concern: "high",
    eventType: "Fuel shortage with commercial restrictions and conservation drive",
    status: "Active — escalating controls",
    timeFrame: "Conservation and export controls ongoing; airline schedule cuts through August 2026",
    fuelAvailability:
      "Industrial fuel supply reduced. Commercial buyers banned from purchasing gasoline or diesel from retail stations. Daily diesel limit of 200 litres per customer or vehicle. LPG prioritised to domestic consumers.",
    governmentMeasures: [
      "Prime Minister Modi urged fuel-conservation measures: work from home, public transport, reduced cooking-oil consumption and limiting foreign travel.",
      "LPG supply prioritised to domestic consumers.",
      "Excise duty cut on petrol and diesel.",
      "Export levies increased on diesel and aviation turbine fuel (most recent adjustment active as of 16 June 2026).",
      "Industrial fuel supply reduced.",
      "Commercial fuel buyers banned from purchasing gasoline or diesel from retail stations.",
      "Daily diesel limit of 200 litres per customer or vehicle.",
    ],
    transportImpact:
      "Transport constraints; daily diesel purchases capped at 200 litres per customer or vehicle.",
    businessImpact:
      "Input shortages reported across several factory sectors; commercial fuel-buying restrictions raise business-continuity pressure.",
    aviationImpact:
      "Air India and IndiGo have reduced domestic and international flight schedules through August. Routes likely affected include Chicago, Newark, Singapore, Shanghai, San Francisco, Paris and Toronto.",
    protestRisk: "Possible protests (region-wide driver).",
    operationalImpact:
      "Factory disruption, transport constraints, flight disruption and increased business continuity pressure.",
    polestarView:
      "Highest concern in the region — commercial fuel restrictions, industrial supply reduction and airline schedule cuts.",
    advice: [
      "Confirm flight bookings; Air India and IndiGo schedules are reduced through August.",
      "Plan for diesel rationing (200 litres per day) and possible factory input delays; build business-continuity buffers.",
    ],
    watchNext: [
      "Further airline schedule reductions.",
      "Additional diesel or aviation-fuel export controls.",
      "Factory slowdowns.",
    ],
  },
  {
    country: "Pakistan",
    concern: "moderate",
    eventType: "Opening-hour restrictions and power outages",
    status: "Active — restrictions extended until at least 30 June 2026",
    timeFrame: "Until at least 30 June 2026",
    fuelAvailability: "Fuel stations remain exempt from closure and continue operating.",
    governmentMeasures: [
      "Opening-hour restrictions extended until at least 30 June 2026.",
      "Shops, markets and shopping malls may remain open until 21:00.",
      "Standalone groceries and kiryana stores may remain open until 22:00.",
      "Restaurants and food outlets may remain open until 23:00.",
      "Pharmacies, hospitals, fuel stations, IT firms, sports facilities, takeaway and delivery services remain exempt.",
    ],
    businessImpact: "Reduced commercial hours and disruption to routine operations.",
    powerImpact:
      "Sporadic power outages reported across the country; likely to worsen during severe weather or heatwaves.",
    operationalImpact:
      "Reduced commercial hours, power reliability issues and disruption to routine operations.",
    polestarView: "Requires monitoring for power disruption and restricted commercial hours.",
    advice: [
      "Plan around reduced commercial hours (shops to 21:00, groceries to 22:00, restaurants to 23:00).",
      "Prepare for sporadic power outages, worse during heatwaves; fuel stations, pharmacies and hospitals remain open.",
    ],
    watchNext: ["Power outages.", "Extension of restrictions beyond 30 June."],
  },
  {
    country: "Sri Lanka",
    concern: "moderate",
    eventType: "Fuel rationing (National Fuel Pass)",
    status: "Active",
    timeFrame: "Through at least late June 2026",
    fuelAvailability:
      "Rationed — weekly fuel allocation by vehicle category under the National Fuel Pass System.",
    governmentMeasures: [
      "National Fuel Pass System in place.",
      "Weekly fuel-allocation rationing applies by vehicle category.",
    ],
    transportImpact:
      "Movement planning required, especially for business travel, essential services and long-distance travel.",
    businessImpact: "Movement-planning constraints for business travel and essential services.",
    operationalImpact:
      "Movement planning required, especially for business travel, essential services and long-distance travel.",
    polestarView: "Remains constrained by rationing.",
    advice: [
      "Plan movement around weekly fuel-pass rationing by vehicle category; prioritise essential, business and long-distance travel.",
    ],
    watchNext: ["Any widening of rationing."],
  },
  {
    country: "Bangladesh",
    concern: "low",
    eventType: "Reduced operating hours (no confirmed national shortage)",
    status: "Active — government denies national shortage",
    timeFrame: "Through at least late June 2026",
    fuelAvailability: "Government officials state there is no fuel shortage in the country.",
    governmentMeasures: [
      "Government and private offices continue to operate 09:00–16:00.",
      "Banking services available 10:00–15:00.",
    ],
    businessImpact: "Reduced service windows and appointment constraints.",
    operationalImpact:
      "Reduced service windows and appointment constraints, but no confirmed national fuel shortage.",
    polestarView: "Mainly affected through reduced operating hours rather than confirmed national shortage.",
    advice: [
      "Schedule office and banking tasks within shortened hours (offices 09:00–16:00, banking 10:00–15:00).",
    ],
  },
  {
    country: "Nepal",
    concern: "low",
    eventType: "Fuel conservation measures",
    status: "Active",
    timeFrame: "Through at least late June 2026",
    governmentMeasures: [
      "Civil service and educational institutions reduced from a six-day to a five-day working week.",
      "Government offices operating 09:00–17:00, Monday to Friday.",
      "Authorities have urged work from home where possible.",
    ],
    businessImpact: "Reduced public-sector availability and slower administration processing.",
    operationalImpact: "Reduced public-sector availability and slower administration processing.",
    polestarView: "Mainly affected through conservation measures rather than confirmed national shortage.",
    advice: [
      "Allow extra time for administrative and government processing; public-sector services run a reduced five-day week (09:00–17:00).",
    ],
  },
];

export const SOUTH_ASIA_FUEL_ALERT: FuelDisruptionAlert = {
  region: "South Asia",
  event: "Fuel shortages",
  severity: "high",
  highestConcern: "India",
  timeFrame: "Through at least late June 2026",
  alertBegan: "18 June 2026, 19:04 UTC",
  alertExpires: "30 June 2026, 23:59 UTC",
  alertExpiresAt: "2026-06-30T23:59:00Z",
  drivers: [
    "Global supply constraints",
    "Regional export restrictions",
    "Operational uncertainty in the Strait of Hormuz",
    "Middle East conflict",
    "Petroleum and oil price volatility",
  ],
  primaryImpacts: [
    "Transport disruption",
    "Business disruption",
    "Flight disruption",
    "Rising costs",
    "Possible protests",
  ],
  countries: COUNTRIES,
  operationalImpact: COUNTRIES.map((c) => ({ country: c.country, impact: c.operationalImpact })),
  travellerAdvice: [
    "India: Confirm flights — Air India and IndiGo have cut domestic and international schedules through August (Chicago, Newark, Singapore, Shanghai, San Francisco, Paris and Toronto among routes affected). Expect diesel rationing (200 litres per day) and factory input delays.",
    "Sri Lanka: Plan movement around weekly fuel-pass rationing by vehicle category; prioritise essential, business and long-distance travel.",
    "Pakistan: Expect reduced commercial hours (shops to 21:00, groceries to 22:00, restaurants to 23:00) and sporadic power outages; fuel stations, pharmacies and hospitals remain exempt.",
    "Bangladesh: Government, private offices and banking run shortened hours (offices 09:00–16:00, banking 10:00–15:00); schedule appointments inside these windows.",
    "Nepal: Public-sector services run a reduced five-day week (09:00–17:00, Monday to Friday); allow extra time for administrative processing.",
    "Region-wide: Carry buffers for fuel queues and rising costs, allow for possible fuel-queue protests, and watch for any extension of restrictions beyond 30 June.",
  ],
  polestarView:
    "Fuel shortages across South Asia are producing uneven but operationally relevant disruption. India is the highest concern due to commercial fuel restrictions, industrial supply reduction and airline schedule cuts. Pakistan requires monitoring for power disruption and restricted commercial hours. Sri Lanka remains constrained by rationing. Bangladesh and Nepal are mainly affected through reduced operating hours and conservation measures rather than confirmed national shortage.",
  watchNext: [
    "Extension of restrictions beyond 30 June.",
    "Further airline schedule reductions.",
    "Additional diesel or aviation fuel export controls.",
    "Factory slowdowns in India.",
    "Power outages in Pakistan.",
    "Fuel queue related protests.",
    "Any widening of rationing or commercial fuel restrictions.",
  ],
  sourceNote:
    "Polestar Advisory regional alert — analyst-compiled operational intelligence based on the South Asia fuel-disruption alert, distinct from the live market-price feed below. Country measures and impacts are transcribed from the alert; the Polestar View, advice and watch-next items are analyst synthesis of those facts.",
};
