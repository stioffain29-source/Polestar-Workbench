import { format } from "date-fns";
import { sourceStatusClass } from "./topics";

// Single source of truth for how a `sources` row's status and timestamps
// are turned into what an analyst sees on the Source Health page. Both the
// page (`pages/Sources.tsx`) and its tests import these helpers, so the
// rendered badge label / colour and the last-success / last-failure cells
// can never silently drift from what is verified.

// Human-readable badge label for a source status enum value
// (e.g. "not_configured" -> "not configured").
export function sourceStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

// Tailwind classes that colour the status badge. Re-exported from `topics`
// so callers and tests have one import surface for status display.
export function sourceStatusBadgeClass(status: string): string {
  return sourceStatusClass(status);
}

// Render a source health timestamp (last success / last failure) the way the
// table and Action Required panel do, falling back to an em dash when absent.
export function formatSourceTimestamp(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  return format(new Date(value), "dd MMM HH:mm");
}
