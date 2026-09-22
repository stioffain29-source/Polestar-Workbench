/** Keep the current route, including durable report-job identifiers, through
 * sign-in. Only local paths may be used as the post-login destination. */
export function getLoginUrl(
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
): string {
  const path = `${location.pathname}${location.search}${location.hash}`;
  const returnTo = path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")
    ? path
    : "/";
  return `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
}