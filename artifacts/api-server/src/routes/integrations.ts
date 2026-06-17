import { Router, type IRouter } from "express";
import { getIntegrationStatuses } from "../lib/integrationStatus";

const router: IRouter = Router();

// GET /integrations/status — PUBLIC configuration + health snapshot of the four
// optional external integrations (GDELT, ReliefWeb, Liveuamap, OpenAI).
//
// This returns ONLY configuration STATE and graceful-degradation EVIDENCE
// (counts, last-run dates, the NAMES of the env vars that configure each one) —
// never the secret values themselves. Safe to expose on the public workbench.
router.get("/integrations/status", async (_req, res): Promise<void> => {
  const payload = await getIntegrationStatuses();
  res.json(payload);
});

export default router;
