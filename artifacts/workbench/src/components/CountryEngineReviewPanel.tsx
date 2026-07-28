// CountryEngineReviewPanel — owner-facing review surface for the shared
// country-engine (owner brief §29–32). It exposes the SAME canonical events the
// api-server owner routes serve (via the generated api-client hooks), lets an
// analyst apply an audit-logged override to one event, re-run the engine, and
// read the recent audit trail.
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
  useReprocessCountryEngine,
  useOverrideCountryEngineEvent,
  getGetCountryEngineQueryKey,
  getGetCountryEngineAuditQueryKey,
  type CanonicalEvent,
  type CountryEngineOverrideInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

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

interface CountryEngineReviewPanelProps {
  slug: string;
}

export function CountryEngineReviewPanel({ slug }: CountryEngineReviewPanelProps) {
  const queryClient = useQueryClient();
  const engineQuery = useGetCountryEngine(slug);
  const auditQuery = useGetCountryEngineAudit(slug);

  // Repo memory: Orval mutations do NOT auto-invalidate — invalidate the engine
  // and audit queries by their generated keys on success so the panel refreshes.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetCountryEngineQueryKey(slug) });
    void queryClient.invalidateQueries({ queryKey: getGetCountryEngineAuditQueryKey(slug) });
  };

  const reprocess = useReprocessCountryEngine({ mutation: { onSuccess: invalidate } });
  const override = useOverrideCountryEngineEvent({ mutation: { onSuccess: invalidate } });

  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<InclusionStatus>(
    STATUS_INCLUDED,
  );
  const [draftReason, setDraftReason] = useState<string>("");

  const events: CanonicalEvent[] = engineQuery.data?.events ?? [];
  const stats = engineQuery.data?.stats ?? null;

  const beginOverride = (ev: CanonicalEvent) => {
    setOpenEventId(ev.eventId ?? null);
    setDraftStatus(
      (ev.inclusionStatus as InclusionStatus | undefined) ??
        STATUS_INCLUDED,
    );
    setDraftReason(ev.exclusionReason ?? "");
  };

  const submitOverride = async (eventId: string) => {
    const data: CountryEngineOverrideInput = {
      inclusionStatus: draftStatus,
      exclusionReason:
        draftStatus === STATUS_INCLUDED
          ? null
          : draftReason.trim() || null,
    };
    await override.mutateAsync({ slug, eventId, data });
    setOpenEventId(null);
  };

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
            fontFamily: ROBOTO,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            padding: "6px 12px",
            borderRadius: 4,
            border: `1px solid ${INK}`,
            background: reprocess.isPending ? "#e7e9ee" : INK,
            color: reprocess.isPending ? DUSK : "#fff",
            cursor: reprocess.isPending ? "default" : "pointer",
          }}
        >
          {reprocess.isPending ? "Reprocessing…" : "Reprocess"}
        </button>
      </header>

      {engineQuery.isLoading ? (
        <div style={{ fontSize: 12, color: DUSK }}>Loading engine data…</div>
      ) : engineQuery.isError ? (
        <div style={{ fontSize: 12, color: "#7a1f1f" }}>
          Could not load engine data for this country.
        </div>
      ) : (
        <>
          {stats ? (
            <div style={{ fontSize: 11, color: DUSK, marginBottom: 8 }}>
              Latest run:{" "}
              {Object.entries(stats as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join("  ·  ")}
            </div>
          ) : null}

          {events.length === 0 ? (
            <div style={{ fontSize: 12, color: DUSK }}>
              No canonical events for this country in the latest run.
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
                        style={{
                          fontFamily: ROBOTO,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "4px 10px",
                          borderRadius: 4,
                          border: `1px solid ${LINE}`,
                          background: "#fff",
                          color: INK,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
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
                            style={{ fontFamily: ROBOTO, fontSize: 11, padding: "2px 4px" }}
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
                            style={{
                              fontFamily: ROBOTO,
                              fontSize: 11,
                              padding: "3px 6px",
                              border: `1px solid ${LINE}`,
                              borderRadius: 4,
                              flex: "1 1 200px",
                            }}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void submitOverride(id)}
                          disabled={override.isPending}
                          style={{
                            fontFamily: ROBOTO,
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "4px 12px",
                            borderRadius: 4,
                            border: `1px solid ${INK}`,
                            background: override.isPending ? "#e7e9ee" : INK,
                            color: override.isPending ? DUSK : "#fff",
                            cursor: override.isPending ? "default" : "pointer",
                          }}
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
