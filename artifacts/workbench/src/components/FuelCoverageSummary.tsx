import type { CSSProperties, ReactElement } from "react";
import {
  buildFuelCoverageSummary,
  FUEL_COVERAGE_SEVERITIES,
  type FuelCoverageCountry,
  type FuelCoverageSummary as FuelCoverageModel,
} from "@/lib/fuelCoverage";
import type { FuelCanonicalFacts, FuelSeverity } from "@/lib/fuelCanonicalFacts";
import { SEV_COLOR, WHITE } from "@/lib/pdfChrome";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";

function severityColor(severity: FuelSeverity): string {
  return SEV_COLOR[severity.toLowerCase()] ?? SEV_COLOR.insignificant;
}

const rootStyle: CSSProperties = {
  border: `1px solid ${POLAR}`,
  background: "#fff",
  padding: 12,
  fontFamily: "Roboto, sans-serif",
  color: DUSK,
};

const labelStyle: CSSProperties = {
  fontSize: 9,
  lineHeight: 1.2,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: DUSK,
};

const metricStyle: CSSProperties = {
  border: `1px solid ${POLAR}`,
  borderLeft: `4px solid ${ELECTRIC}`,
  padding: "7px 9px",
  minHeight: 48,
};

const tableHeadStyle: CSSProperties = {
  background: NAVY,
  color: "#fff",
  fontSize: 8,
  lineHeight: 1.2,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontWeight: 700,
  textAlign: "left",
  padding: "5px 7px",
};

const tableCellStyle: CSSProperties = {
  fontSize: 9,
  lineHeight: 1.25,
  padding: "4px 7px",
  borderBottom: `1px solid ${POLAR}`,
  verticalAlign: "middle",
};

