import { Router, type IRouter } from "express";
import { db, marketPricesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { ListMarketPricesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// Live commodity-price snapshots for the Fuel / Energy / Fertiliser monitors.
// One row per (group, key), refreshed in place by runMarketSnapshotIngest. Every
// value comes from a real public feed; a series that fails to fetch leaves its
// prior row untouched, so this endpoint never returns fabricated prices.
router.get("/market-prices", async (req, res): Promise<void> => {
  const parsed = ListMarketPricesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { group } = parsed.data;
  const rows = await db
    .select()
    .from(marketPricesTable)
    .where(group ? eq(marketPricesTable.group, group) : undefined)
    .orderBy(asc(marketPricesTable.group), asc(marketPricesTable.key));
  res.json(rows);
});

export default router;
