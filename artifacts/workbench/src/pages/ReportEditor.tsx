import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetReport,
  useUpdateReport,
  useListIncidents,
  useListMarketPrices,
  getListMarketPricesQueryKey,
  useListLatestMaritimeMovement,
  useListMaritimeSecurityEvents,
  useListReliefWebReports,
  useGenerateReportIncidentSummaries,
  useEditReportIncidentSummaries,
  useGenerateReportProse,
  getListIncidentsQueryKey,
  getGetReportQueryKey,
  getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
  type ReportIncidentSummariesResult,
  type ReportProseResult,
  type ReportUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TOPICS, TOPIC_LABELS, REPORT_STATUSES } from "@/lib/topics";
import ReportPreview from "@/components/ReportPreview";
import ShippingReportPreview from "@/components/ShippingReportPreview";
import FlashpointReportPreview from "@/components/FlashpointReportPreview";
import ConflictReportPreview from "@/components/ConflictReportPreview";
import CargoReportPreview from "@/components/CargoReportPreview";
import {
  buildCargoPatternModel,
  type CargoPatternModelInput,
} from "@/lib/cargoPatternModel";
import { downloadCargoRegisterCsv } from "@/lib/cargoRegisterExport";
import { ArrowLeft, Download, FileSpreadsheet, Loader2, Save } from "lucide-react";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import { exportFlashpointReportPdf } from "@/lib/exportFlashpointReportPdf";
import { exportShippingReportPdf } from "@/lib/exportShippingReportPdf";
import { exportConflictReportPdf } from "@/lib/exportConflictReportPdf";
import {
  draftTopicReportProse,
  type DraftableIncident,
} from "@/lib/draftReportProse";
import {
  aiOr,
  stableDraftTopicReportProse,
  toDraftableIncidents,
} from "@/lib/topicProseResolution";
import { resolveReportTitle } from "@/lib/reportNaming";
import { selectRelatedIncidents } from "@/lib/relatedIncidents";
import { computeTopicFastFacts, filterTopicReportIncidents } from "@/lib/topicFastFacts";
import {
  applyIncidentCurations,
  makeSectionGate,
  topicSectionKeys,
  pruneTopicSectionOverrides,
  marketOperatorRowKey,
  type TopicSectionOverrides,
  type FastFactOverride,
  reattachFastFactOverride,
  clearFastFactOverride,
  type GulfBulletOverride,
  type MarketOperatorRowOverride,
  orphanedFastFactOverrideKeys,
  reattachGulfBulletOverride,
  clearGulfBulletOverride,
  reattachMarketOperatorOverride,
  clearMarketOperatorOverride,
} from "@/lib/topicSectionOverrides";
import { OrphanedFastFactsPanel } from "@/components/OrphanedFastFactsPanel";
import { MarketOperatorResponsesEditor } from "@/components/MarketOperatorResponsesEditor";
import { OrphanSaveWarning } from "@/components/OrphanSaveWarning";
import {
  OrphanedGulfBulletsPanel,
  OrphanedMarketOperatorPanel,
} from "@/components/OrphanedFuelOverridesPanel";
import { buildConflictReportDataset } from "@/lib/conflictReportDataset";
import { buildShippingReportDataset } from "@/lib/shippingReportDataset";
import { buildFlashpointReportDataset } from "@/lib/flashpointReportDataset";
import { resolveIncidentSummary } from "@/lib/incidentSummary";
import { autoReportRating } from "@/lib/cardAutofill";
import { CARD_RATINGS, CARD_RATING_LABELS } from "@/lib/cardTemplates";
import { latestRecordDate, utcYmd } from "@/lib/reportDataStatus";
import { clampIssueDateToLatestRecord, reportCadence } from "@/lib/reportWindow";
import { resolveFuelEffectiveSections } from "@/lib/fuelReportConsistency";
import { format, parseISO } from "date-fns";
import {
  FUEL_MARKET_DATA_SAMPLE,
  validateFuelHardNumbersJson,
  buildFuelWatchReportData,
  toRenderableCard,
  buildHardNumbersFromForm,
  fuelMarketFormFromData,
  fuelMarketLatestDate,
  buildFuelReportFacts,
  serialiseFuelFactsForPrompt,
  resolveFuelPeriodEnd,
  EMPTY_FUEL_MARKET_FORM,
  type FuelMarketFormState,
  type FuelMarketCardForm,
  type ProducerBuyerActionRow,
} from "@/lib/fuelWatchReport";

const legacyExecSummaryStorageKey = (id: number) =>
  `polestar:exec-summary:report:${id}`;

function readLegacyExecSummary(id: number): string {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? (window.localStorage.getItem(legacyExecSummaryStorageKey(id)) ?? "")
      : "";
  } catch {
    return "";
  }
}

function clearLegacyExecSummary(id: number): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(legacyExecSummaryStorageKey(id));
    }
  } catch {
    /* ignore */
  }
}

// Short scope reminders shown above the editor. Kept tight on purpose so
// they read as a topic map, not a writing prompt.
const TOPIC_SCOPE: Record<string, string> = {
  shipping:
    "Shipping covers vessel attack, port and chokepoint disruption, route diversion, naval advisories and freight pressure. Theft and pilferage sit in Cargo Watch.",
  cargo_watch:
    "Cargo Watch covers cargo theft, hijack, pilferage, warehouse and depot loss, seal tampering and insider crime. Port and vessel disruption sit in Shipping.",
  fuel: "Fuel covers shortage, price moves, subsidy change, refinery and transport disruption, and fuel related unrest.",
  fertiliser:
    "Fertiliser covers supply, price, export controls, production disruption and farmer pressure.",
  energy:
    "Energy covers outages, load shedding, grid disruption, generation shortfall and fuel to power issues.",
  protests:
    "Civil protest and unrest covers public order activity, disruption to transport and access, and escalation risk.",
  flashpoint:
    "Flashpoint reads as a short operational warning derived from civil unrest data. Keep it tight and actionable.",
  data_centres:
    "Data Centres covers build-out, planning, power and water constraint, community opposition and operational risk to data-centre facilities. Facility records sit in the Registry; this report reads the incident feed.",
};

function scopeFor(topic: string): string | null {
  return TOPIC_SCOPE[topic] ?? null;
}

interface FormState {
  title: string;
  topic: string;
  status: string;
  issueDate: string;
  // "" = no override; falls back to the computed/auto rating on card pull.
  riskRating: string;
  executiveSummary: string;
  situation: string;
  whatHappened: string;
  whatMatters: string;
  implications: string;
  polestarView: string;
  watchNext: string;
  activismRead: string;
  civilUnrestRead: string;
  forecastRead: string;
  regionalCountryRead: string;
  // Shipping reads (regionalCountryRead reused for "Regional & Country View").
  chokepointRouteRead: string;
  vesselPiracyRead: string;
  commercialImpactRead: string;
  maritimeSecurityRead: string;
  // Cargo reads (regionalCountryRead reused for "Regional Read").
  cargoSecurityRead: string;
  logisticsHubRead: string;
  // Fuel reads.
  fuelMarketRead: string;
  fuelOperationalRead: string;
  fuelRegionalHighlights: string;
  // Conflict: single Other Watched Theatres read + per-theatre map keyed by
  // the activity-area theatre name.
  conflictOtherWatchedRead: string;
  conflictAreaReads: Record<string, string>;
  author: string;
}

const EMPTY: FormState = {
  title: "",
  topic: "fuel",
  status: "draft",
  issueDate: new Date().toISOString().slice(0, 10),
  riskRating: "",
  executiveSummary: "",
  situation: "",
  whatHappened: "",
  whatMatters: "",
  implications: "",
  polestarView: "",
  watchNext: "",
  activismRead: "",
  civilUnrestRead: "",
  forecastRead: "",
  regionalCountryRead: "",
  chokepointRouteRead: "",
  vesselPiracyRead: "",
  commercialImpactRead: "",
  maritimeSecurityRead: "",
  cargoSecurityRead: "",
  logisticsHubRead: "",
  fuelMarketRead: "",
  fuelOperationalRead: "",
  fuelRegionalHighlights: "",
  conflictOtherWatchedRead: "",
  conflictAreaReads: {},
  author: "",
};

const SEVERITY_ORDER: Record<string, number> = {
  insignificant: 0,
  low: 1,
  moderate: 2,
  high: 3,
  extreme: 4,
};
const SEVERITY_DEMOTE_OPTIONS = ["insignificant", "low", "moderate", "high"] as const;

