import { Router, type IRouter } from "express";
import { ListOfficialMilitaryMaritimeSourcesQueryParams } from "@workspace/api-zod";
import {
  getOfficialMilitaryMaritimeSourceById,
  listOfficialMilitaryMaritimeSources,
} from "../lib/officialMilitaryMaritimeSourcesList";

const router: IRouter = Router();

// M1.5 official military & maritime sources — read-only list for analyst queue
// foundation (Phase 3). CRITICAL: these rows are NOT incidents.

router.get("/official-military-maritime-sources", async (req, res): Promise<void> => {
  const parsed = ListOfficialMilitaryMaritimeSourcesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  res.json(await listOfficialMilitaryMaritimeSources(parsed.data));
});

router.get("/official-military-maritime-sources/:id", async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id < 1) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const row = await getOfficialMilitaryMaritimeSourceById(id);
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json(row);
});

export default router;
