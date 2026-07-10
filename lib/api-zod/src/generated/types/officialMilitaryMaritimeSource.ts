/**
 * M1.5 official military & maritime source list query params.
 * Hand-maintained alongside openapi.yaml when orval codegen is unavailable.
 */
export type ListOfficialMilitaryMaritimeSourcesSource =
  | "centcom"
  | "ukmto"
  | "partner"
  | "jmic"
  | "cmf";

export type ListOfficialMilitaryMaritimeSourcesWatch = "conflict" | "shipping";

export type ListOfficialMilitaryMaritimeSourcesFlag =
  | "significant_incident"
  | "escalation_indicator"
  | "maritime_disruption"
  | "evidence_available"
  | "possible_spot_report";

export type ListOfficialMilitaryMaritimeSourcesParams = {
  source?: ListOfficialMilitaryMaritimeSourcesSource;
  watch?: ListOfficialMilitaryMaritimeSourcesWatch;
  flag?: ListOfficialMilitaryMaritimeSourcesFlag;
  limit?: number;
};

export type OfficialMilitaryMaritimeSource = {
  id: number;
  sourceName: string;
  externalId: string;
  title: string;
  publishedAt?: string | null;
  sourceUrl: string;
  bodyText?: string | null;
  classification: string;
  flagSignificantIncident: boolean;
  flagEscalationIndicator: boolean;
  flagMaritimeDisruption: boolean;
  flagEvidenceAvailable: boolean;
  flagPossibleSpotReport: boolean;
  primaryWatch?: "conflict" | "shipping" | null;
  watchTags: ("conflict" | "shipping")[];
  ingestedAt: string;
  createdAt: string;
  updatedAt: string;
};
