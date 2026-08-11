import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCountryReport,
  useListIncidents,
  useListSources,
  useListReliefWebReports,
  useUpdateCountryReport,
  useGetCountryBaseline,
  useUpsertCountryBaseline,
  useDeleteCountryBaseline,
  useGenerateCountryProse,
  useEditCountryProse,
  getGetCountryReportQueryKey,
  getGetCountryBaselineQueryKey,
  type CountryProseSections,
  type CountryProseResult,
  type ProseIncidentInput,
  type ProseBaselineContext,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { draftCountryReportProse, type DraftableIncident } from "@/lib/draftReportProse";
import { createInFlightBusy } from "@/lib/inFlightBusy";
import { ArrowLeft, Download, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import polestarLogo from "@assets/Reverse_colour_logo_hor.png";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import { DISCLAIMER_TEXT } from "@/lib/pdfChrome";
import { computeCountryFastFacts, type CountryFastFactsIncident } from "@/lib/countryFastFacts";
import { correctPngIncidentSeverities } from "@/lib/pngSeverityCorrection";
import { consolidateCountryStories } from "@/lib/countrySameStory";
import { shouldGenerateProse } from "@/lib/countryProseGate";
import { isCityReport, reportKindLabel } from "@/lib/reportKind";
import PngCountryReportBody from "@/components/PngCountryReportBody";
import {
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  buildIndonesiaReportDataset,
  buildThailandReportDataset,
  buildPhilippinesReportDataset,
  buildJakartaReportDataset,
  type PngSourceIncident,
} from "@/lib/pngReportDataset";
import { buildCountryOperatingRiskDataset } from "@/lib/countryOperatingRiskDataset";
import { RATING_COLORS } from "@/lib/topics";
import { runQualityGate } from "@workspace/country-engine/gate";
import { countWords } from "@workspace/country-engine/narrative";
import { findBannedPhrases } from "@workspace/country-engine/bannedPhrases";
import { isJakartaScoped } from "@workspace/ingest/jakartaExtract";
import {
  incidentMatchesCountry,
  acceptedCountryTokens,
  countryFetchTokens,
  isIndonesianWestPapuaContext,
  isPapuaNewGuineaDominantContext,
  isIndonesianPapuaTheatreContext,
  isCrossBorderPapuaPng,
  isForeignDominantContext,
  isForeignTheatreContext,
  isForeignSubjectForIndonesia,
  isForeignSubjectNoHomeAnchor,
  foreignSyndicationDropIds,
  isPreparednessDrill,
} from "@/lib/countryMatch";
import CountryReportMap from "@/components/CountryReportMap";
import JakartaCorridorMap from "@/components/JakartaCorridorMap";
import CountryReportVisuals from "@/components/CountryReportVisuals";
import type {
  CountryMapPlacement,
  CountryPhotoPlacement,
} from "@/components/PngCountryReportBody";
import type { CountryReportPhoto } from "@workspace/api-client-react";
import {
  COUNTRY_SECTION_LABELS,
  applyIncidentCurations,
  normalizeHiddenSections,
  type CountrySectionKey,
  type CountrySectionOverrides,
} from "../lib/countrySectionOverrides";
import { countryCoverUrl } from "@/lib/coverImages";
import type { CountryBaseline } from "@/lib/countryBaselines";
import { buildCountryLayers, filterCountryRelevant, dropSyndicatedRehashes, resolveActiveCountryWindow, resolvePreviousCountryWindow, computeCountryCoverageStatus, computeCountrySourceSignals, type CountryLayerBuckets, type CoverageSourceLike } from "@/lib/countryReportLayers";
import { clampIssueDateToLatestRecord } from "@/lib/reportWindow";
import { runCountryReportQc, type CountryReportQcMapIncident } from "@/lib/countryReportQc";
import { parseISO, subDays, startOfDay } from "date-fns";

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const MIDNIGHT = "#0b0a3d";

// Severity rank + the demote-only option list for the incident-curation editor.
// Fixed five-tier vocabulary; the picker only ever offers tiers BELOW the
// incident's stored severity (never an up-rate).
const SEVERITY_ORDER: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};
const SEVERITY_DEMOTE_OPTIONS = ["insignificant", "low", "moderate", "high"] as const;
const ROBOTO = "Roboto, sans-serif";
const BRAND_GRADIENT = "linear-gradient(to right, #0b0a3d 0%, #465bff 100%)";

interface Draft {
  name: string;
  region: string;
  overview: string;       // Situation
  trendSummary: string;   // What Happened
  implications: string;   // Implications for Business
}

const EMPTY_DRAFT: Draft = { name: "", region: "", overview: "", trendSummary: "", implications: "" };

const MAX_REPORT_PHOTO_BYTES = 28 * 1024 * 1024;

// Resize/flatten an uploaded image to a JPEG data URL bounded to a max edge,
// mirroring the spot-report photo util so inline payloads stay small.
async function fileToReportPhotoDataUrl(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("image decode failed"));
    im.src = dataUrl;
  });
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

