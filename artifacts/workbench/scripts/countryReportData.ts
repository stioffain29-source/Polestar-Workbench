// Headless country-report data loader.
//
// The on-screen country report (CountryReport.tsx) fetches incidents, the
// country baseline and ReliefWeb situational reports over the authenticated
// `/api` surface and filters them client-side. Under the now-private workbench
// every `/api` data route is gated by `requireOwner`, so a headless run cannot
// authenticate. This loader reads the SAME three sources directly from Postgres
// (the script runs in Node with DATABASE_URL) and applies the IDENTICAL
// country-matching / cross-theatre filter the page applies, so the structured
// brief the headless PDF renders matches the on-screen report for font auditing.
import { and, desc, gte, ilike, or, sql } from "drizzle-orm";
import {
  db,
  incidentsTable,
  countryBaselinesTable,
  reliefwebReportsTable,
} from "@workspace/db";
import {
  acceptedCountryTokens,
  incidentMatchesCountry,
  isIndonesianWestPapuaContext,
  isPapuaNewGuineaDominantContext,
  isForeignDominantContext,
  isForeignSubjectForIndonesia,
  isForeignSubjectNoHomeAnchor,
  isForeignTheatreContext,
  isCrossBorderPapuaPng,
  isIndonesianPapuaTheatreContext,
  foreignSyndicationDropIds,
} from "../src/lib/countryMatch";
import { isJakartaScoped } from "@workspace/ingest/jakartaExtract";
import type {
  PdfCountry,
  PdfIncident,
  CountryPdfExtras,
} from "../src/lib/exportCountryReportPdf";
import type { CountryBaseline } from "../src/lib/countryBaselines";
import type { ReliefWebReport } from "@workspace/api-client-react";

// Canonical slug -> report name. These are the names `acceptedCountryTokens`
// resolves into the structured-brief token sets (papua new guinea / papua /
// indonesia), matching the report rows the workbench serves.
const SLUG_TO_NAME: Record<string, { name: string; region: string }> = {
  "papua-new-guinea": { name: "Papua New Guinea", region: "Pacific" },
  papua: { name: "Papua", region: "Asia-Pacific" },
  indonesia: { name: "Indonesia", region: "Asia-Pacific" },
  thailand: { name: "Thailand", region: "Asia-Pacific" },
  philippines: { name: "Philippines", region: "Asia-Pacific" },
  jakarta: { name: "Jakarta", region: "Asia-Pacific" },
};

// The structured builders read these fields off each incident; build the full
// row shape (camelCase, matching the incidents API the page consumes) so both
// the country filter and the dataset builders see what they expect.
type CountryIncident = PdfIncident & {
  displayTitle?: string | null;
  ln?: string | null;
  resolvedUrl?: string | null;
  confidence?: string | null;
  province?: string | null;
  category?: string | null;
  businessImpact?: string | null;
  incidentDate?: string | null;
};

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
};

async function loadIncidents(): Promise<CountryIncident[]> {
  // 90-day backstop, all relevance (the page fetches includeIrrelevant=true and
  // applies its own country gate — see CountryReport.tsx).
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(incidentsTable)
    .where(gte(incidentsTable.occurredAt, cutoff))
    .orderBy(desc(incidentsTable.occurredAt));
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    title: r.title,
    displayTitle: r.displayTitle,
    ln: r.displayTitle,
    summary: r.summary,
    severity: r.severity,
    occurredAt: iso(r.occurredAt) ?? new Date().toISOString(),
    incidentDate: iso(r.incidentDate),
    country: r.country,
    location: r.location,
    latitude: r.latitude,
    longitude: r.longitude,
    source: r.source,
    sourceUrl: r.sourceUrl,
    resolvedUrl: r.resolvedUrl,
    confidence: r.confidence,
    province: r.province,
    category: r.category,
    businessImpact: r.businessImpact,
  }));
}

