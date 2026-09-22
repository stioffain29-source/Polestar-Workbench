/** @jest-environment jsdom */
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RegionalReportCreate from "../../artifacts/workbench/src/pages/RegionalReportCreate";
import {
  regionalCreationInput,
  RegionalCreationError,
  waitForRegionalReport,
} from "../../artifacts/workbench/src/lib/regionalReportCreation";

const navigate = jest.fn();
jest.mock("wouter", () => ({
  useRoute: () => [true, { topic: "apac_weekly" }],
  useLocation: () => ["/regional-reports/create/apac_weekly", navigate],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}), { virtual: true });
jest.mock("lucide-react", () => ({
  ArrowLeft: () => null, Loader2: () => null, RotateCw: () => null,
}), { virtual: true });
jest.mock("@/components/ui/button", () => ({
  Button: ({ asChild, children, onClick }: { asChild?: boolean; children: React.ReactNode; onClick?: () => void }) =>
    asChild ? children : <button onClick={onClick}>{children}</button>,
}));
jest.mock("@workspace/api-client-react", () => ({
  getListReportsQueryKey: () => ["/api/reports"],
  getGetDashboardOverviewQueryKey: () => ["/api/dashboard/overview"],
}));
jest.mock("../../artifacts/workbench/src/lib/regionalReportCreation", () => {
  const real = jest.requireActual("../../artifacts/workbench/src/lib/regionalReportCreation");
  return { ...real, regionalCreationInput: jest.fn(), waitForRegionalReport: jest.fn() };
});
const input = {
  requestId: "24c24b69-36a7-4b91-94da-df4e66b25839",
  topic: "apac_weekly" as const,
  issueDate: "2026-09-21",
};
const waitForReport = jest.mocked(waitForRegionalReport);

function showPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}><RegionalReportCreate /></QueryClientProvider>);
  return { client, invalidate };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", `/regional-reports/create/apac_weekly?requestId=${input.requestId}&issueDate=${input.issueDate}`);
  jest.mocked(regionalCreationInput).mockReturnValue(input);
});
afterEach(cleanup);

test("shows server progress and opens the saved report without waiting on list refetches", async () => {
  waitForReport.mockImplementation(async (_input, options) => {
    options.onProgress({
      id: input.requestId, topic: input.topic, issueDate: input.issueDate,
      status: "running", stage: "building", reportId: null, error: null,
    });
    return 165;
  });
  const { invalidate } = showPage();
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/reports/165"));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/reports"], refetchType: "none" });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/dashboard/overview"], refetchType: "none" });
});

test("connection error exposes reconnect and reload; reconnect preserves the same identity", async () => {
  waitForReport.mockRejectedValueOnce(new RegionalCreationError("Reconnect to the same creation request.", "connection"))
    .mockResolvedValueOnce(165);
  showPage();
  expect(await screen.findByRole("heading", { name: "Connection interrupted" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Reload page" })).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/reports/165"));
  expect(waitForReport.mock.calls.map(([body]) => body.requestId)).toEqual([input.requestId, input.requestId]);
  expect(waitForReport.mock.calls[1][1].retryFailed).toBe(true);
  expect(regionalCreationInput).toHaveBeenCalledTimes(1);
});

test("confirmed session expiry offers real sign-in and preserves the exact creation request", async () => {
  waitForReport.mockRejectedValueOnce(new RegionalCreationError("Sign in to resume this report.", "session"));
  showPage();
  expect(await screen.findByRole("heading", { name: "Sign in to continue" })).not.toBeNull();
  const signIn = screen.getByRole("link", { name: "Sign in and resume" });
  const url = new URL(signIn.getAttribute("href")!, window.location.origin);
  expect(url.pathname).toBe("/api/login");
  expect(url.searchParams.get("returnTo")).toBe(`${window.location.pathname}${window.location.search}`);
  expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test("owner denial is distinct from expiration and offers the owner-account login", async () => {
  waitForReport.mockRejectedValueOnce(new RegionalCreationError("Sign in with the owner account.", "access"));
  showPage();
  expect(await screen.findByRole("heading", { name: "Owner access required" })).not.toBeNull();
  expect(screen.getByRole("link", { name: "Sign in with owner account" }).getAttribute("href")).toContain("/api/login?returnTo=");
  expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(waitForReport).toHaveBeenCalledTimes(1);
});