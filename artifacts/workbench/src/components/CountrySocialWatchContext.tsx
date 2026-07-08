import { useMemo } from "react";
import {
  useListSocialWatchItems,
  getListSocialWatchItemsQueryKey,
  type SocialWatchItem,
} from "@workspace/api-client-react";
import {
  kammiItemInReportTheatre,
  type ReportTheatre,
} from "@workspace/ingest/kammiGeography";

// Read-only "KAMMI protest monitoring context" panel for a country report.
//
// KAMMI social-watch posts are ADDITIVE context — never incidents. This panel
// surfaces the posts that belong to THIS report's theatre (resolved by the
// shared kammiItemInReportTheatre, the same routing the manual promote uses) so
// an analyst reading, say, the Indonesia or West Papua brief sees the relevant
// street-level chatter alongside the confirmed incidents. It has NO promote /
// edit / delete controls — those live only on the Protests monitor. It renders
// nothing where no KAMMI post matches (PNG and other countries always empty),
// and is screen-only (never in the exported report PDF).

const DUSK = "#303030";
const ELECTRIC = "#465bff";
const POLAR = "#E2E2E2";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  active: "Active / on-street",
  dispersed: "Dispersed",
  arrest: "Arrests reported",
  cancelled: "Cancelled",
  unclear: "Unclear",
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

function whenLabel(item: SocialWatchItem): string | null {
  const parts: string[] = [];
  if (item.eventDate) parts.push(new Date(item.eventDate).toLocaleDateString());
  else if (item.postedAt) parts.push(new Date(item.postedAt).toLocaleDateString());
  if (item.eventTimeText) parts.push(item.eventTimeText);
  return parts.length ? parts.join(" · ") : null;
}

function whereLabel(item: SocialWatchItem): string | null {
  return item.location || item.province || item.city || null;
}

export default function CountrySocialWatchContext({
  reportTheatre,
}: {
  reportTheatre: ReportTheatre;
}) {
  // Only Indonesian theatres can carry KAMMI context; skip the fetch elsewhere.
  const enabled =
    reportTheatre === "indonesia" ||
    reportTheatre === "jakarta" ||
    reportTheatre === "westPapua";

  const { data } = useListSocialWatchItems(
    { limit: 60 },
    {
      query: {
        enabled,
        queryKey: getListSocialWatchItemsQueryKey({ limit: 60 }),
      },
    },
  );

  const items = useMemo(() => {
    const all = (data ?? []) as SocialWatchItem[];
    return all.filter((it) => kammiItemInReportTheatre(it, reportTheatre));
  }, [data, reportTheatre]);

  // Render nothing when no KAMMI post belongs to this report — the panel appears
  // only where it is relevant, never as an empty shell.
  if (!enabled || items.length === 0) return null;

  return (
    <div
      className="no-print"
      style={{
        marginTop: 10,
        borderTop: `1px solid ${POLAR}`,
        paddingTop: 10,
      }}
    >
      <div
        style={{
          fontFamily: "'Roboto Condensed', sans-serif",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: DUSK,
        }}
      >
        KAMMI protest monitoring context
      </div>
      <p
        className="font-sans"
        style={{ fontSize: 11, lineHeight: 1.4, color: "#6b6b6b", marginTop: 4 }}
      >
        Public KAMMI Pusat social-media posts monitored as additive context for
        this theatre — never incidents, so they never affect any incident count.
        Screen only; not part of the exported report.
      </p>

      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
        {items.map((it) => {
          const when = whenLabel(it);
          const where = whereLabel(it);
          const promoted = it.promotedIncidentId !== null;
          // Prefer the English translation; fall back to the original caption
          // when it is untranslated (English rows, or prod not yet backfilled).
          const caption = it.captionEn || it.caption;
          return (
            <li
              key={it.id}
              className="font-sans"
              style={{
                borderTop: `1px solid ${POLAR}`,
                padding: "8px 0",
                fontSize: 12,
                color: DUSK,
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    color: ELECTRIC,
                  }}
                >
                  {statusLabel(it.status)}
                </span>
                {when && <span style={{ fontSize: 11, color: "#6b6b6b" }}>{when}</span>}
                {where && <span style={{ fontSize: 11, color: "#6b6b6b" }}>· {where}</span>}
                {promoted && (
                  <span style={{ fontSize: 11, color: "#6b6b6b" }}>
                    · Promoted to incident #{it.promotedIncidentId}
                  </span>
                )}
              </div>
              {caption && (
                <div style={{ marginTop: 3, lineHeight: 1.4 }}>
                  {caption.length > 240 ? `${caption.slice(0, 240)}…` : caption}
                </div>
              )}
              <div style={{ marginTop: 3, fontSize: 11, color: "#6b6b6b" }}>
                {it.channel}
                {it.url && (
                  <>
                    {" · "}
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ color: ELECTRIC, textDecoration: "underline" }}
                    >
                      source
                    </a>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