// Mirrors the client-side filter in CountryReport.tsx for the three structured
// theatres (png / papua / indonesia). Jakarta and the generic country layout
// are out of scope for this loader.
function filterForCountry(
  all: CountryIncident[],
  name: string,
): CountryIncident[] {
  const tokens = acceptedCountryTokens(name);
  const isPng = tokens.includes("papua new guinea");
  const isPapua = !isPng && tokens.includes("papua");
  // The Jakarta city brief is a sub-view of Indonesia-tagged records: match on
  // Indonesia, then keep only Jakarta-scoped items (mirrors CountryReport.tsx).
  const isJakarta = tokens.includes("jakarta");
  const isIndonesia =
    !isPng && !isPapua && !tokens.includes("jakarta") && tokens.includes("indonesia");
  // Cross-row foreign-syndication clustering (Indonesia + Jakarta): drop a
  // marker-less foreign syndication when a
  // foreign-attributed sibling row names the place. Built over the same en text
  // the single-string guard reads (title + Bahasa title, no summary masthead).
  const syndicationDrop = isIndonesia || isJakarta
    ? foreignSyndicationDropIds(
        all.map((i) => ({
          id: String(i.id),
          en: `${i.ln ?? i.displayTitle ?? ""} ${i.title ?? ""}`,
        })),
      )
    : new Set<string>();
  return all.filter((i) => {
    // Jakarta city brief: match Indonesia, keep only Jakarta-scoped items, drop
    // foreign-subject slop and syndicated foreign accidents (mirrors the page).
    if (isJakarta) {
      if (!incidentMatchesCountry(i.country, "Indonesia")) return false;
      if (!isJakartaScoped(i.title, i.summary, i.location)) return false;
      const en = `${i.ln ?? i.displayTitle ?? ""} ${i.title ?? ""}`;
      if (isForeignSubjectForIndonesia(en)) return false;
      if (syndicationDrop.has(String(i.id))) return false;
      return true;
    }
    if (!incidentMatchesCountry(i.country, name)) return false;
    if (isPng && !isCrossBorderPapuaPng(i.country)) {
      const text = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
      if (isIndonesianWestPapuaContext(text)) return false;
    }
    if (isPapua && !isCrossBorderPapuaPng(i.country)) {
      const text = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
      if (isPapuaNewGuineaDominantContext(text)) return false;
    }
    if (isIndonesia && isIndonesianPapuaTheatreContext(i.title)) return false;
    if (isIndonesia) {
      const en = `${i.ln ?? i.displayTitle ?? ""} ${i.title ?? ""} ${i.summary ?? ""}`;
      if (isForeignSubjectForIndonesia(en)) return false;
      if (syndicationDrop.has(String(i.id))) return false;
    }
    const fullText = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
    if (isForeignDominantContext(i.title, fullText, i.country, name)) return false;
    const narrative = `${i.title ?? ""} ${i.summary ?? ""}`;
    if (!isCrossBorderPapuaPng(i.country) && isForeignTheatreContext(narrative, name)) {
      return false;
    }
    // Generic country briefs (no bespoke theatre branch — Thailand / Philippines):
    // mirror CountryReport.tsx and drop a record whose TITLE names a foreign
    // country/capital/actor as its subject with NO home anchor and no resolved
    // local `location`. Structured-theatre countries (png/papua/indonesia, and
    // jakarta which this loader does not serve) are excluded from this gate.
    if (
      !isPng &&
      !isPapua &&
      !isIndonesia &&
      !tokens.includes("jakarta") &&
      isForeignSubjectNoHomeAnchor(i.title, i.displayTitle ?? null, i.location, name)
    ) {
      return false;
    }
    return true;
  });
}

async function loadBaseline(slug: string): Promise<CountryBaseline | null> {
  const rows = await db
    .select()
    .from(countryBaselinesTable)
    .where(sql`lower(${countryBaselinesTable.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  const b = rows[0];
  if (!b) return null;
  return {
    operatingEnvironment: b.operatingEnvironment,
    securityContext: b.securityContext,
    knownRiskAreas: b.knownRiskAreas ?? [],
    keyCitiesProvinces: b.keyCitiesProvinces ?? [],
    movementConstraints: b.movementConstraints,
    infrastructureLimits: b.infrastructureLimits,
    medicalEvac: b.medicalEvac,
    resourceSectorExposure: b.resourceSectorExposure,
    locationWatchlist:
      (b.locationWatchlist as CountryBaseline["locationWatchlist"]) ?? [],
  };
}

async function loadSituationalReports(name: string): Promise<ReliefWebReport[]> {
  const rows = await db
    .select()
    .from(reliefwebReportsTable)
    .where(
      or(
        ilike(reliefwebReportsTable.country, name),
        sql`${reliefwebReportsTable.countries} @> ${JSON.stringify([name])}::jsonb`,
      ),
    )
    .orderBy(desc(reliefwebReportsTable.publishedAt))
    .limit(40);
  return rows.map(
    (r) =>
      ({
        id: r.id,
        externalId: r.externalId,
        title: r.title,
        url: r.url,
        summary: r.summary,
        sourceOrg: r.sourceOrg,
        country: r.country,
        countries: r.countries ?? [],
        publishedAt: iso(r.publishedAt),
        originalDate: iso(r.originalDate),
        sourceType: r.sourceType,
        classification: r.classification,
        confidence: r.confidence,
        tags: r.tags ?? [],
      }) as unknown as ReliefWebReport,
  );
}

export async function fetchCountryReportData(slug: string): Promise<{
  country: PdfCountry;
  incidents: PdfIncident[];
  extras: CountryPdfExtras;
}> {
  const meta = SLUG_TO_NAME[slug.toLowerCase()];
  if (!meta) {
    throw new Error(
      `Unknown country slug "${slug}". Supported: ${Object.keys(SLUG_TO_NAME).join(", ")}`,
    );
  }
  const [all, baseline, situationalReports] = await Promise.all([
    loadIncidents(),
    loadBaseline(slug),
    loadSituationalReports(meta.name),
  ]);
  const incidents = filterForCountry(all, meta.name);
  const country: PdfCountry = { name: meta.name, region: meta.region };
  return {
    country,
    incidents: incidents as unknown as PdfIncident[],
    extras: { baseline, situationalReports },
  };
}
