import { Link } from "wouter";
import { useListStrikes } from "@workspace/api-client-react";
import { ArrowRight } from "lucide-react";

const HUB_STRIKES: Array<{ theatre: "maritime_hormuz" | "land_gcc"; href: string; label: string; subtitle: string }> = [
  {
    theatre: "maritime_hormuz",
    href: "/strikes/maritime",
    label: "Maritime — Hormuz",
    subtitle: "Maritime missile, drone, mine and small-boat attacks in the Strait of Hormuz and northern Arabian Gulf.",
  },
  {
    theatre: "land_gcc",
    href: "/strikes/land",
    label: "Land — GCC",
    subtitle: "Land-based missile and drone strikes against GCC states and Jordan.",
  },
];

function StrikeCard({ tracker }: { tracker: (typeof HUB_STRIKES)[number] }) {
  const { data: strikes = [], isLoading } = useListStrikes({ theatre: tracker.theatre, days: 30 });
  return (
    <Link href={tracker.href} data-testid={`link-strike-${tracker.theatre}`}>
      <div className="bg-card border border-border rounded-sm p-5 hover:border-accent/50 cursor-pointer h-full flex flex-col group transition-colors">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-serif font-bold text-primary uppercase tracking-tight group-hover:text-accent transition-colors">
            {tracker.label}
          </h2>
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent transition-colors flex-shrink-0 mt-1" />
        </div>
        <p className="text-xs text-muted-foreground font-sans mt-1.5 leading-relaxed">{tracker.subtitle}</p>
        <div className="mt-4 pt-3 border-t border-border/60">
          <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">Strikes (30D)</div>
          <div className="text-lg font-mono font-semibold text-primary" data-testid={`text-strike-count-${tracker.theatre}`}>
            {isLoading ? "—" : strikes.length}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function StrikesHub() {
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Kinetic Incident Tracking</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Strike Trackers</h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">Missile and drone strike tracking by theatre.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {HUB_STRIKES.map((s) => (
          <StrikeCard key={s.theatre} tracker={s} />
        ))}
      </div>
    </div>
  );
}
