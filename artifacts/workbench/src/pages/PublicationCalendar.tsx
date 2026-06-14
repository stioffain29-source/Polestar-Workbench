import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListReports,
  useListSpotReports,
  useListCountryReports,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { cn } from "@/lib/utils";
import { TOPIC_LABELS } from "@/lib/topics";
import {
  buildPubItems,
  buildTopicRows,
  CALENDAR_TOPICS,
  PUB_FLAG_COLORS,
  PUB_KIND_COLORS,
  PUB_KIND_LABELS,
  type PubItem,
  type PubKind,
} from "@/lib/publicationCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_ORDER: PubKind[] = ["topic", "spot", "country"];

export default function PublicationCalendar() {
  const { data: reports = [] } = useListReports();
  const { data: spots = [] } = useListSpotReports();
  const { data: countries = [] } = useListCountryReports();

  const allItems = useMemo(
    () =>
      buildPubItems({
        topicReports: reports,
        spotReports: spots,
        countryReports: countries,
      }),
    [reports, spots, countries],
  );

  const [topic, setTopic] = useState("all");
  const [country, setCountry] = useState("all");
  const [region, setRegion] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");

  const countryOptions = useMemo(
    () =>
      Array.from(new Set(allItems.map((i) => i.country).filter((c): c is string => !!c))).sort(),
    [allItems],
  );
  const regionOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.region).filter(Boolean))).sort(),
    [allItems],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(allItems.map((i) => i.status).filter((s): s is string => !!s))).sort(),
    [allItems],
  );

  // Shared filter — type is applied separately so the per-topic list (which is
  // inherently topic reports) ignores the report-type selector.
  const passesShared = (i: PubItem): boolean =>
    (topic === "all" || i.topicKey === topic) &&
    (country === "all" || i.country === country) &&
    (region === "all" || i.region === region) &&
    (status === "all" || (i.status ?? "") === status);

  const calendarItems = useMemo(
    () => allItems.filter((i) => passesShared(i) && (type === "all" || i.kind === type)),
    [allItems, topic, country, region, status, type],
  );

  // The per-topic list only makes sense for topic reports, so hide it whenever
  // the type filter is narrowed to spot reports or country briefs. When a topic
  // is selected, show only that topic so absent topics aren't flagged overdue.
  const showTopicList = type === "all" || type === "topic";
  const topicRows = useMemo(
    () =>
      showTopicList
        ? buildTopicRows(
            allItems.filter((i) => i.kind === "topic" && passesShared(i)),
            new Date(),
            topic === "all" ? CALENDAR_TOPICS : [topic],
          )
        : [],
    [allItems, topic, country, region, status, showTopicList],
  );
  const overdueCount = topicRows.filter((r) => r.flag.flag === "red").length;

  // Default the grid to the month of the most recent publication; null = follow
  // data, otherwise the user-navigated month.
  const latestDate = useMemo(() => {
    let m = "";
    for (const i of allItems) if (i.date > m) m = i.date;
    return m;
  }, [allItems]);
  const [monthOverride, setMonthOverride] = useState<Date | null>(null);
  const month = monthOverride ?? (latestDate ? startOfMonth(parseISO(latestDate)) : startOfMonth(new Date()));

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [month]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, PubItem[]>();
    for (const i of calendarItems) {
      const arr = map.get(i.date);
      if (arr) arr.push(i);
      else map.set(i.date, [i]);
    }
    return map;
  }, [calendarItems]);

  const today = new Date();

  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Operations</div>
          <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Publication Calendar</h1>
          <p className="text-muted-foreground font-sans mt-1 text-sm">
            When each Polestar Insight Report was last published — and what is due next.
          </p>
        </div>
        {showTopicList && (
          <div className="text-right">
            <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topics overdue</div>
            <div
              className="text-3xl font-serif font-bold mt-1"
              style={{ color: overdueCount > 0 ? PUB_FLAG_COLORS.red : PUB_FLAG_COLORS.green }}
            >
              {overdueCount}
              <span className="text-base text-muted-foreground font-sans"> / {topicRows.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-sm p-3 flex flex-wrap gap-2">
        <FilterSelect label="All topics" value={topic} onChange={setTopic}
          options={CALENDAR_TOPICS.map((t) => ({ value: t, label: TOPIC_LABELS[t] ?? t }))} />
        <FilterSelect label="All types" value={type} onChange={setType}
          options={KIND_ORDER.map((k) => ({ value: k, label: PUB_KIND_LABELS[k] }))} />
        <FilterSelect label="All regions" value={region} onChange={setRegion}
          options={regionOptions.map((r) => ({ value: r, label: r }))} />
        <FilterSelect label="All countries" value={country} onChange={setCountry}
          options={countryOptions.map((c) => ({ value: c, label: c }))} />
        <FilterSelect label="All statuses" value={status} onChange={setStatus}
          options={statusOptions.map((s) => ({ value: s, label: s }))} />
      </div>

      {/* Per-topic status list */}
      {showTopicList && (
        <div className="bg-card border border-border rounded-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="font-serif font-bold text-primary uppercase tracking-wide text-sm">Topics by oldest publication</h2>
            <Legend />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[3%]" />
                <TableHead>Topic</TableHead>
                <TableHead>Last report</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="text-right">Days since</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {topicRows.map((r) => (
                <TableRow key={r.topicKey}>
                  <TableCell>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: r.flag.color }}
                      title={r.flag.label}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-primary">
                    {r.topicLabel}
                    <span className="text-muted-foreground font-sans text-xs ml-2">{r.cadence}</span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    {r.latest ? (
                      <Link href={r.latest.href} className="text-foreground hover:text-accent transition-colors truncate block">
                        {r.latest.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">Never published</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.latest ? format(parseISO(r.latest.date), "d MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {r.daysSince === null ? "—" : `${r.daysSince}d`}
                  </TableCell>
                  <TableCell>
                    <span
                      className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm text-white"
                      style={{ backgroundColor: r.flag.color }}
                    >
                      {r.flag.label}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.nextDue ? format(parseISO(r.nextDue), "d MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.latest && (
                      <Link href={r.latest.href} className="text-accent inline-flex items-center">
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Month calendar */}
      <div className="bg-card border border-border rounded-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-accent" />
            <h2 className="font-serif font-bold text-primary uppercase tracking-wide text-sm">
              {format(month, "MMMM yyyy")}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="rounded-sm h-8 w-8 p-0" onClick={() => setMonthOverride(subMonths(month, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="rounded-sm h-8 px-3 text-xs uppercase tracking-wider" onClick={() => setMonthOverride(startOfMonth(new Date()))}>
              Today
            </Button>
            <Button variant="ghost" size="sm" className="rounded-sm h-8 w-8 p-0" onClick={() => setMonthOverride(addMonths(month, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {calendarItems.length === 0 && (
          <div className="px-4 py-2 text-xs font-sans text-muted-foreground border-b border-border">
            No publications match these filters.
          </div>
        )}

        <div className="grid grid-cols-7 border-b border-border">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-2 text-[10px] font-sans uppercase tracking-widest text-muted-foreground text-center">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayItems = itemsByDay.get(key) ?? [];
            const inMonth = isSameMonth(day, month);
            const isToday = isSameDay(day, today);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[96px] border-b border-r border-border p-1.5 align-top",
                  !inMonth && "bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "text-[11px] font-mono mb-1 flex items-center justify-center w-5 h-5 rounded-full",
                    inMonth ? "text-muted-foreground" : "text-muted-foreground/40",
                    isToday && "bg-accent text-accent-foreground",
                  )}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-1">
                  {dayItems.map((i) => (
                    <Link
                      key={i.key}
                      href={i.href}
                      className="block text-[10px] leading-tight px-1.5 py-1 rounded-sm border-l-2 bg-muted/50 hover:bg-muted transition-colors truncate"
                      style={{ borderLeftColor: PUB_KIND_COLORS[i.kind] }}
                      title={`${i.typeLabel}: ${i.title}`}
                    >
                      <span className="font-medium text-foreground">{i.topicLabel ?? i.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="rounded-sm w-44">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: PUB_FLAG_COLORS.green, label: "≤7d" },
    { color: PUB_FLAG_COLORS.amber, label: "8–14d" },
    { color: PUB_FLAG_COLORS.red, label: ">14d" },
  ];
  return (
    <div className="flex items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1 text-[10px] font-sans uppercase tracking-wider text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
