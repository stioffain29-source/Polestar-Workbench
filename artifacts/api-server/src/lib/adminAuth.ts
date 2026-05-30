import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

// Shared admin-token gate for privileged routes (production ingest trigger and
// source mutations). Reuses the single INGEST_ADMIN_TOKEN secret so there is no
// second credential to manage.
//
// Behaviour matches the /admin/ingest contract:
//   - token not configured on the server -> 503 (route disabled, can NEVER run
//     unauthenticated)
//   - token configured but missing/incorrect on the request -> 401
// The token may be presented via `Authorization: Bearer <token>`, or the
// `x-ingest-token` / `x-admin-token` headers.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function presentedToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const headerToken = req.header("x-ingest-token") ?? req.header("x-admin-token");
  if (headerToken) return headerToken.trim();
  return null;
}

export function requireAdminToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = process.env["INGEST_ADMIN_TOKEN"];
  if (!expected) {
    req.log.warn(
      "admin-protected route called but INGEST_ADMIN_TOKEN is not configured",
    );
    res.status(503).json({
      error: "admin_disabled",
      message: "INGEST_ADMIN_TOKEN is not configured on the server.",
    });
    return;
  }
  const presented = presentedToken(req);
  if (!presented || !safeEqual(presented, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
