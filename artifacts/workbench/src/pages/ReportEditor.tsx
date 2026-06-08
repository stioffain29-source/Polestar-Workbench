import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetReport,
  useUpdateReport,
  useListIncidents,
  getGetReportQueryKey,
  getListReportsQueryKey,
  getGetDashboardOverviewQueryKey,
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
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";
import { exportElementToPdf, slugifyForFilename } from "@/lib/exportPdf";
import { exportTopicReportPdf } from "@/lib/exportTopicReportPdf";
import { exportFlashpointReportPdf } from "@/lib/exportFlashpointReportPdf";
import { exportShippingReportPdf } from "@/lib/exportShippingReportPdf";
import {
  draftTopicReportProse,
  type DraftableIncident,
} from "@/lib/draftReportProse";
import { resolveReportTitle } from "@/lib/reportNaming";
import { latestRecordDate } from "@/lib/reportDataStatus";
import { clampIssueDateToLatestRecord } from "@/lib/reportWindow";
import { format, parseISO } from "date-fns";
import {
  FUEL_MARKET_DATA_SAMPLE,
  validateFuelHardNumbersJson,
  buildFuelWatchReportData,
  buildHardNumbersFromForm,
  fuelMarketFormFromData,
  fuelMarketLatestDate,
  resolveFuelPeriodEnd,
  EMPTY_FUEL_MARKET_FORM,
  type FuelMarketFormState,
  type FuelMarketCardForm,
} from "@/lib/fuelWatchReport";

const execSummaryStorageKey = (id: number) =>
  `polestar:exec-summary:report:${id}`;

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
};

function scopeFor(topic: string): string | null {
  return TOPIC_SCOPE[topic] ?? null;
}

interface FormState {
  title: string;
  topic: string;
  status: string;
  issueDate: string;
  executiveSummary: string;
  situation: string;
  whatHappened: string;
  whatMatters: string;
  implications: string;
  polestarView: string;
  watchNext: string;
  author: string;
}

const EMPTY: FormState = {
  title: "",
  topic: "fuel",
  status: "draft",
  issueDate: new Date().toISOString().slice(0, 10),
  executiveSummary: "",
  situation: "",
  whatHappened: "",
  whatMatters: "",
  implications: "",
  polestarView: "",
  watchNext: "",
  author: "",
};

