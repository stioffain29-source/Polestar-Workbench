import { Router, type IRouter, type Request, type Response } from "express";
import { GetAccessStatusResponse } from "@workspace/api-zod";
import { isAllowedUser } from "../lib/ownerAccess";

// Public probe so the browser can distinguish "logged in as the owner" from
// "logged in as someone else" without leaking the owner's identity. The real
// access boundary is the requireOwner middleware on the data routes.
const router: IRouter = Router();

router.get("/access", async (req: Request, res: Response) => {
  const authenticated = req.isAuthenticated();
  const allowed = authenticated ? await isAllowedUser(req.user.id) : false;
  res.json(GetAccessStatusResponse.parse({ authenticated, allowed }));
});

export default router;
