import { db, incidentsTable, type Incident } from "@workspace/db";
import { eq } from "drizzle-orm";
import { persistMaritimeSemanticEvidence } from "./backfillMaritimeSemantic";
import { validateMaritimeEvent } from "./maritimeSemantic";
import { geocode } from "./geocode";

/**
 * Immediately evaluates maritime rows created by source writers. A row can be
 * inserted before the provider call because its relational projection is only
 * attachable when the persisted fingerprint/version matches the current source
 * snapshot; a failed/unavailable provider therefore cannot make the row
 * readable as a validated maritime event.
 */
export async function validateAndPersistMaritimeWriterRows(
  rows: Incident[],
): Promise<{ evaluated: number; held: number }> {
  let evaluated = 0;
  let held = 0;
  for (const row of rows) {
    if (row.topic !== "shipping" && row.topic !== "maritime") continue;
    const result = await validateMaritimeEvent({
      title: row.title,
      summary: row.summary,
      source: row.source,
      sourceUrl: row.sourceUrl,
      publishedAt: row.occurredAt,
      candidateEventDate: row.incidentDate,
    });
    let currentRow = row;
    // Legacy geography is populated only from a valid semantic physical
    // location. A city/port lookup is intentionally required before plotting
    // coordinates; waterway/feed defaults, client payloads, and country
    // centroids are rejected. Clear supplied maritime coordinates even when
    // validation is held so an admin POST/PATCH cannot briefly create a false
    // map position.
    const country =
      result.verdict === "valid" ? result.country?.trim() || null : null;
    const physicalLocation =
      result.verdict === "valid" ? result.physicalLocation?.trim() || null : null;
    const exactGeo =
      country && physicalLocation ? geocode(country, physicalLocation) : null;
    const [updated] = await db
      .update(incidentsTable)
      .set({
        country: country || "Unknown",
        ...(exactGeo?.location
          ? {
              location: exactGeo.location,
              latitude: exactGeo.latitude,
              longitude: exactGeo.longitude,
            }
          : {
              location: null,
              latitude: null,
              longitude: null,
            }),
      })
      .where(eq(incidentsTable.id, row.id))
      .returning();
    if (updated) currentRow = updated;
    const persisted = await persistMaritimeSemanticEvidence(currentRow, result);
    evaluated++;
    if (!persisted || result.verdict !== "valid") held++;
  }
  return { evaluated, held };
}