function severityPill(severity: FuelSeverity | null): ReactElement {
  const label = severity ?? "Not assessed";
  return (
    <span
      style={{
        display: "inline-block",
        background: severity ? severityColor(severity) : WHITE,
        color: severity ? WHITE : DUSK,
        border: severity ? "none" : `1px solid ${POLAR}`,
        padding: "2px 5px",
        borderRadius: 2,
        fontSize: 8,
        lineHeight: 1.1,
        fontWeight: 700,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {label}
    </span>
  );
}

function BarRows({
  rows,
  valueLabel,
  colors,
}: {
  rows: Array<{ label: string; value: number; color?: string }>;
  valueLabel?: (value: number) => string;
  colors?: Record<string, string>;
}): ReactElement {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "grid",
            gridTemplateColumns: "74px minmax(0,1fr) 18px",
            gap: 5,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 9, color: DUSK }}>{row.label}</span>
          <div
            style={{
              height: 7,
              background: "#F0F2F6",
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${row.value > 0 ? Math.max(5, (row.value / max) * 100) : 0}%`,
                height: "100%",
                background:
                  row.color ??
                  colors?.[row.label] ??
                  ELECTRIC,
                WebkitPrintColorAdjust: "exact",
                printColorAdjust: "exact",
              }}
            />
          </div>
          <span style={{ fontSize: 9, color: NAVY, fontWeight: 700, textAlign: "right" }}>
            {valueLabel ? valueLabel(row.value) : row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function countrySeverityDetail(row: FuelCoverageCountry): string {
  return FUEL_COVERAGE_SEVERITIES
    .filter((severity) => row.severityDistribution[severity] > 0)
    .map((severity) => `${severity} ${row.severityDistribution[severity]}`)
    .join(" · ");
}

function CoverageBody({
  model,
  countryRows = model.affectedCountries,
  showMetrics = true,
  continued = false,
}: {
  model: FuelCoverageModel;
  countryRows?: FuelCoverageCountry[];
  showMetrics?: boolean;
  continued?: boolean;
}): ReactElement {
  const severityRows = FUEL_COVERAGE_SEVERITIES.map((severity) => ({
    label: severity,
    value: model.severityDistribution[severity],
    color: severityColor(severity),
  }));
  const trendRows = model.dailyTrend.map((day) => ({
    label: day.label,
    value: day.count,
    color: ELECTRIC,
  }));

  return (
    <div
      data-fuel-coverage-summary=""
      style={rootStyle}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ color: NAVY, fontSize: 12, fontWeight: 700 }}>
          {continued ? "Reporting-period coverage (continued)" : "Reporting-period coverage"}
        </div>
        {!continued && (
          <div style={{ color: DUSK, fontSize: 8, whiteSpace: "nowrap" }}>
            {model.reportingPeriod.start} to {model.reportingPeriod.end}
          </div>
        )}
      </div>

      {showMetrics && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 7,
              marginBottom: 9,
            }}
          >
            <div style={metricStyle}>
              <div style={labelStyle}>Distinct developments</div>
              <div style={{ fontSize: 18, lineHeight: 1.05, color: NAVY, fontWeight: 700, marginTop: 5 }}>
                {model.totalDistinctDevelopments}
              </div>
              <div style={{ fontSize: 8, marginTop: 3, color: DUSK }}>
                Evidence-family-deduplicated
              </div>
            </div>
            <div style={{ ...metricStyle, borderLeftColor: DUSK }}>
              <div style={labelStyle}>Active countries</div>
              <div style={{ fontSize: 18, lineHeight: 1.05, color: NAVY, fontWeight: 700, marginTop: 5 }}>
                {model.activeCountries}
              </div>
              <div style={{ fontSize: 8, marginTop: 3, color: DUSK }}>
                With an attributed development
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Severity distribution</div>
              <BarRows rows={severityRows} />
            </div>
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Daily incident trend</div>
              {trendRows.length > 0 ? (
                <BarRows rows={trendRows} />
              ) : (
                <div style={{ fontSize: 9, color: DUSK, fontStyle: "italic" }}>
                  No dated developments in scope.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <div style={{ ...labelStyle, marginBottom: 5 }}>
        Affected countries — distinct development count
      </div>
      {countryRows.length > 0 ? (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: `1px solid ${POLAR}`,
            tableLayout: "fixed",
          }}
        >
          <thead>
            <tr>
              <th style={{ ...tableHeadStyle, width: "37%" }}>Country</th>
              <th style={{ ...tableHeadStyle, width: "16%", textAlign: "right" }}>Developments</th>
              <th style={{ ...tableHeadStyle, width: "20%" }}>Highest severity</th>
              <th style={{ ...tableHeadStyle, width: "27%" }}>Severity detail</th>
            </tr>
          </thead>
          <tbody>
            {countryRows.map((row) => (
              <tr key={row.country}>
                <td style={{ ...tableCellStyle, color: NAVY, fontWeight: 700 }}>
                  {row.country}
                </td>
                <td style={{ ...tableCellStyle, color: NAVY, textAlign: "right", fontWeight: 700 }}>
                  {row.count}
                </td>
                <td style={tableCellStyle}>{severityPill(row.highestSeverity)}</td>
                <td style={{ ...tableCellStyle, color: DUSK }}>
                  {countrySeverityDetail(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ fontSize: 9, color: DUSK, fontStyle: "italic" }}>
          No attributed countries in the qualifying set.
        </div>
      )}
      {!continued && (
        <div style={{ fontSize: 8, lineHeight: 1.3, color: DUSK, marginTop: 6 }}>
          Coverage is limited to current-period Fuel-relevant records that passed
          the relevance and evidence-family gates; syndicated, commentary and
          follow-on coverage is not counted as a separate development. Country
          rows include only developments with a resolved country and are ordered
          by development count, not ranked for impact.{" "}
          {model.unattributedDevelopmentCount > 0
            ? `${model.unattributedDevelopmentCount} development${model.unattributedDevelopmentCount === 1 ? " was" : "s were"} excluded from this country table because the location could not be verified. `
            : ""}
          This is not a full raw-ingest total.
        </div>
      )}
    </div>
  );
}

export function FuelCoverageSummary({
  canonicalFacts,
  model,
  countryRows,
  showMetrics,
  continued,
}: {
  canonicalFacts?: FuelCanonicalFacts | null;
  model?: FuelCoverageModel | null;
  countryRows?: FuelCoverageCountry[];
  showMetrics?: boolean;
  continued?: boolean;
}): ReactElement | null {
  const resolved = model ?? (canonicalFacts ? buildFuelCoverageSummary(canonicalFacts) : null);
  if (!resolved) return null;
  return (
    <CoverageBody
      model={resolved}
      countryRows={countryRows}
      showMetrics={showMetrics}
      continued={continued}
    />
  );
}

export default FuelCoverageSummary;