export default function ReportEditor() {
  const qc = useQueryClient();
  const [, params] = useRoute("/reports/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const { data: report, isLoading } = useGetReport(id);
  const update = useUpdateReport();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [exporting, setExporting] = useState(false);
  // Id of the report whose data the seed effect below has populated into `form`.
  // Drives `activeTopic`: before the CURRENT report is seeded we scope the
  // incident fetch off the report's own topic; after it we follow the editable
  // dropdown. Keyed by id (not a bare boolean) so navigating between reports
  // never seeds the new report from the previous one's still-loaded topic set.
  const [seededId, setSeededId] = useState<number | null>(null);

  // The builder only ever renders ONE topic's report, but a naive
  // useListIncidents({}) fetches EVERY relevance-passing incident (tens of
  // thousands of rows, ~26 MB, once high-volume topics like indonesia_local
  // landed). That payload is heavy enough that the seed effect below — gated on
  // the fetch resolving — could stall, leaving `form` at its EMPTY default
  // (topic "fuel"), so every report rendered as Fuel Watch. Scope the fetch to
  // exactly the topic(s) the active report needs. Before the form seeds we key
  // off the loaded report.topic (report resolves independently of incidents,
  // avoiding a chicken-and-egg); after seeding we follow the topic dropdown.
  const activeTopic: string | undefined =
    report && seededId === report.id
      ? form.topic
      : report
        ? report.topic ?? "fuel"
        : undefined;
  // Window builders read these buckets: a fuel report also cross-reads shipping
  // (producer/operational actions); a flashpoint/protests report draws from
  // BOTH the live flashpoint bucket and the legacy protests bucket. Every other
  // topic reads only its own rows (cargo adds a raw includeIrrelevant fetch
  // below and discards the gated primary set).
  const primaryTopic = activeTopic === "protests" ? "flashpoint" : activeTopic;
  const secondaryTopic =
    activeTopic === "fuel"
      ? "shipping"
      : activeTopic === "flashpoint" || activeTopic === "protests"
        ? "protests"
        : undefined;
  const primaryParams = { topic: primaryTopic };
  const { data: primaryIncidents } = useListIncidents(primaryParams as never, {
    query: {
      enabled: !!primaryTopic,
      queryKey: getListIncidentsQueryKey(primaryParams as never),
    },
  });
  const secondaryParams = { topic: secondaryTopic };
  const { data: secondaryIncidents } = useListIncidents(secondaryParams as never, {
    query: {
      enabled: !!secondaryTopic,
      queryKey: getListIncidentsQueryKey(secondaryParams as never),
    },
  });
  // Fuel also cross-reads energy: fuel-to-power continuity failures (gas
  // shortage load shedding, rationing, power cuts) qualify into Fuel Watch
  // via filterFuelContinuityCrossRead.
  const tertiaryTopic = activeTopic === "fuel" ? "energy" : undefined;
  const tertiaryParams = { topic: tertiaryTopic };
  const { data: tertiaryIncidents } = useListIncidents(tertiaryParams as never, {
    query: {
      enabled: !!tertiaryTopic,
      queryKey: getListIncidentsQueryKey(tertiaryParams as never),
    },
  });
  // Merge the scoped buckets (disjoint topics → plain concat). Return undefined
  // until every query the active topic needs has resolved so the one-shot seed
  // never fires against a partial window (e.g. fuel without its shipping
  // cross-read) — which would freeze incomplete prose into the draft.
  const rawIncidents = useMemo(() => {
    if (!primaryTopic || !primaryIncidents) return undefined;
    if (secondaryTopic && !secondaryIncidents) return undefined;
    if (tertiaryTopic && !tertiaryIncidents) return undefined;
    if (!secondaryTopic && !tertiaryTopic) return primaryIncidents;
    return [
      ...primaryIncidents,
      ...(secondaryTopic ? secondaryIncidents ?? [] : []),
      ...(tertiaryTopic ? tertiaryIncidents ?? [] : []),
    ];
  }, [primaryTopic, secondaryTopic, tertiaryTopic, primaryIncidents, secondaryIncidents, tertiaryIncidents]);

  // Market Prices rows render on energy AND fertiliser reports; fetch the
  // matching commodity group so the override UI and preview/PDF share rows.
  const marketPriceGroup =
    activeTopic === "energy" || activeTopic === "fertiliser"
      ? activeTopic
      : undefined;
  const marketPriceParams = { group: marketPriceGroup ?? "energy" };
  const { data: marketPriceRows = [] } = useListMarketPrices(marketPriceParams, {
    query: {
      enabled: !!marketPriceGroup,
      queryKey: getListMarketPricesQueryKey(marketPriceParams),
    },
  });

  // Cargo Watch's authoritative scope gate is isCargoInScope (APAC/ME cargo
  // crime) — NOT the server's general text-relevance gate, which wrongly marks
  // most genuine cargo theft "irrelevant". The cargo monitor and CountryReport
  // both fetch includeIrrelevant for exactly this reason; the scoped fetch above
  // is relevance-gated, so those rows never reached the cargo report and its
  // record count collapsed to the handful the general gate let through. Fetch
  // the raw cargo set (only while editing a cargo report) and splice it in over
  // the gated cargo subset. Every downstream builder re-applies
  // filterTopicReportIncidents → isCargoInScope, so this admits exactly the rows
  // the monitor shows and leaves all other topics byte-identical.
  const isCargoReport = activeTopic === "cargo_watch";
  const cargoRawParams = { topic: "cargo_watch", includeIrrelevant: true };
  const { data: rawCargoIncidents } = useListIncidents(cargoRawParams as never, {
    query: {
      enabled: isCargoReport,
      queryKey: getListIncidentsQueryKey(cargoRawParams as never),
    },
  });
  const incidents = useMemo(() => {
    if (!rawIncidents) return undefined;
    if (!isCargoReport) return rawIncidents;
    if (!rawCargoIncidents) return undefined;
    const nonCargo = rawIncidents.filter((i) => i.topic !== "cargo_watch");
    return [...nonCargo, ...rawCargoIncidents];
  }, [isCargoReport, rawIncidents, rawCargoIncidents]);
  // Maritime movement (AIS) context for the Shipping Watch report. Context
  // only — never an incident; the board degrades to "movement data
  // unavailable" when empty.
  const { data: movement = [] } = useListLatestMaritimeMovement();
  // Standalone ICC CCS / IMB maritime-security events for the Shipping Watch
  // report. Their own source — never an incident; the section degrades to an
  // empty-state line when the feed is unconfigured/blocked.
  const { data: maritimeSecurityEvents = [] } = useListMaritimeSecurityEvents({
    limit: 500,
  });
  // Supporting UN OCHA ReliefWeb context for the Conflict Watch report. Fetched
  // unconditionally but only surfaced for the conflict topic; degrades to an
  // empty list (and a hidden section) when the feed is unconfigured/unapproved.
  const { data: situationalReports } = useListReliefWebReports({ limit: 40 });
  const seededForId = useRef<number | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  // Staleness check shared by the seeding effect and the live warning banner.
  // A report's window ends on its issue DATE (day granularity). Prose is stale
  // only when live data holds a record for the topic dated on a calendar day
  // AFTER the issue date — a same-day-but-later timestamp is still in-window.
  // Flashpoint reports carry topic "protests" but their incidents are stored
  // under "flashpoint"; scope the freshness check to the data topic.
  const computeStale = (
    topic: string,
    issueDate: string,
  ): { latest: string; issueDate: string } | null => {
    if (!issueDate) return null;
    // Fuel Watch is a MARKET product: its window ends on the latest market
    // close, which is routinely EARLIER than the newest incident. That gap is
    // expected and is reported in the data-status strip (Market data vs
    // Incident records), not as stale prose — so the incident-vs-issue-date
    // staleness check does not apply to fuel.
    if (topic === "fuel") return null;
    const dataTopic = topic === "protests" ? "flashpoint" : topic;
    const latest = latestRecordDate(incidents ?? [], dataTopic);
    if (!latest) return null;
    // occurredAt is a UTC instant; project its calendar day in UTC (NOT the
    // browser's local zone) so an evening-UTC record does not roll into the
    // next day for eastern viewers and fire a FALSE staleness against the bare
    // (UTC-style) issue date. Matches the UTC "today" used at seed time.
    const latestYmd = utcYmd(latest);
    const issueYmd = issueDate.slice(0, 10);
    if (latestYmd <= issueYmd) return null;
    return {
      latest: format(parseISO(latestYmd), "d MMM yyyy"),
      issueDate: format(parseISO(issueYmd), "d MMM yyyy"),
    };
  };
  // Fuel Watch market-data editor. `hardNumbersText` is the textarea
  // buffer; `hardNumbersEdited` is the last-validated object surfaced
  // to the preview so authors see their edits live before saving.
  const [hardNumbersText, setHardNumbersText] = useState<string>("");
  const [hardNumbersError, setHardNumbersError] = useState<string | null>(null);
  // Save-blocked notice rendered NEXT TO the Save button. The fuel validation
  // errors live far down the page, so a blocked save previously looked like a
  // silent no-op ("you are not allowing me to edit the report").
  const [saveBlocked, setSaveBlocked] = useState<string | null>(null);
  const [hardNumbersEdited, setHardNumbersEdited] = useState<
    unknown | undefined
  >(undefined);
  const hardNumbersSeededForId = useRef<number | null>(null);
  // Form-based Fuel Market Data panel state. JSON advanced view is
  // kept as an escape hatch but the normal path is the form below.
  const [fuelForm, setFuelForm] = useState<FuelMarketFormState>(
    EMPTY_FUEL_MARKET_FORM,
  );
  const [showFuelJson, setShowFuelJson] = useState(false);
  const [fuelFormErrors, setFuelFormErrors] = useState<string[]>([]);
  // Override flag for the "fail closed" export gate. Reset on every
  // successful export and whenever the user edits the market data.
  const [allowMissingExport, setAllowMissingExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Cargo Watch: opt-in to appending the full incident register as a PDF annex.
  // Off by default — the standard cargo report ends at Selected Incidents →
  // Polestar View → Disclaimer; the full register lives in the Workbench + CSV.
  const [includeFullAnnex, setIncludeFullAnnex] = useState(false);

  // Durable analyst layout controls (hidden sections, excluded window
  // incidents, demote-only severity corrections). Mirrors the country brief.
  // Seeded from report.sectionOverrides; persisted verbatim on save.
  const [sectionOverrides, setSectionOverrides] = useState<TopicSectionOverrides>(
    {},
  );

  // Curation propagates through the SINGLE incident pool feeding every topic
  // dataset builder → both previews AND PDFs. Applying it here (exclude +
  // demote-only) covers cargoRegisterRows, relatedForSummaries, all previews
  // and all PDF exporters uniformly. STRICT: exclude/demote only, never add.
  const incidentsForExport = useMemo(
    () => applyIncidentCurations(incidents ?? [], sectionOverrides),
    [incidents, sectionOverrides],
  );

  // The relevance-passing window pool the analyst can curate from. Windowed by
  // topic + issue date (a superset of what any single section renders), so an
  // exclusion never fabricates and only ever removes a real, in-window row.
  const curationPool = useMemo(() => {
    const src = incidents ?? [];
    if (!form.topic || !form.issueDate) return [] as typeof src;
    return filterTopicReportIncidents(src, form.topic, form.issueDate).slice(0, 60);
  }, [incidents, form.topic, form.issueDate]);

  const sectionGate = makeSectionGate(sectionOverrides.hiddenSections);
  const hiddenSections = sectionOverrides.hiddenSections ?? [];

  // The AUTO Fast Facts tiles for the current topic, computed from the SAME
  // builders the preview/PDF use, so the override editor lists exactly the
  // tiles that render (matched by auto label). Empty when the report has no
  // topic/date yet.
  const autoFastFacts = useMemo<
    Array<{ label: string; value: string; note?: string }>
  >(() => {
    if (!form.topic || !form.issueDate) return [];
    try {
      if (form.topic === "fuel") {
        return buildFuelWatchReportData(
          {
            issueDate: form.issueDate,
            hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
          },
          incidentsForExport,
        ).marketData.fastFactsCards.map(toRenderableCard);
      }
      if (form.topic === "cargo_watch") {
        return buildCargoPatternModel(
          incidentsForExport.map(
            (i): CargoPatternModelInput => ({
              id: i.id,
              topic: i.topic,
              title: i.title,
              summary: i.summary ?? null,
              source: i.source ?? null,
              sourceUrl: i.sourceUrl ?? null,
              location: i.location ?? null,
              country: i.country ?? null,
              severity: i.severity ?? null,
              occurredAt: i.occurredAt,
            }),
          ),
          { issueDate: form.issueDate },
        ).fastFacts;
      }
      if (form.topic === "shipping") {
        return buildShippingReportDataset(
          incidentsForExport,
          form.topic,
          form.issueDate,
          maritimeSecurityEvents,
        ).fastFacts;
      }
      if (form.topic === "flashpoint" || form.topic === "protests") {
        return buildFlashpointReportDataset(
          incidentsForExport,
          form.topic,
          form.issueDate,
        ).fastFacts;
      }
      if (form.topic === "conflict") {
        return buildConflictReportDataset(
          incidentsForExport,
          form.topic,
          form.issueDate,
        ).fastFacts;
      }
      return computeTopicFastFacts({
        topic: form.topic,
        issueDate: form.issueDate,
        incidents: incidentsForExport,
        topicLabel: TOPIC_LABELS[form.topic] ?? form.topic,
      });
    } catch {
      return [];
    }
  }, [
    form.topic,
    form.issueDate,
    incidentsForExport,
    maritimeSecurityEvents,
    hardNumbersEdited,
    report,
  ]);

  // The AUTO Gulf/Hormuz bullets and Market & Operator Responses rows for a
  // fuel report, computed from the SAME canonical builder the preview/PDF
  // use, so the override editor lists exactly the bullets/rows that render.
  const fuelOverridePanels = useMemo<{
    gulfLines: string[];
    gulfRead: string;
    producerRows: ProducerBuyerActionRow[];
  } | null>(() => {
    if (form.topic !== "fuel" || !form.issueDate) return null;
    try {
      const d = buildFuelWatchReportData(
        {
          issueDate: form.issueDate,
          hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
        },
        incidentsForExport,
      );
      const gulf = d.incidentData.gulfChokepointWatch;
      return {
        gulfLines: gulf
          ? [...gulf.currentItemLines, ...gulf.standingItemLines]
          : [],
        // The live AUTO read — recorded as the staleness baseline whenever the
        // owner edits the panel-read override, and compared against any saved
        // baseline to flag an override the report no longer applies.
        gulfRead: gulf?.read ?? "",
        producerRows: d.incidentData.producerBuyerActions,
      };
    } catch {
      return null;
    }
  }, [form.topic, form.issueDate, incidentsForExport, hardNumbersEdited, report]);

  // Orphaned Fast Facts override keys (saved edits keyed to a renamed tile).
  // Drives the save-time notice near the Save button: the owner must either
  // fix them (re-attach/clear in the panel) or explicitly "Save anyway".
  const orphanedFastFactKeys = useMemo(
    () =>
      autoFastFacts.length > 0
        ? orphanedFastFactOverrideKeys(
            autoFastFacts,
            sectionOverrides.fastFactOverrides,
          )
        : [],
    [autoFastFacts, sectionOverrides.fastFactOverrides],
  );
  // True after a Save click was intercepted because orphans exist; renders the
  // inline warning with a "Save anyway" confirm. Auto-dismissed once every
  // orphan is re-attached or cleared, so a fixed form saves with no notice.
  const [orphanSavePending, setOrphanSavePending] = useState(false);
  useEffect(() => {
    if (orphanedFastFactKeys.length === 0) setOrphanSavePending(false);
  }, [orphanedFastFactKeys.length]);

  // Full deduplicated cargo register (the Workbench-only companion to the PDF's
  // curated Selected Incidents), exported to CSV on demand. Built from the SAME
  // model as the preview/PDF so the register matches the report.
  const cargoRegisterRows = useMemo(() => {
    if (form.topic !== "cargo_watch") return [];
    return buildCargoPatternModel(
      incidentsForExport.map(
        (i): CargoPatternModelInput => ({
          id: i.id,
          topic: i.topic,
          title: i.title,
          summary: i.summary ?? null,
          source: i.source ?? null,
          sourceUrl: i.sourceUrl ?? null,
          location: i.location ?? null,
          country: i.country ?? null,
          severity: i.severity ?? null,
          occurredAt: i.occurredAt,
        }),
      ),
      { issueDate: form.issueDate ?? new Date().toISOString().slice(0, 10) },
    ).appendix;
  }, [form.topic, form.issueDate, incidentsForExport]);

  // Per-incident AI summaries for the Related Incidents table of TOPIC,
  // CONFLICT and SHIPPING reports (flashpoint/protests/fuel carry no such
  // table). The same prompt contract, fingerprint cache and editable-fallback
  // pattern as the country reports; generation is keyed by the EXACT rendered
  // related set (≤ backend cap) so the cache can never lag the data and every
  // key resolves to the row that renders it.
  const summariesEnabled =
    form.topic !== "flashpoint" &&
    form.topic !== "protests" &&
    form.topic !== "fuel";

  // Theatre names for the conflict report's per-theatre "Top Activity Area"
  // read overrides. Built from the SAME dataset the preview/PDF render, so the
  // editor only offers a textarea for a theatre that actually appears.
  const conflictAreaTheatres = useMemo<string[]>(() => {
    if (form.topic !== "conflict") return [];
    return buildConflictReportDataset(
      incidentsForExport,
      form.topic,
      form.issueDate,
    ).topActivityAreas.map((a) => a.theatre);
  }, [form.topic, form.issueDate, incidentsForExport]);

  const relatedForSummaries = useMemo(() => {
    if (!summariesEnabled) return [];
    let rows: Array<Record<string, unknown>> = [];
    if (form.topic === "shipping") {
      rows = buildShippingReportDataset(
        incidentsForExport,
        form.topic,
        form.issueDate,
        maritimeSecurityEvents,
      ).relatedIncidents as unknown as Array<Record<string, unknown>>;
    } else if (form.topic === "conflict") {
      rows = buildConflictReportDataset(
        incidentsForExport,
        form.topic,
        form.issueDate,
      ).relatedIncidents as unknown as Array<Record<string, unknown>>;
    } else {
      // Mirror the generic-topic preview/PDF pipeline EXACTLY: window-filter
      // first (filterTopicReportIncidents on the issue date), then
      // selectRelatedIncidents — otherwise the generation payload would be the
      // global incident pool and its summary keys would not match the rendered
      // (windowed) rows.
      rows = selectRelatedIncidents(
        filterTopicReportIncidents(
          incidentsForExport,
          form.topic,
          form.issueDate,
        ),
        form.topic,
      ) as unknown as Array<Record<string, unknown>>;
    }
    return rows.map((i) => ({
      id: i.id != null ? String(i.id) : undefined,
      topic: typeof i.topic === "string" ? i.topic : form.topic,
      title: typeof i.title === "string" ? i.title : "",
      summary: typeof i.summary === "string" ? i.summary : "",
      location: typeof i.location === "string" ? i.location : "",
      country: typeof i.country === "string" ? i.country : "",
      severity: typeof i.severity === "string" ? i.severity : "",
      occurredAt: typeof i.occurredAt === "string" ? i.occurredAt : "",
      source: typeof i.source === "string" ? i.source : "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    summariesEnabled,
    form.topic,
    form.issueDate,
    incidentsForExport,
    maritimeSecurityEvents,
  ]);

  const [summaryRes, setSummaryRes] =
    useState<ReportIncidentSummariesResult | null>(null);
  const [editedSummaries, setEditedSummaries] = useState<Record<
    string,
    string
  > | null>(null);
  const [summaryEditError, setSummaryEditError] = useState<string | null>(null);
  const lastGenKey = useRef<string>("");
  const generateSummaries = useGenerateReportIncidentSummaries();
  const editSummaries = useEditReportIncidentSummaries();

  useEffect(() => {
    if (!id) return;
    if (relatedForSummaries.length === 0) {
      if (lastGenKey.current !== "") {
        lastGenKey.current = "";
        setSummaryRes(null);
        setEditedSummaries(null);
      }
      return;
    }
    // Key on the FULL canonical incident identity (the same fields the backend
    // fingerprint + prompt grounding use), not just [id,title] — otherwise an
    // incident whose summary/severity/location changes without a title change
    // would never re-trigger generation and the cached line would go stale.
    const key = JSON.stringify(relatedForSummaries);
    if (key === lastGenKey.current) return;
    lastGenKey.current = key;
    generateSummaries.mutate(
      { id, data: { incidents: relatedForSummaries } },
      {
        onSuccess: (res) => {
          setSummaryRes(res);
          setEditedSummaries((res.edited as Record<string, string>) ?? null);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, relatedForSummaries]);

  // Effective per-incident summaries = AI-generated, overlaid with analyst
  // edits (live draft, else saved edits). Empty when AI is unavailable, in
  // which case each row falls back to its deterministic line.
  const effectiveSummaries = useMemo<Record<string, string>>(() => {
    const gen = (summaryRes?.summaries as Record<string, string>) ?? {};
    const ed =
      editedSummaries ??
      (summaryRes?.edited as Record<string, string> | null) ??
      {};
    return { ...gen, ...ed };
  }, [summaryRes, editedSummaries]);

  // ---- AI report NARRATIVE (themes / drivers / operational meaning) ------
  // EVERY narrative report type gets a genuine AI-written narrative grounded on
  // the EXACT set the report renders. The AI sections occupy the fallback LAYER
  // beneath any genuine analyst edit: conflict + flashpoint/protests resolve via
  // pickProse(form.X, aiOr(ai, autoX)) (their editor fields are seeded with
  // deterministic text, so a recognised generic seed is discarded); shipping +
  // cargo_watch + fuel/energy/fertiliser resolve via resolveSimpleProse(form.X,
  // ai, detX) (their editor fields are seeded SAVED-ONLY, so an empty field
  // means unedited). Preview and PDF run the IDENTICAL chain, so they can never
  // disagree; the deterministic template shows only when the AI engine is
  // unavailable (labelled near the preview).
  const proseEnabled =
    form.topic === "conflict" ||
    form.topic === "shipping" ||
    form.topic === "cargo_watch" ||
    form.topic === "fuel" ||
    form.topic === "energy" ||
    form.topic === "fertiliser" ||
    form.topic === "flashpoint" ||
    form.topic === "protests";

  // Ground on the same set the report renders (parity with the cache
  // fingerprint). Summaries-enabled topics (conflict/shipping/cargo_watch/
  // energy/fertiliser) already build the EXACT rendered related set;
  // flashpoint/protests/fuel carry no related table, so ground them on the
  // windowed incident set the report actually renders.
  const proseGrounding = useMemo(() => {
    if (!proseEnabled) return [];
    if (summariesEnabled) return relatedForSummaries;
    return filterTopicReportIncidents(
      incidentsForExport,
      form.topic,
      form.issueDate,
    ).map((i) => ({
      id: i.id != null ? String(i.id) : undefined,
      topic: typeof i.topic === "string" ? i.topic : form.topic,
      title: typeof i.title === "string" ? i.title : "",
      summary: typeof i.summary === "string" ? i.summary : "",
      location: typeof i.location === "string" ? i.location : "",
      country: typeof i.country === "string" ? i.country : "",
      severity: typeof i.severity === "string" ? i.severity : "",
      occurredAt: typeof i.occurredAt === "string" ? i.occurredAt : "",
      source: typeof i.source === "string" ? i.source : "",
    }));
  }, [
    proseEnabled,
    summariesEnabled,
    relatedForSummaries,
    incidentsForExport,
    form.topic,
    form.issueDate,
  ]);
  // Fuel only: the canonical FIXED FACTS block for the AI prompt — computed by
  // the SAME facts builder the preview/PDF consistency gate reads (same
  // market-anchored issue date), so the model is handed the exact values the
  // gate will later enforce. Part of the prose cache key: a direction flip or
  // leader change regenerates the narrative.
  const proseFacts = useMemo(() => {
    if (form.topic !== "fuel" || !form.issueDate) return null;
    const hn = hardNumbersEdited ?? report?.hardNumbers;
    const renderIssueDate = fuelMarketLatestDate(hn) ?? form.issueDate;
    // Use the shared payload's RECONCILED reportFacts (pressure leadership
    // agrees with the canonical sections) so the AI FIXED FACTS block, the
    // rendered canonical prose and the effective-text gate all describe the
    // same pressure picture.
    return serialiseFuelFactsForPrompt(
      buildFuelWatchReportData(
        { issueDate: renderIssueDate, hardNumbers: hn },
        incidentsForExport,
      ).reportFacts,
    );
  }, [form.topic, form.issueDate, hardNumbersEdited, report, incidentsForExport]);
  const proseBasisDays = reportCadence(form.topic) === "monthly" ? 30 : 7;
  const prosePeriodWord =
    reportCadence(form.topic) === "monthly" ? "this month" : "this week";

  const [proseRes, setProseRes] = useState<ReportProseResult | null>(null);
  const [proseUnavailable, setProseUnavailable] = useState(false);
  const lastProseKey = useRef<string>("");
  const generateProse = useGenerateReportProse();

  useEffect(() => {
    if (!id || !proseEnabled) {
      if (lastProseKey.current !== "") {
        lastProseKey.current = "";
        setProseRes(null);
        setProseUnavailable(false);
      }
      return;
    }
    // Wait for the incidents query to load so we ground on the real window and
    // do not fire once on the empty set and again on the full set.
    if (!incidents) return;
    // Key on the EXACT grounding payload + window so the cache can never lag
    // the data (mirrors the per-incident summaries fingerprint discipline).
    const key = JSON.stringify({
      topic: form.topic,
      title: form.title,
      issueDate: form.issueDate,
      basisDays: proseBasisDays,
      incidents: proseGrounding,
      facts: proseFacts,
    });
    if (key === lastProseKey.current) return;
    lastProseKey.current = key;
    setProseUnavailable(false);
    generateProse.mutate(
      {
        id,
        data: {
          topic: form.topic,
          title: form.title,
          periodWord: prosePeriodWord,
          basisDays: proseBasisDays,
          issueDate: form.issueDate,
          incidents: proseGrounding,
          ...(proseFacts ? { facts: proseFacts } : {}),
          force: false,
        },
      },
      {
        onSuccess: (res) => {
          // 200 {available:false} (engine unconfigured / upstream failed) ->
          // degrade to the deterministic template and show the hint.
          if (!res.available) {
            setProseRes(null);
            setProseUnavailable(true);
            return;
          }
          setProseRes(res);
        },
        onError: () => {
          setProseRes(null);
          setProseUnavailable(true);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, proseEnabled, form.topic, form.title, form.issueDate, proseBasisDays, prosePeriodWord, proseGrounding, proseFacts, incidents]);

  // AI narrative handed to the preview + PDF as the fallback layer. The full
  // 7-section result is structurally compatible with the 4-field
  // ConflictAiProse prop (extra keys are ignored).
  const aiProseSections = proseRes?.edited ?? proseRes?.sections ?? null;

  // ---- Fuel Watch direct-edit prefill --------------------------------------
  // The owner edits Fuel Watch by cutting/replacing the rendered text in
  // place, so every blank narrative box is pre-filled with EXACTLY the text
  // the preview/PDF currently renders (analyst edit -> AI -> deterministic;
  // reads use their auto view text). Baselines remember what was pre-filled:
  // on Save an untouched box persists "" so the section keeps following the
  // live AI/auto text instead of freezing today's copy into the DB. One-shot
  // per report id, after the main seed and after the AI narrative settles.
  const fuelPrefillForId = useRef<number | null>(null);
  const fuelPrefillBaselines = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!report || form.topic !== "fuel") return;
    if (seededId !== report.id) return; // main seed must run first
    if (fuelPrefillForId.current === report.id) return;
    if (!incidents) return;
    // Wait for the AI narrative to settle (result or explicit unavailable) so
    // the boxes hold what actually renders, not the fallback that would be
    // replaced seconds later.
    if (proseEnabled && proseRes === null && !proseUnavailable) return;
    fuelPrefillForId.current = report.id;
    const ai = aiProseSections;
    // Mirror ReportPreview exactly: implications/watchNext flow through
    // buildFuelWatchReportData's narrativeData (AI text + default top-up), so
    // the prefill must come from the SAME payload, not aiOr() directly.
    const hn = hardNumbersEdited ?? report.hardNumbers;
    // Market-anchored render date — same derivation as ReportPreview and
    // exportTopicReportPdf, so the payload the prefill reads is the payload
    // the report renders.
    const renderIssueDate = fuelMarketLatestDate(hn) ?? form.issueDate;
    const fuelData = buildFuelWatchReportData(
      {
        issueDate: renderIssueDate,
        implications: aiOr(aiProseSections?.implications, ""),
        watchNext: aiOr(aiProseSections?.watchNext, ""),
        hardNumbers: hn,
      },
      incidentsForExport,
    );
    // ONE shared resolver — the same call ReportPreview and the PDF exporter
    // make, so the boxes hold byte-identical text to what renders. Report
    // fields are passed blank: a saved analyst override already skips the
    // prefill below, and the baseline must be the auto (AI/canonical) tier.
    const effective = resolveFuelEffectiveSections({
      report: {},
      aiProse: ai,
      fuelData,
    });
    const resolved: Record<string, string> = {
      executiveSummary: effective.executiveSummary ?? "",
      situation: effective.situation ?? "",
      whatHappened: effective.whatHappened ?? "",
      whatMatters: effective.whatMatters ?? "",
      implications: fuelData.narrativeData.implications ?? "",
      watchNext: fuelData.narrativeData.watchNext ?? "",
      polestarView: effective.polestarView ?? "",
      fuelMarketRead: effective.marketRead ?? "",
      fuelOperationalRead: effective.operationalRead ?? "",
      fuelRegionalHighlights: effective.regionalHighlights ?? "",
    };
    const fills: Partial<FormState> = {};
    const baselines: Record<string, string> = {};
    for (const [key, text] of Object.entries(resolved)) {
      const cur = (form[key as keyof FormState] as string) ?? "";
      if (cur.trim()) continue; // saved analyst override wins
      if (!text.trim()) continue; // nothing to pre-fill
      (fills as Record<string, unknown>)[key] = text;
      baselines[key] = text;
    }
    fuelPrefillBaselines.current = baselines;
    if (Object.keys(fills).length > 0) setForm((f) => ({ ...f, ...fills }));
  }, [
    report,
    form,
    seededId,
    incidents,
    proseEnabled,
    proseRes,
    proseUnavailable,
    aiProseSections,
    incidentsForExport,
    hardNumbersEdited,
  ]);

  const setIncidentSummary = (incidentId: string, text: string) =>
    setEditedSummaries((d) => ({ ...(d ?? {}), [incidentId]: text }));

  const saveIncidentSummaries = () => {
    if (!id || !summaryRes) return;
    setSummaryEditError(null);
    editSummaries.mutate(
      {
        id,
        data: {
          fingerprint: summaryRes.fingerprint,
          summaries: editedSummaries ?? {},
        },
      },
      {
        onSuccess: (res) => {
          setSummaryRes(res);
          setEditedSummaries((res.edited as Record<string, string>) ?? null);
        },
        onError: () => {
          setSummaryEditError(
            "Summaries are out of date — regenerate before editing.",
          );
        },
      },
    );
  };

  const downloadPdf = async (opts?: { forceAllowMissing?: boolean }) => {
    setExporting(true);
    setExportError(null);
    // System-error guard: if the form clearly has values but the builder
    // we're about to hand to the exporter does not see them, the wiring
    // is broken — block export instead of silently producing a bad PDF.
    if (form.topic === "fuel" && liveFuelData) {
      const md = liveFuelData.marketData;
      const formHasNow = {
        brent: fuelForm.brent.value.trim() !== "",
        wti: fuelForm.wti.value.trim() !== "",
        jet: fuelForm.jet.value.trim() !== "",
      };
      const builderHas = {
        brent: md.brent != null,
        wti: md.wti != null,
        jet: md.jetFuel != null,
      };
      if (
        (formHasNow.brent && !builderHas.brent) ||
        (formHasNow.wti && !builderHas.wti) ||
        (formHasNow.jet && !builderHas.jet)
      ) {
        setExportError(
          "Fuel market form values are not reaching the report builder.",
        );
        setExporting(false);
        return;
      }
    }
    try {
      const allow = opts?.forceAllowMissing === true || allowMissingExport;
      if (
        form.topic === "fuel" &&
        liveFuelData &&
        !liveFuelData.validation.hasRequiredFuelWatchData &&
        !allow
      ) {
        setExportError(
          `Fuel Watch export requires market data. Missing: ${liveFuelData.validation.missingRequired.join(", ")}.`,
        );
        return;
      }

      const filename = `polestar-report-${slugifyForFilename(form.title || "untitled")}.pdf`;

      // Common payload shared by all PDF exporters.
      const pdfPayload = {
        title: form.title,
        topic: form.topic,
        issueDate: form.issueDate,
        author: form.author,
        executiveSummary: form.executiveSummary,
        situation: form.situation,
        whatHappened: form.whatHappened,
        whatMatters: form.whatMatters,
        implications: form.implications,
        watchNext: form.watchNext,
        polestarView: form.polestarView,
        activismRead: form.activismRead,
        civilUnrestRead: form.civilUnrestRead,
        forecastRead: form.forecastRead,
        regionalCountryRead: form.regionalCountryRead,
        chokepointRouteRead: form.chokepointRouteRead,
        vesselPiracyRead: form.vesselPiracyRead,
        commercialImpactRead: form.commercialImpactRead,
        maritimeSecurityRead: form.maritimeSecurityRead,
        cargoSecurityRead: form.cargoSecurityRead,
        logisticsHubRead: form.logisticsHubRead,
        fuelMarketRead: form.fuelMarketRead,
        fuelOperationalRead: form.fuelOperationalRead,
        fuelRegionalHighlights: form.fuelRegionalHighlights,
        conflictOtherWatchedRead: form.conflictOtherWatchedRead,
        conflictAreaReads: form.conflictAreaReads,
      };

      if (form.topic === "flashpoint" || form.topic === "protests") {
        await exportFlashpointReportPdf(
          pdfPayload,
          incidentsForExport,
          filename,
          aiProseSections,
          hiddenSections,
          sectionOverrides,
        );
      } else if (form.topic === "shipping") {
        await exportShippingReportPdf(
          pdfPayload,
          incidentsForExport,
          filename,
          movement,
          maritimeSecurityEvents,
          effectiveSummaries,
          aiProseSections,
          hiddenSections,
          sectionOverrides,
        );
      } else if (form.topic === "conflict") {
        await exportConflictReportPdf(
          pdfPayload,
          incidentsForExport,
          filename,
          situationalReports,
          effectiveSummaries,
          aiProseSections,
          hiddenSections,
          sectionOverrides,
        );
      } else {
        const { exportTopicReportPdf } = await import("@/lib/exportTopicReportPdf");
        await exportTopicReportPdf(
          {
            ...pdfPayload,
            hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
          },
          incidentsForExport,
          TOPIC_LABELS,
          filename,
          {
            allowMissingMarketData: allow,
            incidentSummaries: effectiveSummaries,
            aiProse: aiProseSections,
            marketPrices: marketPriceRows,
            includeFullAnnex,
            hiddenSections,
            sectionOverrides,
          },
        );
      }
      setAllowMissingExport(false);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "PDF export failed.");
    } finally {
      setExporting(false);
    }
  };
  useEffect(() => {
    if (!report) return;
    // Wait until incidents have loaded before seeding so the draft prose is
    // built from the actual window. Seed exactly once per report id.
    if (!incidents) return;
    if (seededForId.current === report.id) return;
    seededForId.current = report.id;
    const savedExec =
      (report.executiveSummary ?? "").trim()
        ? report.executiveSummary
        : readLegacyExecSummary(report.id);

    // Generate an operational draft for any section that is still empty.
    // Saved content always wins; the draft only seeds blank fields so a new
    // report opens with usable prose rather than writing prompts.
    const topic = report.topic ?? "fuel";
    // A report's data window ends on its issue date, so a draft left at an old
    // issue date shows permanently stale data. Drafts are living documents:
    // advance their effective issue date to today so they always render the
    // current window. Published reports keep their stored issue date (they are
    // frozen snapshots). Nothing is written to the DB until the author Saves.
    const today = new Date().toISOString().slice(0, 10);
    const storedIssueDate = (report.issueDate ?? today).slice(0, 10);
    const isDraft = (report.status ?? "draft") === "draft";
    const draftAdvanced = isDraft && storedIssueDate < today;
    const renderIssueDate = draftAdvanced ? today : storedIssueDate;
    // Option A: never date a report past the latest real record for its data
    // topic. Topics with a live feed (flashpoint/protests) stay on the current
    // date; static/import-only topics (fuel/shipping/cargo/etc.) clamp back to
    // their newest record so the prose, cover, incident tables and data-status
    // line all describe the SAME window the data actually covers — instead of
    // presenting an empty/stale current week as if it were live.
    const dataTopic = topic === "protests" ? "flashpoint" : topic;
    // Fuel Watch is a MARKET product: its reporting period ends on the latest
    // market close the report carries (from hardNumbers), NOT on the latest
    // incident. Incident records — which may stop earlier — are reported
    // separately in the data-status strip. Other topics keep the incident
    // clamp. resolveFuelPeriodEnd falls back to that clamp when a fresh draft
    // has no market data yet.
    const issueDate =
      topic === "fuel"
        ? resolveFuelPeriodEnd(
            renderIssueDate,
            report.hardNumbers,
            incidents ?? [],
          )
        : clampIssueDateToLatestRecord(
            renderIssueDate,
            incidents ?? [],
            dataTopic,
          );
    const inputs: DraftableIncident[] = (incidents ?? []).map((i) => ({
      id: i.id,
      topic: i.topic,
      title: i.title,
      summary: i.summary,
      source: i.source,
      sourceUrl: i.sourceUrl,
      location: i.location,
      severity: i.severity,
      occurredAt: i.occurredAt,
      country: i.country,
    }));
    const draft = draftTopicReportProse({
      topic,
      issueDate,
      incidents: inputs,
    });

    // Staleness guard: a report's window ends on its issue date. If live data
    // holds records for this topic newer than the issue date, the saved prose
    // was written against an older window and is stale. Seed the editor from
    // the freshly generated draft instead of the stored prose. Non-destructive:
    // nothing is written to the DB until the author clicks Save. The visible
    // warning banner is computed live below (so it tracks issue-date edits).
    // An auto-advanced draft's saved prose was written against the old window,
    // so it is stale by definition — reseed it. Otherwise fall back to the
    // live data-vs-issue-date staleness check.
    const proseIsStale =
      draftAdvanced || computeStale(topic, issueDate) != null;

    // Topics whose previews/PDFs resolve prose via resolveSimpleProse seed
    // SAVED-ONLY: the AI narrative + deterministic auto occupy the fallback
    // layer at RENDER time, so a blank field renders AI (else deterministic),
    // and only a genuine saved analyst edit is seeded. Stale saved prose is
    // dropped so the fresh fallback shows. Conflict + flashpoint/protests keep
    // the deterministic draft seed (their pickProse discards a generic seed).
    const savedOnlyProse =
      topic === "shipping" ||
      topic === "cargo_watch" ||
      topic === "fuel" ||
      topic === "energy" ||
      topic === "fertiliser";

    const pick = (saved: string | null | undefined, drafted: string) => {
      if (savedOnlyProse) {
        if (proseIsStale) return "";
        const s = (saved ?? "").trim();
        return s ? (saved as string) : "";
      }
      if (proseIsStale) return drafted;
      const s = (saved ?? "").trim();
      return s ? (saved as string) : drafted;
    };

    // Flashpoint/protests render four data-driven "reads" (Activism & Protest,
    // Civil Unrest & Public Order, Forecast, Regional & Country View). Build the
    // SAME dataset the preview/PDF consume so each read seeds with the exact
    // generated text the analyst edits; pick() then applies the identical
    // staleness/saved-override rules used by every other section. Other topics
    // never render these reads, so leave them blank.
    const fpReads =
      topic === "flashpoint" || topic === "protests"
        ? buildFlashpointReportDataset(incidents ?? [], topic, issueDate)
        : null;

    // Replace empty titles and the well-known old regional defaults (e.g.
    // "APAC Fuel Watch", "Hormuz Maritime Watch") with the canonical title.
    // Any other stored title is treated as a manual edit and preserved.
    setForm({
      title: resolveReportTitle(topic, report.title),
      topic,
      status: report.status ?? "draft",
      issueDate,
      riskRating: report.riskRating ?? "",
      executiveSummary: pick(savedExec, draft.executiveSummary),
      situation: pick(report.situation, draft.situation),
      whatHappened: pick(report.whatHappened, draft.whatHappened),
      whatMatters: pick(report.whatMatters, draft.whatMatters),
      implications: pick(report.implications, draft.implications),
      polestarView: pick(report.polestarView, draft.polestarView),
      watchNext: pick(report.watchNext, draft.watchNext),
      activismRead: fpReads
        ? pick(report.activismRead, fpReads.activismRead)
        : "",
      civilUnrestRead: fpReads
        ? pick(report.civilUnrestRead, fpReads.civilUnrestRead)
        : "",
      forecastRead: fpReads
        ? pick(report.forecastRead, fpReads.forecastRead)
        : "",
      regionalCountryRead: fpReads
        ? pick(report.regionalCountryRead, fpReads.regionalCountryRead)
        : "",
      // Topic-specific reads (shipping/cargo/fuel/conflict) seed SAVED-ONLY:
      // pick(saved, "") drops stale saved prose and otherwise returns the saved
      // override or blank. A blank field renders the live generated read at
      // render time (pickRead in the preview + PDF) — no dataset build needed
      // here and no fabricated prose is frozen into the editor.
      chokepointRouteRead: pick(report.chokepointRouteRead, ""),
      vesselPiracyRead: pick(report.vesselPiracyRead, ""),
      commercialImpactRead: pick(report.commercialImpactRead, ""),
      maritimeSecurityRead: pick(report.maritimeSecurityRead, ""),
      cargoSecurityRead: pick(report.cargoSecurityRead, ""),
      logisticsHubRead: pick(report.logisticsHubRead, ""),
      fuelMarketRead: pick(report.fuelMarketRead, ""),
      fuelOperationalRead: pick(report.fuelOperationalRead, ""),
      fuelRegionalHighlights: pick(report.fuelRegionalHighlights, ""),
      conflictOtherWatchedRead: pick(report.conflictOtherWatchedRead, ""),
      conflictAreaReads: proseIsStale ? {} : (report.conflictAreaReads ?? {}),
      author: report.author ?? "",
    });
    setSectionOverrides(
      (report.sectionOverrides as TopicSectionOverrides | null) ?? {},
    );
    setSeededId(report.id);
  }, [report, incidents]);

  // Reset the seed guard if the route id changes.
  useEffect(() => {
    if (seededForId.current !== null && seededForId.current !== id) {
      seededForId.current = null;
    }
    if (fuelPrefillForId.current !== null && fuelPrefillForId.current !== id) {
      fuelPrefillForId.current = null;
      fuelPrefillBaselines.current = {};
    }
    if (
      hardNumbersSeededForId.current !== null &&
      hardNumbersSeededForId.current !== id
    ) {
      hardNumbersSeededForId.current = null;
      setHardNumbersText("");
      setHardNumbersError(null);
      setHardNumbersEdited(undefined);
      setFuelForm(EMPTY_FUEL_MARKET_FORM);
      setFuelFormErrors([]);
      setShowFuelJson(false);
      setAllowMissingExport(false);
      setExportError(null);
      setSampleAutoSeeded(false);
    }
  }, [id]);

  // Tracks whether the current in-memory market data came from the
  // auto-seed (no persisted hardNumbers) vs. the saved DB row. Drives
  // the "unsaved sample data" banner so authors aren't misled into
  // thinking placeholder values are real.
  const [sampleAutoSeeded, setSampleAutoSeeded] = useState(false);

  // Seed both the form-based panel and the JSON advanced view from the
  // persisted payload once per report. Round-tripping through the
  // canonical builder guarantees the form shows exactly what the
  // preview/PDF will read on the next render.
  //
  // Fuel Watch UX rule: opening a report with no persisted market data
  // must NOT leave the editor blocked behind a red banner. Auto-seed
  // FUEL_MARKET_DATA_SAMPLE into the in-memory form so the preview and
  // PDF are immediately usable. The sample stays in-memory only — it
  // is not written back to the DB unless the author clicks Save.
  useEffect(() => {
    if (!report) return;
    if (hardNumbersSeededForId.current === report.id) return;
    hardNumbersSeededForId.current = report.id;
    const hasPersisted = report.hardNumbers != null;
    // Honesty rule: never auto-inject fabricated placeholder prices into the
    // preview/PDF. Live prices are written into report.hardNumbers by the
    // FRED market-price ingest (lib/ingest/marketPrices). A report with no
    // saved data renders empty market fields rather than fake numbers; the
    // author can still click "Load sample" to populate a template explicitly.
    const effectiveHardNumbers = hasPersisted ? report.hardNumbers : null;
    setHardNumbersText(
      effectiveHardNumbers ? JSON.stringify(effectiveHardNumbers, null, 2) : "",
    );
    setHardNumbersError(null);
    setHardNumbersEdited(undefined);
    const seeded = buildFuelWatchReportData(
      {
        issueDate: report.issueDate ?? new Date().toISOString().slice(0, 10),
        hardNumbers: effectiveHardNumbers,
      },
      [],
    );
    setFuelForm(fuelMarketFormFromData(seeded));
    setFuelFormErrors([]);
    setAllowMissingExport(false);
    setExportError(null);
    setSampleAutoSeeded(false);
  }, [report]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = (opts?: { force?: boolean }) => {
    // Orphaned Fast Facts guard: saving would persist owner edits keyed to a
    // tile that no longer exists (they render nowhere). First Save click with
    // orphans present shows a notice naming them next to the Save button; the
    // owner either fixes them in the panel (notice auto-clears, next Save is
    // silent) or explicitly clicks "Save anyway".
    if (orphanedFastFactKeys.length > 0 && !opts?.force) {
      setOrphanSavePending(true);
      return;
    }
    setOrphanSavePending(false);
    setSaveBlocked(null);
    // Conflict Watch is location-led: it drops the Executive Summary, What
    // Happened and Implications sections. Only Situation / What Matters /
    // Watch Next / Polestar View are editable + persisted; the rest of the
    // spine (Top Activity Areas, Other Watched Theatres) is render-time
    // auto-prose. So never write those dropped fields for conflict.
    const isConflict = form.topic === "conflict";
    // Fuel Watch market-data save semantics:
    //   * Advanced JSON view dirty → validate the textarea content and
    //     persist that. Blocks on invalid JSON rather than silently
    //     dropping the edit.
    //   * Otherwise → assemble from the form. Empty form → clear
    //     payload with `hardNumbers: null`.
    const payload: Record<string, unknown> = { ...form };
    // Conflict reports never persist the dropped narrative fields — they are
    // hidden from the form and rendered nowhere, so leaving them out of the
    // payload keeps the DB free of stale boilerplate written from form state.
    if (isConflict) {
      delete payload.whatHappened;
      delete payload.implications;
      delete payload.executiveSummary;
    }
    // Data-driven "reads" are analyst OVERRIDES — a blank/NULL column renders
    // the live generated read (no fabrication, no frozen-stale prose). Each
    // topic carries only its own read columns, so delete every read that does
    // not belong to the current topic before persisting. regionalCountryRead is
    // SHARED by flashpoint/protests ("Regional & Country View"), shipping
    // ("Regional & Country View") and cargo ("Regional Read").
    const READ_KEYS_BY_TOPIC: Record<string, readonly string[]> = {
      flashpoint: [
        "activismRead",
        "civilUnrestRead",
        "forecastRead",
        "regionalCountryRead",
      ],
      protests: [
        "activismRead",
        "civilUnrestRead",
        "forecastRead",
        "regionalCountryRead",
      ],
      shipping: [
        "chokepointRouteRead",
        "vesselPiracyRead",
        "commercialImpactRead",
        "maritimeSecurityRead",
        "regionalCountryRead",
      ],
      cargo_watch: ["cargoSecurityRead", "logisticsHubRead", "regionalCountryRead"],
      fuel: ["fuelMarketRead", "fuelOperationalRead", "fuelRegionalHighlights"],
      conflict: ["conflictOtherWatchedRead", "conflictAreaReads"],
    };
    const ALL_READ_KEYS = [
      "activismRead",
      "civilUnrestRead",
      "forecastRead",
      "regionalCountryRead",
      "chokepointRouteRead",
      "vesselPiracyRead",
      "commercialImpactRead",
      "maritimeSecurityRead",
      "cargoSecurityRead",
      "logisticsHubRead",
      "fuelMarketRead",
      "fuelOperationalRead",
      "fuelRegionalHighlights",
      "conflictOtherWatchedRead",
      "conflictAreaReads",
    ] as const;
    const keepReads = new Set(READ_KEYS_BY_TOPIC[form.topic] ?? []);
    for (const key of ALL_READ_KEYS) {
      if (!keepReads.has(key)) delete payload[key];
    }

    // Flashpoint/protests seed PRE-FILLED with the generated read, so persist a
    // read only when it differs from a freshly-generated dataset read; an
    // untouched field stores "" (renders the live auto read). Shipping, cargo
    // and fuel seed SAVED-ONLY (blank box), so their form value already IS the
    // override and flows through {...payload} unchanged.
    if (form.topic === "flashpoint" || form.topic === "protests") {
      const gen = buildFlashpointReportDataset(
        incidentsForExport,
        form.topic,
        form.issueDate,
      );
      const overrideRead = (val: string, generated: string) => {
        const t = (val ?? "").trim();
        return t && t !== (generated ?? "").trim() ? t : "";
      };
      payload.activismRead = overrideRead(form.activismRead, gen.activismRead);
      payload.civilUnrestRead = overrideRead(
        form.civilUnrestRead,
        gen.civilUnrestRead,
      );
      payload.forecastRead = overrideRead(form.forecastRead, gen.forecastRead);
      payload.regionalCountryRead = overrideRead(
        form.regionalCountryRead,
        gen.regionalCountryRead,
      );
    } else if (form.topic === "conflict") {
      // Conflict reads seed SAVED-ONLY too. Prune blank per-theatre entries so
      // the JSONB map holds only genuine analyst overrides (each absent key
      // renders that theatre's live auto read).
      const pruned: Record<string, string> = {};
      for (const [theatre, text] of Object.entries(form.conflictAreaReads)) {
        const t = (text ?? "").trim();
        if (t) pruned[theatre] = t;
      }
      payload.conflictAreaReads = pruned;
    }
    // Empty override → clear the stored rating (card pull falls back to the
    // computed/auto value). A set value persists the analyst's choice.
    payload.riskRating = form.riskRating ? form.riskRating : null;
    // Durable layout controls persist verbatim (null when empty so the column
    // clears). form has no override keys, so this is additive to {...form}.
    {
      // Prune blank entries (a cleared override reverts to auto and is not
      // persisted) so the stored jsonb holds only genuine overrides.
      const pruned = pruneTopicSectionOverrides(sectionOverrides);
      payload.sectionOverrides =
        Object.keys(pruned).length === 0
          ? null
          : (pruned as NonNullable<ReportUpdate["sectionOverrides"]>);
    }
    if (form.topic === "fuel") {
      // Direct-edit prefill semantics: the boxes were pre-filled with the
      // rendered auto/AI text so the owner can cut/replace it in place. A box
      // still byte-equal to its prefill baseline was NOT edited — persist ""
      // so the section keeps following the live AI/auto text rather than
      // freezing today's copy. Any changed box persists as a genuine override.
      for (const [key, baseline] of Object.entries(
        fuelPrefillBaselines.current,
      )) {
        const val =
          ((payload as Record<string, unknown>)[key] as string | undefined) ??
          "";
        if (val.trim() === baseline.trim()) {
          (payload as Record<string, unknown>)[key] = "";
        }
      }
      if (showFuelJson) {
        if (!hardNumbersText.trim()) {
          payload.hardNumbers = null;
          setHardNumbersError(null);
        } else {
          const v = validateFuelHardNumbersJson(hardNumbersText);
          if (!v.ok) {
            setHardNumbersError(v.errors.join(" "));
            setSaveBlocked(
              "Not saved — the fuel market data JSON is invalid. See the error under the JSON editor below.",
            );
            return;
          }
          setHardNumbersError(null);
          payload.hardNumbers = v.value;
        }
      } else {
        const result = buildHardNumbersFromForm(fuelForm);
        if (result.errors.length > 0) {
          setFuelFormErrors(result.errors);
          setSaveBlocked(
            `Not saved — fix the fuel market data fields first: ${result.errors.join(" ")}`,
          );
          return;
        }
        setFuelFormErrors([]);
        // Persist exactly what the preview shows: merge form-controlled
        // sections with any non-form sections (sample supply/policy/
        // routes, jetFuel snapshot, etc.) carried in hardNumbersEdited
        // or the prior saved payload. This is the same merge applyFuelForm
        // uses, so save === preview by construction.
        const prior =
          (hardNumbersEdited as Record<string, unknown> | null | undefined) ??
          (report?.hardNumbers as Record<string, unknown> | null | undefined);
        payload.hardNumbers = mergeFuelHardNumbers(result.payload, prior);
      }
    }
    update.mutate(
      { id, data: payload as never },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardOverviewQueryKey() });
          // After a successful save, drop the in-memory override and let
          // the next report refetch reseed the form from DB truth. This
          // is what the persistence test exercises: save → reseed → the
          // form should show what was just written.
          hardNumbersSeededForId.current = null;
          setHardNumbersEdited(undefined);
          setSampleAutoSeeded(false);
          clearLegacyExecSummary(id);
        },
      },
    );
  };

  // Form-driven rebuild — every field edit re-assembles the canonical
  // hardNumbers payload and pushes it to the preview via hardNumbersEdited.
  // Non-form sections (fastFacts.supply/policy/routes and any other
  // top-level keys we don't surface in the form) are preserved from the
  // current live payload so that editing a single Brent field after
  // Load Sample doesn't silently drop the rest of the sample.
  const applyFuelForm = (next: FuelMarketFormState) => {
    setFuelForm(next);
    setAllowMissingExport(false);
    setExportError(null);
    setSampleAutoSeeded(false);
    const built = buildHardNumbersFromForm(next);
    setFuelFormErrors(built.errors);
    const prior =
      (hardNumbersEdited as Record<string, unknown> | null | undefined) ??
      (report?.hardNumbers as Record<string, unknown> | null | undefined);
    const merged = mergeFuelHardNumbers(built.payload, prior);
    setHardNumbersEdited(merged);
    setHardNumbersText(merged ? JSON.stringify(merged, null, 2) : "");
  };

  const setFuelCardField = (
    section: "brent" | "wti",
    key: keyof FuelMarketCardForm,
    value: string,
  ) => {
    applyFuelForm({
      ...fuelForm,
      [section]: { ...fuelForm[section], [key]: value },
    });
  };
  const setFuelJetField = (
    key: keyof FuelMarketFormState["jet"],
    value: string,
  ) => {
    applyFuelForm({ ...fuelForm, jet: { ...fuelForm.jet, [key]: value } });
  };
  const setFuelTrajectoryText = (value: string) => {
    applyFuelForm({ ...fuelForm, trajectoryText: value });
  };

  const loadSampleFuelData = () => {
    const text = JSON.stringify(FUEL_MARKET_DATA_SAMPLE, null, 2);
    setHardNumbersText(text);
    setHardNumbersError(null);
    setHardNumbersEdited(FUEL_MARKET_DATA_SAMPLE);
    setSampleAutoSeeded(false);
    // Reseed the form so the user can edit individual fields next.
    const seeded = buildFuelWatchReportData(
      { issueDate: form.issueDate, hardNumbers: FUEL_MARKET_DATA_SAMPLE },
      [],
    );
    setFuelForm(fuelMarketFormFromData(seeded));
    setFuelFormErrors([]);
    setAllowMissingExport(false);
    setExportError(null);
  };

  const validateFuelData = () => {
    const v = validateFuelHardNumbersJson(hardNumbersText);
    if (!v.ok) {
      setHardNumbersError(v.errors.join(" "));
      setHardNumbersEdited(undefined);
      return;
    }
    setHardNumbersError(null);
    setHardNumbersEdited(v.value);
    setSampleAutoSeeded(false);
    // Sync the form from the validated JSON so switching back to the
    // form view doesn't silently discard the edit.
    const seeded = buildFuelWatchReportData(
      { issueDate: form.issueDate, hardNumbers: v.value },
      [],
    );
    setFuelForm(fuelMarketFormFromData(seeded));
    setFuelFormErrors([]);
  };

  // Form-state truth for the debug panel and the system-error guard.
  // We can't trust placeholder text — only `.value.trim()` counts as
  // "the user actually entered something".
  const formHas = {
    brent: fuelForm.brent.value.trim() !== "",
    wti: fuelForm.wti.value.trim() !== "",
    jet: fuelForm.jet.value.trim() !== "",
    trajectoryLines: fuelForm.trajectoryText
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "").length,
  };

  // Live canonical view of the report — drives the editor banner and the
  // PDF export gate. We pass an empty incident list when incidents are
  // still loading so the banner doesn't flicker into "no related incidents".
  const liveFuelData =
    form.topic === "fuel" && form.issueDate
      ? buildFuelWatchReportData(
          {
            title: form.title,
            issueDate: form.issueDate,
            author: form.author,
            executiveSummary: form.executiveSummary,
            situation: form.situation,
            whatHappened: form.whatHappened,
            whatMatters: form.whatMatters,
            implications: form.implications,
            polestarView: form.polestarView,
            watchNext: form.watchNext,
            hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
          },
          incidentsForExport,
        )
      : null;

  if (isLoading)
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!report)
    return (
      <div className="text-sm text-muted-foreground">Report not found.</div>
    );

  const scope = scopeFor(form.topic);
  // The rating a card pull would derive if the analyst leaves the override
  // blank: worst credible tier among scoped incidents, else the prose
  // heuristic. Built from the live form so it tracks topic / issue-date /
  // prose edits, mirroring exactly what cardAutofill.reportToCard computes.
  const computedRating =
    report != null
      ? autoReportRating(
          {
            ...report,
            topic: form.topic as typeof report.topic,
            issueDate: form.issueDate,
            situation: form.situation,
            whatMatters: form.whatMatters,
            implications: form.implications,
            whatHappened: form.whatHappened,
          },
          incidents ?? [],
        )
      : undefined;
  // Live freshness warning — recomputes as the author edits the issue date.
  const staleProse = computeStale(form.topic, form.issueDate);
  // Option A enforcement on manual edits: a report must never be dated past
  // the latest real record for its data topic. The seed clamps the date; this
  // keeps it clamped when the author edits the Issue Date field by hand, so a
  // static/import-only report can't be re-dated forward to present stale data
  // as current. `max` blocks the native picker; the onChange clamp catches
  // typed input. Returns "" (no cap) when no records exist for the topic.
  const issueDateMax = (() => {
    // Fuel Watch is market-driven: cap the issue date at the latest market
    // close it carries, not the latest incident. Falls through to the
    // incident cap only when no market data is present yet.
    if (form.topic === "fuel") {
      const market = fuelMarketLatestDate(
        hardNumbersEdited ?? report?.hardNumbers,
      );
      if (market) return market;
    }
    const dataTopic = form.topic === "protests" ? "flashpoint" : form.topic;
    const latest = latestRecordDate(incidents ?? [], dataTopic);
    // UTC day (see utcYmd) so the issue-date cap matches the UTC clamp/"today"
    // and does not let an eastern viewer pick a day past the real data.
    return latest ? utcYmd(latest) : "";
  })();

  return (
    <div className="max-w-[1900px] mx-auto space-y-4">
      <div className="flex items-end justify-between no-print">
        <div>
          <Link
            href="/reports"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> All Reports
          </Link>
          <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mt-2">
            Polestar Insights
          </div>
          <h1 className="text-2xl font-serif font-bold text-primary uppercase tracking-tight mt-0.5">
            {form.title || "Untitled report"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {form.topic === "cargo_watch" && (
            <>
              <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none mr-1">
                <input
                  type="checkbox"
                  checked={includeFullAnnex}
                  onChange={(e) => setIncludeFullAnnex(e.target.checked)}
                  className="accent-accent"
                />
                Include full annex
              </label>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCargoRegisterCsv(
                    cargoRegisterRows,
                    `${slugifyForFilename(form.title || "cargo-watch")}-incident-register.csv`,
                  )
                }
                disabled={cargoRegisterRows.length === 0}
                className="rounded-sm"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export Incident Register
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => {
              void downloadPdf();
            }}
            disabled={exporting}
            className="rounded-sm"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            {exporting ? "Generating PDF..." : "Download PDF"}
          </Button>
          <Button
            onClick={() => save()}
            disabled={update.isPending}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            {update.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Save outcome, right where the button is. A blocked or failed save
          used to be completely silent here (validation errors render far down
          the page; the PATCH mutation surfaced nothing), which reads as "my
          edits don't show up" after a reload discards the unsaved form. */}
      {saveBlocked ? (
        <p className="text-[12px] font-medium text-amber-700">{saveBlocked}</p>
      ) : update.isError ? (
        <p className="text-[12px] font-medium text-destructive">
          Save failed —{" "}
          {update.error instanceof Error
            ? update.error.message
            : "the server rejected the request."}{" "}
          Your edits are still in the form; try Save again.
        </p>
      ) : update.isSuccess && !update.isPending ? (
        <p className="text-[12px] font-medium text-emerald-700">Saved.</p>
      ) : null}

      {/* Save intercepted: orphaned Fast Facts edits exist. Names each orphan
          so the owner sees exactly what would persist dead; "Save anyway"
          bypasses once, fixing the orphans clears the notice automatically. */}
      {orphanSavePending && (
        <OrphanSaveWarning
          orphanKeys={orphanedFastFactKeys}
          onSaveAnyway={() => save({ force: true })}
          onCancel={() => setOrphanSavePending(false)}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-sm p-5 space-y-3 no-print">
          {scope && (
            <div
              className="text-[12px] leading-snug p-3 rounded-sm border"
              style={{
                background: "#f3f4fa",
                borderColor: "#465bff",
                color: "#0b0a3d",
                fontFamily: "Roboto, sans-serif",
              }}
            >
              <div
                className="uppercase tracking-widest font-bold text-[10px] mb-1"
                style={{ color: "#465bff" }}
              >
                {TOPIC_LABELS[form.topic]} scope
              </div>
              {scope}
            </div>
          )}
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Topic">
              <Select value={form.topic} onValueChange={(v) => set("topic", v)}>
                <SelectTrigger className="rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPICS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TOPIC_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v)}
              >
                <SelectTrigger className="rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Issue Date">
              <Input
                type="date"
                value={form.issueDate}
                max={issueDateMax || undefined}
                onChange={(e) =>
                  set(
                    "issueDate",
                    form.topic === "fuel"
                      ? resolveFuelPeriodEnd(
                          e.target.value,
                          hardNumbersEdited ?? report?.hardNumbers,
                          incidents ?? [],
                        )
                      : clampIssueDateToLatestRecord(
                          e.target.value,
                          incidents ?? [],
                          form.topic === "protests" ? "flashpoint" : form.topic,
                        ),
                  )
                }
                className="rounded-sm"
              />
            </Field>
          </div>
          <Field label="Author">
            <Input
              value={form.author}
              onChange={(e) => set("author", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="Risk Rating">
            <Select
              value={form.riskRating || "__auto__"}
              onValueChange={(v) =>
                set("riskRating", v === "__auto__" ? "" : v)
              }
            >
              <SelectTrigger className="rounded-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">
                  {computedRating
                    ? `Auto — ${CARD_RATING_LABELS[computedRating]} (from data)`
                    : "Auto (from data)"}
                </SelectItem>
                {CARD_RATINGS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {CARD_RATING_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {form.riskRating
                ? "Overrides the rating computed from incidents when this report is pulled into a card."
                : computedRating
                  ? `Left on Auto: this report rates ${CARD_RATING_LABELS[computedRating]} from its incidents.`
                  : "Left on Auto: rating is computed from incidents when pulled into a card."}
            </p>
          </Field>

          {/* Section visibility + incident curation — mirrors the country
              brief. Hides canonical sections from BOTH preview and PDF (same
              section keys), and excludes / demote-only-rerates relevance-passing
              window incidents. STRICT no-fabrication: curate only from the
              in-window pool; nothing can be added or up-rated. */}
          <div className="border-t border-border pt-3 mt-1">
            <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-2">
              Section visibility
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {topicSectionKeys(form.topic).map(({ key, label }) => {
                const hidden = hiddenSections.includes(key);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden}
                      onChange={(e) => {
                        setSectionOverrides((ov) => {
                          const s = new Set(ov.hiddenSections ?? []);
                          if (e.target.checked) s.delete(key);
                          else s.add(key);
                          return { ...ov, hiddenSections: Array.from(s) };
                        });
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Per-tile Fast Facts overrides. Keyed by the tile's AUTO label so
              a saved override re-attaches to the same tile as its computed
              value changes week to week. Blank field = keep the auto text;
              clearing every field reverts the tile fully to auto. Applied
              identically in the preview AND the PDF exporters. */}
          {autoFastFacts.length > 0 && (
            <div className="border-t border-border pt-3 mt-1">
              <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
                Fast Facts overrides
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Blank fields keep the computed value. Clear all three to revert
                a tile to auto.
              </p>
              <div className="flex flex-col gap-2">
                {autoFastFacts.map((card) => {
                  const ov: FastFactOverride =
                    sectionOverrides.fastFactOverrides?.[card.label] ?? {};
                  const setF = (field: keyof FastFactOverride, v: string) =>
                    setSectionOverrides((prev) => ({
                      ...prev,
                      fastFactOverrides: {
                        ...(prev.fastFactOverrides ?? {}),
                        [card.label]: {
                          ...(prev.fastFactOverrides?.[card.label] ?? {}),
                          [field]: v,
                        },
                      },
                    }));
                  return (
                    <div
                      key={card.label}
                      className="border border-border rounded-sm p-2"
                    >
                      <div className="text-[11px] text-muted-foreground mb-1.5">
                        {card.label} — auto: {card.value}
                        {card.note ? ` · ${card.note}` : ""}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Input
                          placeholder="Label"
                          value={ov.label ?? ""}
                          onChange={(e) => setF("label", e.target.value)}
                          className="rounded-sm text-[12px] h-8"
                        />
                        <Input
                          placeholder="Value"
                          value={ov.value ?? ""}
                          onChange={(e) => setF("value", e.target.value)}
                          className="rounded-sm text-[12px] h-8"
                        />
                        <Input
                          placeholder="Note"
                          value={ov.note ?? ""}
                          onChange={(e) => setF("note", e.target.value)}
                          className="rounded-sm text-[12px] h-8"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Orphaned overrides: saved edits keyed to an auto tile label
                  that no longer exists (a builder renamed the tile). They no
                  longer apply anywhere; surface them so the owner can
                  re-attach the edit to a current tile or clear it. Nothing is
                  migrated silently. */}
              <OrphanedFastFactsPanel
                autoFastFacts={autoFastFacts}
                overrides={sectionOverrides.fastFactOverrides}
                onReattach={(from, to) =>
                  setSectionOverrides((prev) => ({
                    ...prev,
                    fastFactOverrides: reattachFastFactOverride(
                      prev.fastFactOverrides,
                      from,
                      to,
                    ),
                  }))
                }
                onClear={(key) =>
                  setSectionOverrides((prev) => ({
                    ...prev,
                    fastFactOverrides: clearFastFactOverride(
                      prev.fastFactOverrides,
                      key,
                    ),
                  }))
                }
              />
            </div>
          )}

          {/* The Gulf & Hormuz read paragraph is no longer separately editable —
              it folds into the Operational Read narrative (owner ruling), which
              already has its own edit box. */}

          {/* Fuel Watch: per-bullet overrides for the Gulf & Hormuz Chokepoint
              Watch lists. Keyed by the bullet's AUTO line so a saved override
              re-attaches to the same bullet. Uncheck to suppress; non-blank
              text replaces the line; blank = auto. Applied identically in the
              preview AND the PDF exporter. */}
          {form.topic === "fuel" &&
            (fuelOverridePanels?.gulfLines.length ?? 0) > 0 && (
            <div className="border-t border-border pt-3 mt-1">
              <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
                Gulf &amp; Hormuz bullet overrides
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Uncheck to remove a bullet. Blank text keeps the auto line.
              </p>
              <div className="flex flex-col gap-2">
                {fuelOverridePanels!.gulfLines.map((line) => {
                  const ov: GulfBulletOverride =
                    sectionOverrides.gulfBulletOverrides?.[line] ?? {};
                  const setG = (patch: Partial<GulfBulletOverride>) =>
                    setSectionOverrides((prev) => ({
                      ...prev,
                      gulfBulletOverrides: {
                        ...(prev.gulfBulletOverrides ?? {}),
                        [line]: {
                          ...(prev.gulfBulletOverrides?.[line] ?? {}),
                          ...patch,
                        },
                      },
                    }));
                  return (
                    <div
                      key={line}
                      className="border border-border rounded-sm p-2"
                      style={{ opacity: ov.suppressed ? 0.5 : 1 }}
                    >
                      <label className="flex items-start gap-2 text-[11px] text-muted-foreground mb-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!ov.suppressed}
                          className="mt-0.5"
                          onChange={(e) =>
                            setG({ suppressed: !e.target.checked })
                          }
                        />
                        <span>{line}</span>
                      </label>
                      <Input
                        placeholder="Replacement text (blank = auto)"
                        value={ov.text ?? ""}
                        onChange={(e) => setG({ text: e.target.value })}
                        className="rounded-sm text-[12px] h-8"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Orphaned Gulf/Hormuz bullet overrides: saved edits keyed to an
              auto line that no longer renders (the underlying incident title,
              date wording or classification changed on a refresh). They no
              longer apply anywhere; surface them so the owner can re-attach
              the edit to a current bullet or clear it. Nothing is migrated
              silently. */}
          {form.topic === "fuel" && (
            <OrphanedGulfBulletsPanel
              autoLines={fuelOverridePanels?.gulfLines ?? []}
              overrides={sectionOverrides.gulfBulletOverrides}
              onReattach={(from, to) =>
                setSectionOverrides((prev) => ({
                  ...prev,
                  gulfBulletOverrides: reattachGulfBulletOverride(
                    prev.gulfBulletOverrides,
                    from,
                    to,
                  ),
                }))
              }
              onClear={(key) =>
                setSectionOverrides((prev) => ({
                  ...prev,
                  gulfBulletOverrides: clearGulfBulletOverride(
                    prev.gulfBulletOverrides,
                    key,
                  ),
                }))
              }
            />
          )}

          {/* Fuel Watch: Market and Operator Responses. Compact collapsed rows
              (include checkbox + effective summary + Edit); the edit panel
              prepopulates with the values the report currently renders and
              stores only fields that differ from the generated text. Same
              persistence (marketOperatorOverrides), same preview/PDF apply. */}
          {form.topic === "fuel" &&
            (fuelOverridePanels?.producerRows.length ?? 0) > 0 && (
            <MarketOperatorResponsesEditor
              rows={fuelOverridePanels!.producerRows}
              overrides={sectionOverrides.marketOperatorOverrides}
              onSetOverride={(key, value) =>
                setSectionOverrides((prev) => ({
                  ...prev,
                  marketOperatorOverrides: {
                    ...(prev.marketOperatorOverrides ?? {}),
                    [key]: value,
                  },
                }))
              }
            />
          )}

          {/* Orphaned Market and Operator Responses overrides: saved edits
              keyed to a row whose date|actor|action key no longer matches any
              current auto row. They no longer apply anywhere; surface them so
              the owner can re-attach the edit to a current row or clear it.
              Nothing is migrated silently. */}
          {form.topic === "fuel" && (
            <OrphanedMarketOperatorPanel
              autoRows={fuelOverridePanels?.producerRows ?? []}
              overrides={sectionOverrides.marketOperatorOverrides}
              onReattach={(from, to) =>
                setSectionOverrides((prev) => ({
                  ...prev,
                  marketOperatorOverrides: reattachMarketOperatorOverride(
                    prev.marketOperatorOverrides,
                    from,
                    to,
                  ),
                }))
              }
              onClear={(key) =>
                setSectionOverrides((prev) => ({
                  ...prev,
                  marketOperatorOverrides: clearMarketOperatorOverride(
                    prev.marketOperatorOverrides,
                    key,
                  ),
                }))
              }
            />
          )}

          {/* Energy/fertiliser: Market Prices row overrides. Value must be numeric (the
              card formats numbers); a non-numeric value is ignored at render.
              Blank = live FRED value. */}
          {(form.topic === "energy" || form.topic === "fertiliser") &&
            marketPriceRows.length > 0 && (
            <div className="border-t border-border pt-3 mt-1">
              <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-1">
                Market Prices overrides
              </div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Blank keeps the live value. Value must be a number; the change
                text is free-form.
              </p>
              <div className="flex flex-col gap-1.5">
                {[...marketPriceRows]
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((r) => {
                    const k = `${r.group}:${r.key}`;
                    const ov = sectionOverrides.marketPriceOverrides?.[k] ?? {};
                    const setM = (field: "value" | "change", v: string) =>
                      setSectionOverrides((prev) => ({
                        ...prev,
                        marketPriceOverrides: {
                          ...(prev.marketPriceOverrides ?? {}),
                          [k]: {
                            ...(prev.marketPriceOverrides?.[k] ?? {}),
                            [field]: v,
                          },
                        },
                      }));
                    return (
                      <div
                        key={k}
                        className="grid grid-cols-[1fr_110px_110px] gap-1.5 items-center"
                      >
                        <div className="text-[12px] text-foreground min-w-0 truncate">
                          {r.label}
                          <span className="text-muted-foreground">
                            {" "}
                            · auto {r.value}
                            {r.change ? ` (${r.change})` : ""}
                          </span>
                        </div>
                        <Input
                          placeholder="Value"
                          value={ov.value ?? ""}
                          onChange={(e) => setM("value", e.target.value)}
                          className="rounded-sm text-[12px] h-8"
                        />
                        <Input
                          placeholder="Change"
                          value={ov.change ?? ""}
                          onChange={(e) => setM("change", e.target.value)}
                          className="rounded-sm text-[12px] h-8"
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {curationPool.length > 0 && (
            <div className="border-t border-border pt-3 mt-1">
              <div className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground mb-2">
                Incident selection &amp; severity ({curationPool.length} in window)
              </div>
              <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
                {curationPool.map((inc) => {
                  const incId = String(inc.id);
                  const excluded = (
                    sectionOverrides.excludedIncidentIds ?? []
                  ).includes(incId);
                  const stored = (inc.severity ?? "").trim().toLowerCase();
                  const demoteTo = sectionOverrides.severityDemotions?.[incId] ?? "";
                  return (
                    <div
                      key={incId}
                      className="border border-border rounded-sm p-2 flex gap-2.5 items-start"
                      style={{ opacity: excluded ? 0.5 : 1 }}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded}
                        className="mt-1"
                        onChange={(e) => {
                          setSectionOverrides((ov) => {
                            const s = new Set(ov.excludedIncidentIds ?? []);
                            if (e.target.checked) s.delete(incId);
                            else s.add(incId);
                            return { ...ov, excludedIncidentIds: Array.from(s) };
                          });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-foreground">
                          {inc.displayTitle ?? inc.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Stored severity: {stored || "—"}
                          {inc.location ? ` · ${inc.location}` : ""}
                        </div>
                      </div>
                      <select
                        value={demoteTo}
                        disabled={excluded}
                        className="text-[11px] border border-border rounded-sm p-1 text-muted-foreground"
                        onChange={(e) => {
                          const v = e.target.value;
                          setSectionOverrides((ov) => {
                            const next = { ...(ov.severityDemotions ?? {}) };
                            if (v) next[incId] = v;
                            else delete next[incId];
                            return { ...ov, severityDemotions: next };
                          });
                        }}
                      >
                        <option value="">Keep severity</option>
                        {SEVERITY_DEMOTE_OPTIONS.filter(
                          (o) => SEVERITY_ORDER[o] < (SEVERITY_ORDER[stored] ?? 4),
                        ).map((o) => (
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

          {/* Conflict Watch is location-led: Situation leads and the
              Executive Summary section is dropped entirely. */}
          {form.topic !== "conflict" && (
            <Field label="Executive Summary">
              <Textarea
                rows={4}
                value={form.executiveSummary}
                onChange={(e) => set("executiveSummary", e.target.value)}
                className="rounded-sm"
              />
            </Field>
          )}
          {/* Flashpoint/protests reports replace the generic Situation /
              What Happened spine with four data-driven "reads". Each textarea
              marries the on-screen + PDF section one-for-one, in the same
              order; clear a box to restore the auto-generated text. */}
          {(form.topic === "flashpoint" || form.topic === "protests") && (
            <>
              <Field label="Activism & Protest Read">
                <Textarea
                  rows={5}
                  value={form.activismRead}
                  onChange={(e) => set("activismRead", e.target.value)}
                  className="rounded-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Clear any read to restore the auto-generated text.
                </p>
              </Field>
              <Field label="Civil Unrest & Public Order Read">
                <Textarea
                  rows={5}
                  value={form.civilUnrestRead}
                  onChange={(e) => set("civilUnrestRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label={"Forecast: Next 7\u201314 Days"}>
                <Textarea
                  rows={5}
                  value={form.forecastRead}
                  onChange={(e) => set("forecastRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Regional & Country View">
                <Textarea
                  rows={5}
                  value={form.regionalCountryRead}
                  onChange={(e) => set("regionalCountryRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
            </>
          )}
          {/* Shipping/cargo/fuel/conflict render data-driven "reads" too. Each
              textarea mirrors one preview + PDF section one-for-one; a blank box
              renders the live generated read (no fabrication). Seeded
              SAVED-ONLY, so an empty field means "use the auto read". */}
          {form.topic === "shipping" && (
            <>
              <Field label="Chokepoint / Route Read">
                <Textarea
                  rows={5}
                  value={form.chokepointRouteRead}
                  onChange={(e) => set("chokepointRouteRead", e.target.value)}
                  className="rounded-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Clear any read to restore the auto-generated text.
                </p>
              </Field>
              <Field label="Vessel Threat and Piracy Read">
                <Textarea
                  rows={5}
                  value={form.vesselPiracyRead}
                  onChange={(e) => set("vesselPiracyRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Maritime Security (ICC CCS / IMB) Read">
                <Textarea
                  rows={5}
                  value={form.maritimeSecurityRead}
                  onChange={(e) => set("maritimeSecurityRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Commercial Impact on Shipping Read">
                <Textarea
                  rows={5}
                  value={form.commercialImpactRead}
                  onChange={(e) => set("commercialImpactRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Regional and Country View">
                <Textarea
                  rows={5}
                  value={form.regionalCountryRead}
                  onChange={(e) => set("regionalCountryRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
            </>
          )}
          {form.topic === "cargo_watch" && (
            <>
              <Field label="Cargo Security Read">
                <Textarea
                  rows={5}
                  value={form.cargoSecurityRead}
                  onChange={(e) => set("cargoSecurityRead", e.target.value)}
                  className="rounded-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Clear any read to restore the auto-generated text.
                </p>
              </Field>
              <Field label="Logistics Hub Read">
                <Textarea
                  rows={5}
                  value={form.logisticsHubRead}
                  onChange={(e) => set("logisticsHubRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Regional Read">
                <Textarea
                  rows={5}
                  value={form.regionalCountryRead}
                  onChange={(e) => set("regionalCountryRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
            </>
          )}
          {form.topic === "fuel" && (
            <>
              <Field label="Fuel Market Read">
                <Textarea
                  rows={5}
                  value={form.fuelMarketRead}
                  onChange={(e) => set("fuelMarketRead", e.target.value)}
                  className="rounded-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Boxes hold the text the report currently renders — edit, cut
                  or replace it directly. Clear a box to restore the
                  auto-generated text.
                </p>
              </Field>
              <Field label="Fuel Operational Read">
                <Textarea
                  rows={5}
                  value={form.fuelOperationalRead}
                  onChange={(e) => set("fuelOperationalRead", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
              <Field label="Regional Highlights">
                <Textarea
                  rows={5}
                  value={form.fuelRegionalHighlights}
                  onChange={(e) => set("fuelRegionalHighlights", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
            </>
          )}
          {form.topic === "conflict" && (
            <>
              {conflictAreaTheatres.map((theatre, idx) => (
                <Field key={theatre} label={`Top Activity Area \u2014 ${theatre}`}>
                  <Textarea
                    rows={5}
                    value={form.conflictAreaReads[theatre] ?? ""}
                    onChange={(e) =>
                      set("conflictAreaReads", {
                        ...form.conflictAreaReads,
                        [theatre]: e.target.value,
                      })
                    }
                    className="rounded-sm"
                  />
                  {idx === 0 && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Clear any read to restore the auto-generated text.
                    </p>
                  )}
                </Field>
              ))}
              <Field label="Other Watched Theatres Read">
                <Textarea
                  rows={5}
                  value={form.conflictOtherWatchedRead}
                  onChange={(e) =>
                    set("conflictOtherWatchedRead", e.target.value)
                  }
                  className="rounded-sm"
                />
                {conflictAreaTheatres.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Clear any read to restore the auto-generated text.
                  </p>
                )}
              </Field>
            </>
          )}
          {form.topic !== "flashpoint" && form.topic !== "protests" && (
            <Field label="Situation">
              <Textarea
                rows={4}
                value={form.situation}
                onChange={(e) => set("situation", e.target.value)}
                className="rounded-sm"
              />
            </Field>
          )}
          {form.topic !== "conflict" &&
            form.topic !== "flashpoint" &&
            form.topic !== "protests" && (
              <Field label="What Happened">
                <Textarea
                  rows={5}
                  value={form.whatHappened}
                  onChange={(e) => set("whatHappened", e.target.value)}
                  className="rounded-sm"
                />
              </Field>
            )}
          <Field label="What Matters">
            <Textarea
              rows={4}
              value={form.whatMatters}
              onChange={(e) => set("whatMatters", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          {form.topic !== "conflict" && (
            <Field
              label={
                form.topic === "cargo_watch"
                  ? "Implications"
                  : "Implications for Business"
              }
            >
              <Textarea
                rows={4}
                value={form.implications}
                onChange={(e) => set("implications", e.target.value)}
                className="rounded-sm"
              />
            </Field>
          )}
          <Field label="Watch Next">
            <Textarea
              rows={3}
              value={form.watchNext}
              onChange={(e) => set("watchNext", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="Polestar View">
            <Textarea
              rows={3}
              value={form.polestarView}
              onChange={(e) => set("polestarView", e.target.value)}
              className="rounded-sm"
            />
          </Field>

          {summariesEnabled && relatedForSummaries.length > 0 && (
            <div className="border-t border-border pt-4 mt-2 space-y-3">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
                    Related Incident Summaries
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    One short line per related incident, shown under its title in
                    the preview and PDF. Edit any line below, then Save
                    summaries. Regenerate redraws from the current data.
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm h-8 text-xs"
                    disabled={generateSummaries.isPending}
                    onClick={() => {
                      if (!id) return;
                      setSummaryEditError(null);
                      generateSummaries.mutate(
                        {
                          id,
                          data: { incidents: relatedForSummaries, force: true },
                        },
                        {
                          onSuccess: (res) => {
                            setSummaryRes(res);
                            setEditedSummaries(
                              (res.edited as Record<string, string>) ?? null,
                            );
                          },
                        },
                      );
                    }}
                  >
                    {generateSummaries.isPending ? "Working…" : "Regenerate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm h-8 text-xs"
                    disabled={editSummaries.isPending || !summaryRes}
                    onClick={saveIncidentSummaries}
                  >
                    {editSummaries.isPending ? "Saving…" : "Save summaries"}
                  </Button>
                </div>
              </div>

              {summaryRes && !summaryRes.available && (
                <div className="text-[11px] text-muted-foreground leading-snug">
                  AI summaries are unavailable, so each row shows a deterministic
                  fallback line. You can still edit any line below.
                </div>
              )}
              {summaryEditError && (
                <div
                  className="text-[12px] p-2 rounded-sm border"
                  style={{
                    background: "#f7eded",
                    borderColor: "#a33232",
                    color: "#a33232",
                    fontFamily: "Roboto, sans-serif",
                  }}
                >
                  {summaryEditError}
                </div>
              )}

              <div className="space-y-3">
                {relatedForSummaries.map((row) => {
                  const key = row.id ?? "";
                  if (!key) return null;
                  const value = resolveIncidentSummary(
                    {
                      id: key,
                      topic: row.topic,
                      title: row.title,
                      summary: row.summary,
                      location: row.location,
                      severity: row.severity,
                      occurredAt: row.occurredAt,
                      source: row.source,
                    },
                    effectiveSummaries,
                  );
                  return (
                    <div key={key} className="space-y-1">
                      <div className="text-[11px] font-medium leading-snug text-foreground">
                        {row.title || "Untitled incident"}
                      </div>
                      <Textarea
                        rows={2}
                        value={value}
                        onChange={(e) => setIncidentSummary(key, e.target.value)}
                        className="rounded-sm text-[12px]"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {form.topic === "fuel" && (
            <div className="border-t border-border pt-4 mt-2 space-y-3">
              {sampleAutoSeeded && (
                <div
                  className="text-[11px] leading-snug p-2 rounded-sm border"
                  style={{
                    background: "#f3f4fa",
                    borderColor: "#465bff",
                    color: "#0b0a3d",
                    fontFamily: "Roboto, sans-serif",
                  }}
                >
                  <span
                    className="font-bold uppercase tracking-widest text-[10px] mr-2"
                    style={{ color: "#465bff" }}
                  >
                    Sample data
                  </span>
                  This report has no saved market data, so sample values are
                  loaded in the form and preview. Edit the fields below and
                  click Save to persist your own numbers, or Save as-is to keep
                  the sample.
                </div>
              )}
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
                    Fuel Market Data
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Brent, WTI and jet fuel are required market indicators.
                    Trajectory points drive the Jet Fuel Price Trajectory chart
                    (minimum two dated points).
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm h-8 text-xs"
                    onClick={loadSampleFuelData}
                  >
                    Load sample
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm h-8 text-xs"
                    onClick={() => setShowFuelJson((v) => !v)}
                  >
                    {showFuelJson ? "Hide JSON" : "Advanced JSON"}
                  </Button>
                </div>
              </div>

              {/* Validation banner — surfaces fail-closed missing-data
                  reasons inline above the form so authors see exactly what
                  is required before they hit Save / Download PDF. */}
              {liveFuelData &&
                !liveFuelData.validation.hasRequiredFuelWatchData && (
                  <div
                    className="text-[12px] p-3 rounded-sm border space-y-1"
                    style={{
                      background: "#fdecec",
                      borderColor: "#a33232",
                      color: "#a33232",
                      fontFamily: "Roboto, sans-serif",
                    }}
                  >
                    <div className="font-bold">
                      Fuel Watch is missing required market data. Add Brent, WTI
                      and jet fuel data before export.
                    </div>
                    <div>
                      Missing:{" "}
                      {liveFuelData.validation.missingRequired.join(", ")}.
                    </div>
                  </div>
                )}

              <FuelMarketCardFields
                title="Brent crude"
                form={fuelForm.brent}
                onChange={(k, v) => setFuelCardField("brent", k, v)}
              />
              <FuelMarketCardFields
                title="WTI crude"
                form={fuelForm.wti}
                onChange={(k, v) => setFuelCardField("wti", k, v)}
              />

              <div className="border border-border rounded-sm p-3 space-y-2">
                <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
                  Jet fuel
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Benchmark">
                    <Input
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.benchmark}
                      onChange={(e) =>
                        setFuelJetField("benchmark", e.target.value)
                      }
                      placeholder="e.g. U.S. Gulf Coast kerosene-type jet fuel"
                    />
                  </Field>
                  <Field label="Source">
                    <Input
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.source}
                      onChange={(e) =>
                        setFuelJetField("source", e.target.value)
                      }
                      placeholder="e.g. EIA / FRED (DJFUELUSGULF)"
                    />
                  </Field>
                  <Field label="Value">
                    <Input
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.value}
                      onChange={(e) => setFuelJetField("value", e.target.value)}
                      placeholder="e.g. 4.152"
                    />
                  </Field>
                  <Field label="Unit">
                    <Input
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.unit}
                      onChange={(e) => setFuelJetField("unit", e.target.value)}
                      placeholder="e.g. USD/gal"
                    />
                  </Field>
                  <Field label="Change">
                    <Input
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.change}
                      onChange={(e) =>
                        setFuelJetField("change", e.target.value)
                      }
                      placeholder="e.g. +2.5% 7d"
                    />
                  </Field>
                  <Field label="As of">
                    <Input
                      type="date"
                      className="rounded-sm h-8 text-xs"
                      value={fuelForm.jet.asOf}
                      onChange={(e) => setFuelJetField("asOf", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label='Trajectory points (one per line, "YYYY-MM-DD, value")'>
                  <Textarea
                    rows={6}
                    value={fuelForm.trajectoryText}
                    onChange={(e) => setFuelTrajectoryText(e.target.value)}
                    placeholder={
                      "2026-04-17, 3.709\n2026-04-24, 3.906\n2026-05-01, 4.160"
                    }
                    className="rounded-sm font-mono text-[11px]"
                  />
                </Field>
                {fuelFormErrors.length > 0 && (
                  <div
                    className="text-[11px] p-2 rounded-sm border"
                    style={{
                      background: "#fdecec",
                      borderColor: "#a33232",
                      color: "#a33232",
                      fontFamily: "Roboto, sans-serif",
                    }}
                  >
                    {fuelFormErrors.map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                  </div>
                )}
              </div>

              {showFuelJson && (
                <div className="border border-border rounded-sm p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
                      Advanced: hardNumbers JSON
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-sm h-7 text-[11px]"
                      onClick={validateFuelData}
                    >
                      Validate &amp; sync form
                    </Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug">
                    Accepts <code>fastFacts</code>, top-level{" "}
                    <code>prices/supply/policy/routes</code>,{" "}
                    <code>jetFuel</code> snapshot, and{" "}
                    <code>jetFuelTrajectory</code>. Leave empty to clear.
                  </div>
                  <Textarea
                    rows={10}
                    value={hardNumbersText}
                    onChange={(e) => {
                      setHardNumbersText(e.target.value);
                      setHardNumbersError(null);
                      setHardNumbersEdited(undefined);
                      setSampleAutoSeeded(false);
                    }}
                    className="rounded-sm font-mono text-[11px]"
                  />
                  {hardNumbersError && (
                    <div
                      className="text-[11px] p-2 rounded-sm border"
                      style={{
                        background: "#fdecec",
                        borderColor: "#a33232",
                        color: "#a33232",
                        fontFamily: "Roboto, sans-serif",
                      }}
                    >
                      {hardNumbersError}
                    </div>
                  )}
                </div>
              )}

              {/* Per-field optional-data warnings. These do not block
                  export — they help the author tighten provenance. */}
              {(() => {
                const md = liveFuelData?.marketData;
                const hints: string[] = [];
                const check = (
                  prefix: string,
                  card: {
                    asOf?: string;
                    source?: string;
                    unit?: string;
                  } | null,
                ) => {
                  if (!card) return;
                  if (!card.asOf) hints.push(`${prefix} as-of date missing`);
                  if (!card.source) hints.push(`${prefix} source missing`);
                  if (!card.unit) hints.push(`${prefix} unit missing`);
                };
                check("Brent", md?.brent ?? null);
                check("WTI", md?.wti ?? null);
                check("Jet fuel", md?.jetFuel ?? null);
                if (md && md.jetFuel && md.jetFuelTrajectory.length < 2) {
                  hints.push(
                    "Jet fuel trajectory needs at least two dated points",
                  );
                }
                if (hints.length === 0) return null;
                return (
                  <div
                    className="text-[11px] p-2 rounded-sm border"
                    style={{
                      background: "#f3f4fa",
                      borderColor: "#465bff",
                      color: "#0b0a3d",
                      fontFamily: "Roboto, sans-serif",
                    }}
                  >
                    <div className="font-bold mb-1">
                      Recommended provenance fields
                    </div>
                    <ul className="list-disc list-inside leading-snug">
                      {hints.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {/* Editor-only debug panel. Hidden in PDF (no-print) and
                  inside `.no-print` ancestors. Shows the live form ↔
                  builder agreement so an author can see at a glance
                  whether their edits are reaching the report builder. */}
              {liveFuelData &&
                (() => {
                  const md = liveFuelData.marketData;
                  const hardNumbersSource =
                    hardNumbersEdited !== undefined
                      ? "live form"
                      : report?.hardNumbers
                        ? "saved DB"
                        : "empty";
                  const yn = (b: boolean) => (b ? "yes" : "no");
                  return (
                    <div
                      className="text-[11px] p-2 rounded-sm border font-mono"
                      style={{
                        background: "#f7f7fa",
                        borderColor: "#e2e2e2",
                        color: "#363636",
                      }}
                    >
                      <div
                        className="uppercase tracking-widest text-[10px] font-bold mb-1"
                        style={{
                          fontFamily: "Roboto, sans-serif",
                          color: "#465bff",
                        }}
                      >
                        Fuel debug
                      </div>
                      <div>
                        hardNumbers source: <b>{hardNumbersSource}</b>
                      </div>
                      <div>
                        form Brent value: <b>{fuelForm.brent.value || "—"}</b> ·
                        builder Brent found: <b>{yn(md.brent != null)}</b>
                      </div>
                      <div>
                        form WTI value: <b>{fuelForm.wti.value || "—"}</b> ·
                        builder WTI found: <b>{yn(md.wti != null)}</b>
                      </div>
                      <div>
                        form jet fuel value: <b>{fuelForm.jet.value || "—"}</b>{" "}
                        · builder jet fuel found:{" "}
                        <b>{yn(md.jetFuel != null)}</b>
                      </div>
                      <div>
                        trajectory lines in form:{" "}
                        <b>{formHas.trajectoryLines}</b> · trajectory points in
                        builder: <b>{md.jetFuelTrajectory.length}</b>
                      </div>
                      <div>
                        gate hasRequiredFuelWatchData:{" "}
                        <b>
                          {yn(liveFuelData.validation.hasRequiredFuelWatchData)}
                        </b>
                      </div>
                    </div>
                  );
                })()}

              {/* Export gate. The exporter throws when required data is
                  missing; this banner gives the author the explicit
                  "Export with missing market data" override. */}
              {exportError && (
                <div
                  className="text-[12px] p-3 rounded-sm border space-y-2"
                  style={{
                    background: "#fdecec",
                    borderColor: "#a33232",
                    color: "#a33232",
                    fontFamily: "Roboto, sans-serif",
                  }}
                >
                  <div className="font-bold">PDF export blocked.</div>
                  <div>{exportError}</div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-sm h-8 text-xs"
                    onClick={() => {
                      setAllowMissingExport(true);
                      setExportError(null);
                      void downloadPdf({ forceAllowMissing: true });
                    }}
                  >
                    Export with missing market data
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
        {staleProse && (
          <div
            className="no-print rounded-sm border px-4 py-3 mb-3 text-xs"
            style={{
              borderColor: "#A33232",
              background: "#fbeeee",
              color: "#A33232",
            }}
          >
            <span style={{ fontWeight: 700 }}>Saved prose was stale.</span>{" "}
            Newer records exist (latest {staleProse.latest}) than this report's
            issue date ({staleProse.issueDate}). The editor has been reseeded
            from freshly generated text for the current data. Review and Save to
            persist, or change the issue date to re-cover the latest window.
          </div>
        )}

        {proseEnabled && proseUnavailable && (
          <div
            className="no-print rounded-sm border px-4 py-3 mb-3 text-xs"
            style={{ borderColor: "#363636", background: "#f4f4f4", color: "#363636" }}
          >
            <span style={{ fontWeight: 700 }}>AI narrative unavailable.</span>{" "}
            Showing the deterministic template prose. Configure the OpenAI
            integration to generate the analytical narrative.
          </div>
        )}

        {proseEnabled && proseRes?.stale && (
          <div
            className="no-print rounded-sm border px-4 py-3 mb-3 text-xs"
            style={{ borderColor: "#A33232", background: "#fff", color: "#A33232" }}
          >
            <span style={{ fontWeight: 700 }}>Saved edit may be out of date.</span>{" "}
            Your saved narrative edit is being kept, but the underlying data has
            changed since it was written and it may no longer match the current
            incidents. Review and re-save, or regenerate to start from the fresh
            AI draft.
          </div>
        )}

        <div
          ref={previewRef}
          className="bg-white border border-border rounded-sm overflow-hidden"
        >
          {form.topic === "shipping" ? (
            <ShippingReportPreview
              report={form}
              incidents={incidentsForExport}
              movement={movement}
              maritimeSecurityEvents={maritimeSecurityEvents}
              incidentSummaries={effectiveSummaries}
              aiProse={aiProseSections}
              hiddenSections={hiddenSections}
              sectionOverrides={sectionOverrides}
            />
          ) : form.topic === "flashpoint" || form.topic === "protests" ? (
            <FlashpointReportPreview
              report={form}
              incidents={incidentsForExport}
              aiProse={aiProseSections}
              hiddenSections={hiddenSections}
              sectionOverrides={sectionOverrides}
            />
          ) : form.topic === "conflict" ? (
            <ConflictReportPreview
              report={form}
              incidents={incidentsForExport}
              situationalReports={situationalReports}
              incidentSummaries={effectiveSummaries}
              aiProse={aiProseSections}
              hiddenSections={hiddenSections}
              sectionOverrides={sectionOverrides}
            />
          ) : form.topic === "cargo_watch" ? (
            <CargoReportPreview
              report={{
                ...form,
                hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
              }}
              incidents={incidentsForExport}
              incidentSummaries={effectiveSummaries}
              aiProse={aiProseSections}
              includeFullAnnex={includeFullAnnex}
              hiddenSections={hiddenSections}
              sectionOverrides={sectionOverrides}
            />
          ) : (
            <ReportPreview
              report={{
                ...form,
                hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
              }}
              incidents={incidentsForExport}
              incidentSummaries={effectiveSummaries}
              aiProse={aiProseSections}
              marketPrices={marketPriceRows}
              hiddenSections={hiddenSections}
              sectionOverrides={sectionOverrides}
            />
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

/** Compact card-field block used for Brent and WTI rows. */
function FuelMarketCardFields({
  title,
  form,
  onChange,
}: {
  title: string;
  form: FuelMarketCardForm;
  onChange: (key: keyof FuelMarketCardForm, value: string) => void;
}) {
  return (
    <div className="border border-border rounded-sm p-3 space-y-2">
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Value">
          <Input
            className="rounded-sm h-8 text-xs"
            value={form.value}
            onChange={(e) => onChange("value", e.target.value)}
            placeholder="e.g. 109.26"
          />
        </Field>
        <Field label="Unit">
          <Input
            className="rounded-sm h-8 text-xs"
            value={form.unit}
            onChange={(e) => onChange("unit", e.target.value)}
            placeholder="e.g. USD/bbl"
          />
        </Field>
        <Field label="Change">
          <Input
            className="rounded-sm h-8 text-xs"
            value={form.change}
            onChange={(e) => onChange("change", e.target.value)}
            placeholder="e.g. +7.9% 7d"
          />
        </Field>
        <Field label="As of">
          <Input
            type="date"
            className="rounded-sm h-8 text-xs"
            value={form.asOf}
            onChange={(e) => onChange("asOf", e.target.value)}
          />
        </Field>
        <Field label="Source">
          <Input
            className="rounded-sm h-8 text-xs"
            value={form.source}
            onChange={(e) => onChange("source", e.target.value)}
            placeholder="e.g. Manual"
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * Merge a form-rebuilt fuel hardNumbers payload with the prior payload so
 * that non-form sections (fastFacts.supply / policy / routes, jetFuel
 * snapshot, and any top-level extras) are preserved across form edits.
 * Form-controlled keys (fastFacts.prices, jetFuelTrajectory) always come
 * from `built` so that clearing a field clears it in the persisted state.
 */
function mergeFuelHardNumbers(
  built: Record<string, unknown> | null,
  prior: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!prior || typeof prior !== "object") return built;
  const out: Record<string, unknown> = { ...prior };
  const builtFastFacts =
    (built?.fastFacts as Record<string, unknown> | undefined) ?? undefined;
  const priorFastFacts =
    (prior.fastFacts as Record<string, unknown> | undefined) ?? undefined;
  if (priorFastFacts || builtFastFacts) {
    const mergedFastFacts: Record<string, unknown> = {
      ...(priorFastFacts ?? {}),
    };
    // Form owns `prices`; clearing the form clears the field.
    if (builtFastFacts && "prices" in builtFastFacts) {
      mergedFastFacts.prices = builtFastFacts.prices;
    } else if (built === null) {
      delete mergedFastFacts.prices;
    }
    out.fastFacts = mergedFastFacts;
  }
  // Form owns `jetFuelTrajectory`.
  if (built && "jetFuelTrajectory" in built) {
    out.jetFuelTrajectory = built.jetFuelTrajectory;
  } else if (built === null) {
    delete out.jetFuelTrajectory;
  }
  // If nothing meaningful remains, collapse to null.
  if (Object.keys(out).length === 0) return null;
  return out;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground block mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
