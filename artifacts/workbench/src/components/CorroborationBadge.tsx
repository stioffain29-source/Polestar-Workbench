import { BadgeCheck, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Corroboration } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export function CorroborationBadge({
  corroborations,
  className,
}: {
  corroborations?: Corroboration[] | null;
  className?: string;
}) {
  if (!corroborations?.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex shrink-0 text-accent hover:text-accent/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm",
            className,
          )}
          aria-label="Show UN OCHA (ReliefWeb) corroborating sources"
          title="Corroborated by UN OCHA (ReliefWeb)"
        >
          <BadgeCheck className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 rounded-sm p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5 text-[11px] font-sans font-semibold uppercase tracking-wider text-accent">
          <BadgeCheck className="w-3.5 h-3.5" />
          Corroborated by UN OCHA (ReliefWeb)
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          Independent official reporting covering the same country and timeframe. A
          separate signal — it does not change the assessed confidence.
        </p>
        <ul className="mt-2 space-y-1.5">
          {corroborations.map((c) => (
            <li key={c.id} className="text-xs">
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1 text-accent hover:underline"
              >
                <ExternalLink className="w-3 h-3 mt-0.5 shrink-0" />
                <span>
                  {c.reportTitle}
                  {c.sourceAgency ? ` — ${c.sourceAgency}` : ""}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
