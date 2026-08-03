import { useMemo, useState } from "react";
import {
  useListGdeltStructuredItems,
  type GdeltStructuredItem,
} from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { ExternalLink } from "lucide-react";

// GDELT Cloud structured event layer — a READ-ONLY surface over the standalone
// gdelt_structured_items table. Lane-bearing events promote into incidents and
// feed the country geography reports; stories and unpromoted events surface in
// the GDELT Open-Source Context section of GDELT-monitored country reports.

// Fixed lane order — must match the collector's lane taxonomy verbatim.
const LANES = [
  "Protests",
  "Civil unrest and riots",
  "Security incidents",
  "Crime",
  "Transport disruption",
] as const;

// The four countries the collector pulls FOR. GDELT may geocode a returned item
// to another country (kept verbatim); those fall under "Other" in the filter.
const PRIMARY_COUNTRIES = [
  "Indonesia",
  "Philippines",
  "Thailand",
  "Papua New Guinea",
] as const;

// Sub-bucket badges are GEOGRAPHY metadata, not a severity tier — so they must
// NOT use the reserved tier colours (#1B6B7A = Insignificant, #A33232 =
// Extreme). Use an Electric Blue outline, which is brand-compliant and clearly
// reads as a tag rather than a risk rating.
const SUB_BUCKET_BADGE_CLASS =
  "border border-[#465bff] text-[#465bff] bg-transparent";

// How many recent rows the page pulls in one shot. Stat tiles and filters
// describe this window; when the result hits the cap we say so (no false
// "total"). Comfortably above current volume (~428 rows / 30-day retention).
const FETCH_LIMIT = 500;

function fmtDate(iso?: string | null): string {
  if (!iso) return "not reported";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return "not reported";
  }
}

function itemLink(item: GdeltStructuredItem): string | null {
  return item.url ?? item.primaryStoryUrl ?? null;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-border rounded-sm px-4 py-3">
      <div className="text-2xl font-serif font-bold text-primary leading-none">
        {value}
      </div>
      <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground mt-1.5">
        {label}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: GdeltStructuredItem }) {
  const link = itemLink(item);
  const country = item.country?.trim() || "not reported";
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-foreground font-medium leading-snug">
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent inline-flex items-start gap-1"
            >
              <span>{item.title}</span>
              <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
            </a>
          ) : (
            item.title
          )}
        </div>
        {item.subBucket && (
          <span
            className={`shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm ${SUB_BUCKET_BADGE_CLASS}`}
          >
            {item.subBucket}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wide">{country}</span>
        <span aria-hidden>·</span>
        <span>{fmtDate(item.sourceDate)}</span>
        {item.location?.trim() && (
          <>
            <span aria-hidden>·</span>
            <span>{item.location.trim()}</span>
          </>
        )}
        {item.domain?.trim() && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono">{item.domain.trim()}</span>
          </>
        )}
        {item.category?.trim() && (
          <>
            <span aria-hidden>·</span>
            <span>{item.category.trim()}</span>
          </>
        )}
      </div>
      {item.summary?.trim() && (
        <div className="text-xs text-muted-foreground mt-1.5 leading-snug">
          {item.summary.trim()}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="text-sm font-serif font-bold uppercase tracking-wide text-primary">
          {title}
        </div>
        <div className="text-xs text-muted-foreground ml-1">
          {count} {count === 1 ? "item" : "items"}
        </div>
      </div>
      {count === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Not reported this period.
        </div>
      ) : (
        <div className="divide-y divide-border">{children}</div>
      )}
    </div>
  );
}

