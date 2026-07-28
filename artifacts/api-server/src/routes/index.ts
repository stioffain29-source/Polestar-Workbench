import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import accessRouter from "./access";
import incidentsRouter from "./incidents";
import strikesRouter from "./strikes";
import sourcesRouter from "./sources";
import reportsRouter from "./reports";
import spotReportsRouter from "./spotReports";
import specialReportsRouter from "./specialReports";
import dataCentreFacilitiesRouter from "./dataCentreFacilities";
import dataCentreCountryRiskRouter from "./dataCentreCountryRisk";
import countriesRouter from "./countries";
import countryEngineRouter from "./countryEngine";
import baselinesRouter from "./baselines";
import proseRouter from "./prose";
import reportIncidentSummariesRouter from "./reportIncidentSummaries";
import reportProseRouter from "./reportProse";
import dashboardRouter from "./dashboard";
import marketPricesRouter from "./marketPrices";
import maritimeMovementRouter from "./maritimeMovement";
import liveuamapRouter from "./liveuamap";
import reliefwebReportsRouter from "./reliefwebReports";
import gdeltStructuredRouter from "./gdeltStructured";
import socialRawRouter from "./socialRaw";
import maritimeSecurityEventsRouter from "./maritimeSecurityEvents";
import officialMilitaryMaritimeSourcesRouter from "./officialMilitaryMaritimeSources";
import integrationsRouter from "./integrations";
import adminRouter from "./admin";
import backfillRouter from "./backfill";
import cardsRouter from "./cards";
import { requireOwner } from "../lib/ownerAccess";

const router: IRouter = Router();

// Public routes (no owner gate):
//  - health: deployment health checks
//  - auth: the login/callback/logout + session probe flow itself
//  - access: lets the browser learn whether the session is the owner
//  - admin/backfill: token-gated (requireAdminToken) for external schedulers
//    and curl, which authenticate with INGEST_ADMIN_TOKEN, not a browser session
router.use(healthRouter);
router.use(authRouter);
router.use(accessRouter);
router.use(adminRouter);
router.use(backfillRouter);

// Everything below is private to the authenticated owner.
router.use(requireOwner);

router.use(incidentsRouter);
router.use(strikesRouter);
router.use(sourcesRouter);
router.use(reportsRouter);
router.use(spotReportsRouter);
router.use(specialReportsRouter);
router.use(dataCentreFacilitiesRouter);
router.use(dataCentreCountryRiskRouter);
router.use(baselinesRouter);
router.use(proseRouter);
router.use(reportIncidentSummariesRouter);
router.use(reportProseRouter);
router.use(countriesRouter);
router.use(countryEngineRouter);
router.use(dashboardRouter);
router.use(marketPricesRouter);
router.use(maritimeMovementRouter);
router.use(liveuamapRouter);
router.use(reliefwebReportsRouter);
router.use(gdeltStructuredRouter);
router.use(socialRawRouter);
router.use(maritimeSecurityEventsRouter);
router.use(officialMilitaryMaritimeSourcesRouter);
router.use(integrationsRouter);
router.use(cardsRouter);

export default router;
