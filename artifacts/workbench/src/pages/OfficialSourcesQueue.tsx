import OfficialSourcesQueuePanel from "@/components/OfficialSourcesQueuePanel";

export default function OfficialSourcesQueue() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif font-bold uppercase text-primary text-2xl tracking-wide border-b-2 border-accent pb-2 inline-block">
          Official Sources Analyst Queue
        </h1>
        <p className="text-sm text-muted-foreground font-sans mt-3 max-w-4xl">
          Review flagged CENTCOM, UKMTO, JMIC, and CMF products. Use filter tabs to
          slice by analyst flag type. Possible Spot Report rows open the manual
          Spot Report editor with prefilled context — ingest never creates Spot
          Reports automatically.
        </p>
      </header>

      <OfficialSourcesQueuePanel />
    </div>
  );
}
