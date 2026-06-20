export const TOPIC_LABELS: Record<string, string> = {
  fuel: "Fuel",
  flashpoint: "Flashpoint",
  protests: "Protests & Civil Unrest",
  fertiliser: "Fertiliser",
  energy: "Energy",
  shipping: "Shipping",
  cargo_watch: "Cargo Watch",
  conflict: "Conflict",
  maritime_security: "Maritime Security",
};

export const TOPICS = Object.keys(TOPIC_LABELS) as Array<keyof typeof TOPIC_LABELS>;

export const SEVERITY_LEVELS = ["insignificant", "low", "moderate", "high", "extreme"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export const SEVERITY_LABELS: Record<string, string> = {
  insignificant: "Insignificant",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  extreme: "Extreme",
};

// Rating colours — drawn from the approved Polestar palette
// (Midnight Blue, Dusk Gray, Electric Blue, Polar Gray + subdued red).
// Update these five values and every map / badge / chart will follow.
export const RATING_COLORS: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};

export const RATING_TEXT_COLORS: Record<string, string> = {
  extreme: "#FFFFFF",
  high: "#FFFFFF",
  moderate: "#FFFFFF",
  low: "#FFFFFF",
  insignificant: "#363636",
};

export const MARKER_FILL_OPACITY = 0.78;
export const MARKER_BORDER_WIDTH = 1.5;

export function ratingColor(rating: string): string {
  return RATING_COLORS[rating] ?? RATING_COLORS.insignificant;
}

// Standard marker styling — apply identically on every map surface
// (dashboard, topic, country report, strike tracker, cargo watch, PDF export).
export function markerStyle(rating: string): {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
} {
  const c = ratingColor(rating);
  return {
    fill: c,
    fillOpacity: MARKER_FILL_OPACITY,
    stroke: c,
    strokeOpacity: 1,
    strokeWidth: MARKER_BORDER_WIDTH,
  };
}

export const MUNITIONS = ["drone", "ballistic_missile", "cruise_missile", "mixed", "unknown"] as const;
export const TARGET_CATEGORIES = [
  "military_site","government_facility","energy_infrastructure","port_maritime",
  "airport_aviation","civilian_area","commercial_site","industrial_site","vessel","unknown",
] as const;
export const INFRASTRUCTURE = [
  "government","power","military","civilian_residential","port","airport","oil_gas","industrial","commercial","unknown",
] as const;

export const SOURCE_TYPES = ["rss","api","scraper","manual","social","government","news"] as const;
export const SOURCE_STATUSES = ["operational","delayed","stale","failing","blocked","not_configured","pending"] as const;
export const REPORT_STATUSES = ["draft","review","published"] as const;

export function severityClass(s: string): string {
  switch (s) {
    case "extreme": return "bg-destructive text-destructive-foreground";
    case "high": return "bg-accent text-accent-foreground";
    case "moderate": return "bg-primary text-primary-foreground";
    case "low": return "bg-muted text-muted-foreground";
    default: return "bg-secondary text-secondary-foreground";
  }
}

// Inline style equivalent — guaranteed to match RATING_COLORS regardless of
// tailwind token theming. Prefer this for severity badges.
export function severityBadgeStyle(s: string): {
  backgroundColor: string;
  color: string;
} {
  return {
    backgroundColor: RATING_COLORS[s] ?? RATING_COLORS.insignificant,
    color: RATING_TEXT_COLORS[s] ?? RATING_TEXT_COLORS.insignificant,
  };
}

export function sourceStatusClass(s: string): string {
  switch (s) {
    case "operational": return "bg-accent text-accent-foreground";
    case "delayed": return "bg-secondary text-secondary-foreground";
    case "stale": return "bg-primary/80 text-primary-foreground";
    case "failing": return "bg-destructive text-destructive-foreground";
    case "blocked": return "bg-destructive text-destructive-foreground";
    case "not_configured": return "bg-muted text-muted-foreground";
    case "pending": return "bg-amber-100 text-amber-800 border border-amber-200";
    default: return "bg-muted text-muted-foreground";
  }
}

export function reportStatusClass(s: string): string {
  switch (s) {
    case "published": return "bg-accent text-accent-foreground";
    case "review": return "bg-primary text-primary-foreground";
    case "draft": return "bg-muted text-muted-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

export function munitionLabel(m: string): string {
  return m.replace(/_/g, " ");
}
