import { Link } from "wouter";
import { useListIncidents } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";
import { differenceInHours, parseISO } from "date-fns";

// Topic cards shown on the hub, in display order. Shipping and Cargo Watch stay
// as two distinct cards (matching the real app's separate topic pages/data),
// Crime is the new distinct category — piracy/cargo theft stays under
// Shipping/Cargo Watch rather than Crime, so incidents are never double-counted.
const HUB_TOPICS: Array<{ key: string; href: string; label: string; subtitle: string }> = [
  { key: "conflict", href: "/topics/conflict", label: "Conflict Watch", subtitle: "Armed conflict and contact incidents." },
  { key: "fuel", href: "/topics/fuel", label: "Fuel Watch", subtitle: "Fuel supply, refining and pricing disruption." },
  { key: "energy", href: "/topics/energy", label: "Energy Watch", subtitle: "Power, grid and energy-infrastructure disruption." },
  { key: "fertiliser", href: "/topics/fertiliser", label: "Fertiliser Watch", subtitle: "Fertiliser supply, plant and input-cost disruption." },
  { key: "shipping", href: "/topics/shipping", label: "Shipping Watch", subtitle: "Maritime shipping and chokepoint disruption." },
  { key: "cargo_watch", href: "/topics/cargo-watch", label: "Cargo Watch", subtitle: "Cargo theft, piracy and port disruption." },
  { key: "protests", href: "/topics/protests", label: "Civil Unrest (Flashpoint)", subtitle: "Civil protests and civil-unrest flashpoints." },
  { key: "crime", href: "/topics/crime", label: "Crime Watch", subtitle: "Organised crime, gang activity and trafficking." },
];

function useTopicCount(topicKey: string) {
  const { data: raw = [], isLoading } = useListIncidents({ topic: topicKey as never });
  const last24h = raw.filter((i: any) => {
    const w = i.when ?? i.occurredAt ?? i.date;
    if (!w) return false;
    try {
      return differenceInHours(new Date(), parseISO(w)) < 24;
    } catch {
      return false;
    }
  }).length;
  return { total: raw.length, last24h, isLoading };
}

function TopicCard({ topic }: { topic: (typeof HUB_TOPICS)[number] }) {
  const { total, last24h, isLoading } = useTopicCount(topic.key);
  return (
    <Link href={topic.href} data-testid={`link-topic-${topic.key}`}>
      <div className="bg-card border border-border rounded-sm p-5 hover:border-accent/50 cursor-pointer h-full flex flex-col group transition-colors">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-serif font-bold text-primary uppercase tracking-tight group-hover:text-accent transition-colors">
            {topic.label}
          </h2>
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent transition-colors flex-shrink-0 mt-1" />
        </div>
        <p className="text-xs text-muted-foreground font-sans mt-1.5 leading-relaxed">{topic.subtitle}</p>
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/60">
          <div>
            <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Total Tracked</div>
            <div className="text-lg font-mono font-semibold text-primary" data-testid={`text-topic-total-${topic.key}`}>
              {isLoading ? "—" : total}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">New (24h)</div>
            <div className="text-lg font-mono font-semibold text-accent" data-testid={`text-topic-24h-${topic.key}`}>
              {isLoading ? "—" : last24h}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function TopicsHub() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Topic Monitors</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Topics</h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">
          All active watch topics. Select one to view its full brief and report draft.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {HUB_TOPICS.map((t) => (
          <TopicCard key={t.key} topic={t} />
        ))}
      </div>
    </div>
  );
}
