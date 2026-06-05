// Shared date-range model for the topic monitors. One source of truth so every
// monitor's range toggle offers the same windows and labels.
export type RangeKey = "24h" | "7d" | "14d" | "30d" | "90d" | "180d" | "1y" | "2y";

export const RANGE_KEYS: RangeKey[] = ["24h", "7d", "14d", "30d", "90d", "180d", "1y", "2y"];

export const RANGE_DAYS: Record<RangeKey, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "1y": 365,
  "2y": 730,
};

// Short pill label.
export const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "24h",
  "7d": "7d",
  "14d": "2w",
  "30d": "30d",
  "90d": "90d",
  "180d": "180d",
  "1y": "1y",
  "2y": "2y",
};

// Sentence fragment for card notes, e.g. "12 in the past 30 days".
export const RANGE_NOTE: Record<RangeKey, string> = {
  "24h": "past 24 hours",
  "7d": "past 7 days",
  "14d": "past 2 weeks",
  "30d": "past 30 days",
  "90d": "past 90 days",
  "180d": "past 180 days",
  "1y": "past year",
  "2y": "past 2 years",
};
