import type { DataCentreCountryRisk } from "@workspace/api-client-react";
import {
  ratedDimensions,
  provisionalCount,
  RISK_RATING_COLOR,
  RISK_RATING_TEXT,
  type RiskRating,
} from "../lib/dataCentreRisk";

// Compact, read-only per-country risk strip: one small chip per RATED
// dimension, brand-coloured by tier. Dimensions with no rating are omitted
// (they read "not reported" and never inflate the strip). Shared by the risk
// framework list and the Data Centres monitor so both surfaces never disagree.

export function CountryRiskStrip({
  risk,
  showCountry = false,
}: {
  risk: DataCentreCountryRisk;
  showCountry?: boolean;
}) {
  const rated = ratedDimensions(risk);
  const provisional = provisionalCount(risk);
  return (
    <div className="font-sans">
      {showCountry && (
        <div className="text-sm font-medium text-foreground mb-1.5">
          {risk.country}
        </div>
      )}
      {rated.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">Not reported</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rated.map(({ key, label, value }) => {
            const rating = value.rating as RiskRating;
            return (
              <span
                key={key}
                title={
                  value.rationale
                    ? `${label}: ${rating} — ${value.rationale}`
                    : `${label}: ${rating}`
                }
                className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] leading-none"
                style={{
                  backgroundColor: RISK_RATING_COLOR[rating],
                  color: RISK_RATING_TEXT,
                }}
              >
                <span className="uppercase tracking-wide opacity-90">
                  {label}
                </span>
                <span className="font-semibold">{rating}</span>
              </span>
            );
          })}
        </div>
      )}
      {provisional > 0 && (
        <div className="mt-1 text-[10px] uppercase tracking-widest text-[#B26B00]">
          {provisional} provisional — pending analyst review
        </div>
      )}
    </div>
  );
}
