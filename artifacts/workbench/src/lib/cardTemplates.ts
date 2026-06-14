import type { CardContent } from "@workspace/api-client-react";

// Master social card is a fixed 4:5 portrait.
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

// Five-tier rating vocabulary (no substitutions).
export const CARD_RATINGS = [
  "insignificant",
  "low",
  "moderate",
  "high",
  "extreme",
] as const;
export type CardRating = (typeof CARD_RATINGS)[number];

export const CARD_RATING_LABELS: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

// Card rating ramp. Extreme is the subdued red #A33232, reserved for the top
// tier only (per brand spec — NOT the #800000 used elsewhere in the workbench).
export const CARD_RATING_COLORS: Record<string, string> = {
  insignificant: "#B8C2CC",
  low: "#6FB872",
  moderate: "#E67E22",
  high: "#C0392B",
  extreme: "#A33232",
};

export const CARD_RATING_TEXT_COLORS: Record<string, string> = {
  insignificant: "#363636",
  low: "#FFFFFF",
  moderate: "#FFFFFF",
  high: "#FFFFFF",
  extreme: "#FFFFFF",
};

export function cardRatingColor(rating?: string): string {
  return CARD_RATING_COLORS[rating ?? ""] ?? CARD_RATING_COLORS.insignificant;
}

export function cardRatingTextColor(rating?: string): string {
  return CARD_RATING_TEXT_COLORS[rating ?? ""] ?? CARD_RATING_TEXT_COLORS.insignificant;
}

export function cardRatingLabel(rating?: string): string {
  return CARD_RATING_LABELS[rating ?? ""] ?? "Unrated";
}

export const CARD_TEMPLATE_KEYS = [
  "country_risk",
  "protest_disruption",
  "incident_update",
  "market_entry",
] as const;
export type CardTemplateKeyT = (typeof CARD_TEMPLATE_KEYS)[number];

export interface CardTemplateMeta {
  key: CardTemplateKeyT;
  name: string;
  blurb: string;
  // The headline word shown over the visual/map panel, distinguishing emphasis.
  panelLabel: string;
  // Footer left label.
  kicker: string;
  defaults: CardContent;
}

// Same five regions across all four; emphasis (labels + defaults) differs.
export const CARD_TEMPLATES: Record<CardTemplateKeyT, CardTemplateMeta> = {
  country_risk: {
    key: "country_risk",
    name: "Country Risk Snapshot",
    blurb: "Standing risk posture for a single country.",
    panelLabel: "Risk Map",
    kicker: "Country Risk",
    defaults: {
      topic: "Country Risk",
      rating: "moderate",
      keyPoints: ["", "", ""],
      outlook: "",
    },
  },
  protest_disruption: {
    key: "protest_disruption",
    name: "Protest & Disruption Update",
    blurb: "Civil unrest and operational disruption snapshot.",
    panelLabel: "Disruption Map",
    kicker: "Protests & Civil Unrest",
    defaults: {
      topic: "Protests & Civil Unrest",
      rating: "high",
      keyPoints: ["", "", ""],
      outlook: "",
    },
  },
  incident_update: {
    key: "incident_update",
    name: "Incident Update",
    blurb: "Single-incident rapid update.",
    panelLabel: "Incident Location",
    kicker: "Incident",
    defaults: {
      topic: "Incident",
      rating: "moderate",
      keyPoints: ["", "", ""],
      outlook: "",
    },
  },
  market_entry: {
    key: "market_entry",
    name: "Market Entry Snapshot",
    blurb: "Market entry feasibility and risk posture.",
    panelLabel: "Market Map",
    kicker: "Market Entry",
    defaults: {
      topic: "Market Entry",
      rating: "low",
      keyPoints: ["", "", ""],
      outlook: "",
    },
  },
};

export function templateMeta(key?: string): CardTemplateMeta {
  return CARD_TEMPLATES[(key as CardTemplateKeyT) ?? "country_risk"] ?? CARD_TEMPLATES.country_risk;
}
