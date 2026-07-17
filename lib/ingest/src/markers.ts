// Pure idempotency-marker helpers for GDELT-promoted incidents.
//
// These live in their own dependency-free module (NO db / drizzle / pg imports)
// so browser/client code — e.g. the workbench country report — can import
// markerExternalId WITHOUT pulling the db-heavy ingest barrel into the client
// bundle. Importing the @workspace/ingest root barrel in the browser bundles
// `pg`/`postgres-bytea`, which references Node's `Buffer` at module load and
// throws "Buffer is not defined", white-screening the app.

// Idempotency marker written to analyst_notes so re-runs recognise an already-
// promoted event and never insert it twice.
export const PROMOTE_MARKER_PREFIX = "gdelt_cloud:";

export function promoteMarker(externalId: string): string {
  return `${PROMOTE_MARKER_PREFIX}${externalId}`;
}

/** The GDELT externalId encoded in an analyst_notes marker, or null. */
export function markerExternalId(analystNotes: string | null | undefined): string | null {
  if (!analystNotes || !analystNotes.startsWith(PROMOTE_MARKER_PREFIX)) return null;
  const id = analystNotes.slice(PROMOTE_MARKER_PREFIX.length).trim();
  return id || null;
}
