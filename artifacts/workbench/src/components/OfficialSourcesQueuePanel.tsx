import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListOfficialMilitaryMaritimeSources,
  type OfficialMilitaryMaritimeSource,
} from "@workspace/api-client-react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeAnalystFlags,
  computeOfficialQueueKpis,
  formatOfficialPublishedAt,
  itemMatchesQueueFlagTab,
  OFFICIAL_QUEUE_FLAG_TABS,
  officialBodyExcerpt,
  officialSourceBadge,
  type OfficialQueueFlagTab,
} from "@/lib/officialMilitaryMaritimeWatch";

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="bg-white border border-border rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">
        {label}
      </div>
      <div
        className="text-xl font-serif font-bold mt-1"
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  );
}

export type OfficialSourcesQueuePanelProps = {
  /** Test hook — bypass API when set. */
  itemsOverride?: OfficialMilitaryMaritimeSource[];
  isLoadingOverride?: boolean;
  /** Initial flag tab (default possible_spot_report per Step 9). */
  initialTab?: OfficialQueueFlagTab;
};

function OfficialSourcesQueueTable({
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
      <div className="p-8 text-center text-sm text-muted-foreground">
        Loading official source queue…
      </div>
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
            <th className="text-left p-2 font-sans font-medium w-[100px]">Date</th>
            <th className="text-left p-2 font-sans font-medium w-[90px]">Source</th>
            <th className="text-left p-2 font-sans font-medium">Title</th>
            <th className="text-left p-2 font-sans font-medium w-[220px]">Flags</th>
            <th className="text-left p-2 font-sans font-medium">Excerpt</th>
            <th className="text-left p-2 font-sans font-medium w-[120px]">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const badge = officialSourceBadge(item.sourceName);
            const flags = activeAnalystFlags(item);
            const excerpt = officialBodyExcerpt(item.bodyText, 180);
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
                </td>
                <td className="p-2 text-xs text-muted-foreground max-w-[280px]">
                  {excerpt || "—"}
                </td>
                <td className="p-2 space-y-1">
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      Evidence <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : null}
                  {item.flagPossibleSpotReport ? (
                    <div>
                      <Link
                        href={`/spot-reports/new?officialSourceId=${item.id}`}
                        className="text-xs font-sans font-medium text-primary hover:underline"
                      >
                        Review for Spot Report
                      </Link>
                    </div>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OfficialSourcesQueuePanel({
  itemsOverride,
  isLoadingOverride,
  initialTab = "possible_spot_report",
}: OfficialSourcesQueuePanelProps) {
  const [activeTab, setActiveTab] = useState<OfficialQueueFlagTab>(initialTab);
  const useApi = itemsOverride === undefined;

  const { data: kpiData = [], isLoading: kpiLoading } =
    useListOfficialMilitaryMaritimeSources(
      { flagged: true, limit: 200 },
      { query: { enabled: useApi } },
    );

  const listParams =
    activeTab === "all"
      ? { flagged: true as const, limit: 200 }
      : { flag: activeTab, limit: 200 };

  const { data: tabData = [], isLoading: tabLoading } =
    useListOfficialMilitaryMaritimeSources(listParams, {
      query: { enabled: useApi },
    });

  const allItems = itemsOverride ?? kpiData;
  const isLoading = isLoadingOverride ?? (useApi && (kpiLoading || tabLoading));

  const kpis = useMemo(() => computeOfficialQueueKpis(allItems), [allItems]);

  const visibleItems = useMemo(() => {
    const base = itemsOverride ?? tabData;
    return base
      .filter((item) => itemMatchesQueueFlagTab(item, activeTab))
      .sort((a, b) => {
        const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return bt - at;
      });
  }, [itemsOverride, tabData, activeTab]);

  const sourceKpiLine = ["centcom", "ukmto", "jmic", "cmf"]
    .map((key) => {
      const count = kpis.bySource[key] ?? 0;
      if (count === 0) return null;
      return `${officialSourceBadge(key).label} ${count}`;
    })
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Total flagged" value={kpis.totalFlagged} accent="#0B0B3D" />
        <Kpi label="Significant" value={kpis.significant} accent="#A33232" />
        <Kpi label="Escalation" value={kpis.escalation} accent="#C45B1C" />
        <Kpi
          label="Maritime disruption"
          value={kpis.maritimeDisruption}
          accent="#1B6B7A"
        />
        <Kpi label="Evidence" value={kpis.evidence} accent="#2F6B3A" />
        <Kpi
          label="Possible Spot Report"
          value={kpis.possibleSpotReport}
          accent="#5B3D8A"
        />
      </div>

      {sourceKpiLine ? (
        <p className="text-[11px] text-muted-foreground font-sans">
          By source: {sourceKpiLine}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {OFFICIAL_QUEUE_FLAG_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-3 py-1.5 text-xs font-sans font-medium rounded-sm border transition-colors",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-white text-primary border-border hover:bg-muted/40",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground font-sans leading-snug">
        CENTCOM, UKMTO, JMIC, and CMF official products with analyst flags. These
        rows are standalone official sources — never incidents — and flag badges
        surface review cues only. Possible Spot Report opens the manual editor;
        nothing is auto-created.
      </p>

      <div className="bg-white border border-border rounded-sm">
        <OfficialSourcesQueueTable
          items={visibleItems}
          isLoading={isLoading}
          emptyMessage="No flagged official sources match this filter yet. Items appear here after ingest when analyst flags are set."
        />
      </div>
    </div>
  );
}
