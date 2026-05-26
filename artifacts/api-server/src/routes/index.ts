import { Router, type IRouter } from "express";
import healthRouter from "./health";
import incidentsRouter from "./incidents";
import strikesRouter from "./strikes";
import sourcesRouter from "./sources";
import reportsRouter from "./reports";
import countriesRouter from "./countries";
import baselinesRouter from "./baselines";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(incidentsRouter);
router.use(strikesRouter);
router.use(sourcesRouter);
router.use(reportsRouter);
router.use(baselinesRouter);
router.use(countriesRouter);
router.use(dashboardRouter);

export default router;
