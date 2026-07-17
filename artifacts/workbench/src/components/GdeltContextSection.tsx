import {
  buildGdeltContext,
  GDELT_CONTEXT_HEADING,
  GDELT_CONTEXT_INTRO,
  type GdeltContextItem,
} from "@/lib/gdeltContext";
import type { GdeltStructuredItem } from "@workspace/api-client-react";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const SUB_BUCKET_BADGE_CLASS =
  "border border-[#4655FF] text-[#4655FF] bg-transparent";

export default function GdeltContextSection({
  items,
  country,
  promotedExternalIds,
  max = 12,
}: {
  items: GdeltStructuredItem[] | undefined | null;
  country: string;
  promotedExternalIds?: Set<string>;
  max?: number;
}) {
  const contextItems = buildGdeltContext(items, {
    country,
    max,
    promotedExternalIds,
  });
  if (contextItems.length === 0) return null;

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
        {GDELT_CONTEXT_HEADING}
      </h2>

      <p
        className="text-[14px] leading-[1.7] mb-4 font-light"
        style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
      >
        {GDELT_CONTEXT_INTRO}
      </p>

      <ul className="space-y-4">
        {contextItems.map((it) => (
          <GdeltContextRow key={it.id} item={it} />
        ))}
      </ul>
    </div>
  );
}

function GdeltContextRow({ item }: { item: GdeltContextItem }) {
  const meta = [
    item.country.toUpperCase(),
    item.dateLabel,
    item.location,
    item.lane ?? (item.kind === "story" ? "Story" : ""),
  ].filter(Boolean);

  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
            {meta.join("  \u00B7  ")}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[14px] leading-[1.5] font-normal"
            style={{
              color: NAVY,
              fontFamily: "Roboto, sans-serif",
              textDecoration: "none",
            }}
          >
            {item.title}
          </a>
          {item.summary && item.kind === "story" && (
            <p
              className="text-[13px] leading-[1.6] mt-1 font-light"
              style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
            >
              {item.summary.slice(0, 400)}
            </p>
          )}
        </div>
        {item.subBucket && (
          <span
            className={`shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm ${SUB_BUCKET_BADGE_CLASS}`}
          >
            {item.subBucket}
          </span>
        )}
      </div>
    </li>
  );
}
