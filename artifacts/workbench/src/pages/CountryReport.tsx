import { useRoute, Link } from "wouter";
import { useGetCountryReport, useListIncidents } from "@workspace/api-client-react";
import { format } from "date-fns";
import { TOPIC_LABELS, severityBadgeStyle } from "@/lib/topics";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export default function CountryReport() {
  const [, params] = useRoute("/countries/:slug");
  const slug = params?.slug ?? "";
  const { data: country, isLoading } = useGetCountryReport(slug);
  const { data: incidents = [] } = useListIncidents(country ? { country: country.name } : {}, {
    query: { enabled: !!country },
  } as never);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!country) return <div className="text-sm text-muted-foreground">Country report not found.</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <Link href="/countries" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-accent inline-flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> All Countries
      </Link>

      <div
        className="rounded-sm px-10 py-12 text-white"
        style={{ background: "linear-gradient(-130deg, #0B0B3D, #4655FF)" }}
      >
        <div className="text-[10px] font-sans uppercase tracking-widest opacity-80">{country.region}</div>
        <h1 className="text-4xl font-serif font-bold uppercase tracking-tight mt-2">{country.name}</h1>
      </div>

      {country.keyNumbers && country.keyNumbers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {country.keyNumbers.map((k, i) => (
            <div key={i} className="bg-card border-l-4 border-accent border-y border-r border-y-border border-r-border p-4 rounded-sm">
              <div className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground">{k.label}</div>
              <div className="text-2xl font-serif font-bold text-primary leading-none mt-1">{k.value}</div>
              {k.context && <div className="text-xs text-muted-foreground mt-2">{k.context}</div>}
            </div>
          ))}
        </div>
      )}

      <Section title="Overview" body={country.overview} />
      <Section title="Trend Summary" body={country.trendSummary} />
      <Section title="Implications" body={country.implications} />

      <div>
        <h2 className="font-serif font-bold text-lg text-primary uppercase border-b-2 border-accent pb-1 mb-3">Related Incidents</h2>
        <div className="bg-card border border-border rounded-sm divide-y divide-border">
          {incidents.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No related incidents recorded for {country.name}.</div>
          ) : incidents.map((i) => (
            <div key={i.id} className="grid grid-cols-[180px_120px_1fr_100px] items-center text-sm hover:bg-muted/30">
              <div className="p-3 font-mono text-xs">{format(new Date(i.occurredAt), "dd MMM yyyy HH:mm")}</div>
              <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm bg-secondary text-secondary-foreground">{TOPIC_LABELS[i.topic]}</span></div>
              <div className="p-3 font-medium">{i.title}</div>
              <div className="p-3"><span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-sm" style={severityBadgeStyle(i.severity)}>{i.severity}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ title, body }: { title: string; body?: string | null }) {
  if (!body) return null;
  return (
    <div>
      <h2 className="font-serif font-bold text-lg text-primary uppercase border-b-2 border-accent pb-1 mb-3">{title}</h2>
      <div className="prose max-w-none font-sans text-foreground">
        {body.split(/\n+/).map((p, i) => <p key={i} className="mb-3 leading-relaxed text-sm">{p}</p>)}
      </div>
    </div>
  );
}
