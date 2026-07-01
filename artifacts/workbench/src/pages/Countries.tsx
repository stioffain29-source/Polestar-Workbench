import { useListCountryReports } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { isCityReport } from "@/lib/reportKind";

export default function Countries() {
  const { data: countries = [], isLoading } = useListCountryReports();
  return (
    <div className="max-w-[1400px] mx-auto space-y-5">
      <div>
        <div className="text-xs font-sans uppercase tracking-widest text-muted-foreground">Country and City Reports</div>
        <h1 className="text-3xl font-serif font-bold text-primary uppercase tracking-tight mt-1">Country Picture</h1>
        <p className="text-muted-foreground font-sans mt-1 text-sm">Long form intelligence picture by geography of interest</p>
      </div>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {countries.map((c) => (
            <Link key={c.id} href={`/countries/${c.slug}`}>
              <div className="bg-card border border-border rounded-sm p-5 hover:border-accent/50 cursor-pointer h-full flex flex-col group transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{c.region}</div>
                  {isCityReport(c.slug) && (
                    <span className="text-[9px] font-sans uppercase tracking-widest text-accent border border-accent/50 rounded-sm px-1.5 py-0.5">
                      City Report
                    </span>
                  )}
                </div>
                <h2 className="text-xl font-serif font-bold text-primary uppercase tracking-tight mt-1 group-hover:text-accent transition-colors">{c.name}</h2>
                {c.overview && <p className="text-sm text-muted-foreground mt-3 line-clamp-4">{c.overview}</p>}
                <div className="mt-4 pt-3 border-t border-border text-xs font-sans uppercase tracking-wider text-accent flex items-center gap-1 group-hover:gap-2 transition-all">
                  View Report <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          ))}
          {countries.length === 0 && <div className="text-sm text-muted-foreground">No country reports yet.</div>}
        </div>
      )}
    </div>
  );
}
