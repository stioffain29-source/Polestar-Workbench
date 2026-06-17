import { isUntranslatedTitle } from "@/lib/incidentTitle";
import { cn } from "@/lib/utils";

/**
 * A small, screen-only hint shown beside an incident headline that is still in a
 * foreign language because no English advisory title was produced (typically the
 * AI translation integration is unconfigured or was unavailable at ingest time).
 *
 * Deliberately neutral/muted — this is an informational state, NOT an error or a
 * severity signal, so it never uses the reserved Extreme red (#A33232). It is
 * meant for on-screen monitors only and must NOT be rendered inside `.print-report`
 * content or any PDF builder, so the exported deliverables stay clean.
 */
export function UntranslatedBadge({
  title,
  displayTitle,
  className,
}: {
  title?: string | null;
  displayTitle?: string | null;
  className?: string;
}) {
  if (!isUntranslatedTitle(title, displayTitle)) return null;
  return (
    <span
      className={cn(
        "inline-block align-middle px-1 py-0.5 rounded-sm bg-muted text-muted-foreground text-[9px] font-sans font-semibold uppercase tracking-wider",
        className,
      )}
      title="Foreign-language headline — no English advisory title was generated (AI translation unavailable)."
    >
      untranslated
    </span>
  );
}