export default function ReportEditor() {
  const qc = useQueryClient();
  const [, params] = useRoute("/reports/:id");
  const id = parseInt(params?.id ?? "0", 10);
  const { data: report, isLoading } = useGetReport(id);
  const update = useUpdateReport();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [exporting, setExporting] = useState(false);
  const { data: incidents } = useListIncidents({});
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
    const latestYmd = format(latest, "yyyy-MM-dd");
    const issueYmd = issueDate.slice(0, 10);
    if (latestYmd <= issueYmd) return null;
    return {
      latest: format(latest, "d MMM yyyy"),
      issueDate: format(parseISO(issueYmd), "d MMM yyyy"),
    };
  };
  // Fuel Watch market-data editor. `hardNumbersText` is the textarea
  // buffer; `hardNumbersEdited` is the last-validated object surfaced
  // to the preview so authors see their edits live before saving.
  const [hardNumbersText, setHardNumbersText] = useState<string>("");
  const [hardNumbersError, setHardNumbersError] = useState<string | null>(null);
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

  const incidentsForExport = incidents ?? [];
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
      };

      if (form.topic === "flashpoint" || form.topic === "protests") {
        await exportFlashpointReportPdf(
          pdfPayload,
          incidentsForExport,
          filename,
        );
      } else if (form.topic === "shipping") {
        await exportShippingReportPdf(pdfPayload, incidentsForExport, filename);
      } else {
        await exportTopicReportPdf(
          {
            ...pdfPayload,
            hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
          },
          incidentsForExport,
          TOPIC_LABELS,
          filename,
          { allowMissingMarketData: allow },
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
    let exec = "";
    try {
      exec =
        typeof window !== "undefined" && window.localStorage
          ? (window.localStorage.getItem(execSummaryStorageKey(report.id)) ??
            "")
          : "";
    } catch {
      exec = "";
    }

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

    const pick = (saved: string | null | undefined, drafted: string) => {
      if (proseIsStale) return drafted;
      const s = (saved ?? "").trim();
      return s ? (saved as string) : drafted;
    };

    // Replace empty titles and the well-known old regional defaults (e.g.
    // "APAC Fuel Watch", "Hormuz Maritime Watch") with the canonical title.
    // Any other stored title is treated as a manual edit and preserved.
    setForm({
      title: resolveReportTitle(topic, report.title),
      topic,
      status: report.status ?? "draft",
      issueDate,
      executiveSummary: exec.trim() ? exec : draft.executiveSummary,
      situation: pick(report.situation, draft.situation),
      whatHappened: pick(report.whatHappened, draft.whatHappened),
      whatMatters: pick(report.whatMatters, draft.whatMatters),
      implications: pick(report.implications, draft.implications),
      polestarView: pick(report.polestarView, draft.polestarView),
      watchNext: pick(report.watchNext, draft.watchNext),
      author: report.author ?? "",
    });
  }, [report, incidents]);

  // Reset the seed guard if the route id changes.
  useEffect(() => {
    if (seededForId.current !== null && seededForId.current !== id) {
      seededForId.current = null;
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

  const save = () => {
    const { executiveSummary, ...persistable } = form;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(
          execSummaryStorageKey(id),
          executiveSummary,
        );
      }
    } catch {
      /* ignore */
    }
    // Fuel Watch market-data save semantics:
    //   * Advanced JSON view dirty → validate the textarea content and
    //     persist that. Blocks on invalid JSON rather than silently
    //     dropping the edit.
    //   * Otherwise → assemble from the form. Empty form → clear
    //     payload with `hardNumbers: null`.
    const payload: Record<string, unknown> = { ...persistable };
    if (form.topic === "fuel") {
      if (showFuelJson) {
        if (!hardNumbersText.trim()) {
          payload.hardNumbers = null;
          setHardNumbersError(null);
        } else {
          const v = validateFuelHardNumbersJson(hardNumbersText);
          if (!v.ok) {
            setHardNumbersError(v.errors.join(" "));
            return;
          }
          setHardNumbersError(null);
          payload.hardNumbers = v.value;
        }
      } else {
        const result = buildHardNumbersFromForm(fuelForm);
        if (result.errors.length > 0) {
          setFuelFormErrors(result.errors);
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
    return latest ? format(latest, "yyyy-MM-dd") : "";
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
        <div className="flex gap-2">
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
            onClick={save}
            className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-sm"
          >
            <Save className="w-4 h-4 mr-2" /> Save
          </Button>
        </div>
      </div>

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
          <Field label="Executive Summary">
            <Textarea
              rows={4}
              value={form.executiveSummary}
              onChange={(e) => set("executiveSummary", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="Situation">
            <Textarea
              rows={4}
              value={form.situation}
              onChange={(e) => set("situation", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="What Happened">
            <Textarea
              rows={5}
              value={form.whatHappened}
              onChange={(e) => set("whatHappened", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="What Matters">
            <Textarea
              rows={4}
              value={form.whatMatters}
              onChange={(e) => set("whatMatters", e.target.value)}
              className="rounded-sm"
            />
          </Field>
          <Field label="Implications for Business">
            <Textarea
              rows={4}
              value={form.implications}
              onChange={(e) => set("implications", e.target.value)}
              className="rounded-sm"
            />
          </Field>
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

        <div
          ref={previewRef}
          className="bg-white border border-border rounded-sm overflow-hidden"
        >
          {form.topic === "shipping" ? (
            <ShippingReportPreview
              report={form}
              incidents={incidentsForExport}
            />
          ) : form.topic === "flashpoint" || form.topic === "protests" ? (
            <FlashpointReportPreview
              report={form}
              incidents={incidentsForExport}
            />
          ) : (
            <ReportPreview
              report={{
                ...form,
                hardNumbers: hardNumbersEdited ?? report?.hardNumbers,
              }}
              incidents={incidentsForExport}
            />
          )}
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
