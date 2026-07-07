import { Router, type IRouter } from "express";

// TEMPORARY connectivity test for the PeeringDB facility API.
//
// This route ONLY confirms the workbench can read the public PeeringDB feed. It
// fetches server-side (so the browser never hits PeeringDB directly / trips
// CORS), maps the fields the analyst asked to see, and returns them. It writes
// NOTHING to the database — no `data_centre_facilities` insert, no persistence
// of any kind. Mounted AFTER `requireOwner`, so it is owner-only like the rest
// of the workbench. Delete this file (and its mount + the UI button) once the
// connection is confirmed and a real ingest path is designed.

const PEERINGDB_FAC_URL = "https://www.peeringdb.com/api/fac?limit=5";

type PeeringDbFac = {
  name?: unknown;
  org_name?: unknown;
  city?: unknown;
  country?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  status?: unknown;
  updated?: unknown;
};

function asText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const router: IRouter = Router();

router.get("/peeringdb-test", async (req, res): Promise<void> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(PEERINGDB_FAC_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PolestarWorkbench/1.0 (data-centre connectivity test)",
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      req.log.warn(
        { status: upstream.status },
        "PeeringDB connectivity test: upstream returned non-OK",
      );
      res.status(502).json({
        ok: false,
        error: `PeeringDB responded ${upstream.status} ${upstream.statusText}`,
      });
      return;
    }
    const body = (await upstream.json()) as { data?: PeeringDbFac[] };
    const rows = Array.isArray(body.data) ? body.data : [];
    const facilities = rows.map((f) => ({
      name: asText(f.name),
      orgName: asText(f.org_name),
      city: asText(f.city),
      country: asText(f.country),
      latitude: asNumber(f.latitude),
      longitude: asNumber(f.longitude),
      status: asText(f.status),
      updated: asText(f.updated),
    }));
    res.json({
      ok: true,
      endpoint: PEERINGDB_FAC_URL,
      fetchedAt: new Date().toISOString(),
      count: facilities.length,
      facilities,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    req.log.warn({ err }, "PeeringDB connectivity test failed");
    res.status(502).json({
      ok: false,
      error: aborted
        ? "PeeringDB request timed out after 15s"
        : `PeeringDB request failed: ${String((err as Error)?.message ?? err)}`,
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
