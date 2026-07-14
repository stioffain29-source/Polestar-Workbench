import { useMemo } from "react";
import {
  useListOfficialMilitaryMaritimeSources,
  type ListOfficialMilitaryMaritimeSourcesParams,
  type OfficialMilitaryMaritimeSource,
} from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeAnalystFlags,
  formatOfficialPublishedAt,
  officialSourceBadge,
} from "@/lib/officialMilitaryMaritimeWatch";

export type OfficialMilitaryMaritimeWatchPanelProps = {
  title: string;
  subtitle: string;
  query: ListOfficialMilitaryMaritimeSourcesParams;
  /** Test hook — bypass API when set. */
  itemsOverride?: OfficialMilitaryMaritimeSource[];
  isLoadingOverride?: boolean;
};

export function OfficialMilitaryMaritimeWatchTable({
  items,
  isLoading,
  emptyMessage,
}: {
  items: OfficialMilitaryMaritimeSource[];
  isLoading: boolean;
  emptyMessage: string;
}) {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">Loading official sources…</div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-2 font-sans font-medium w-[110px]">Date</th>
            <th className="text-left p-2 font-sans font-medium w-[100px]">Source</th>
            <th className="text-left p-2 font-sans font-medium">Title</th>
            <th className="text-left p-2 font-sans font-medium w-[220px]">Analyst flags</th>
            <th className="text-left p-2 font-sans font-medium w-[70px]">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const badge = officialSourceBadge(item.sourceName);
            const flags = activeAnalystFlags(item);
            return (
              <tr key={item.id} className="hover:bg-muted/30 align-top">
                <td className="p-2 font-mono text-xs whitespace-nowrap">
                  {formatOfficialPublishedAt(item.publishedAt)}
                </td>
                <td className="p-2">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-block",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="p-2 font-medium text-primary">{item.title}</td>
                <td className="p-2">
                  {flags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {flags.map((flag) => (
                        <span
                          key={flag.key}
                          className={cn(
                            "px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm",
                            flag.className,
                          )}
                        >
                          {flag.label}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1 text-xs"
                      aria-label="Open official evidence URL"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OfficialMilitaryMaritimeWatchPanel({
  title,
  subtitle,
  query,
  itemsOverride,
  isLoadingOverride,
}: OfficialMilitaryMaritimeWatchPanelProps) {
  const useApi = itemsOverride === undefined;
  const { data = [], isLoading: apiLoading } = useListOfficialMilitaryMaritimeSources(
    query,
    { query: { enabled: useApi } },
  );

  const items = useMemo(() => {
    const rows = itemsOverride ?? data;
    return [...rows].sort((a, b) => {
      const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bt - at;
    });
  }, [data, itemsOverride]);

  const isLoading = isLoadingOverride ?? (useApi && apiLoading);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-serif font-bold uppercase text-primary text-base tracking-wide border-b-2 border-accent pb-1 inline-block">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground font-sans mt-2 max-w-4xl">{subtitle}</p>
      </div>
      <div className="bg-white border border-border rounded-sm">
        <OfficialMilitaryMaritimeWatchTable
          items={items}
          isLoading={isLoading}
          emptyMessage="No official products on file for this watch yet — they appear here after ingest and never inflate incident counts."
        />
      </div>
      <p className="text-[11px] text-muted-foreground italic">
        Official-source rows only — not incidents. Analyst flags surface review cues; they do not create Spot Reports.
      </p>
    </section>
  );
}
