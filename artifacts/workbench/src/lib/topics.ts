export const TOPIC_LABELS: Record<string, string> = {
  fuel: "Fuel",
  flashpoint: "Flashpoint",
  protests: "Protests & Civil Unrest",
  fertiliser: "Fertiliser",
  energy: "Energy",
  shipping: "Shipping",
  cargo_watch: "Cargo Watch",
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

export const MUNITIONS = ["drone", "ballistic_missile", "cruise_missile", "mixed", "unknown"] as const;
export const TARGET_CATEGORIES = [
  "military_site","government_facility","energy_infrastructure","port_maritime",
  "airport_aviation","civilian_area","commercial_site","industrial_site","vessel","unknown",
] as const;
export const INFRASTRUCTURE = [
  "government","power","military","civilian_residential","port","airport","oil_gas","industrial","commercial","unknown",
] as const;

export const SOURCE_TYPES = ["rss","api","scraper","manual","social","government","news"] as const;
export const SOURCE_STATUSES = ["operational","delayed","stale","failing","blocked","not_configured"] as const;
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

export function sourceStatusClass(s: string): string {
  switch (s) {
    case "operational": return "bg-accent text-accent-foreground";
    case "delayed": return "bg-secondary text-secondary-foreground";
    case "stale": return "bg-primary/80 text-primary-foreground";
    case "failing": return "bg-destructive text-destructive-foreground";
    case "blocked": return "bg-destructive text-destructive-foreground";
    case "not_configured": return "bg-muted text-muted-foreground";
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
