import * as oidc from "openid-client";
import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import {
  clearSession,
  extendSession,
  getOidcConfig,
  getSessionId,
  getSession,
  setSessionCookie,
  updateSession,
  type SessionData,
} from "../lib/auth";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

// Re-extend an active session at most this often. Bounds the DB writes /
// Set-Cookie churn the dashboard's many concurrent requests would otherwise
// cause, while still keeping the owner signed in indefinitely on active use.
const SESSION_EXTEND_INTERVAL_MS = 60 * 60 * 1000;
const lastExtendedAt = new Map<string, number>();

// Dedupe concurrent token refreshes per session. Replit's OIDC refresh tokens
// rotate (single-use), so once the access token expires the dashboard firing
// many requests at once would race: the first refresh rotates the token and the
// rest fail. Sharing one in-flight refresh per session avoids that.
const inFlightRefresh = new Map<string, Promise<void>>();

// Best-effort: refresh the OIDC access token when it has expired and a refresh
// token is present. This is NON-FATAL — the app session never depends on the
// access token (authorization is the session row + users.is_owner), so a
// refresh failure must not log the owner out. Kept only to leave a fresh token
// available should a future feature call Replit APIs on the user's behalf.
async function refreshAccessTokenBestEffort(
  sid: string,
  session: SessionData,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return;
  if (!session.refresh_token) return;

  let pending = inFlightRefresh.get(sid);
  if (!pending) {
    pending = (async () => {
      try {
        const config = await getOidcConfig();
        const tokens = await oidc.refreshTokenGrant(
          config,
          session.refresh_token!,
        );
        session.access_token = tokens.access_token;
        session.refresh_token = tokens.refresh_token ?? session.refresh_token;
        session.expires_at = tokens.expiresIn()
          ? now + tokens.expiresIn()!
          : session.expires_at;
        await updateSession(sid, session);
      } catch {
        // Non-fatal: the session remains valid without a fresh access token.
      } finally {
        inFlightRefresh.delete(sid);
      }
    })();
    inFlightRefresh.set(sid, pending);
  }
  await pending;
}

// Rolling session: on active use, slide the cookie + DB expiry forward so the
// owner stays signed in until they explicitly log out. Throttled per session.
async function extendSessionIfDue(sid: string, res: Response): Promise<void> {
  const now = Date.now();
  const last = lastExtendedAt.get(sid) ?? 0;
  if (now - last < SESSION_EXTEND_INTERVAL_MS) return;
  // Optimistically mark first so a burst of concurrent requests doesn't all
  // write at once, but roll the marker back on failure so a transient DB error
  // doesn't suppress the rolling extension for a full hour.
  lastExtendedAt.set(sid, now);
  try {
    setSessionCookie(res, sid);
    await extendSession(sid);
  } catch {
    lastExtendedAt.delete(sid);
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    next();
    return;
  }

  // Token refresh is best-effort and non-fatal; the session stays valid even if
  // the OIDC access token has expired and cannot be refreshed.
  await refreshAccessTokenBestEffort(sid, session);
  await extendSessionIfDue(sid, res);

  req.user = session.user;
  next();
}
