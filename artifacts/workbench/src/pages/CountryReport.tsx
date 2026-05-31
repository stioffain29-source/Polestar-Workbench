import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetCountryReport,
  useListIncidents,
  useListSources,
  useUpdateCountryReport,
  useGetCountryBaseline,
  useUpsertCountryBaseline,
  useDeleteCountryBaseline,
  getGetCountryReportQueryKey,
  getGetCountryBaselineQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import DataAsOfBanner from "@/components/DataAsOfBanner";
import { computeDataAsOf } from "@/lib/reportDataStatus";
import { classifyIncidentType } from "@/lib/incidentClassifier";
import { draftCountryReportProse, type DraftableIncident } from "@/lib/draftReportProse";
import { ArrowLeft, Download, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import polestarLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import { DISCLAIMER_TEXT } from "@/lib/pdfChrome";
import { computeCountryFastFacts, titleCaseLocation, type CountryFastFactsIncident, type CountryFastFactCard } from "@/lib/countryFastFacts";
import {
  incidentMatchesCountry,
  acceptedCountryTokens,
  isIndonesianWestPapuaContext,
  isCrossBorderPapuaPng,
} from "@/lib/countryMatch";
import CountryReportMap from "@/components/CountryReportMap";
import { countryCoverUrl } from "@/lib/coverImages";
import type { CountryBaseline } from "@/lib/countryBaselines";
import { buildCountryLayers, buildWatchlistBreakdown, summariseLookback, resolveActiveCountryWindow, computeCountryCoverageStatus, computeCountrySourceSignals, type WatchlistRow, type CountryLayerBuckets, type CoverageSourceLike } from "@/lib/countryReportLayers";
import { clampIssueDateToLatestRecord } from "@/lib/reportWindow";

// Brand palette (lowercase per brand spec).
const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const ROBOTO = "Roboto, sans-serif";
const BRAND_GRADIENT = "linear-gradient(-130deg, #0b0a3d 0%, #465bff 100%)";

const SEV_COLOR: Record<string, string> = {
  extreme: "#800000",
  high: "#C0392B",
  moderate: "#E67E22",
  low: "#6FB872",
  insignificant: "#B8C2CC",
};
const SEV_LABEL: Record<string, string> = {
  extreme: "Extreme",
  high: "High",
  moderate: "Moderate",
  low: "Low",
  insignificant: "Insignificant",
};
const SEV_ORDER = ["extreme", "high", "moderate", "low", "insignificant"] as const;

interface Draft {
  name: string;
  region: string;
  overview: string;       // Situation
  trendSummary: string;   // What Happened
  implications: string;   // Implications for Business
}

const EMPTY_DRAFT: Draft = { name: "", region: "", overview: "", trendSummary: "", implications: "" };

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
  // Country reports must not depend only on the 7-day window. Pull a
  // 90-day backstop so the report can layer current / 30-day / 90-day
  // context even when the current window is thin. We fetch the 90-day
  // feed unscoped and apply country matching client-side: the incidents
  // `country` field is a semicolon-separated list, so server-side exact
  // matching misses compound tags and cannot distinguish Indonesian
  // Papua from Papua New Guinea. `incidentMatchesCountry` does token-
  // exact group matching (see countryMatch.ts).
  const { data: incidentsData } = useListIncidents(country ? { days: 90 } : {}, {
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
  const incidents = useMemo(() => {
    if (!country) return [];
    const name = country.name ?? "";
    const isPng = acceptedCountryTokens(name).includes("papua new guinea");
    return (incidentsData ?? []).filter((i) => {
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
  const [baselineDraft, setBaselineDraft] = useState<CountryBaseline>(EMPTY_BASELINE);
  const [baselineDirty, setBaselineDirty] = useState(false);
  const seededForSlug = useRef<string | null>(null);
  const baselineSeededForSlug = useRef<string | null>(null);
  const reportPreviewRef = useRef<HTMLDivElement | null>(null);

  // Option A: date the country report to the period its data actually covers.
  // Clamp the issue date back to the country's newest incident so the headline
  // 7-day window sits on real records instead of an empty current week (which
  // previously forced a 30/90-day fallback that read old data as current).
  const issueDate = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return clampIssueDateToLatestRecord(
      today,
      (incidents ?? []) as { occurredAt: string; topic?: string }[],
    );
  }, [incidents]);

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
  const layers: CountryLayerBuckets = useMemo(
    () => buildCountryLayers(incidents as CountryFastFactsIncident[], issueDate),
    [incidents, issueDate],
  );
  const watchlist: WatchlistRow[] = useMemo(
    () => (baseline ? buildWatchlistBreakdown(baseline, layers) : []),
    [baseline, layers],
  );
  const lookback = useMemo(
    () => summariseLookback(layers, baseline, country?.name ?? ""),
    [layers, baseline, country?.name],
  );

  // Active reporting window. ALWAYS the 7-day weekly window — even when
  // empty. A zero-record week is a data-quality signal (see `coverage`
  // below), never a reason to promote older 30/90-day records into the
  // headline. Drives Fast Facts, map, charts, the related-incidents table
  // and the drafted prose; 30/90-day material stays as labelled context.
  const active = useMemo(
    () => resolveActiveCountryWindow(layers, issueDate),
    [layers, issueDate],
  );

  // Coverage status for an empty 7-day window. Drives the printable
  // coverage banner; "active" (window has records) renders nothing.
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

  // Compute Fast Facts against the active window once per render.
  const facts = useMemo(
    () => computeCountryFastFacts({
      issueDate,
      incidents: incidents as CountryFastFactsIncident[],
      windowIncidents: active.incidents,
      periodLabel: active.periodShortLabel,
    }),
    [incidents, issueDate, active],
  );

  // Auto-derived prose (executiveSummary, whatMatters, watchNext, polestarView).
  const draftedProse = useMemo(() => {
    if (!country) return null;
    const inputs: DraftableIncident[] = active.incidents.map((i) => ({
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
  }, [country, active, issueDate]);

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

  const coverUrl = effective ? countryCoverUrl(effective.name) : undefined;
  const periodLabel = active.periodLabel;

  const downloadPdf = async () => {
    if (!effective || !draftedProse) return;
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
  if (!country || !effective) return <div style={{ fontFamily: ROBOTO, fontSize: 13, color: DUSK }}>Country report not found.</div>;

  const windowIncidents = facts.windowIncidents;
  const totalInWindow = windowIncidents.length;
  const severityTotal = SEV_ORDER.reduce((s, k) => s + facts.severityCounts[k], 0);
  const typeChartData = Array.from(facts.typeCounts.entries())
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const typeChartMax = typeChartData.length > 0 ? Math.max(...typeChartData.map((d) => d.n)) : 0;

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
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm"
              style={{ fontFamily: ROBOTO, border: `1px solid ${POLAR}`, color: DUSK, background: "#fff" }}
              title="Edit report"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={exporting || editing}
            title={editing ? "Save or cancel edits before exporting" : "Download PDF"}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs uppercase tracking-wider rounded-sm disabled:opacity-60"
            style={{ fontFamily: ROBOTO, fontWeight: 700, border: `1px solid ${ELECTRIC}`, background: ELECTRIC, color: "#fff" }}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </button>
        </div>
      </div>

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
            {effective.name || "Country Report"}
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
      <DataAsOfBanner
        data={{
          ...computeDataAsOf({ topic: "country", incidents, filterByTopic: false }),
          modeLabel: "Mixed sources (live, manual & static)",
        }}
      />
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
              Polestar Insights · Country Report
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

      {/* 1. Executive Summary */}
      {editing && (
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
      )}

      <Section title="Executive Summary">
        <Prose text={draftedProse?.executiveSummary ?? ""} />
      </Section>

      {/* 2. Fast Facts */}
      <Section title="Fast Facts">
        <FastFactsGrid cards={facts.cards} />
      </Section>

      {/* Sections 3-6 are all auto-derived from the window-aware drafted
          prose (draftReportProse). They are intentionally NOT editable or
          stored: persisted overview / trend_summary / implications rows
          previously went stale and implied fresh weekly activity even when
          the 7-day window was empty. Driving every narrative section from
          the live dataset keeps the on-screen report, the captured PDF and
          both the dev and prod environments in agreement regardless of any
          legacy stored text. */}

      {/* 3. Situation (auto — window-aware) */}
      <Section title="Situation">
        <Prose text={draftedProse?.overview ?? ""} />
      </Section>

      {/* 4. What Happened (auto — window-aware) */}
      <Section title="What Happened">
        <Prose text={draftedProse?.trendSummary ?? ""} />
      </Section>

      {/* 5. What Matters (auto) */}
      <Section title="What Matters">
        <Prose text={draftedProse?.whatMatters ?? ""} />
      </Section>

      {/* 6. Implications for Business (auto — window-aware) */}
      <Section title="Implications for Business">
        <Prose text={draftedProse?.implications ?? ""} />
      </Section>

      {/* 6b. Location Watchlist — read-only breakdown derived from the
          curated location list, shown when one is available. */}
      {!editing && baseline && watchlist.length > 0 && (
        <Section title="Location Watchlist">
          <WatchlistTable rows={watchlist} />
        </Section>
      )}

      {/* 6c. 30-Day Context */}
      <Section title="30-Day Context">
        <Prose text={lookback.thirtyDay} />
      </Section>

      {/* 6d. Background Operating Picture (90-day) — always rendered so
          the report carries the deeper backdrop even in busy cycles. */}
      <Section title="Background Operating Picture">
        <Prose text={lookback.ninetyDay} />
      </Section>

      {/* 7. Map */}
      <Section title="Map">
        <div>
          <CountryReportMap incidents={windowIncidents as CountryFastFactsIncident[]} domId="country-report-map" />
        </div>
        <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, fontStyle: "italic", marginTop: 6 }}>
          The map reflects the active reporting window — {active.incidents.length} {active.basisLabel} record{active.incidents.length === 1 ? "" : "s"}. It is not the full risk picture — read it alongside the 30 / 90-day context sections above.
        </div>
      </Section>

      {/* 8. Severity Distribution */}
      <Section title="Severity Distribution">
        {severityTotal === 0 ? (
          <EmptyNote>No incidents in the active window to chart.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {SEV_ORDER.map((k) => {
              const n = facts.severityCounts[k];
              const w = severityTotal === 0 ? 0 : (n / severityTotal) * 100;
              return (
                <div key={k} className="grid items-center" style={{ gridTemplateColumns: "140px 1fr 40px", gap: 8 }}>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{SEV_LABEL[k]}</div>
                  <div style={{ background: POLAR, height: 12, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: SEV_COLOR[k] }} />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" }}>{n}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 9. Incident Breakdown by Type */}
      <Section title="Incident Breakdown by Type">
        {typeChartData.length === 0 ? (
          <EmptyNote>No classifiable incident types in the active window.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {typeChartData.map((d) => {
              const w = typeChartMax === 0 ? 0 : (d.n / typeChartMax) * 100;
              return (
                <div key={d.label} className="grid items-center" style={{ gridTemplateColumns: "180px 1fr 40px", gap: 8 }}>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>{d.label}</div>
                  <div style={{ background: POLAR, height: 12, borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${w}%`, height: "100%", background: ELECTRIC }} />
                  </div>
                  <div style={{ fontFamily: ROBOTO, fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" }}>{d.n}</div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Watch Next (auto) */}
      <Section title="Watch Next">
        <Prose text={draftedProse?.watchNext ?? ""} />
      </Section>

      {/* Polestar View (auto) */}
      <Section title="Polestar View">
        <Prose text={draftedProse?.polestarView ?? ""} />
      </Section>

      {/* 10. Related Incidents */}
      <Section title="Related Incidents">
        {totalInWindow === 0 ? (
          <EmptyNote>No related incidents recorded for {effective.name} in the active window.</EmptyNote>
        ) : (
          <div style={{ border: `1px solid ${POLAR}`, borderRadius: 2, overflow: "hidden", background: "#fff" }}>
            <div className="grid" style={{ gridTemplateColumns: "160px 130px minmax(0, 1fr) 150px", background: NAVY, color: "#fff", fontFamily: ROBOTO, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              <div className="p-2.5">Date</div>
              <div className="p-2.5">Type</div>
              <div className="p-2.5">Title</div>
              <div className="p-2.5">Severity</div>
            </div>
            {[...windowIncidents].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()).map((i) => {
              const sk = (i.severity ?? "").toLowerCase();
              const sevColor = SEV_COLOR[sk] ?? "#999";
              return (
                <div key={i.id} className="grid items-center" style={{ gridTemplateColumns: "160px 130px minmax(0, 1fr) 150px", borderTop: `1px solid ${POLAR}`, fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>
                  <div className="p-2.5" style={{ fontFamily: ROBOTO, fontSize: 11 }}>{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
                  <div className="p-2.5">{classifyIncidentType(i)}</div>
                  <div className="p-2.5" style={{ fontWeight: 500, color: NAVY }}>{i.title}</div>
                  <div className="p-2.5">
                    <span
                      style={{
                        background: sevColor, color: "#fff", padding: "0 10px",
                        minWidth: 72, height: 24, lineHeight: "24px",
                        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                        textTransform: "uppercase", borderRadius: 2, display: "inline-flex",
                        alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", boxSizing: "border-box",
                      }}
                    >
                      {SEV_LABEL[sk] ?? i.severity}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Internal Source Coverage — screen-only, never in the PDF.
          Surfaces the layer counts and any thin-data signal for the
          analyst working in the Workbench, so they can decide whether
          to dispatch a stringer or widen the source set on the Sources
          page. Not for the client-facing report. */}
      <div className="no-print" style={{
        marginTop: 12,
        border: `1px dashed ${POLAR}`,
        background: "#fafafa",
        padding: "12px 14px",
        borderRadius: 2,
      }}>
        <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: DUSK, fontWeight: 700 }}>
          Internal · Source coverage (not in PDF)
        </div>
        <ul style={{ fontFamily: ROBOTO, fontSize: 12, color: DUSK, margin: "8px 0 0 18px", padding: 0 }}>
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
          {layers.current.length < 3 && (
            <li style={{ color: "#A33232" }}>
              Current-window record count is thin (&lt;3). Treat as a coverage signal rather than a clean operating picture — check the Sources page for failing / stale feeds on this country and consider widening local-press coverage.
            </li>
          )}
        </ul>
      </div>

      {/* 12. Disclaimer */}
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

function FastFactsGrid({ cards }: { cards: CountryFastFactCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {cards.map((c, i) => {
        const stripColor = c.severity ? (SEV_COLOR[c.severity] ?? ELECTRIC) : ELECTRIC;
        return (
          <div
            key={i}
            style={{
              background: "#fff",
              border: `1px solid ${POLAR}`,
              borderLeft: `4px solid ${stripColor}`,
              padding: "12px 14px",
              borderRadius: 2,
            }}
          >
            <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: DUSK, fontWeight: 700 }}>
              {c.label}
            </div>
            <div style={{ fontFamily: ROBOTO, fontSize: 20, fontWeight: 700, color: NAVY, lineHeight: 1.15, marginTop: 4 }}>
              {c.value}
            </div>
            {c.note && (
              <div style={{ fontFamily: ROBOTO, fontSize: 11, color: DUSK, marginTop: 4 }}>
                {c.note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BaselineBlock({ baseline }: { baseline: CountryBaseline }) {
  const Row = ({ label, text }: { label: string; text: string }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.55, color: DUSK }}>{text}</div>
    </div>
  );
  const List = ({ label, items }: { label: string; items: string[] }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: ROBOTO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: NAVY, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </div>
      <ul style={{ fontFamily: ROBOTO, fontSize: 13, lineHeight: 1.55, color: DUSK, margin: 0, paddingLeft: 18 }}>
        {items.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
      </ul>
    </div>
  );
  return (
    <div>
      <Row label="Operating Environment" text={baseline.operatingEnvironment} />
      <Row label="Security Context" text={baseline.securityContext} />
      <List label="Known Risk Areas" items={baseline.knownRiskAreas} />
      <List label="Key Cities / Provinces" items={baseline.keyCitiesProvinces} />
      <Row label="Movement Constraints" text={baseline.movementConstraints} />
      <Row label="Infrastructure Limits" text={baseline.infrastructureLimits} />
      <Row label="Medical / Evacuation" text={baseline.medicalEvac} />
      <Row label="Resource-Sector Exposure" text={baseline.resourceSectorExposure} />
    </div>
  );
}

function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div style={{ border: `1px solid ${POLAR}`, borderRadius: 2, overflow: "hidden", background: "#fff" }}>
      <div className="grid" style={{ gridTemplateColumns: "170px minmax(0, 1fr) 48px 48px 48px 170px", background: NAVY, color: "#fff", fontFamily: ROBOTO, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
        <div className="p-2.5">Location</div>
        <div className="p-2.5">Note</div>
        <div className="p-2.5" style={{ textAlign: "right" }}>7d</div>
        <div className="p-2.5" style={{ textAlign: "right" }}>30d</div>
        <div className="p-2.5" style={{ textAlign: "right" }}>90d</div>
        <div className="p-2.5" style={{ whiteSpace: "nowrap" }}>Worst (90d)</div>
      </div>
      {rows.map((r) => {
        const sk = (r.worstSeverity ?? "").toLowerCase();
        const sevColor = SEV_COLOR[sk] ?? "#999";
        return (
          <div key={r.label} className="grid items-center" style={{ gridTemplateColumns: "170px minmax(0, 1fr) 48px 48px 48px 170px", borderTop: `1px solid ${POLAR}`, fontFamily: ROBOTO, fontSize: 12, color: DUSK }}>
            <div className="p-2.5" style={{ fontWeight: 600, color: NAVY }}>{r.label}</div>
            <div className="p-2.5" style={{ fontSize: 11 }}>{r.note}</div>
            <div className="p-2.5" style={{ textAlign: "right", fontWeight: 700 }}>{r.currentCount}</div>
            <div className="p-2.5" style={{ textAlign: "right", fontWeight: 700 }}>{r.thirtyDayCount}</div>
            <div className="p-2.5" style={{ textAlign: "right", fontWeight: 700 }}>{r.ninetyDayCount}</div>
            <div className="p-2.5">
              {r.worstSeverity ? (
                <span style={{
                  background: sevColor, color: "#fff", padding: "0 10px",
                  minWidth: 92, height: 24, lineHeight: "24px",
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  textTransform: "uppercase", borderRadius: 2, display: "inline-flex",
                  alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", boxSizing: "border-box",
                }}>
                  {r.worstSeverityLabel}
                </span>
              ) : (
                <span style={{ fontStyle: "italic", color: DUSK, fontSize: 11, whiteSpace: "nowrap" }}>No records</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
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

// Suppress an unused-import warning during development when titleCaseLocation
// is referenced from the prose draft path but not directly here.
void titleCaseLocation;
