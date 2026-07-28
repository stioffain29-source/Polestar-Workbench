// CountryEngineReviewPanel — owner-facing review surface for the shared
// country-engine (owner brief §29–32). It exposes the SAME canonical events the
// api-server owner routes serve (via the generated api-client hooks), lets an
// analyst apply an audit-logged override to one event, bulk-triage the held
// queue (approve/exclude by category, confidence band or date range), re-run
// the engine, and read the recent audit trail.
//
// IMPORTANT (repo law): this panel is an ADMIN control. It is rendered OUTSIDE
// the `.print-report` element and carries `no-print`, so it never appears in the
// on-screen report, the DOM-rasterised in-app PDF, or the headless re-render.
// It reads the api-server as the source of truth — it does NOT re-run the
// in-browser dataset engine, so analyst overrides survive here.
import { useState } from "react";
import {
  useGetCountryEngine,
  useGetCountryEngineAudit,
  useGetCountryEngineHeldSummary,
  useReprocessCountryEngine,
  useOverrideCountryEngineEvent,
  useBulkOverrideCountryEngine,
  getGetCountryEngineQueryKey,
  getGetCountryEngineAuditQueryKey,
  getGetCountryEngineHeldSummaryQueryKey,
  type CanonicalEvent,
  type CountryEngineOverrideInput,
  type CountryEngineBulkInput,
  type CountryEngineBulkResult,
  type GetCountryEngineParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ISSUE_CATEGORIES,
  EXCLUSION_REASONS,
} from "@workspace/country-engine/types";

const ROBOTO = "'Roboto', system-ui, sans-serif";
const DUSK = "#5a5f6a";
const INK = "#1f2430";
const LINE = "#e2e5ea";

// Mirrors CountryEngineOverrideInputInclusionStatus without importing the
// generated runtime enum object (so the module stays importable under test
// mocks that stub the api-client). Kept in lockstep with the OpenAPI schema.
type InclusionStatus = "included" | "excluded" | "held";

const STATUS_OPTIONS: InclusionStatus[] = ["included", "excluded", "held"];
const STATUS_INCLUDED: InclusionStatus = "included";
const PAGE_SIZE = 200;

function statusColour(status: string | undefined): string {
  switch (status) {
    case "included":
      return "#1a7f4b";
    case "excluded":
      return "#7a1f1f";
    case "held":
      return "#8a6d1a";
    default:
      return DUSK;
  }
}

const inputStyle: React.CSSProperties = {
  fontFamily: ROBOTO,
  fontSize: 11,
  padding: "3px 6px",
  border: `1px solid ${LINE}`,
  borderRadius: 4,
};

const selectStyle: React.CSSProperties = {
  fontFamily: ROBOTO,
  fontSize: 11,
  padding: "2px 4px",
};

function buttonStyle(pending: boolean, solid = true): React.CSSProperties {
  return {
    fontFamily: ROBOTO,
    fontSize: 11,
    fontWeight: 700,
    padding: "4px 12px",
    borderRadius: 4,
    border: `1px solid ${solid ? INK : LINE}`,
    background: pending ? "#e7e9ee" : solid ? INK : "#fff",
    color: pending ? DUSK : solid ? "#fff" : INK,
    cursor: pending ? "default" : "pointer",
    whiteSpace: "nowrap",
  };
}

interface CountryEngineReviewPanelProps {
  slug: string;
}

