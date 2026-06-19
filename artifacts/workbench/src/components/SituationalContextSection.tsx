import {
  buildSituationalContext,
  SITUATIONAL_CONTEXT_HEADING,
  SITUATIONAL_CONTEXT_INTRO,
} from "@/lib/situationalContext";
import type { ReliefWebReport } from "@workspace/api-client-react";

// On-screen Situational Context section. Renders the same supporting UN OCHA
// ReliefWeb reports, in the same order and wording, as drawSituationalContextPdf
// so the preview and the headless PDF cannot drift. Renders nothing when there
// is no supporting context (e.g. the ReliefWeb appname is not yet approved), so
// the report degrades cleanly.

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";

export default function SituationalContextSection({
  reports,
  country,
  max = 6,
}: {
  reports: ReliefWebReport[] | undefined | null;
  country?: string;
  max?: number;
}) {
  const items = buildSituationalContext(reports, { country, max });
  if (items.length === 0) return null;

  return (
    <div className="report-section mb-8">
      <h2
        className="uppercase pb-2 mb-4 tracking-wide"
        style={{
          color: NAVY,
          fontFamily: "Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 18,
          borderBottom: `2px solid ${ELECTRIC}`,
        }}
      >
        {SITUATIONAL_CONTEXT_HEADING}
      </h2>

      <p
        className="text-[14px] leading-[1.7] mb-4 font-light"
        style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
      >
        {SITUATIONAL_CONTEXT_INTRO}
      </p>

      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id}>
            <div
              className="uppercase tracking-widest"
              style={{
                fontFamily: "Roboto, sans-serif",
                fontWeight: 700,
                fontSize: 9,
                color: DUSK,
                marginBottom: 2,
              }}
            >
              {[it.org, it.dateLabel].filter(Boolean).join("  \u00B7  ")}
            </div>
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[14px] leading-[1.5] font-normal"
              style={{
                color: NAVY,
                fontFamily: "Roboto, sans-serif",
                textDecoration: "none",
              }}
            >
              {it.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