export default function GdeltStructured() {
  const [country, setCountry] = useState<string>("");
  const [kind, setKind] = useState<"" | "event" | "story">("");

  // Fetch the full recent window once and bucket client-side, so lane grouping
  // and the country/kind toggles never trigger a refetch.
  const { data, isLoading, isError, error } = useListGdeltStructuredItems({
    days: 30,
    limit: FETCH_LIMIT,
  });

  const items = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (kind && it.kind !== kind) return false;
      if (country) {
        if (country === "__other") {
          // "Other" = a foreign country GDELT geocoded the item to. Rows with no
          // country are NOT "other" — they belong only under "All" (shown as
          // "not reported"), so exclude them here.
          if (
            !it.country ||
            (PRIMARY_COUNTRIES as readonly string[]).includes(it.country)
          )
            return false;
        } else if (it.country !== country) {
          return false;
        }
      }
      return true;
    });
  }, [items, country, kind]);

  const events = useMemo(
    () => filtered.filter((it) => it.kind === "event"),
    [filtered],
  );
  const stories = useMemo(
    () => filtered.filter((it) => it.kind === "story"),
    [filtered],
  );

  const eventsByLane = useMemo(() => {
    const map: Record<string, GdeltStructuredItem[]> = {};
    for (const lane of LANES) map[lane] = [];
    for (const ev of events) {
      if (ev.lane && map[ev.lane]) map[ev.lane].push(ev);
    }
    return map;
  }, [events]);

  const latest = useMemo(() => {
    let max: string | null = null;
    for (const it of items) {
      if (it.sourceDate && (!max || it.sourceDate > max)) max = it.sourceDate;
    }
    return max;
  }, [items]);

  const countryOptions = useMemo(() => {
    const present = new Set(
      items.map((it) => it.country?.trim()).filter(Boolean) as string[],
    );
    const primary = PRIMARY_COUNTRIES.filter((c) => present.has(c));
    const hasOther = [...present].some(
      (c) => !(PRIMARY_COUNTRIES as readonly string[]).includes(c),
    );
    return { primary, hasOther };
  }, [items]);

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-serif font-bold text-primary">
          GDELT Cloud structured event layer
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-snug max-w-3xl">
          Daily GDELT Cloud Events &amp; Stories for Indonesia, the Philippines,
          Thailand and Papua New Guinea. Lane-bearing events promote into
          incidents and feed the country geography reports; stories and
          unpromoted events appear in the GDELT Open-Source Context section of
          those reports. Events are bucketed into lanes from GDELT&apos;s verbatim
          taxonomy; stories carry no lane. Indonesian items are tagged Jakarta or
          Indonesian Papua where the geography matches.
        </p>
      </div>

      {isError ? (
        <div className="bg-card border border-[#A33232] rounded-sm p-4 text-sm text-[#A33232]">
          Could not load the GDELT structured layer
          {error instanceof Error ? `: ${error.message}` : "."}
        </div>
      ) : isLoading ? (
        <div className="bg-card border border-border rounded-sm p-6 text-center text-sm text-muted-foreground">
          Loading structured items…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-sm p-6 text-center text-sm text-muted-foreground">
          No structured items collected yet. The collector runs daily; check
          Source Health for pull status.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="Total items" value={items.length} />
            <StatTile
              label="Events"
              value={items.filter((i) => i.kind === "event").length}
            />
            <StatTile
              label="Stories"
              value={items.filter((i) => i.kind === "story").length}
            />
            <StatTile label="Latest source date" value={fmtDate(latest)} />
          </div>

          {items.length >= FETCH_LIMIT && (
            <div className="text-[11px] text-muted-foreground -mt-2">
              Showing the {FETCH_LIMIT} most recent items; counts above describe
              this window, not the full table.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">
              Country
            </span>
            <select
              aria-label="Filter by country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="bg-card border border-border rounded-sm text-xs px-2 py-1 text-foreground"
            >
              <option value="">All</option>
              {countryOptions.primary.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {countryOptions.hasOther && (
                <option value="__other">Other (verbatim geocode)</option>
              )}
            </select>
            <span className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground ml-2">
              Kind
            </span>
            <div className="inline-flex border border-border rounded-sm overflow-hidden">
              {(
                [
                  ["", "All"],
                  ["event", "Events"],
                  ["story", "Stories"],
                ] as const
              ).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={kind === val}
                  onClick={() => setKind(val)}
                  className={`text-xs px-2.5 py-1 ${
                    kind === val
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {kind !== "story" && (
            <div className="space-y-4">
              <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
                Events by lane
              </div>
              {LANES.map((lane) => (
                <Panel
                  key={lane}
                  title={lane}
                  count={eventsByLane[lane].length}
                >
                  {eventsByLane[lane].map((it) => (
                    <ItemRow key={it.id} item={it} />
                  ))}
                </Panel>
              ))}
            </div>
          )}

          {kind !== "event" && (
            <div className="space-y-4">
              <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">
                Stories (no lane)
              </div>
              <Panel title="Stories" count={stories.length}>
                {stories.map((it) => (
                  <ItemRow key={it.id} item={it} />
                ))}
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
}
