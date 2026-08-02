import type { ReactNode } from "react";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import { severityBadgeStyle, ratingColor, SEVERITY_LABELS } from "@/lib/topics";

// Shared "Recent Incidents" row treatment for the Topic template and the
// Conflict page it's mirrored from. Replaces the old raw <table> row with a
// card that gives long headlines room to wrap and uses a severity-coloured
// left stripe (drawn from the same RATING_COLORS palette as every map marker
// and badge) instead of a same-weight grid line.
//
// Topic-specific extras (corroboration badges, GDELT coding, category/impact
// tags, etc.) are passed in as `children` / `meta` rather than baked in here,
// so this stays a single shared component for both pages.

interface IncidentRowCardProps {
  id: string | number;
  occurredDate: Date;
  country?: string | null;
  severity: string;
  sourceUrl?: string | null;
  /** Headline + any inline badges (UntranslatedBadge, GdeltCoding, etc.) */
  children: ReactNode;
  /** Optional extra tag(s) rendered before the date/country line, e.g. Conflict's category badge or impact text. */
  meta?: ReactNode;
}

export function IncidentRowCard({
  id,
  occurredDate,
  country,
  severity,
  sourceUrl,
  children,
  meta,
}: IncidentRowCardProps) {
  const stripeColor = ratingColor(severity);

  return (
    <div
      className="flex items-start justify-between gap-3 rounded-sm border border-border bg-white px-3 py-2.5 hover:bg-muted/30"
      style={{ borderLeft: `3px solid ${stripeColor}` }}
      data-testid={`row-incident-${id}`}
    >
      <div className="min-w-0 flex-1">
        {meta}
        <div className="text-sm font-medium">{children}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
          <span data-testid={`text-date-${id}`}>
            {isNaN(occurredDate.getTime()) ? "—" : format(occurredDate, "dd MMM yyyy")}
          </span>
          {country ? (
            <span data-testid={`text-country-${id}`}>· {country}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span
          className="whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={severityBadgeStyle(severity)}
          data-testid={`badge-severity-${id}`}
        >
          {SEVERITY_LABELS[severity] ?? severity}
        </span>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
            aria-label="Open source"
            data-testid={`link-source-${id}`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function IncidentRowList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
