import { Router, type IRouter, type RequestHandler } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const sendOk: RequestHandler = (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
};

// `/api/healthz` is the configured startup/deploy probe. `/api` (the bare
// mount root) is also answered with a 200 so external uptime monitors that
// hit the base path get a real health signal instead of a 404 from the
// catch-all — a 404 is "reachable" but not a clean health response, and any
// monitor configured to require 2xx would otherwise flag every check.
router.get("/healthz", sendOk);
router.get("/", sendOk);

export default router;
