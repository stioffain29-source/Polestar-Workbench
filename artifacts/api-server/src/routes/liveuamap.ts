import { Router, type IRouter } from "express";
import { ListLiveuamapEventsQueryParams } from "@workspace/api-zod";
import { getLiveuamapEvents } from "../lib/liveuamap";

const router: IRouter = Router();

// Cached, server-side proxy for the Liveuamap live-event feed. The paid API key
// stays in this process (never exposed to the public browser bundle), and the
// underlying lib bounds upstream calls with a TTL cache + in-flight coalescing.
// When LIVEUAMAP_API_KEY is unset the response is configured:false with no
// events, so the map degrades cleanly instead of erroring.
router.get("/liveuamap/events", async (req, res): Promise<void> => {
  const parsed = ListLiveuamapEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { region, count } = parsed.data;
  const data = await getLiveuamapEvents(region, count);
  res.json(data);
});

export default router;