export function CountryEngineReviewPanel({ slug }: CountryEngineReviewPanelProps) {
  const queryClient = useQueryClient();

  // Queue list filters (default: the held review queue).
  const [listStatus, setListStatus] = useState<InclusionStatus | "">("held");
  const [listCategory, setListCategory] = useState<string>("");
  const [page, setPage] = useState(0);

  const listParams: GetCountryEngineParams = {
    ...(listStatus ? { status: listStatus } : {}),
    ...(listCategory ? { category: listCategory } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const engineQuery = useGetCountryEngine(slug, listParams);
  const auditQuery = useGetCountryEngineAudit(slug);
  const summaryQuery = useGetCountryEngineHeldSummary();

  // Repo memory: Orval mutations do NOT auto-invalidate — invalidate the engine
  // and audit queries by their generated keys on success so the panel refreshes.
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetCountryEngineQueryKey(slug, listParams).slice(0, 1),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetCountryEngineAuditQueryKey(slug),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetCountryEngineHeldSummaryQueryKey(),
    });
  };

  const reprocess = useReprocessCountryEngine({ mutation: { onSuccess: invalidate } });
  const override = useOverrideCountryEngineEvent({ mutation: { onSuccess: invalidate } });
  const bulk = useBulkOverrideCountryEngine();

  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<InclusionStatus>(STATUS_INCLUDED);
  const [draftReason, setDraftReason] = useState<string>("");

  // Bulk triage filter state (applies to the HELD queue by default).
  const [bulkCategory, setBulkCategory] = useState<string>("");
  const [bulkDateFrom, setBulkDateFrom] = useState<string>("");
  const [bulkDateTo, setBulkDateTo] = useState<string>("");
  const [bulkMinConf, setBulkMinConf] = useState<string>("");
  const [bulkMaxConf, setBulkMaxConf] = useState<string>("");
  const [bulkExcludeReason, setBulkExcludeReason] = useState<string>("not_an_event");
  const [bulkPreview, setBulkPreview] = useState<CountryEngineBulkResult | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<string>("");

  const events: CanonicalEvent[] = engineQuery.data?.events ?? [];
  const stats = engineQuery.data?.stats ?? null;
  const statusCounts = engineQuery.data?.statusCounts;
  const totalMatched = engineQuery.data?.totalMatched ?? events.length;
  const pageCount = Math.max(1, Math.ceil(totalMatched / PAGE_SIZE));

  const buildBulkFilter = (): NonNullable<CountryEngineBulkInput["filter"]> => ({
    inclusionStatus: "held",
    ...(bulkCategory ? { issueCategory: bulkCategory } : {}),
    ...(bulkDateFrom ? { dateFrom: bulkDateFrom } : {}),
    ...(bulkDateTo ? { dateTo: bulkDateTo } : {}),
    ...(bulkMinConf !== "" ? { minConfidence: Number(bulkMinConf) } : {}),
    ...(bulkMaxConf !== "" ? { maxConfidence: Number(bulkMaxConf) } : {}),
  });

  const runBulk = async (
    setStatus: "included" | "excluded",
    dryRun: boolean,
  ) => {
    setBulkOutcome("");
    const data: CountryEngineBulkInput = {
      filter: buildBulkFilter(),
      set:
        setStatus === "included"
          ? { inclusionStatus: "included" }
          : { inclusionStatus: "excluded", exclusionReason: bulkExcludeReason },
      dryRun,
    };
    if (!dryRun) {
      const verb = setStatus === "included" ? "APPROVE" : "EXCLUDE";
      const n = bulkPreview?.matched;
      const ok = window.confirm(
        `${verb} ${n != null ? `${n} ` : ""}matching held event(s)? This is audit-logged and re-runs the engine.`,
      );
      if (!ok) return;
    }
    try {
      const result = await bulk.mutateAsync({ slug, data });
      if (dryRun) {
        setBulkPreview(result);
      } else {
        setBulkPreview(null);
        setBulkOutcome(
          `Applied ${result.applied} change(s). Held now: ${
            (result.stats as Record<string, unknown> | null | undefined)?.held ?? "—"
          }.`,
        );
        invalidate();
      }
    } catch {
      setBulkOutcome("Bulk action failed — check the server logs.");
    }
  };

  const beginOverride = (ev: CanonicalEvent) => {
    setOpenEventId(ev.eventId ?? null);
    setDraftStatus(
      (ev.inclusionStatus as InclusionStatus | undefined) ?? STATUS_INCLUDED,
    );
    setDraftReason(ev.exclusionReason ?? "");
  };

  const submitOverride = async (eventId: string) => {
    const data: CountryEngineOverrideInput = {
      inclusionStatus: draftStatus,
      exclusionReason:
        draftStatus === STATUS_INCLUDED ? null : draftReason.trim() || null,
    };
    await override.mutateAsync({ slug, eventId, data });
    setOpenEventId(null);
  };

  const summaryRows = summaryQuery.data ?? [];

  return (
    <section
      className="no-print"
      data-testid="country-engine-review-panel"
      style={{
        fontFamily: ROBOTO,
        border: `1px solid ${LINE}`,
        borderRadius: 6,
        padding: "14px 16px",
        marginTop: 16,
        background: "#fbfcfd",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: INK }}>
            Country Engine — Review &amp; Overrides
          </div>
          <div style={{ fontSize: 11, color: DUSK, marginTop: 2 }}>
            Owner-only. Canonical events from the shared engine. Overrides are
            audit-logged and re-run the engine.
          </div>
        </div>
        <button
          type="button"
          onClick={() => reprocess.mutate({ slug })}
          disabled={reprocess.isPending}
          style={{
            ...buttonStyle(reprocess.isPending),
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "6px 12px",
          }}
        >
          {reprocess.isPending ? "Reprocessing…" : "Reprocess"}
        </button>
      </header>

      {/* Held backlog at a glance — every engine country. */}
      {summaryRows.length > 0 ? (
        <div
          data-testid="engine-held-summary"
          style={{ fontSize: 11, color: DUSK, marginBottom: 8 }}
        >
          Held backlog:{" "}
          {summaryRows.map((r, i) => (
            <span key={r.countrySlug}>
              {i > 0 ? "  ·  " : ""}
              <span style={{ fontWeight: r.countrySlug === slug ? 700 : 400, color: r.countrySlug === slug ? INK : DUSK }}>
                {r.countrySlug}: {r.held.toLocaleString()}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {engineQuery.isLoading ? (
        <div style={{ fontSize: 12, color: DUSK }}>Loading engine data…</div>
      ) : engineQuery.isError ? (
        <div style={{ fontSize: 12, color: "#7a1f1f" }}>
          Could not load engine data for this country.
        </div>
      ) : (
        <>
          {statusCounts ? (
            <div style={{ fontSize: 11, marginBottom: 6 }}>
              {STATUS_OPTIONS.map((s) => (
                <span key={s} style={{ marginRight: 12, color: statusColour(s), fontWeight: 700 }}>
                  {s}: {(statusCounts[s] ?? 0).toLocaleString()}
                </span>
              ))}
            </div>
          ) : null}
          {stats ? (
            <div style={{ fontSize: 11, color: DUSK, marginBottom: 8 }}>
              Latest run:{" "}
              {Object.entries(stats as Record<string, unknown>)
                .filter(([, v]) => typeof v !== "object")
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join("  ·  ")}
            </div>
          ) : null}

          {/* Bulk triage — works the held queue at scale (audit-logged). */}
          <div
            data-testid="engine-bulk-triage"
            style={{
              border: `1px solid ${LINE}`,
              borderRadius: 4,
              background: "#fff",
              padding: 10,
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 6 }}>
              Bulk triage (held queue)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 11, color: DUSK }}>
                Category:{" "}
                <select
                  value={bulkCategory}
                  onChange={(e) => { setBulkCategory(e.target.value); setBulkPreview(null); }}
                  style={selectStyle}
                >
                  <option value="">(any)</option>
                  {ISSUE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11, color: DUSK }}>
                From:{" "}
                <input type="date" value={bulkDateFrom} style={inputStyle}
                  onChange={(e) => { setBulkDateFrom(e.target.value); setBulkPreview(null); }} />
              </label>
              <label style={{ fontSize: 11, color: DUSK }}>
                To:{" "}
                <input type="date" value={bulkDateTo} style={inputStyle}
                  onChange={(e) => { setBulkDateTo(e.target.value); setBulkPreview(null); }} />
              </label>
              <label style={{ fontSize: 11, color: DUSK }}>
                Confidence:{" "}
                <input type="number" min={0} max={100} placeholder="min" value={bulkMinConf}
                  style={{ ...inputStyle, width: 52 }}
                  onChange={(e) => { setBulkMinConf(e.target.value); setBulkPreview(null); }} />
                {" – "}
                <input type="number" min={0} max={100} placeholder="max" value={bulkMaxConf}
                  style={{ ...inputStyle, width: 52 }}
                  onChange={(e) => { setBulkMaxConf(e.target.value); setBulkPreview(null); }} />
              </label>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
              <button type="button" disabled={bulk.isPending}
                style={buttonStyle(bulk.isPending, false)}
                onClick={() => void runBulk("included", true)}>
                Preview matches
              </button>
              <button type="button" disabled={bulk.isPending || !bulkPreview || bulkPreview.matched === 0}
                style={buttonStyle(bulk.isPending || !bulkPreview || bulkPreview.matched === 0)}
                onClick={() => void runBulk("included", false)}>
                Approve matched
              </button>
              <label style={{ fontSize: 11, color: DUSK }}>
                Exclude as:{" "}
                <select value={bulkExcludeReason} style={selectStyle}
                  onChange={(e) => setBulkExcludeReason(e.target.value)}>
                  {EXCLUSION_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={bulk.isPending || !bulkPreview || bulkPreview.matched === 0}
                style={buttonStyle(bulk.isPending || !bulkPreview || bulkPreview.matched === 0)}
                onClick={() => void runBulk("excluded", false)}>
                Exclude matched
              </button>
              {bulk.isPending ? (
                <span style={{ fontSize: 11, color: DUSK }}>Working…</span>
              ) : null}
            </div>
            {bulkPreview ? (
              <div style={{ fontSize: 11, color: DUSK, marginTop: 8 }}>
                <div style={{ fontWeight: 700, color: INK }}>
                  {bulkPreview.matched.toLocaleString()} held event(s) match.
                </div>
                {(bulkPreview.sample ?? []).slice(0, 8).map((s, i) => (
                  <div key={i} style={{ padding: "1px 0" }}>
                    {(s as Record<string, unknown>).eventTitle as string}
                    {(s as Record<string, unknown>).issueCategory
                      ? `  ·  ${(s as Record<string, unknown>).issueCategory as string}`
                      : ""}
                  </div>
                ))}
              </div>
            ) : null}
            {bulkOutcome ? (
              <div style={{ fontSize: 11, color: INK, marginTop: 8, fontWeight: 600 }}>
                {bulkOutcome}
              </div>
            ) : null}
          </div>

          {/* List filters + paging. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: DUSK }}>
              Show:{" "}
              <select
                value={listStatus}
                onChange={(e) => { setListStatus(e.target.value as InclusionStatus | ""); setPage(0); }}
                style={selectStyle}
              >
                <option value="">all statuses</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 11, color: DUSK }}>
              Category:{" "}
              <select
                value={listCategory}
                onChange={(e) => { setListCategory(e.target.value); setPage(0); }}
                style={selectStyle}
              >
                <option value="">(any)</option>
                {ISSUE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 11, color: DUSK }}>
              {totalMatched.toLocaleString()} matching · page {page + 1}/{pageCount}
            </span>
            <button type="button" disabled={page === 0} style={buttonStyle(page === 0, false)}
              onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ‹ Prev
            </button>
            <button type="button" disabled={page + 1 >= pageCount} style={buttonStyle(page + 1 >= pageCount, false)}
              onClick={() => setPage((p) => p + 1)}>
              Next ›
            </button>
          </div>

          {events.length === 0 ? (
            <div style={{ fontSize: 12, color: DUSK }}>
              No canonical events match the current filter.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {events.map((ev) => {
                const id = ev.eventId ?? "";
                const isOpen = openEventId === id;
                return (
                  <li
                    key={id}
                    style={{
                      borderTop: `1px solid ${LINE}`,
                      padding: "8px 0",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: INK }}>
                          {ev.eventTitle ?? "(untitled event)"}
                        </div>
                        <div style={{ fontSize: 11, color: DUSK, marginTop: 2 }}>
                          <span
                            style={{
                              fontWeight: 700,
                              color: statusColour(ev.inclusionStatus),
                            }}
                          >
                            {ev.inclusionStatus ?? "unknown"}
                          </span>
                          {ev.physicalCountry ? `  ·  ${ev.physicalCountry}` : ""}
                          {ev.issueCategory ? `  ·  ${ev.issueCategory}` : ""}
                          {ev.severity ? `  ·  ${ev.severity}` : ""}
                          {ev.eventDate ? `  ·  ${ev.eventDate}` : ""}
                          {typeof ev.classificationConfidence === "number"
                            ? `  ·  conf ${ev.classificationConfidence}`
                            : ""}
                        </div>
                        {ev.exclusionReason ? (
                          <div style={{ fontSize: 11, color: DUSK, marginTop: 2 }}>
                            Reason: {ev.exclusionReason}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => (isOpen ? setOpenEventId(null) : beginOverride(ev))}
                        style={buttonStyle(false, false)}
                      >
                        {isOpen ? "Cancel" : "Override"}
                      </button>
                    </div>

                    {isOpen ? (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          border: `1px solid ${LINE}`,
                          borderRadius: 4,
                          background: "#fff",
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <label style={{ fontSize: 11, color: DUSK }}>
                          Inclusion:{" "}
                          <select
                            value={draftStatus}
                            onChange={(e) =>
                              setDraftStatus(e.target.value as InclusionStatus)
                            }
                            style={selectStyle}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </label>
                        {draftStatus !== STATUS_INCLUDED ? (
                          <input
                            type="text"
                            value={draftReason}
                            placeholder="Reason (audit-logged)"
                            onChange={(e) => setDraftReason(e.target.value)}
                            style={{ ...inputStyle, flex: "1 1 200px" }}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void submitOverride(id)}
                          disabled={override.isPending}
                          style={buttonStyle(override.isPending)}
                        >
                          {override.isPending ? "Applying…" : "Apply override"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: INK, marginBottom: 4 }}>
              Recent changes
            </div>
            {auditQuery.isLoading ? (
              <div style={{ fontSize: 11, color: DUSK }}>Loading audit…</div>
            ) : (auditQuery.data?.length ?? 0) === 0 ? (
              <div style={{ fontSize: 11, color: DUSK }}>No recorded changes yet.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {(auditQuery.data ?? []).slice(0, 10).map((row) => (
                  <li key={row.id} style={{ fontSize: 11, color: DUSK, padding: "2px 0" }}>
                    <span style={{ color: INK, fontWeight: 600 }}>{row.action}</span>
                    {row.action === "bulk_override" && row.detail
                      ? `  ·  ${(row.detail as Record<string, unknown>).matched ?? "?"} event(s)`
                      : ""}
                    {row.eventId ? `  ·  ${row.eventId}` : ""}
                    {row.actor ? `  ·  ${row.actor}` : ""}
                    {"  ·  "}
                    {row.createdAt}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default CountryEngineReviewPanel;
