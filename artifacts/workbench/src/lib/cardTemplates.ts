import type { CardContent } from "@workspace/api-client-react";
import type { LucideIcon } from "lucide-react";
import {
  Users,
  Shield,
  TrafficCone,
  TriangleAlert,
  Lock,
  Flame,
  Ship,
  Droplet,
  MapPin,
  Megaphone,
  Activity,
  Building2,
} from "lucide-react";

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
  insignificant: "#1B6B7A",
  low: "#6FB872",
  moderate: "#E67E22",
  // Burnt orange, NOT red — the subdued red #A33232 is reserved for the Extreme
  // tier only (brand rule), so High must read as a deep orange, not red.
  high: "#D35400",
  extreme: "#A33232",
};

export const CARD_RATING_TEXT_COLORS: Record<string, string> = {
  insignificant: "#FFFFFF",
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
  // Electric-blue section label above the BLUF block.
  sectionLabel: string;
  // Footer rating heading (e.g. "Risk Rating" / "Disruption Rating").
  ratingHeading: string;
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
    sectionLabel: "Risk Overview",
    ratingHeading: "Risk Rating",
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
    sectionLabel: "Situation Update",
    ratingHeading: "Disruption Rating",
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
    sectionLabel: "Situation Update",
    ratingHeading: "Impact Rating",
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
    sectionLabel: "Market Overview",
    ratingHeading: "Risk Rating",
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

// Per-tier one-line descriptor shown under the footer rating word. Used as a
// fallback when the analyst leaves `ratingNote` blank, so the rating block never
// reads bare.
export const CARD_RATING_NOTES: Record<string, string> = {
  insignificant: "Minimal disruption expected. Routine monitoring.",
  low: "Limited impact. Standard precautions advised.",
  moderate: "Significant but manageable. Monitor closely.",
  high: "Serious disruption likely. Heightened caution advised.",
  extreme: "Severe impact probable. Avoid affected areas.",
};

export function cardRatingNote(rating?: string): string {
  return CARD_RATING_NOTES[rating ?? ""] ?? CARD_RATING_NOTES.moderate;
}

// Curated icon set for the right-column highlight callouts. Keys are a fixed,
// controlled vocabulary chosen via a dropdown in the builder — never free text —
// so the card only ever renders a known lucide component.
export interface CardHighlightIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export const CARD_HIGHLIGHT_ICONS: CardHighlightIconOption[] = [
  { key: "alert", label: "Alert / Warning", Icon: TriangleAlert },
  { key: "crowd", label: "Crowd / People", Icon: Users },
  { key: "police", label: "Police / Security", Icon: Shield },
  { key: "traffic", label: "Traffic / Roads", Icon: TrafficCone },
  { key: "protest", label: "Protest / Demonstration", Icon: Megaphone },
  { key: "detention", label: "Detentions / Arrests", Icon: Lock },
  { key: "fire", label: "Fire / Unrest", Icon: Flame },
  { key: "ship", label: "Maritime / Shipping", Icon: Ship },
  { key: "fuel", label: "Fuel / Energy", Icon: Droplet },
  { key: "location", label: "Location", Icon: MapPin },
  { key: "activity", label: "Activity / Trend", Icon: Activity },
  { key: "infrastructure", label: "Infrastructure", Icon: Building2 },
];

export const DEFAULT_HIGHLIGHT_ICON_KEY = "alert";

export function highlightIcon(key?: string): LucideIcon {
  return (
    CARD_HIGHLIGHT_ICONS.find((o) => o.key === key)?.Icon ??
    CARD_HIGHLIGHT_ICONS.find((o) => o.key === DEFAULT_HIGHLIGHT_ICON_KEY)!.Icon
  );
}
