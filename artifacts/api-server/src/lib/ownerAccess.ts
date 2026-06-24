import type { Request, Response, NextFunction } from "express";
import { sql, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Owner-only access gate.
//
// The workbench is private to a SINGLE owner. Access is granted when either:
//   - ALLOWED_USER_IDS (comma-separated Replit `sub` ids) is set and contains
//     the authenticated user's id (explicit allowlist / recovery override), OR
//   - no allowlist is configured and the user has been claimed as the owner
//     (is_owner = true) by the first-login claim below.
//
// Server-side enforcement is the real boundary; the frontend gate is only UX.

function parseAllowedUserIds(): Set<string> {
  const raw = process.env["ALLOWED_USER_IDS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/**
 * Claim ownership for the first authenticated user.
 *
 * No-op when an explicit ALLOWED_USER_IDS allowlist is configured. Otherwise,
 * inside an advisory-locked transaction (so concurrent first logins can't both
 * win), set is_owner=true for this user iff no owner exists yet.
 */
export async function ensureOwnerClaim(userId: string): Promise<void> {
  if (parseAllowedUserIds().size > 0) return;

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('workbench-owner-claim'))`,
    );

    const existing = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isOwner, true))
      .limit(1);

    if (existing.length > 0) return;

    await tx
      .update(usersTable)
      .set({ isOwner: true })
      .where(eq(usersTable.id, userId));
  });
}

/** Whether a given user id is permitted to use the workbench. */
export async function isAllowedUser(userId: string): Promise<boolean> {
  const allowlist = parseAllowedUserIds();
  if (allowlist.size > 0) return allowlist.has(userId);

  const [row] = await db
    .select({ isOwner: usersTable.isOwner })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  return row?.isOwner === true;
}

/**
 * Express middleware: allow only the authenticated owner through.
 *   - 401 when there is no valid session
 *   - 403 when authenticated but not the owner
 */
export async function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const allowed = await isAllowedUser(req.user.id);
  if (!allowed) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
