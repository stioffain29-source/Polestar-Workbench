import { Router, type IRouter } from "express";
import { backfillFlashpointValidity } from "@workspace/ingest";
import { requireAdminToken } from "../lib/adminAuth";

const router: IRouter = Router();

// Token-gated operational route. This router is mounted before the owner
// session gate so schedulers and command-line audits can authenticate with the
// dedicated ingest token without weakening normal Workbench data routes.
router.post(
  "/admin/flashpoint-validity-backfill",
  requireAdminToken,
  async (req, res): Promise<void> => {
    const requested = Number(req.body?.limit ?? 100);
    const result = await backfillFlashpointValidity(
      Number.isFinite(requested) ? requested : 100,
    );
    res.json(result);
  },
);

export default router;