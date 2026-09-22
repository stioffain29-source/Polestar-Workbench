import { getLoginUrl } from "../../lib/replit-auth-web/src/login";

describe("report sign-in return destination", () => {
  it.each(["apac_weekly", "middle_east_weekly"])("preserves the %s creation identity, issue date and hash", (topic) => {
    const location = {
      pathname: `/regional-reports/create/${topic}`,
      search: "?requestId=24c24b69-36a7-4b91-94da-df4e66b25839&issueDate=2026-09-22",
      hash: "#progress",
    };
    const loginUrl = new URL(getLoginUrl(location), "https://example.test");
    expect(loginUrl.pathname).toBe("/api/login");
    expect(loginUrl.searchParams.get("returnTo")).toBe(`${location.pathname}${location.search}${location.hash}`);
  });

  it("retains same-report rebuild inputs and concurrency timestamp", () => {
    const location = {
      pathname: "/reports/42",
      search: "?rebuildRequestId=24c24b69-36a7-4b91-94da-df4e66b25839&rebuildTargetReportId=42&rebuildExpectedUpdatedAt=2026-09-22T01%3A00%3A00.000Z",
      hash: "",
    };
    expect(new URL(getLoginUrl(location), "https://example.test").searchParams.get("returnTo"))
      .toBe(`${location.pathname}${location.search}`);
  });

  it("preserves an artifact base path", () => {
    const location = { pathname: "/workbench/regional-reports/create/apac_weekly", search: "?requestId=example", hash: "" };
    expect(new URL(getLoginUrl(location), "https://example.test").searchParams.get("returnTo"))
      .toBe(`${location.pathname}${location.search}`);
  });

  it.each(["//external.test", "/\\external.test", "https://external.test", "javascript:alert(1)"])("rejects non-local return path %s", (pathname) => {
    expect(getLoginUrl({ pathname, search: "", hash: "" })).toBe("/api/login?returnTo=%2F");
  });
});