// Dry-run replay for the Fire and accident category rule (task tuning check).
// Rebuilds canonical events per slug from live incidents and diffs
// held/included against persisted country_engine_events. NO writes.
import "../lib/loadDevEnv";
import { db, incidentsTable, countryEngineEventsTable as countryEngineEvents, countryEngineOverridesTable as countryEngineOverrides } from "@workspace/db";
import { and, eq, gte, ilike, or } from "drizzle-orm";
import {
  buildCanonicalEvents,
  getCountryEngineConfig,
  COUNTRY_ENGINE_CONFIGS,
  type EngineSourceInput,
} from "@workspace/country-engine";

const LOOKBACK_DAYS = 120;

function projectRow(row: any): EngineSourceInput {
  return {
    id: String(row.id),
    topic: row.topic ?? "",
    title: row.title ?? "",
    displayTitle: row.displayTitle ?? null,
    summary: row.summary ?? null,
    country: row.country ?? null,
    location: row.location ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : String(row.occurredAt),
    incidentDate: row.incidentDate
      ? row.incidentDate instanceof Date
        ? row.incidentDate.toISOString()
        : String(row.incidentDate)
      : null,
    province: row.province ?? null,
    category: row.category ?? null,
    severity: row.severity ?? null,
    source: row.source ?? null,
    sourceUrl: row.sourceUrl ?? null,
    fatalities: row.fatalities ?? null,
  };
}

async function main() {
  for (const slug of Object.keys(COUNTRY_ENGINE_CONFIGS)) {
    const config = getCountryEngineConfig(slug);
    const tokens = config.acceptedTokens.map((t) => t.trim().replace(/[%_\\]/g, "")).filter(Boolean);
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000);
    const conditions: any[] = [gte(incidentsTable.occurredAt, since)];
    if (tokens.length > 0) conditions.push(or(...tokens.map((t) => ilike(incidentsTable.country, `%${t}%`)))!);
    const rows = await db.select().from(incidentsTable).where(and(...conditions));
    const overrides = (
      await db.select().from(countryEngineOverrides).where(eq(countryEngineOverrides.countrySlug, slug))
    ).map((r: any) => r.override);
    const result = buildCanonicalEvents(rows.map(projectRow), config, overrides);

    const persisted = await db
      .select({ eventId: countryEngineEvents.eventId, inclusionStatus: countryEngineEvents.inclusionStatus, payload: countryEngineEvents.payload })
      .from(countryEngineEvents)
      .where(eq(countryEngineEvents.countrySlug, slug));
    const oldById = new Map(persisted.map((p: any) => [p.eventId, p]));

    let heldToIncluded = 0, heldToExcluded = 0, includedLost: any[] = [], gained: any[] = [], heldStill = 0;
    for (const ev of result.events) {
      const old: any = oldById.get(ev.eventId);
      if (!old) continue;
      if (old.inclusionStatus === "held" && ev.inclusionStatus === "included") {
        heldToIncluded++;
        gained.push({ t: ev.eventTitle.slice(0, 110), cat: ev.issueCategory, conf: ev.classificationConfidence });
      } else if (old.inclusionStatus === "held" && ev.inclusionStatus === "excluded") heldToExcluded++;
      else if (old.inclusionStatus === "included" && ev.inclusionStatus !== "included")
        includedLost.push({ t: ev.eventTitle.slice(0, 110), st: ev.inclusionStatus, reason: ev.exclusionReason });
      if (ev.inclusionStatus === "held") heldStill++;
    }
    const oldHeld = persisted.filter((p: any) => p.inclusionStatus === "held").length;
    console.log(`\n=== ${slug} === persistedHeld=${oldHeld} newHeld=${heldStill} held→included=${heldToIncluded} held→excluded=${heldToExcluded} includedLost=${includedLost.length}`);
    for (const g of gained.slice(0, 40)) console.log(`  + [${g.cat} ${g.conf}] ${g.t}`);
    if (gained.length > 40) console.log(`  ... +${gained.length - 40} more`);
    for (const l of includedLost.slice(0, 10)) console.log(`  - LOST [${l.st}/${l.reason}] ${l.t}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