// Analyst-attached photo block rendered at the chosen placement slot. Static
// DOM only (img + figcaption) so it rasterises cleanly into the in-app PDF.
function CountryReportPhotoBlock({ photos }: { photos: CountryReportPhoto[] }) {
  if (!photos.length) return null;
  return (
    <div style={{ margin: "4px 0" }}>
      {photos.map((p, i) => (
        <figure key={i} style={{ margin: "0 0 14px 0", breakInside: "avoid" }}>
          <img
            src={p.dataUrl}
            alt={p.caption ?? ""}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              borderRadius: 2,
              border: `1px solid ${POLAR}`,
            }}
          />
          {(p.caption || p.source || p.credit || p.context) && (
            <figcaption style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 6, lineHeight: 1.45 }}>
              {p.caption && <div style={{ fontWeight: 700, color: NAVY }}>{p.caption}</div>}
              {p.context && <div style={{ marginTop: 2 }}>{p.context}</div>}
              {(p.source || p.credit) && (
                <div style={{ marginTop: 2, fontStyle: "italic" }}>
                  {[p.source ? `Source: ${p.source}` : "", p.credit ? `Credit: ${p.credit}` : ""]
                    .filter(Boolean)
                    .join("  ·  ")}
                </div>
              )}
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

const EMPTY_BASELINE: CountryBaseline = {
  operatingEnvironment: "",
  securityContext: "",
  knownRiskAreas: [],
  keyCitiesProvinces: [],
  movementConstraints: "",
  infrastructureLimits: "",
  medicalEvac: "",
  resourceSectorExposure: "",
  locationWatchlist: [],
};

export default function CountryReport() {
  const [, params] = useRoute("/countries/:slug");
  const slug = params?.slug ?? "";
  const qc = useQueryClient();
  const { data: country, isLoading } = useGetCountryReport(slug);
  // Country reports lead with the rolling 7-day (weekly) window. Pull a
  // 90-day backstop so the report can layer current / 30-day / 90-day
  // context for the deeper background section. We fetch the 90-day
  // feed unscoped and apply country matching client-side: the incidents
  // `country` field is a semicolon-separated list, so server-side exact
  // matching misses compound tags and cannot distinguish Indonesian
  // Papua from Papua New Guinea. `incidentMatchesCountry` does token-
  // exact group matching (see countryMatch.ts).
  //
  // includeIrrelevant=true: country reports MUST NOT inherit the server's
  // persisted relevance verdict. That verdict is the general TOPIC classifier
  // (e.g. it keeps a fuel-subsidy story as "relevant to fuel" and drops an
  // armed-robbery story as "irrelevant to protests"), which is exactly
  // backwards for a SECURITY country aggregate. We fetch raw and let this
  // page's own `isCountryRelevant` gate (applied in buildCountryLayers) be the
  // single source of truth, so the report is self-consistent and identical in
  // dev and prod regardless of how each DB persisted relevance.
  // Server-side SUPERSET pre-filter: scope the 90-day fetch to rows whose
  // country field contains one of this report's accepted tokens. Without it the
  // server returned the ENTIRE 90-day incidents table (~16k rows) for EVERY
  // country and joined corroborations over all of them — the root cause of the
  // Indonesia tab freeze. countryFetchTokens guarantees a superset of the rows
  // this page keeps (Jakarta scoped to the Indonesia group), so the client
  // isCountryRelevant gate below remains the authoritative filter.
  const incidentFetchParams = useMemo(() => {
    if (!country) return {};
    const tokens = countryFetchTokens(country.name ?? "");
    return {
      days: 90,
      includeIrrelevant: true,
      ...(tokens.length ? { countryLike: tokens.join(",") } : {}),
    };
  }, [country]);
  const {
    data: incidentsData,
    isSuccess: incidentsSuccess,
    isError: incidentsError,
  } = useListIncidents(incidentFetchParams as never, {
    query: { enabled: !!country },
  } as never);
  // Source health feeds the coverage-status determination for an empty
  // weekly window (always a coverage-problem; the detail explains which).
  // Gate the banner only
  // while the query is still loading, so we never flash a false "no source"
  // warning during the initial fetch — but if the query SETTLES with an error
  // (no source health available) we still surface the conservative coverage
  // warning rather than silently hiding it.
  const { data: sourcesData, isLoading: sourcesLoading } = useListSources();
  // Supporting UN OCHA ReliefWeb context scoped to this country. Degrades to an
  // empty list (and a hidden section) when the feed is unconfigured/unapproved.
  const { data: situationalReports } = useListReliefWebReports(
    country ? { country: country.name ?? undefined, limit: 40 } : {},
    { query: { enabled: !!country } } as never,
  );
  const incidents = useMemo(() => {
    if (!country) return [];
    const name = country.name ?? "";
    const tokens = acceptedCountryTokens(name);
    const isPng = tokens.includes("papua new guinea");
    // The Indonesian Papua report (own token "papua", never the PNG group).
    const isPapua = !isPng && tokens.includes("papua");
    // The Jakarta city brief is a sub-view of Indonesia-tagged records: match on
    // Indonesia, then keep only Jakarta-scoped items (a district gazetteer hit or
    // a citywide Jakarta token). Indonesian Papua records never carry "Indonesia"
    // alone, so they cannot leak into the capital brief.
    const isJakarta = tokens.includes("jakarta");
    // The Indonesia Operating Risk Watch (national brief). Papua-related
    // reporting (the highlands separatist conflict, OPM / TPNPB) is routed to
    // the dedicated Indonesian Papua brief and never shown here, even when a
    // mis-tag files it under "Indonesia".
    const isIndonesia =
      !isPng && !isPapua && !isJakarta && tokens.includes("indonesia");
    // Cross-row foreign-syndication clustering (Indonesia/Jakarta only): a
    // marker-less syndicated foreign accident ("Plane crash kills 11") that the
    // single-string guard cannot judge is dropped when a foreign-attributed
    // SIBLING row names the place. Built once over the same en text the guard
    // reads, then consulted per-row below.
    const syndicationDrop =
      isIndonesia || isJakarta
        ? foreignSyndicationDropIds(
            (incidentsData ?? []).map((i) => {
              const tr = i as { ln?: string | null; displayTitle?: string | null };
              return {
                id: String(i.id),
                en: `${tr.ln ?? tr.displayTitle ?? ""} ${i.title ?? ""}`,
              };
            }),
          )
        : new Set<string>();
    return (incidentsData ?? []).filter((i) => {
      // Preparedness drills / exercises / simulations are non-events; drop them
      // from EVERY brief before any theme is built (mirrors countryReportData.ts)
      // so an "active shooter drill" never surfaces as the "most serious" item.
      const dr = i as { ln?: string | null; displayTitle?: string | null };
      if (
        isPreparednessDrill(`${dr.ln ?? dr.displayTitle ?? ""} ${i.title ?? ""}`)
      ) {
        return false;
      }
      if (isJakarta) {
        if (!incidentMatchesCountry(i.country, "Indonesia")) return false;
        if (!isJakartaScoped(i.title, i.summary, i.location)) return false;
        // Indonesian outlets also report OVERSEAS events under a domestic
        // country tag; drop foreign-subject "slop" using the English text.
        // Feed the translated title + Bahasa title but NOT the summary — the
        // appended outlet masthead ("CNN Indonesia", "CNBC Indonesia") would
        // inject a false Indonesian anchor and defeat the dominance test.
        const tr = i as { ln?: string | null; displayTitle?: string | null };
        const en = `${tr.ln ?? tr.displayTitle ?? ""} ${i.title ?? ""}`;
        if (isForeignSubjectForIndonesia(en)) return false;
        // A marker-less foreign syndication the single-string guard cannot judge
        // is dropped when a foreign-attributed sibling row names the place.
        if (syndicationDrop.has(String(i.id))) return false;
        return true;
      }
      if (!incidentMatchesCountry(i.country, name)) return false;
      // Standing rule: Indonesian Papua / West Papua records must not
      // populate the PNG report unless they are explicitly cross-border
      // or directly PNG-relevant. Some West Papua items carry a stray
      // "Papua New Guinea" country tag (e.g. RNZ "pacific_west-papua"
      // stories); strip them from PNG using a content-aware guard.
      if (isPng && !isCrossBorderPapuaPng(i.country)) {
        const text = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
        if (isIndonesianWestPapuaContext(text)) return false;
      }
      // Symmetric rule for the Indonesian Papua report: a genuinely Papua New
      // Guinea record (Port Moresby, Lae, Morobe, MOMASE, PNG institutions) that
      // carries a stray "Papua" / "West Papua" country tag must not populate this
      // brief, or the Indonesian Papua report reads as Papua New Guinea. Genuine
      // cross-border records are exempt and stay in both reports.
      if (isPapua && !isCrossBorderPapuaPng(i.country)) {
        const text = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
        if (isPapuaNewGuineaDominantContext(text)) return false;
      }
      // Indonesia Operating Risk Watch: route Papua-theatre reporting out to the
      // dedicated West Papua brief. Genuine Papua New Guinea records (exempted
      // inside the guard) and ordinary national-Indonesia stories are unaffected.
      // Read the TITLE only — the summary/source carry the appended masthead, and
      // national outlets like "Sabang Merauke NEWS" embed a Papua city name that
      // would otherwise mis-route an unrelated national story (masthead pollution).
      if (isIndonesia && isIndonesianPapuaTheatreContext(i.title)) {
        return false;
      }
      // Indonesia operating-risk brief: the indonesia_local topic is fed by
      // Bahasa-first outlets that also report OVERSEAS events (foreign quakes,
      // foreign sport, foreign politics) under a domestic country tag. These are
      // only detectable once translated, so test the English `ln` translation;
      // Indonesian-place cues rescue a genuine domestic story that merely names
      // a foreign nationality.
      if (isIndonesia) {
        const tr = i as { ln?: string | null; displayTitle?: string | null };
        // Translated title + Bahasa title only — the summary carries the outlet
        // masthead ("CNN Indonesia" etc.), a false Indonesian anchor.
        const en = `${tr.ln ?? tr.displayTitle ?? ""} ${i.title ?? ""}`;
        if (isForeignSubjectForIndonesia(en)) return false;
        // A marker-less foreign syndication the single-string guard cannot judge
        // is dropped when a foreign-attributed sibling row names the place.
        if (syndicationDrop.has(String(i.id))) return false;
      }
      // Drop geocoder mis-tags: a record whose TITLE is about a distant
      // foreign country (e.g. "Myanmar clashes ... near Thai border") with no
      // strict local marker was filed here only because a city substring
      // matched (the PNG city "Lae" inside "Thicha Lae camp"). It is not a
      // local incident regardless of its stored country tag.
      const fullText = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
      if (isForeignDominantContext(i.title, fullText, i.country, name)) return false;
      // Aggressive cross-country filter: a record anchored to a named foreign
      // maritime/conflict theatre this country is not a member of (e.g. a
      // South-Korean-flagged tanker attacked in the Strait of Hormuz, tagged
      // "South Korea; Iran") happened in that theatre, not here, and is only
      // cross-tagged onto a nationality it names. Strip it from the non-member
      // report; the theatre's littoral states (Iran, the UAE, ...) keep it.
      // Read the narrative only — the appended masthead/URL never names a Gulf
      // choke-point, so this avoids masthead pollution. Cross-border Papua/PNG
      // records are exempt (they never name a foreign maritime theatre anyway).
      const narrative = `${i.title ?? ""} ${i.summary ?? ""}`;
      if (
        !isCrossBorderPapuaPng(i.country) &&
        isForeignTheatreContext(narrative, name)
      ) {
        return false;
      }
      // Generic country briefs (no bespoke branch — Thailand / Philippines):
      // drop a record whose TITLE names a foreign country / capital / actor as
      // its subject but carries NO home anchor (no home country / province /
      // city token in the title or translation, and no resolved local
      // `location`). Such a record ("US launches new Iran strikes") was filed
      // here only by a stray country tag; it is not a local incident.
      if (
        !isPng &&
        !isPapua &&
        !isJakarta &&
        !isIndonesia &&
        isForeignSubjectNoHomeAnchor(
          i.title,
          (i as { displayTitle?: string | null }).displayTitle,
          i.location,
          name,
        )
      ) {
        return false;
      }
      return true;
    });
  }, [incidentsData, country]);
  const update = useUpdateCountryReport();

  // Country baseline (editorial reference content stored in the DB).
  // 404 is the expected "no baseline curated" state and is mapped to
  // null so the report still renders the live-data layers.
  const { data: baselineData, isSuccess: baselineLoaded, isError: baselineMissing } =
    useGetCountryBaseline(slug, {
      query: { enabled: !!slug, retry: false },
    } as never);
  const upsertBaseline = useUpsertCountryBaseline();
  const deleteBaseline = useDeleteCountryBaseline();

  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Durable analyst layout controls (persisted per-report, OUTSIDE the AI prose
  // fingerprint cache so changing layout never regenerates the narrative).
  const [mapPlacement, setMapPlacement] = useState<CountryMapPlacement>("end");
  const [photoPlacement, setPhotoPlacement] = useState<CountryPhotoPlacement>("none");
  const [reportPhotos, setReportPhotos] = useState<CountryReportPhoto[]>([]);
  // Durable analyst curation of the rendered brief — hidden canonical sections,
  // excluded relevance-passing window incidents, demote-only severity fixes.
  const [sectionOverrides, setSectionOverrides] = useState<CountrySectionOverrides>({});
  const [baselineDraft, setBaselineDraft] = useState<CountryBaseline>(EMPTY_BASELINE);
  const [baselineDirty, setBaselineDirty] = useState(false);
  const seededForSlug = useRef<string | null>(null);
  const baselineSeededForSlug = useRef<string | null>(null);
  const reportPreviewRef = useRef<HTMLDivElement | null>(null);

  // Option A: date the country report to the period its data actually covers.
  // Clamp the issue date back to the country's newest incident so the rolling
  // 7-day headline window ends on real records instead of trailing weeks of
  // empty calendar time past the latest incident.
  // Clamp the issue date off the country-RELEVANT records only. If we
  // clamped off the raw country-matched set, a newer irrelevant record
  // (e.g. a fuel-subsidy story dated after the latest security incident)
  // would drag the window forward onto a week that buildCountryLayers
  // then empties — reintroducing the "old data read as current" bug.
  // Also strip syndicated rehashes (an aggregator re-running a months-old
  // event with a fresh publication date) so a recycled headline can't drag
  // the issue date onto an empty current week ahead of the genuine cluster.
  // Country-relevant records (drops economic/PR/sports noise via
  // isCountryRelevant). Computed ONCE here and reused for both the issue-date
  // anchor and the lookback layers, so the ~6k-row Indonesia set is
  // relevance-filtered a single time per render instead of twice.
  const countryRelevant = useMemo(
    () => filterCountryRelevant(incidents as CountryFastFactsIncident[]),
    [incidents],
  );
  // Issue-date anchor ONLY: additionally strip syndicated rehashes so a
  // recycled headline can't drag the date onto an empty week. This
  // rehash-dropped set is NEVER used for display — only to pick the date.
  const relevantIncidents = useMemo(
    () => dropSyndicatedRehashes(countryRelevant),
    [countryRelevant],
  );
  const issueDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return clampIssueDateToLatestRecord(
      today,
      relevantIncidents as { occurredAt: string; topic?: string }[],
    );
  }, [relevantIncidents]);

  // Country baseline + lookback layers. The baseline is editorial
  // reference content that does not depend on the incident feed; the
  // layers partition the 90-day pull into current / 30 / 90 buckets so
  // the report carries proper context even when the current window is
  // thin. When editing, the report renders against the in-progress
  // draft so the editor can preview their changes immediately.
  const persistedBaseline: CountryBaseline | null = useMemo(() => {
    if (!baselineData) return null;
    return {
      operatingEnvironment: baselineData.operatingEnvironment,
      securityContext: baselineData.securityContext,
      knownRiskAreas: baselineData.knownRiskAreas,
      keyCitiesProvinces: baselineData.keyCitiesProvinces,
      movementConstraints: baselineData.movementConstraints,
      infrastructureLimits: baselineData.infrastructureLimits,
      medicalEvac: baselineData.medicalEvac,
      resourceSectorExposure: baselineData.resourceSectorExposure,
      locationWatchlist: baselineData.locationWatchlist,
    };
  }, [baselineData]);
  const baseline: CountryBaseline | null = editing ? baselineDraft : persistedBaseline;

  // The structured nine-section brief now serves TWO theatres: Papua New Guinea
  // and the Indonesian West Papua report (slug `papua`, token "papua" but NOT the
  // PNG group). Both render the same PngCountryReportBody from a config-driven
  // dataset; everything below keys off `isStructured` so the West Papua brief
  // reaches parity. Any other country keeps the generic brief.
  const structuredTheatre = useMemo<
    "png" | "westPapua" | "indonesia" | "thailand" | "philippines" | "jakarta" | null
  >(() => {
    const tokens = acceptedCountryTokens(country?.name ?? "");
    if (tokens.includes("papua new guinea")) return "png";
    if (tokens.includes("papua")) return "westPapua";
    if (tokens.includes("indonesia")) return "indonesia";
    if (tokens.includes("thailand")) return "thailand";
    if (tokens.includes("philippines")) return "philippines";
    if (tokens.includes("jakarta")) return "jakarta";
    return null;
  }, [country]);
  const isStructured = structuredTheatre !== null;
  const layers: CountryLayerBuckets = useMemo(
    // countryRelevant is already relevance-filtered, so tell buildCountryLayers
    // to skip its internal re-filter (preFiltered) — same buckets, one pass.
    () => buildCountryLayers(countryRelevant, issueDate, { preFiltered: true }),
    [countryRelevant, issueDate],
  );

  // Active reporting window. Country reports are a WEEKLY brief, so the headline
  // basis is FIXED to the rolling 7-day window — it never widens to 30/90-day
  // (the user was explicit that 30 days is too long for a weekly report). Drives
  // Fast Facts, map, charts, the related-incidents table and the drafted prose;
  // the 30/90-day buckets stay as labelled context/background sections. An empty
  // week is surfaced via the coverage banner, never widened away.
  const active = useMemo(
    () => resolveActiveCountryWindow(layers, issueDate),
    [layers, issueDate],
  );

  // Apply the analyst's durable curation to the relevance-passing window pool:
  // drop excluded incidents and apply demote-only severity corrections. Every
  // downstream surface (Fast Facts, map, charts, cards, prose) derives from this
  // curated set so the brief stays internally consistent. STRICT no-fabrication:
  // curation can only remove/demote what already passed relevance — never add.
  const curatedWindowIncidents = useMemo(
    () => applyIncidentCurations(active.incidents, sectionOverrides),
    [active, sectionOverrides],
  );

  // Coverage status for an empty WEEKLY (7-day) window. Drives the printable
  // coverage banner; "active" (week has records) renders nothing.
  const coverage = useMemo(
    () =>
      computeCountryCoverageStatus({
        layers,
        sources: (sourcesData ?? []) as CoverageSourceLike[],
        issueDate,
        countryName: country?.name ?? "",
      }),
    [layers, sourcesData, issueDate, country?.name],
  );

  // Country / topic / specialist feed health as three separate signals for the
  // internal (screen-only) source-coverage strip, so a down specialist tracker
  // is visible but never conflated with country coverage.
  const sourceSignals = useMemo(
    () =>
      computeCountrySourceSignals({
        sources: (sourcesData ?? []) as CoverageSourceLike[],
        issueDate,
        countryName: country?.name ?? "",
      }),
    [sourcesData, issueDate, country?.name],
  );

  // Consolidate same-story incidents (syndicated re-runs AND the same named
  // premises event reported across a few days) BEFORE Fast Facts, the map, the
  // charts and the related-incidents table read the active window, so one event
  // never shows or counts twice. Shares the exact clustering authority the
  // structured report builder uses, so the page and the brief agree.
  const dedupedWindowIncidents = useMemo(
    () => consolidateCountryStories(curatedWindowIncidents),
    [curatedWindowIncidents],
  );

  // The UNCURATED relevance-passing window pool the analyst picks from in the
  // editor (so an excluded incident can be re-included). Consolidated to one row
  // per distinct event, matching what the brief would show.
  const curationPool = useMemo(
    () =>
      consolidateCountryStories(active.incidents).filter(
        (i) => i.id != null,
      ) as Array<{
        id: number | string;
        title: string;
        displayTitle?: string | null;
        severity: string;
        location?: string | null;
      }>,
    [active],
  );

  // Compute Fast Facts against the active window once per render. For PNG only,
  // demote non-kinetic assistance / PR items to Low first (the stored severity
  // mis-rates them High) so the Fast Facts severity and the incident map agree
  // with the corrected structured brief. No-fabrication: demote-only, inert for
  // every other theatre. Mirrors the toItem correction in pngReportDataset.ts.
  const facts = useMemo(() => {
    const demote = structuredTheatre === "png";
    const fix = <T extends { title: string; summary?: string | null; severity: string }>(
      list: T[],
    ): T[] => (demote ? correctPngIncidentSeverities(list) : list);
    return computeCountryFastFacts({
      issueDate,
      incidents: fix(incidents as CountryFastFactsIncident[]),
      windowIncidents: fix(dedupedWindowIncidents),
      standingIncidents: fix(layers.ninetyDay),
      periodLabel: active.periodShortLabel,
    });
  }, [incidents, issueDate, dedupedWindowIncidents, active, layers, structuredTheatre]);

  // Auto-derived prose (executiveSummary, whatMatters, watchNext, polestarView).
  const draftedProse = useMemo(() => {
    if (!country) return null;
    const inputs: DraftableIncident[] = dedupedWindowIncidents.map((i) => ({
      topic: i.topic, title: i.title, summary: i.summary,
      source: i.source, sourceUrl: i.sourceUrl, location: i.location,
      severity: i.severity, occurredAt: i.occurredAt, country: i.country,
    }));
    return draftCountryReportProse({
      countryName: country.name ?? "",
      region: country.region ?? "",
      incidents: inputs,
      issueDate,
      windowIncidents: inputs,
      basisDays: active.basisDays,
    });
  }, [country, active, dedupedWindowIncidents, issueDate]);

  // Deterministic PNG dataset (the labelled fallback). Built here so the AI
  // prose path below can ground its Executive Summary + Outlook on the SAME
  // deduped window items the brief renders.
  const pngDataset = useMemo(() => {
    if (!country) return null;
    const args = {
      windowIncidents: curatedWindowIncidents as PngSourceIncident[],
      previousWindowIncidents: resolvePreviousCountryWindow(layers, issueDate) as PngSourceIncident[],
      thirtyDay: layers.thirtyDay as PngSourceIncident[],
      ninetyDay: layers.ninetyDay as PngSourceIncident[],
      baselineWatchlist: (baseline?.locationWatchlist ?? []).map((w) => w.label),
      periodLabel: active.basisLabel,
      // Start of the rolling 7-day window (issueDate-6, start-of-day). Lets the
      // builder flag rows whose OWN event date predates the window (an older
      // incident resurfacing in this week's reporting) so they never inflate the
      // period's trend/severity aggregates while still appearing in the cards.
      windowStart: (() => {
        let end: Date;
        try {
          end = parseISO(issueDate);
        } catch {
          end = new Date();
        }
        if (isNaN(end.getTime())) end = new Date();
        return startOfDay(subDays(end, 6));
      })(),
      // Empty-week coverage determination: when the week is a coverage problem
      // every empty-week surface (BLUF, tactical brief, confidence, posture)
      // reads "Not Assessed" instead of implying a confirmed quiet week.
      coverageUnconfirmed: coverage.state === "coverage-problem",
      // Analyst Top 3 Developments curation — pins lead the section, section
      // excludes fall back to Incident Details. Persisted in section_overrides.
      top3Curation: {
        pinnedIds: sectionOverrides.top3PinnedIds ?? [],
        excludedIds: sectionOverrides.top3ExcludedIds ?? [],
      },
    };
    switch (structuredTheatre) {
      case "westPapua":
        return buildWestPapuaReportDataset(args);
      case "indonesia":
        return buildIndonesiaReportDataset(args);
      case "thailand":
        return buildThailandReportDataset(args);
      case "philippines":
        return buildPhilippinesReportDataset(args);
      case "jakarta":
        return buildJakartaReportDataset(args);
      case "png":
        return buildPngReportDataset(args);
      // Every other country renders the same operating-risk brief, built from a
      // generic config (shared rulebook for themes, incident location for the
      // watchlist).
      default:
        return buildCountryOperatingRiskDataset(args, country.name ?? "");
    }
  }, [structuredTheatre, curatedWindowIncidents, active, layers, baseline, issueDate, country, coverage.state, sectionOverrides.top3PinnedIds, sectionOverrides.top3ExcludedIds]);

  // --- AI-generated prose -------------------------------------------------
  // The narrative is generated server-side, grounded strictly on the same
  // window incidents the page renders, and cached by a fingerprint of that
  // data. A cache hit is free; the prose regenerates only when the data
  // changes (so it can never go stale) or on an explicit Redraft. When the
  // LLM is unavailable the page falls back to the deterministic template.
  const generateProse = useGenerateCountryProse();
  // Blank draft used when no AI prose row exists yet: the inline editors
  // prefill from the engine defaults, and blank fields save as "" (= keep
  // engine text), so seeding empty is exactly "no overrides yet".
  const EMPTY_PROSE_SECTIONS: CountryProseSections = {
    executiveSummary: "",
    situation: "",
    whatHappened: "",
    whatMatters: "",
    implications: [],
    watchNext: [],
    polestarView: "",
    bluf: "",
    whatChanged: "",
    outlook: "",
  };
  const editProse = useEditCountryProse();
  const [proseResult, setProseResult] = useState<CountryProseResult | null>(null);
  const [proseUnavailable, setProseUnavailable] = useState(false);
  const [proseDraft, setProseDraft] = useState<CountryProseSections | null>(null);
  const proseRequestKey = useRef<string | null>(null);
  // The latest server fingerprint, captured from EVERY generate response —
  // including `{available:false}` (AI unconfigured), which still carries the
  // fingerprint of the live data basis. Edits made without any AI prose are
  // saved against this fingerprint, so editing works even when the prose
  // engine has never run for this country.
  const lastFingerprint = useRef<string | null>(null);
  // Busy state is derived from a LOCAL in-flight counter, not the shared React
  // Query mutation's `isPending`. StrictMode double-invokes the prose effect in
  // dev, which can strand the shared mutation in a zombie pending state and
  // leave the button stuck on "Drafting...". The counter only reflects requests
  // this component actually started and finished, so it always settles.
  // (See `createInFlightBusy` + `inFlightBusy.test.ts` for the guarded logic.)
  const proseTracker = useRef(createInFlightBusy());
  const [proseBusy, setProseBusy] = useState(false);
  const beginProseRequest = () => {
    setProseBusy(proseTracker.current.begin());
  };
  const endProseRequest = () => {
    setProseBusy(proseTracker.current.end());
  };

  // PNG grounds the AI prose on the SAME deduped, province/category-attributed
  // window items the brief renders (richer than the raw incident rows); every
  // other country uses the raw window incidents.
  const proseVariant: "country" | "png" = isStructured ? "png" : "country";
  const proseIncidents: ProseIncidentInput[] = useMemo(() => {
    if (isStructured && pngDataset) {
      return pngDataset.windowItems.map((it) => ({
        id: it.id,
        topic: it.category,
        title: it.title,
        summary: it.summary ?? null,
        location: it.province ?? null,
        country: country?.name ?? "",
        severity: it.severity,
        occurredAt: (it.incidentDate ?? it.reportedDate).toISOString(),
        source: it.source ?? null,
      }));
    }
    // Generic country report: ground the prose on the FULL active window set.
    // We pass `id` so the model's number-keyed per-incident summaries map back to
    // each incident. We deliberately ground on active.incidents (not the deduped
    // table subset): the full set's id list is order-stable under the server's
    // canonical sort, so the cache fingerprint is stable, whereas the dedup keeps
    // a non-deterministic representative per cluster and would flip the
    // fingerprint every load (regeneration loop). Every deduped table row's id is
    // a subset of this set, so each shown row still resolves a summary.
    return curatedWindowIncidents.map((i) => ({
      id: i.id != null ? String(i.id) : undefined,
      topic: i.topic, title: i.title, summary: i.summary,
      location: i.location, country: i.country,
      severity: i.severity, occurredAt: i.occurredAt, source: i.source,
    }));
  }, [isStructured, pngDataset, curatedWindowIncidents, country]);

  const periodWord = useMemo(
    () =>
      active.basisDays >= 90 ? "this past quarter" : active.basisDays >= 30 ? "this past month" : "this week",
    [active.basisDays],
  );

  // Stable identity of the window data — mirrors the inputs the server hashes
  // into its fingerprint, so we fire at most one request per data state.
  const proseContentKey = useMemo(() => {
    const ids = proseIncidents
      .map((i) =>
        [
          (i.id ?? "").trim().toLowerCase(),
          (i.title ?? "").trim().toLowerCase(),
          (i.occurredAt ?? "").slice(0, 10),
          (i.severity ?? "").toLowerCase(),
          (i.location ?? "").trim().toLowerCase(),
        ].join("~"),
      )
      .sort();
    return `${proseVariant}|${slug}|${active.basisDays}|${ids.join("§")}`;
  }, [proseIncidents, slug, active.basisDays, proseVariant]);

  const baselineContext: ProseBaselineContext | null = useMemo(() => {
    if (!persistedBaseline) return null;
    return {
      operatingEnvironment: persistedBaseline.operatingEnvironment,
      securityContext: persistedBaseline.securityContext,
      knownRiskAreas: persistedBaseline.knownRiskAreas,
      keyCitiesProvinces: persistedBaseline.keyCitiesProvinces,
      movementConstraints: persistedBaseline.movementConstraints,
      infrastructureLimits: persistedBaseline.infrastructureLimits,
      medicalEvac: persistedBaseline.medicalEvac,
      resourceSectorExposure: persistedBaseline.resourceSectorExposure,
    };
  }, [persistedBaseline]);

  useEffect(() => {
    // Gate the prose generation on every precondition (country loaded, not
    // editing, incidents query SETTLED, structured dataset built). The settle
    // gate is the regeneration-loop fix: firing while the incidents query is
    // still loading would ground prose on a transient empty set and race a
    // second fingerprint (the full set) into the cache. A genuinely empty week
    // still proceeds — the query settles with an empty array. See
    // shouldGenerateProse for the full predicate.
    if (
      !shouldGenerateProse({
        hasCountry: Boolean(country),
        editing,
        incidentsSuccess,
        incidentsError,
        isStructured,
        structuredReady: Boolean(pngDataset),
      })
    )
      return;
    if (!country) return;
    if (proseRequestKey.current === proseContentKey) return;
    proseRequestKey.current = proseContentKey;
    let cancelled = false;
    setProseUnavailable(false);
    beginProseRequest();
    generateProse
      .mutateAsync({
        slug,
        data: {
          region: country.region ?? "",
          basisDays: active.basisDays,
          periodWord,
          issueDate,
          incidents: proseIncidents,
          baseline: baselineContext,
          variant: proseVariant,
          force: false,
        },
      })
      .then((res) => {
        if (cancelled) return;
        // The server returns 200 {available:false} (not a 503) when the AI prose
        // engine is unconfigured or the upstream call failed. Treat it exactly
        // like a thrown error: fall back to the deterministic template and show
        // the unavailable hint.
        lastFingerprint.current = res.fingerprint;
        if (!res.available) {
          setProseResult(null);
          setProseUnavailable(true);
          return;
        }
        setProseResult(res);
      })
      .catch(() => {
        if (!cancelled) {
          setProseResult(null);
          setProseUnavailable(true);
        }
      })
      .finally(() => {
        endProseRequest();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, slug, editing, proseContentKey, periodWord, issueDate, baselineContext, incidentsSuccess, incidentsError]);

  const redraft = async () => {
    if (!country) return;
    setProseUnavailable(false);
    beginProseRequest();
    try {
      const res = await generateProse.mutateAsync({
        slug,
        data: {
          region: country.region ?? "",
          basisDays: active.basisDays,
          periodWord,
          issueDate,
          incidents: proseIncidents,
          baseline: baselineContext,
          variant: proseVariant,
          force: true,
        },
      });
      lastFingerprint.current = res.fingerprint;
      // 200 {available:false} -> degrade to the template just like a thrown error.
      if (!res.available) {
        setProseResult(null);
        setProseUnavailable(true);
        return;
      }
      setProseResult(res);
      setProseDraft(res.edited ?? res.sections);
      proseRequestKey.current = proseContentKey;
    } catch {
      setProseUnavailable(true);
    } finally {
      endProseRequest();
    }
  };

  // Seed the editable prose draft when entering edit mode; clear on exit.
  // When no AI prose exists (engine unconfigured, or never generated for this
  // country) the draft seeds EMPTY: every inline editor then prefills with the
  // engine default text, and only genuine analyst overrides are stored — so
  // editing is available regardless of the prose engine's state.
  useEffect(() => {
    if (editing && !proseDraft) {
      setProseDraft(
        proseResult ? (proseResult.edited ?? proseResult.sections) : { ...EMPTY_PROSE_SECTIONS },
      );
    }
    if (!editing && proseDraft) setProseDraft(null);
  }, [editing, proseResult, proseDraft]);

  // PNG: overlay the AI narrative sections (Bottom Line Up Front, Executive
  // Summary, What Changed, Outlook, Polestar View) onto the deterministic dataset,
  // which still supplies every structured section (breakdown, watchlist, incident
  // cards). Each section prefers the AI text and falls back to the deterministic
  // paragraph when the AI text is absent or blank. While editing, the live draft
  // drives the preview; otherwise prefer the server prose. PngCountryReportBody is
  // DOM-rasterised into the PDF, so this single merge keeps preview == PDF.
  const pngEffectiveDataset = useMemo(() => {
    if (!pngDataset) return null;
    // Operating-risk briefs (Indonesia / Jakarta) render the deterministic,
    // business-language narrative authored by operatingRiskProse.ts. They are
    // never overlaid by the generic AI prose: that prompt is not operating-risk
    // aware and would bypass the no-fabrication controls, so the upgrade must
    // stay authoritative in every environment (incl. production with AI keyed).
    // PNG / West Papua keep the overlay below, byte-identical to before. The
    // per-incident AI summaries are unaffected — they are derived separately and
    // still populate each card.
    if (pngDataset.proseVariant === "operating-risk") return pngDataset;
    // Owner brief §36: the DEFAULT source of the analytical sections is now the
    // shared country-engine narrative built into pngDataset — the old free-form
    // AI generator is NO LONGER a silent fallback OR an automatic overlay. Only
    // an EXPLICIT analyst EDIT (proseResult.edited, or the live draft while
    // editing) is human review and may override the engine default; the
    // machine-generated proseResult.sections never overlays the engine text.
    const src =
      editing && proseDraft ? proseDraft : (proseResult?.edited ?? null);
    if (!src) return pngDataset;
    const prefer = (edit: string | undefined, engineDefault: string) => {
      const t = (edit ?? "").trim();
      return t ? t : engineDefault;
    };
    return {
      ...pngDataset,
      bluf: prefer(src.bluf, pngDataset.bluf),
      executiveSummary: prefer(src.executiveSummary, pngDataset.executiveSummary),
      whatChanged: prefer(src.whatChanged, pngDataset.whatChanged),
      outlook: prefer(src.outlook, pngDataset.outlook),
      polestarView: prefer(src.polestarView, pngDataset.polestarView),
    };
  }, [pngDataset, editing, proseDraft, proseResult]);

  // Per-incident AI analyst summaries (keyed by incident id) from the same
  // effective source as the prose above — live draft while editing, otherwise the
  // saved/edited server prose. Used by BOTH the structured brief (on each card)
  // and the generic country report (in the Related Incidents table). Empty when no
  // AI prose exists, in which case each surface falls back gracefully (the card to
  // its deterministic category line; the table to no summary).
  const incidentSummaries = useMemo<Record<string, string>>(() => {
    const src =
      editing && proseDraft
        ? proseDraft
        : proseResult
          ? (proseResult.edited ?? proseResult.sections)
          : null;
    return src?.incidentSummaries ?? {};
  }, [editing, proseDraft, proseResult]);

  const setProseField = (k: keyof CountryProseSections, v: string | string[]) =>
    setProseDraft((d) => (d ? { ...d, [k]: v } : d));

  // In-preview section visibility toggle (replaces the old checkbox panel).
  const toggleSectionHidden = (key: string, hide: boolean) =>
    setSectionOverrides((ov) => {
      const set = new Set(ov.hiddenSections ?? []);
      if (hide) set.add(key as CountrySectionKey);
      else set.delete(key as CountrySectionKey);
      return { ...ov, hiddenSections: Array.from(set) };
    });

  // Inline prose editor for the preview (fuel direct-edit prefill pattern):
  // the box shows EXACTLY the text currently rendered (analyst edit if present,
  // otherwise the engine default). Editing writes the draft; restoring the text
  // to the engine default stores "" so the auto narrative keeps flowing.
  const inlineProseEditor = (field: "bluf" | "executiveSummary" | "outlook" | "polestarView", engineDefault: string) => {
    const draftVal = ((proseDraft?.[field] as string | undefined) ?? "").trim();
    const value = draftVal !== "" ? (proseDraft?.[field] as string) : engineDefault;
    return (
      <textarea
        className="no-print"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setProseField(field, v.trim() === engineDefault.trim() ? "" : v);
        }}
        rows={Math.min(14, Math.max(3, value.split(/\n/).reduce((n, l) => n + Math.ceil(l.length / 90) || 1, 0) + 1))}
        style={{
          fontFamily: ROBOTO,
          fontSize: 14,
          lineHeight: 1.55,
          color: DUSK,
          width: "100%",
          border: `1px solid ${POLAR}`,
          padding: 8,
          margin: "0 0 10px 0",
          background: "#FBFCFE",
          resize: "vertical",
        }}
      />
    );
  };

  // Update a single per-incident summary in the live draft (keyed by incident
  // id). Persisted for free because the whole proseDraft is sent on save.
  const setIncidentSummary = (id: string, text: string) =>
    setProseDraft((d) =>
      d ? { ...d, incidentSummaries: { ...(d.incidentSummaries ?? {}), [id]: text } } : d,
    );

  useEffect(() => {
    if (!country) return;
    if (!incidentsData) return;
    if (seededForSlug.current === slug) return;
    seededForSlug.current = slug;
    const pick = (saved: string | null | undefined, drafted: string) => {
      const s = (saved ?? "").trim();
      return s ? (saved as string) : drafted;
    };
    setDraft({
      name: country.name ?? "",
      region: country.region ?? "",
      overview: pick(country.overview, draftedProse?.overview ?? ""),
      trendSummary: pick(country.trendSummary, draftedProse?.trendSummary ?? ""),
      implications: pick(country.implications, draftedProse?.implications ?? ""),
    });
    setMapPlacement((country.mapPlacement as CountryMapPlacement | null) ?? "end");
    setPhotoPlacement((country.photoPlacement as CountryPhotoPlacement | null) ?? "none");
    setReportPhotos(country.reportPhotos ?? []);
    {
      const savedOverrides = (country.sectionOverrides as CountrySectionOverrides | null) ?? {};
      // Normalise pre-merge hidden-section keys to the current 5-key vocabulary
      // so the checkbox state matches what the body actually hides.
      setSectionOverrides({
        ...savedOverrides,
        hiddenSections: normalizeHiddenSections(savedOverrides.hiddenSections),
      });
    }
  }, [country, incidentsData, slug, draftedProse]);

  useEffect(() => {
    if (seededForSlug.current !== null && seededForSlug.current !== slug) {
      seededForSlug.current = null;
    }
    if (baselineSeededForSlug.current !== null && baselineSeededForSlug.current !== slug) {
      baselineSeededForSlug.current = null;
      setBaselineDirty(false);
    }
  }, [slug]);

  // Seed the baseline draft once the baseline query has actually
  // resolved for this slug — either a 200 with content or a 404 telling
  // us no baseline is curated yet. Seeding before the query settles
  // would lock in EMPTY_BASELINE and then silently overwrite the real
  // record on save.
  useEffect(() => {
    if (!slug) return;
    if (baselineSeededForSlug.current === slug) return;
    if (!baselineLoaded && !baselineMissing) return;
    baselineSeededForSlug.current = slug;
    setBaselineDraft(persistedBaseline ?? EMPTY_BASELINE);
    setBaselineDirty(false);
  }, [slug, baselineLoaded, baselineMissing, persistedBaseline]);

  const setField = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const setPhotoField = (idx: number, field: keyof CountryReportPhoto, v: string) =>
    setReportPhotos((ps) => ps.map((p, i) => (i === idx ? { ...p, [field]: v } : p)));
  const movePhoto = (idx: number, dir: -1 | 1) =>
    setReportPhotos((ps) => {
      const next = [...ps];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return ps;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  const removePhoto = (idx: number) => setReportPhotos((ps) => ps.filter((_, i) => i !== idx));
  const addPhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const incoming = await Promise.all(Array.from(files).map((f) => fileToReportPhotoDataUrl(f)));
    setReportPhotos((ps) => {
      const merged: CountryReportPhoto[] = [...ps, ...incoming.map((dataUrl) => ({ dataUrl }))];
      // Bound the total inline payload so the PATCH body stays under the
      // server's express.json limit.
      let total = 0;
      const kept: CountryReportPhoto[] = [];
      for (const p of merged) {
        total += p.dataUrl.length;
        if (total > MAX_REPORT_PHOTO_BYTES) break;
        kept.push(p);
      }
      return kept;
    });
  };

  const effective = country
    ? {
        ...country,
        name: editing ? draft.name : country.name,
        region: editing ? draft.region : country.region,
        overview: editing ? draft.overview : country.overview,
        trendSummary: editing ? draft.trendSummary : country.trendSummary,
        implications: editing ? draft.implications : country.implications,
      }
    : null;

  const isJakarta = effective?.name.trim().toLowerCase() === "jakarta";
  const coverUrl = effective ? countryCoverUrl(effective.name) : undefined;
  const periodLabel = active.periodLabel;

  const downloadPdf = async () => {
    if (!effective || !draftedProse) return;
    // §33 — never generate a defective PDF. If the fail-closed gate reports a
    // critical failure the export is blocked here as well as at the button.
    if (gateBlocked) return;
    setExporting(true);
    try {
      const reportElement = reportPreviewRef.current?.querySelector<HTMLElement>(".print-report") ?? reportPreviewRef.current;
      if (!reportElement) {
        throw new Error("PDF export failed: report preview is not ready.");
      }
      await exportElementToPdf(
        reportElement,
        `polestar-country-report-${slugifyForFilename(effective.name)}.pdf`,
      );
    } finally {
      setExporting(false);
    }
  };

  const save = async () => {
    if (!country) return;
    try {
      await update.mutateAsync({
        slug,
        data: {
          name: draft.name,
          region: draft.region,
          // Durable layout controls — persisted alongside the report row, never
          // folded into the prose fingerprint cache.
          mapPlacement,
          photoPlacement,
          reportPhotos,
          sectionOverrides,
        },
      });
      // Only touch the baseline row if the editor actually changed
      // something. Without this gate, hitting Save on a country whose
      // baseline query hasn't settled (or whose editor wasn't touched)
      // would upsert whatever happens to be in `baselineDraft` and can
      // wipe curated content with empty strings/arrays.
      if (baselineDirty) {
        await upsertBaseline.mutateAsync({
          slug,
          data: {
            operatingEnvironment: baselineDraft.operatingEnvironment,
            securityContext: baselineDraft.securityContext,
            knownRiskAreas: baselineDraft.knownRiskAreas,
            keyCitiesProvinces: baselineDraft.keyCitiesProvinces,
            movementConstraints: baselineDraft.movementConstraints,
            infrastructureLimits: baselineDraft.infrastructureLimits,
            medicalEvac: baselineDraft.medicalEvac,
            resourceSectorExposure: baselineDraft.resourceSectorExposure,
            locationWatchlist: baselineDraft.locationWatchlist,
          },
        });
        qc.invalidateQueries({ queryKey: getGetCountryBaselineQueryKey(slug) });
        setBaselineDirty(false);
      }
      // Persist analyst overrides to the AI prose. Bound to the fingerprint the
      // draft was written against — a stale fingerprint (data moved on) is
      // rejected server-side so an edit can never describe an old snapshot.
      // Persist prose overrides whenever the draft holds ANY content — even
      // when no AI prose row exists yet (the server mints one from the edit).
      // A draft of all-blank fields means "keep engine text everywhere": skip
      // the call rather than minting an empty row.
      const draftHasContent =
        proseDraft != null &&
        Object.values(proseDraft).some((v) =>
          Array.isArray(v)
            ? v.some((x) => String(x).trim() !== "")
            : typeof v === "string"
              ? v.trim() !== ""
              : v != null && Object.values(v).some((x) => String(x).trim() !== ""),
        );
      const proseFp = proseResult?.fingerprint ?? lastFingerprint.current;
      if (proseDraft && draftHasContent && proseFp) {
        try {
          const res = await editProse.mutateAsync({
            slug,
            data: { fingerprint: proseFp, sections: proseDraft },
          });
          setProseResult(res);
        } catch (err) {
          // 409 = the stored row's fingerprint predates the live data basis.
          // Recover seamlessly: refresh the row against the live basis, then
          // re-apply the analyst's edit to the fresh fingerprint.
          try {
            const regen = await generateProse.mutateAsync({
              slug,
              data: {
                region: draft.region ?? "",
                basisDays: active.basisDays,
                periodWord,
                issueDate,
                incidents: proseIncidents,
                baseline: baselineContext,
                variant: proseVariant,
                force: false,
              },
            });
            lastFingerprint.current = regen.fingerprint;
            const res = await editProse.mutateAsync({
              slug,
              data: { fingerprint: regen.fingerprint, sections: proseDraft },
            });
            setProseResult(res);
          } catch (err2) {
            console.error("[CountryReport] prose edit save failed", err, err2);
            window.alert(
              "Your narrative edits could not be saved (the report data may have changed). The rest of the report was saved — please re-open Edit and try again.",
            );
          }
        }
      }
      qc.invalidateQueries({ queryKey: getGetCountryReportQueryKey(slug) });
      setEditing(false);
    } catch (err) {
      console.error("[CountryReport] save failed", err);
    }
  };

  const cancel = () => {
    if (country) {
      setDraft({
        name: country.name ?? "",
        region: country.region ?? "",
        overview: country.overview ?? "",
        trendSummary: country.trendSummary ?? "",
        implications: country.implications ?? "",
      });
      setMapPlacement((country.mapPlacement as CountryMapPlacement | null) ?? "end");
      setPhotoPlacement((country.photoPlacement as CountryPhotoPlacement | null) ?? "none");
      setReportPhotos(country.reportPhotos ?? []);
      {
      const savedOverrides = (country.sectionOverrides as CountrySectionOverrides | null) ?? {};
      // Normalise pre-merge hidden-section keys to the current 5-key vocabulary
      // so the checkbox state matches what the body actually hides.
      setSectionOverrides({
        ...savedOverrides,
        hiddenSections: normalizeHiddenSections(savedOverrides.hiddenSections),
      });
    }
    }
    setBaselineDraft(persistedBaseline ?? EMPTY_BASELINE);
    setBaselineDirty(false);
    setEditing(false);
  };

  const clearBaseline = async () => {
    if (!slug) return;
    if (!window.confirm(`Retire the curated baseline for ${effective?.name ?? "this country"}? The report will fall back to live-data layers only.`)) return;
    try {
      await deleteBaseline.mutateAsync({ slug });
      qc.invalidateQueries({ queryKey: getGetCountryBaselineQueryKey(slug) });
      setBaselineDraft(EMPTY_BASELINE);
      // Disarm the upsert path so a subsequent Save click does not
      // immediately recreate an empty baseline row.
      setBaselineDirty(false);
    } catch (err) {
      console.error("[CountryReport] baseline delete failed", err);
    }
  };

  const setBaselineField = <K extends keyof CountryBaseline>(k: K, v: CountryBaseline[K]) => {
    setBaselineDraft((b) => ({ ...b, [k]: v }));
    setBaselineDirty(true);
  };

  if (isLoading) return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK }}>Loading...</div>;
  if (!country || !effective) return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK }}>Report not found.</div>;

  const windowIncidents = facts.windowIncidents;

  // §23 — map gating. Plot ONLY included canonical events with a credible
  // precision (the shared engine's mapPoints); never Unknown / Country-only /
  // foreign / excluded / held rows. Map each engine mapPoint (eventId ===
  // window-incident id) back to the incident the map component renders. When no
  // engine dataset is available the map falls back to the raw window set.
  const mapGatedIncidents = (() => {
    const ds = pngEffectiveDataset;
    if (!ds || !ds.mapPoints) return windowIncidents;
    const plottableIds = new Set(ds.mapPoints.map((p) => String(p.eventId)));
    const gated = (windowIncidents as CountryFastFactsIncident[]).filter((i) =>
      plottableIds.has(String((i as { id?: number | string }).id ?? "")),
    );
    return gated;
  })();

  // §33 — fail-closed pre-publication quality gate. Any CRITICAL failure blocks
  // the Download PDF action (mirroring the cargo report validation gate) and
  // renders a visible failure panel (owner-only page, so admin-visible). The
  // gate is computed inside the shared dataset build, and — when an explicit
  // analyst edit overlays a section — RE-RUN here over the FINAL effective
  // narrative, so the text that renders/exports is always the text that was
  // validated. If the re-run itself throws, the gate fails CLOSED.
  // NOTE: computed inline (not useMemo) — this sits below conditional early
  // returns, so it must not be a hook.
  const gate = (() => {
    const base = pngDataset?.gate ?? null;
    if (!pngDataset || !pngEffectiveDataset || !base) return base;
    const overlaid =
      pngEffectiveDataset.bluf !== pngDataset.bluf ||
      pngEffectiveDataset.executiveSummary !== pngDataset.executiveSummary ||
      pngEffectiveDataset.whatChanged !== pngDataset.whatChanged ||
      pngEffectiveDataset.outlook !== pngDataset.outlook ||
      pngEffectiveDataset.polestarView !== pngDataset.polestarView;
    if (!overlaid) return base;
    try {
      const n = pngDataset.engineNarrative;
      const patched = {
        ...n,
        bluf: pngEffectiveDataset.bluf,
        currentSituation: pngEffectiveDataset.executiveSummary,
        outlook: pngEffectiveDataset.outlook,
        polestarView: pngEffectiveDataset.polestarView,
        sectionWordCounts: {
          ...n.sectionWordCounts,
          "Bottom Line Up Front": countWords(pngEffectiveDataset.bluf),
          "Current Situation": countWords(pngEffectiveDataset.executiveSummary),
          Outlook: countWords(pngEffectiveDataset.outlook),
          "Pole Star View": countWords(pngEffectiveDataset.polestarView),
        },
      };
      const rerun = runQualityGate({
        ...pngDataset.gateReport,
        narrative: patched,
        sectionWordCounts: patched.sectionWordCounts,
        // localityScope rides in on pngDataset.gateReport (Jakarta only) and
        // already carries the raw-source-row fallback — a merged/translated
        // canonical title can lose its Jakarta token even though the source
        // row passed isJakartaScoped, so re-defining a canonical-fields-only
        // predicate here would reinstate that false fail on analyst edits.
      });
      // whatChanged is analyst-editable but not a §31 narrative section — still
      // scan the edited text for §30 banned phrases so no overlay escapes the
      // language gate.
      const extra = findBannedPhrases(pngEffectiveDataset.whatChanged ?? "").map(
        (phrase) => ({
          check: "no_banned_phrase" as const,
          severity: "critical" as const,
          message: `Banned phrase "${phrase}" appears in What Changed (analyst edit).`,
          section: "What Changed",
        }),
      );
      return extra.length > 0
        ? { passed: false, failures: [...rerun.failures, ...extra] }
        : rerun;
    } catch {
      return {
        passed: false,
        failures: [
          {
            check: "gate_rerun_failed",
            severity: "critical" as const,
            message:
              "Quality gate could not be re-run over the edited narrative; export is blocked (fail-closed).",
          },
        ],
      };
    }
  })();
  const gateFailures = gate?.failures ?? [];
  const gateBlocked = gate ? gate.passed === false : false;

  // Non-blocking §13 quality-control pass over the built structured brief. Pure
  // and never throws; a non-empty result renders as a subdued-red, no-print
  // banner (below) so the analyst sees a consistency problem without the report
  // silently shipping wrong. Uses the SAME window incidents the map plots from.
  const qcWarnings = pngDataset
    ? (() => {
        try {
          return runCountryReportQc(
            pngDataset,
            windowIncidents as CountryReportQcMapIncident[],
          );
        } catch {
          return [];
        }
      })()
    : [];

  // Analyst-placed incident map node, rendered at the chosen placement slot.
  // Jakarta uses a corridor & access schematic (operating-exposure graphic)
  // instead of the numbered incident-dot map; all other theatres are unchanged.
  // City reports (Jakarta today; Manila/Bangkok planned) are framed as CITY, not
  // COUNTRY, reports — driven by the shared reportKind registry.
  const isCity = isCityReport(effective.name);
  const jakartaMapCaption = pngEffectiveDataset?.jakartaTacticalBrief?.mapCaption ?? "";
  const mapNode = isJakarta ? (
    // Jakarta's corridor schematic and its one-line exposure caption stay as a
    // keep-together block. The caption replaces the former seven-zone table.
    <div data-pdf-keep="true">
      <JakartaCorridorMap
        incidents={windowIncidents as CountryFastFactsIncident[]}
        issueDate={issueDate}
        coverageUnconfirmed={coverage.state === "coverage-problem"}
      />
      {jakartaMapCaption
        ? jakartaMapCaption.split(/\n+/).map((p, i) => (
            <p
              key={i}
              style={{ fontFamily: ROBOTO, fontSize: 11, lineHeight: 1.45, color: DUSK, margin: "8px 0 0 0", fontStyle: "italic" }}
            >
              {p}
            </p>
          ))
        : null}
    </div>
  ) : (
    <CountryReportMap
      incidents={mapGatedIncidents as CountryFastFactsIncident[]}
      countryName={effective.name}
    />
  );
  // Analyst-attached photo block, rendered at the chosen placement slot.
  const photoBlock = reportPhotos.length > 0 ? <CountryReportPhotoBlock photos={reportPhotos} /> : null;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6" style={{ fontFamily: ROBOTO, color: DUSK }}>
      {/* Top toolbar (not printed) */}
      <div className="flex items-center justify-between no-print">
        <Link
          href="/countries"
          className="text-xs uppercase tracking-widest hover:opacity-70 inline-flex items-center gap-1"
          style={{ color: DUSK, fontFamily: ROBOTO }}
        >
          <ArrowLeft className="w-3 h-3" /> All Countries
        </Link>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={cancel}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                onClick={save}
                disabled={update.isPending}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
                style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${NAVY}`, background: NAVY, color: "#fff" }}
              >
                {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {update.isPending ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={redraft}
                disabled={proseBusy}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
                title="Regenerate the narrative from the current incidents"
              >
                {proseBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {proseBusy ? "Drafting..." : "Redraft"}
              </button>
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm"
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
                title="Edit report"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </>
          )}
          <button
            onClick={downloadPdf}
            disabled={exporting || editing || gateBlocked}
            title={
              editing
                ? "Save or cancel edits before exporting"
                : gateBlocked
                  ? "Download blocked: the pre-publication quality gate reported critical failures"
                  : "Download PDF"
            }
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
            style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${ELECTRIC}`, background: ELECTRIC, color: "#fff" }}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </button>
        </div>
      </div>

      {/* §33 — fail-closed quality-gate failure panel. Owner-only page, so the
          admin sees every failed critical check. Not printed. */}
      {gateBlocked && (
        <div
          className="no-print"
          style={{
            fontFamily: ROBOTO,
            fontSize: 12,
            color: "#7a1f1f",
            background: "#fdecec",
            border: "1px solid #e6b3b3",
            borderRadius: 4,
            padding: "10px 14px",
            marginTop: 8,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            PDF blocked — the pre-publication quality gate failed. Resolve the
            following before exporting:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {gateFailures
              .filter((f) => f.severity === "critical")
              .map((f, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{f.check}</span>: {f.message}
                </li>
              ))}
          </ul>
        </div>
      )}

      {proseUnavailable && (
        <div
          className="no-print"
          style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, marginTop: 8, fontStyle: "italic" }}
        >
          AI narrative is unavailable right now — showing the template draft. Try Redraft shortly.
        </div>
      )}

      {proseResult?.stale && (
        <div
          className="no-print"
          style={{
            fontFamily: ROBOTO,
            fontSize: 12,
            color: "#A33232",
            border: "1px solid #A33232",
            borderRadius: 2,
            background: "#fff",
            padding: "6px 10px",
            marginTop: 8,
          }}
        >
          Your saved narrative edit is being kept, but the underlying data has
          changed since it was written — it may no longer match the current
          incidents. Review it and re-save, or use Redraft to start from the
          fresh AI draft.
        </div>
      )}

      {/* Owner-only country-engine review panel (§29–32). Rendered OUTSIDE the
          `.print-report` element below and carries `no-print`, so it never
          reaches the on-screen report, in-app PDF, or headless re-render. */}

      {qcWarnings.length > 0 && (
        <div
          className="no-print"
          style={{
            fontFamily: ROBOTO,
            fontSize: 12,
            // Advisory-only, non-blocking — must read as a caution, not a
            // failure. Reusing the app's real MODERATE severity tone (see
            // RATING_COLORS in lib/topics.ts) instead of the alarming red
            // previously borrowed from the blocking-critical panel above,
            // which made a non-blocking notice look like an export failure.
            color: RATING_COLORS.moderate,
            border: `1px solid ${RATING_COLORS.moderate}`,
            borderRadius: 2,
            background: "#fff",
            padding: "6px 10px",
            marginTop: 8,
          }}
        >
          <strong>Report quality checks</strong> flagged {qcWarnings.length}{" "}
          {qcWarnings.length === 1 ? "item" : "items"}. This is advisory only —
          the report still exports.
          <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
            {qcWarnings.map((w, i) => (
              <li key={i} style={{ marginTop: 2 }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Polestar header band — matches Watch report cover treatment */}
      <div ref={reportPreviewRef} className="print-report bg-white" style={{ color: NAVY, fontFamily: ROBOTO }}>
        <div className="pdf-cover-page">
        <div
          className="flex items-center"
          style={{
            background: BRAND_GRADIENT,
            color: "#fff",
            height: 64,
            paddingLeft: 24,
            paddingRight: 24,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        >
          <img src={polestarLogo} alt="Polestar Advisory" style={{ height: 26, width: "auto", maxWidth: 180, display: "block" }} />
        </div>
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            background: BRAND_GRADIENT,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
            overflow: "hidden",
          }}
        >
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          )}
        </div>
        <div
          style={{
            background: BRAND_GRADIENT,
            color: "#fff",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
            paddingLeft: 32,
            paddingRight: 32,
            paddingTop: 40,
            paddingBottom: 28,
          }}
        >
          {isCity && (
            <div
              className="uppercase"
              style={{ fontFamily: ROBOTO, fontWeight: 700, fontSize: 13, letterSpacing: "0.22em", marginBottom: 10 }}
            >
              CITY REPORT
            </div>
          )}
          <h1
            className="mb-4"
            style={{
              fontFamily: ROBOTO,
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.05,
              textTransform: "uppercase",
            }}
          >
            {effective.name || reportKindLabel(effective.name)}
          </h1>
          <div className="uppercase" style={{ fontFamily: ROBOTO, fontWeight: 700, fontSize: 13, letterSpacing: "0.22em", marginBottom: 6 }}>
            POLESTAR INSIGHTS
          </div>
          <div className="uppercase" style={{ fontFamily: ROBOTO, fontWeight: 400, fontSize: 12, letterSpacing: "0.18em", color: "rgba(255,255,255,0.92)" }}>
            REPORTING PERIOD: {periodLabel.toUpperCase()}
          </div>
          <div className="uppercase" style={{ fontFamily: ROBOTO, fontWeight: 700, fontSize: 11, letterSpacing: "0.18em", marginTop: 32 }}>
            polestar-advisory.com
          </div>
        </div>
        </div>

        <div className="px-10 py-10 space-y-8">
      {/* "Cover" photo placement — analyst-attached imagery leads the report. */}
      {photoPlacement === "cover" && photoBlock}
      {!sourcesLoading && coverage.showBanner && (
        <div
          style={{
            border: `1px solid ${POLAR}`,
            borderLeft: `4px solid ${ELECTRIC}`,
            background: "#fff",
            padding: "12px 16px",
            borderRadius: 2,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        >
          <div
            style={{
              fontFamily: ROBOTO,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: NAVY,
              marginBottom: 4,
            }}
          >
            {coverage.title}
          </div>
          <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, lineHeight: 1.5 }}>
            {coverage.detail}
          </div>
        </div>
      )}
      <div
        className="hidden"
        style={{
          background: `linear-gradient(to right, ${NAVY} 0%, ${NAVY} 38%, ${ELECTRIC} 100%)`,
          borderRadius: 2,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      >
        <img
          src={polestarLogo}
          alt="Polestar Advisory"
          className="shrink-0 h-9 w-auto"
          style={{ maxWidth: 220 }}
        />
        {editing ? (
          <div className="flex flex-col items-end gap-1 w-1/2">
            <input
              value={draft.region}
              onChange={(e) => setField("region", e.target.value)}
              placeholder="Region"
              style={{ fontFamily: ROBOTO }}
              className="bg-white/10 border border-white/30 rounded-sm px-2 py-1 text-xs uppercase tracking-widest text-white placeholder-white/60 text-right w-48"
            />
            <input
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Country name"
              style={{ fontFamily: ROBOTO, fontWeight: 700 }}
              className="bg-white/10 border border-white/30 rounded-sm px-3 py-2 text-2xl uppercase tracking-tight text-white text-right w-full"
            />
          </div>
        ) : (
          <div className="text-right">
            <div style={{ fontFamily: ROBOTO, fontSize: 11, letterSpacing: "0.18em", opacity: 0.85 }} className="uppercase">
              Polestar Insights · {reportKindLabel(effective.name)}
            </div>
            <h1 style={{ fontFamily: ROBOTO, fontWeight: 700, fontSize: 30, letterSpacing: "0", lineHeight: 1.1, marginTop: 6 }} className="uppercase">
              {effective.name}
            </h1>
            {effective.region && (
              <div style={{ fontFamily: ROBOTO, fontSize: 12, letterSpacing: "0.12em", opacity: 0.9, marginTop: 6 }} className="uppercase">
                {effective.region}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cover photo (if registered) */}
      {coverUrl && (
        <div
          style={{
            display: "none",
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            height: 220,
            borderRadius: 2,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
      )}

      {/* Edit mode: the rarely-touched setup lives in ONE collapsed drawer so
          week-to-week editing happens in the preview itself (owner ruling,
          11 Aug 2026). Section visibility + narrative prose moved in-preview. */}
      {editing && (
        <details className="no-print" style={{ border: `1px solid ${POLAR}`, borderRadius: 2, padding: 12, marginBottom: 16 }}>
        <summary style={{ fontFamily: ROBOTO, fontSize: 13, fontWeight: 600, color: NAVY, cursor: "pointer" }}>
          Report setup &amp; advanced — name, baseline, layout, photos, incident selection
        </summary>
        <Section title="Report Details">
          <div className="grid md:grid-cols-2 gap-3">
            <input
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="Country name"
              style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, padding: 10, color: DUSK }}
            />
            <input
              value={draft.region}
              onChange={(e) => setField("region", e.target.value)}
              placeholder="Region"
              style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, padding: 10, color: DUSK }}
            />
          </div>
        </Section>

        <Section title="Country Baseline">
          <BaselineEditor
            baseline={baselineDraft}
            setField={setBaselineField}
            onClear={clearBaseline}
            clearing={deleteBaseline.isPending}
          />
        </Section>

        <Section title="Report Layout">
          <div className="grid md:grid-cols-2 gap-3">
            <label style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, display: "block" }}>
              Incident map placement
              <select
                value={mapPlacement}
                onChange={(e) => setMapPlacement(e.target.value as CountryMapPlacement)}
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, padding: 8, color: DUSK, width: "100%", marginTop: 4 }}
              >
                <option value="none">Hidden</option>
                <option value="after-bluf">After Bottom Line</option>
                <option value="after-top3">After Top 3 Developments</option>
                <option value="after-incident-details">After Incident Details</option>
                <option value="before-outlook">Before Outlook</option>
                <option value="before-polestar">Before Polestar View</option>
                <option value="end">At end (above supporting context)</option>
              </select>
            </label>
            <label style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, display: "block" }}>
              Photo placement
              <select
                value={photoPlacement}
                onChange={(e) => setPhotoPlacement(e.target.value as CountryPhotoPlacement)}
                style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, padding: 8, color: DUSK, width: "100%", marginTop: 4 }}
              >
                <option value="none">Hidden</option>
                <option value="cover">On cover</option>
                <option value="after-bluf">After Bottom Line</option>
                <option value="after-top3">After Top 3 Developments</option>
                <option value="inside-incident-details">Inside Incident Details</option>
                <option value="before-polestar">Before Polestar View</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                void addPhotoFiles(e.target.files);
                e.target.value = "";
              }}
              style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}
            />
          </div>
          {reportPhotos.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {reportPhotos.map((p, i) => (
                <div
                  key={i}
                  style={{ border: `1px solid ${POLAR}`, padding: 10, borderRadius: 2, display: "flex", gap: 12 }}
                >
                  <img
                    src={p.dataUrl}
                    alt=""
                    style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 2, border: `1px solid ${POLAR}` }}
                  />
                  <div style={{ flex: 1, display: "grid", gap: 6 }}>
                    <input
                      value={p.caption ?? ""}
                      onChange={(e) => setPhotoField(i, "caption", e.target.value)}
                      placeholder="Caption"
                      style={{ fontFamily: ROBOTO, fontSize: 12, border: `1px solid ${POLAR}`, padding: 8, color: DUSK }}
                    />
                    <input
                      value={p.context ?? ""}
                      onChange={(e) => setPhotoField(i, "context", e.target.value)}
                      placeholder="Context"
                      style={{ fontFamily: ROBOTO, fontSize: 12, border: `1px solid ${POLAR}`, padding: 8, color: DUSK }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={p.source ?? ""}
                        onChange={(e) => setPhotoField(i, "source", e.target.value)}
                        placeholder="Source"
                        style={{ fontFamily: ROBOTO, fontSize: 12, border: `1px solid ${POLAR}`, padding: 8, color: DUSK }}
                      />
                      <input
                        value={p.credit ?? ""}
                        onChange={(e) => setPhotoField(i, "credit", e.target.value)}
                        placeholder="Credit"
                        style={{ fontFamily: ROBOTO, fontSize: 12, border: `1px solid ${POLAR}`, padding: 8, color: DUSK }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => movePhoto(i, -1)}
                        disabled={i === 0}
                        style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "4px 10px", color: DUSK, opacity: i === 0 ? 0.4 : 1 }}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => movePhoto(i, 1)}
                        disabled={i === reportPhotos.length - 1}
                        style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "4px 10px", color: DUSK, opacity: i === reportPhotos.length - 1 ? 0.4 : 1 }}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid #A33232`, padding: "4px 10px", color: "#A33232" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Section visibility moved in-preview: each rendered section heading
              carries a Hide control, and hidden sections leave a Show stub. */}

          {/* Incident curation — include / exclude and demote-only severity for
              each relevance-passing window incident. STRICT no-fabrication: the
              analyst chooses only from this pool; nothing can be added or
              up-rated. */}
          {curationPool.length > 0 && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${POLAR}`, paddingTop: 12 }}>
              <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, fontWeight: 600, marginBottom: 8 }}>
                Incident selection &amp; severity ({curationPool.length} this week)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {curationPool.map((inc) => {
                  const id = String(inc.id);
                  const excluded = (sectionOverrides.excludedIncidentIds ?? []).includes(id);
                  const stored = (inc.severity ?? "").trim().toLowerCase();
                  const demoteTo = sectionOverrides.severityDemotions?.[id] ?? "";
                  return (
                    <div
                      key={id}
                      style={{ border: `1px solid ${POLAR}`, padding: 8, borderRadius: 2, display: "flex", gap: 10, alignItems: "flex-start", opacity: excluded ? 0.5 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={(e) => {
                          setSectionOverrides((ov) => {
                            const set = new Set(ov.excludedIncidentIds ?? []);
                            if (e.target.checked) set.delete(id);
                            else set.add(id);
                            return { ...ov, excludedIncidentIds: Array.from(set) };
                          });
                        }}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: ROBOTO, fontSize: 12, color: MIDNIGHT }}>
                          {inc.displayTitle ?? inc.title}
                        </div>
                        <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 2 }}>
                          Stored severity: {stored || "—"}
                          {inc.location ? ` · ${inc.location}` : ""}
                        </div>
                      </div>
                      <select
                        value={demoteTo}
                        disabled={excluded}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSectionOverrides((ov) => {
                            const next = { ...(ov.severityDemotions ?? {}) };
                            if (v) next[id] = v;
                            else delete next[id];
                            return { ...ov, severityDemotions: next };
                          });
                        }}
                        style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: 4, color: DUSK }}
                      >
                        <option value="">Keep severity</option>
                        {SEVERITY_DEMOTE_OPTIONS.filter((o) => SEVERITY_ORDER[o] < (SEVERITY_ORDER[stored] ?? 4)).map((o) => (
                          <option key={o} value={o}>
                            Demote to {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Section>

        {proseDraft && (
        <Section title="Narrative (advanced)">
          {pngDataset && pngDataset.proseVariant === "operating-risk" ? (
            // Operating-risk briefs (Indonesia / Jakarta / every generic country)
            // render a deterministic, business-language narrative from the live
            // window — the section prose is intentionally NOT editable so it can
            // never drift from the data or persist as stale hidden prose. Only the
            // per-incident analyst summary on each card is editable.
            <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginBottom: 10, fontStyle: "italic" }}>
              The written brief is generated deterministically from this window's incidents and is not
              directly editable. Refine the one-line analyst summary shown on each incident card below.
            </div>
          ) : (
            <>
              <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginBottom: 10, fontStyle: "italic" }}>
                Edit the main narrative directly in the preview below — each prose block is an
                editable box while editing. Only What Changed (not rendered as its own block)
                lives here. Edits are saved against the current data; if the data later changes,
                use Redraft to regenerate.
              </div>
              <BaselineTextField label="What Changed" value={proseDraft.whatChanged ?? ""} onChange={(v) => setProseField("whatChanged", v)} />
            </>
          )}
          {pngDataset && pngDataset.windowItems.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: ROBOTO, fontSize: 12, fontWeight: 600, color: NAVY, marginBottom: 6 }}>
                Incident Summaries
              </div>
              <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginBottom: 10, fontStyle: "italic" }}>
                One analyst summary per incident, grounded on its own reporting. Shown on each incident card.
              </div>
              {pngDataset.windowItems.map((it) => (
                <BaselineTextField
                  key={it.id}
                  label={it.title}
                  value={proseDraft.incidentSummaries?.[it.id] ?? ""}
                  onChange={(v) => setIncidentSummary(it.id, v)}
                />
              ))}
            </div>
          )}
        </Section>
        )}
        </details>
      )}

      {/* EVERY theatre — structured, generic and Jakarta — renders the shared
          canonical brief from PngCountryReportBody. Jakarta's tactical evidence
          tables are folded INSIDE the canonical sections (behind the dataset's
          jakartaTacticalBrief). Mapping is the only per-theatre variation: the
          analyst-placed map slot carries Jakarta's corridor schematic and its
          area summary caption instead of the numbered incident-dot map. */}
      {pngEffectiveDataset && (
        <PngCountryReportBody
          dataset={pngEffectiveDataset}
          incidentSummaries={incidentSummaries}
          mapPlacement={mapPlacement}
          mapNode={mapNode}
          photoPlacement={photoPlacement}
          photoNode={photoBlock}
          hiddenSections={sectionOverrides.hiddenSections ?? []}
          editUi={
            editing
              ? {
                  sectionChrome: (key, hidden) =>
                    hidden ? (
                      <div
                        className="no-print"
                        style={{
                          fontFamily: ROBOTO,
                          fontSize: 12,
                          color: DUSK,
                          border: `1px dashed ${POLAR}`,
                          padding: "6px 10px",
                          margin: "0 0 14px 0",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>
                          {COUNTRY_SECTION_LABELS[key as CountrySectionKey] ?? key} — hidden from
                          this report
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleSectionHidden(key, false)}
                          style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "2px 8px", color: NAVY, cursor: "pointer" }}
                        >
                          Show
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="no-print"
                        onClick={() => toggleSectionHidden(key, true)}
                        style={{
                          fontFamily: ROBOTO,
                          fontSize: 11,
                          fontWeight: 400,
                          letterSpacing: 0,
                          textTransform: "none",
                          border: `1px solid ${POLAR}`,
                          padding: "2px 8px",
                          color: DUSK,
                          background: "white",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        Hide section
                      </button>
                    ),
                  prose:
                    pngDataset && pngDataset.proseVariant !== "operating-risk" && proseDraft
                      ? {
                          bluf: inlineProseEditor("bluf", pngDataset.bluf),
                          executiveSummary: inlineProseEditor("executiveSummary", pngDataset.executiveSummary),
                          outlook: inlineProseEditor("outlook", pngDataset.outlook),
                          polestarView: inlineProseEditor("polestarView", pngDataset.polestarView),
                        }
                      : undefined,
                  // Top 3 Developments curation — remove/pin per card, set an
                  // exact severity (analyst authority, either direction), and
                  // add any other window incident into the section.
                  top3ItemControls: (item) => {
                    const id = String(item.id);
                    const pinned = (sectionOverrides.top3PinnedIds ?? []).includes(id);
                    const overrideTo = sectionOverrides.severityOverrides?.[id] ?? "";
                    return (
                      <div
                        className="no-print"
                        style={{ display: "flex", gap: 8, alignItems: "center", margin: "-4px 0 10px", justifyContent: "flex-end" }}
                      >
                        {pinned && (
                          <span style={{ fontFamily: ROBOTO, fontSize: 10, color: DUSK, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            Pinned by analyst
                          </span>
                        )}
                        <select
                          value={overrideTo}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSectionOverrides((ov) => {
                              const next = { ...(ov.severityOverrides ?? {}) };
                              if (v) next[id] = v;
                              else delete next[id];
                              return { ...ov, severityOverrides: next };
                            });
                          }}
                          style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "2px 6px", color: DUSK }}
                        >
                          <option value="">Rating: auto ({item.severityLabel})</option>
                          {Object.keys(SEVERITY_ORDER).map((o) => (
                            <option key={o} value={o}>
                              Set rating: {o}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setSectionOverrides((ov) => {
                              const pins = new Set(ov.top3PinnedIds ?? []);
                              const excl = new Set(ov.top3ExcludedIds ?? []);
                              if (pins.has(id)) pins.delete(id);
                              else excl.add(id);
                              return {
                                ...ov,
                                top3PinnedIds: Array.from(pins),
                                top3ExcludedIds: Array.from(excl),
                              };
                            });
                          }}
                          style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "2px 8px", color: NAVY, background: "white", cursor: "pointer" }}
                        >
                          Remove from Top 3
                        </button>
                      </div>
                    );
                  },
                  top3Extras: (() => {
                    const shown = new Set(
                      (pngEffectiveDataset?.topThree ?? []).map((it) => String(it.id)),
                    );
                    const removed = (sectionOverrides.top3ExcludedIds ?? []).filter(
                      (id) => !shown.has(String(id)),
                    );
                    const candidates = (pngEffectiveDataset?.windowItems ?? []).filter(
                      (it) => !shown.has(String(it.id)),
                    );
                    return (
                      <div className="no-print" style={{ borderTop: `1px dashed ${POLAR}`, paddingTop: 8, marginTop: 4 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <select
                            value=""
                            onChange={(e) => {
                              const id = e.target.value;
                              if (!id) return;
                              setSectionOverrides((ov) => {
                                const pins = new Set(ov.top3PinnedIds ?? []);
                                pins.add(id);
                                const excl = new Set(ov.top3ExcludedIds ?? []);
                                excl.delete(id);
                                return {
                                  ...ov,
                                  top3PinnedIds: Array.from(pins),
                                  top3ExcludedIds: Array.from(excl),
                                };
                              });
                            }}
                            style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "4px 6px", color: DUSK, maxWidth: 480 }}
                          >
                            <option value="">Add a development from this week…</option>
                            {candidates.map((it) => (
                              <option key={it.id} value={String(it.id)}>
                                {(it.developmentTitle ?? it.title).slice(0, 90)}
                                {it.province ? ` · ${it.province}` : ""}
                              </option>
                            ))}
                          </select>
                          {removed.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setSectionOverrides((ov) => ({ ...ov, top3ExcludedIds: [] }))
                              }
                              style={{ fontFamily: ROBOTO, fontSize: 11, border: `1px solid ${POLAR}`, padding: "2px 8px", color: DUSK, background: "white", cursor: "pointer" }}
                            >
                              Restore removed ({removed.length})
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })(),
                }
              : null
          }
        />
      )}

      {/* "End" map placement — the incident map renders here, just above the
          shared analytics block, when the analyst leaves it at the default. */}
      {mapPlacement === "end" && mapNode}

      {/* Situational Context reference layer — rendered below the written brief
          for EVERY country (structured and generic). Per the reworked country
          standard the Severity Distribution and Incident Breakdown by Type
          charts are no longer shown by default. */}
      {!isJakarta && (
        <CountryReportVisuals
          countryName={effective.name}
          situationalReports={situationalReports}
        />
      )}

      {/* Internal Source Coverage — screen-only, never in the PDF.
          Surfaces the layer counts and any thin-data signal for the
          analyst working in the Workbench, so they can decide whether
          to dispatch a stringer or widen the source set on the Sources
          page. Not for the client-facing report. */}
      <div className="no-print" style={{
        marginTop: 10,
        borderTop: `1px solid ${POLAR}`,
        background: "transparent",
        padding: "8px 0 0",
        borderRadius: 0,
        opacity: 0.85,
      }}>
        <div style={{ fontFamily: ROBOTO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: DUSK, fontWeight: 700 }}>
          Internal · Source coverage (not in PDF)
        </div>
        <ul style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, margin: "6px 0 0 16px", padding: 0, lineHeight: 1.5 }}>
          <li>Active reporting basis: <strong>{active.basisLabel}</strong></li>
          <li>Current 7-day window: <strong>{layers.current.length}</strong> record{layers.current.length === 1 ? "" : "s"}</li>
          <li>30-day context window: <strong>{layers.thirtyDay.length}</strong> record{layers.thirtyDay.length === 1 ? "" : "s"}</li>
          <li>90-day background window: <strong>{layers.ninetyDay.length}</strong> record{layers.ninetyDay.length === 1 ? "" : "s"}</li>
          <li style={{ marginTop: 6 }}>
            Country coverage feeds:{" "}
            <strong style={{ color: sourceSignals.country.unhealthy > 0 ? "#A33232" : DUSK }}>
              {sourceSignals.country.healthy}/{sourceSignals.country.total} healthy
            </strong>
            {sourceSignals.country.unhealthy > 0 && ` — failing/stale: ${sourceSignals.country.unhealthyNames.join(", ")}`}
          </li>
          <li>
            Flashpoint topic feeds:{" "}
            <strong style={{ color: sourceSignals.topic.unhealthy > 0 ? "#A33232" : DUSK }}>
              {sourceSignals.topic.healthy}/{sourceSignals.topic.total} healthy
            </strong>
          </li>
          <li>
            Specialist (cargo) feeds:{" "}
            <strong style={{ color: sourceSignals.specialist.unhealthy > 0 ? "#A33232" : DUSK }}>
              {sourceSignals.specialist.healthy}/{sourceSignals.specialist.total} healthy
            </strong>
            {sourceSignals.specialist.unhealthy > 0 && " — does not affect country coverage"}
          </li>
          {layers.thirtyDay.length < 3 && (
            <li style={{ color: "#A33232" }}>
              30-day context record count is thin (&lt;3). Treat as a coverage signal rather than a clean operating picture — check the Sources page for failing / stale feeds on this country and consider widening local-press coverage.
            </li>
          )}
        </ul>
      </div>

      {/* Disclaimer */}
      <Section title="Disclaimer">
        <Prose text={DISCLAIMER_TEXT} />
      </Section>

        </div>

      <div
        className="pdf-preview-footer px-10 flex items-center justify-between"
        style={{ background: POLAR, color: DUSK, fontFamily: ROBOTO, fontSize: 11, minHeight: 36 }}
      >
        <span>polestar-advisory.com</span>
        <span>info@polestar-advisory.com</span>
        <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local presentation components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="report-section">
      <h2
        style={{
          fontFamily: ROBOTO,
          fontWeight: 700,
          fontSize: 18,
          color: NAVY,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          borderBottom: `2px solid ${ELECTRIC}`,
          paddingBottom: 6,
          marginBottom: 14,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  if (!text) return <EmptyNote>Not populated.</EmptyNote>;
  return (
    <div>
      {text.split(/\n+/).map((p, i) => (
        <p
          key={i}
          style={{ fontFamily: ROBOTO, fontSize: 14, lineHeight: 1.55, color: DUSK, margin: "0 0 10px 0" }}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK, fontStyle: "italic" }}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Country Baseline editor
// ---------------------------------------------------------------------------

function BaselineEditor({
  baseline,
  setField,
  onClear,
  clearing,
}: {
  baseline: CountryBaseline;
  setField: <K extends keyof CountryBaseline>(k: K, v: CountryBaseline[K]) => void;
  onClear?: () => void;
  clearing?: boolean;
}) {
  return (
    <div>
      <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, fontStyle: "italic", marginBottom: 10 }}>
        Edits here update the curated country baseline. Save the report (top right) to persist; cancel to discard. Baseline content is reference material — keep it stable across reporting cycles.
      </div>

      <BaselineTextField
        label="Operating Environment"
        value={baseline.operatingEnvironment}
        onChange={(v) => setField("operatingEnvironment", v)}
      />
      <BaselineTextField
        label="Security Context"
        value={baseline.securityContext}
        onChange={(v) => setField("securityContext", v)}
      />
      <BaselineListField
        label="Known Risk Areas"
        items={baseline.knownRiskAreas}
        onChange={(v) => setField("knownRiskAreas", v)}
        placeholder="One risk area per row (geography, dispute, recurring trigger)"
      />
      <BaselineListField
        label="Key Cities / Provinces"
        items={baseline.keyCitiesProvinces}
        onChange={(v) => setField("keyCitiesProvinces", v)}
        placeholder="One city or province per row"
      />
      <BaselineTextField
        label="Movement Constraints"
        value={baseline.movementConstraints}
        onChange={(v) => setField("movementConstraints", v)}
      />
      <BaselineTextField
        label="Infrastructure Limits"
        value={baseline.infrastructureLimits}
        onChange={(v) => setField("infrastructureLimits", v)}
      />
      <BaselineTextField
        label="Medical / Evacuation"
        value={baseline.medicalEvac}
        onChange={(v) => setField("medicalEvac", v)}
      />
      <BaselineTextField
        label="Resource-Sector Exposure"
        value={baseline.resourceSectorExposure}
        onChange={(v) => setField("resourceSectorExposure", v)}
      />

      <WatchlistEditor
        items={baseline.locationWatchlist}
        onChange={(v) => setField("locationWatchlist", v)}
      />

      {onClear && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${POLAR}`, paddingTop: 12 }}>
          <button
            type="button"
            onClick={onClear}
            disabled={clearing}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
            style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid #A33232`, color: "#A33232", background: "#fff" }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {clearing ? "Retiring..." : "Retire curated baseline"}
          </button>
          <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 6, fontStyle: "italic" }}>
            Removes the curated baseline for this country. The report will fall back to live-data layers only.
          </div>
        </div>
      )}
    </div>
  );
}

function BaselineTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(3, Math.min(12, value.split("\n").length + 1))}
        style={{
          width: "100%", background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2,
          padding: 10, fontFamily: ROBOTO, fontSize: 13, color: DUSK, lineHeight: 1.55, outline: "none",
        }}
      />
    </div>
  );
}

function BaselineListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  // Stored as `string[]` but edited as a textarea: one entry per line.
  // This keeps the editor lightweight (no per-row state management)
  // while preserving order on save.
  const text = items.join("\n");
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <textarea
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value.split("\n").map((s) => s.trimEnd());
          // Preserve trailing blank rows while typing; only trim on save.
          onChange(next);
        }}
        onBlur={(e) => {
          // On blur, drop empty rows so the saved baseline stays tidy.
          const clean = e.target.value
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          onChange(clean);
        }}
        rows={Math.max(3, Math.min(12, items.length + 2))}
        style={{
          width: "100%", background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2,
          padding: 10, fontFamily: ROBOTO, fontSize: 13, color: DUSK, lineHeight: 1.55, outline: "none",
        }}
      />
    </div>
  );
}

function WatchlistEditor({
  items,
  onChange,
}: {
  items: Array<{ label: string; note: string; match: string[] }>;
  onChange: (v: Array<{ label: string; note: string; match: string[] }>) => void;
}) {
  const update = (i: number, patch: Partial<{ label: string; note: string; match: string[] }>) => {
    onChange(items.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };
  const remove = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...items, { label: "", note: "", match: [] }]);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY, fontWeight: 700, marginBottom: 4 }}>
        Location Watchlist
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, fontStyle: "italic", marginBottom: 8 }}>
        Each entry is reported against the current / 30 / 90 windows regardless of whether incidents land. Match tokens are case-insensitive substrings checked against incident.location, incident.title and incident.summary — separate multiple spellings with commas.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((row, i) => (
          <div
            key={i}
            style={{
              border: `1px solid ${POLAR}`,
              background: "#fff",
              borderRadius: 2,
              padding: 10,
              display: "grid",
              gridTemplateColumns: "1fr 1.5fr 1.5fr auto",
              gap: 8,
              alignItems: "start",
            }}
          >
            <input
              value={row.label}
              placeholder="Display label"
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2, padding: 8, fontFamily: ROBOTO, fontSize: 13, color: DUSK, outline: "none" }}
            />
            <input
              value={row.note}
              placeholder="Why it's on the watchlist"
              onChange={(e) => update(i, { note: e.target.value })}
              style={{ background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2, padding: 8, fontFamily: ROBOTO, fontSize: 13, color: DUSK, outline: "none" }}
            />
            <input
              value={row.match.join(", ")}
              placeholder="Match tokens, comma separated"
              onChange={(e) =>
                update(i, {
                  match: e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter((s) => s.length > 0),
                })
              }
              style={{ background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2, padding: 8, fontFamily: ROBOTO, fontSize: 13, color: DUSK, outline: "none" }}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove watchlist entry"
              className="inline-flex items-center justify-center"
              style={{ background: "#fff", border: `1px solid ${POLAR}`, borderRadius: 2, padding: 8, color: "#A33232", cursor: "pointer" }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, fontStyle: "italic" }}>
            No watchlist entries. Add a city, corridor or sector the report should always read against.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm mt-2"
        style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${NAVY}`, color: NAVY, background: "#fff" }}
      >
        <Plus className="w-3.5 h-3.5" /> Add location
      </button>
    </div>
  );
}
