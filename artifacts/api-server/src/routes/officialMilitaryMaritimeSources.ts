import { Router, type IRouter } from "express";
import { ListOfficialMilitaryMaritimeSourcesQueryParams } from "@workspace/api-zod";
import { listOfficialMilitaryMaritimeSources } from "../lib/officialMilitaryMaritimeSourcesList";

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

export default router;
