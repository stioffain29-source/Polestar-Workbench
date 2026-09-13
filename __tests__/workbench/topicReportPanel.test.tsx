/**
 * @jest-environment jsdom
 *
 * Locks in the embedded Report Builder panel (TopicReportPanel) that now
 * lives at the bottom of each topic page instead of a "Go to Report Builder"
 * link-out. Renders the REAL component with only the network hooks
 * (`@workspace/api-client-react`) and router (`wouter`) mocked.
 *
 * Covers:
 *   - guard: renders nothing for topics the report API doesn't support yet
 *     (crime, maritime_security — see REPORT_TOPICS in lib/reportNaming.ts)
 *   - empty state for a reportable topic with no drafts
 *   - renders current in-progress cards while keeping saved history collapsed
 *   - "View all N in Report Builder" link only appears above 6 reports
 *   - "New {Topic} Watch" button creates a draft, invalidates the report list
 *     + dashboard overview caches, and navigates to the new report's editor
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mutable fixtures the hook mocks close over (must be `mock*`-prefixed so the
// jest.mock factory hoist permits the reference).
let mockReports: Array<Record<string, unknown>> = [];
let mockCreateMutate: jest.Mock;
let mockCreatePending = false;
let mockInvalidateQueries: jest.Mock;
let mockSetLocation: jest.Mock;

jest.mock("wouter", () => ({
  __esModule: true,
  useLocation: () => ["/topics/shipping", mockSetLocation],
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href?: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useListReports: (params: { topic: string }) => ({
    data: mockReports.filter((r) => r.topic === params.topic),
    isLoading: false,
  }),
  useCreateReport: () => ({
    mutate: mockCreateMutate,
    isPending: mockCreatePending,
  }),
  getListReportsQueryKey: () => ["reports"],
  getGetDashboardOverviewQueryKey: () => ["dashboard-overview"],
}));

import { TopicReportPanel } from "@/components/TopicReportPanel";

function makeReport(
  id: number,
  topic: string,
  issueDate: string,
  status = "draft",
  activityDate?: string,
): Record<string, unknown> {
  return {
    id,
    topic,
    issueDate,
    status,
    title: `${topic} report ${id}`,
    author: null,
    ...(activityDate
      ? { createdAt: `${activityDate}T12:00:00Z`, updatedAt: `${activityDate}T12:00:00Z` }
      : {}),
  };
}

beforeEach(() => {
  mockReports = [];
  mockCreateMutate = jest.fn();
  mockCreatePending = false;
  mockInvalidateQueries = jest.fn();
  mockSetLocation = jest.fn();
});

describe("TopicReportPanel", () => {
  it("renders nothing for a topic the report API doesn't support (crime)", () => {
    const { container } = render(<TopicReportPanel topic="crime" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a topic the report API doesn't support (maritime_security)", () => {
    const { container } = render(<TopicReportPanel topic="maritime_security" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state for a reportable topic with no drafts", () => {
    render(<TopicReportPanel topic="shipping" />);

    expect(screen.getByText("Shipping Watch Drafts")).not.toBeNull();
    expect(screen.getByTestId("text-no-topic-reports")).not.toBeNull();
    expect(screen.queryByTestId("link-view-all-topic-reports")).toBeNull();
  });

  it("renders current report cards and keeps the full topic history reachable", () => {
    // Seed 8 recent shipping reports plus one unrelated-topic report that must
    // be excluded entirely. Activity, rather than issueDate, determines
    // whether an in-progress report is current.
    mockReports = [
      makeReport(1, "shipping", "2026-01-01", "draft", "2026-09-01"),
      makeReport(2, "shipping", "2026-03-01", "draft", "2026-09-02"),
      makeReport(3, "shipping", "2026-02-01", "draft", "2026-09-03"),
      makeReport(4, "shipping", "2026-04-01", "draft", "2026-09-04"),
      makeReport(5, "shipping", "2026-05-01", "draft", "2026-09-05"),
      makeReport(6, "shipping", "2026-06-01", "draft", "2026-09-06"),
      makeReport(7, "shipping", "2026-07-01", "draft", "2026-09-07"),
      makeReport(8, "shipping", "2026-08-01", "draft", "2026-09-08"),
      makeReport(99, "fuel", "2026-08-02"),
    ];

    render(<TopicReportPanel topic="shipping" />);

    // All current reports remain visible; old cards are no longer pushed into
    // the default view merely because there are more than six.
    expect(screen.getByTestId("link-topic-report-8")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-7")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-6")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-5")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-4")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-2")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-3")).not.toBeNull();
    expect(screen.getByTestId("link-topic-report-1")).not.toBeNull();

    // The other topic's report never renders here.
    expect(screen.queryByTestId("link-topic-report-99")).toBeNull();

    // 8 shipping reports > 6 shown -> view-all link, correctly counting only
    // this topic's reports (not the excluded fuel one).
    const viewAll = screen.getByTestId("link-view-all-topic-reports");
    expect(viewAll.textContent).toContain("View all 8 in Report Builder");
    expect(viewAll.getAttribute("href")).toBe("/reports");
  });

  it("hides June drafts from visible card content until the archive is expanded", () => {
    mockReports = [
      makeReport(1, "shipping", "2026-06-15", "draft", "2026-06-15"),
      makeReport(2, "shipping", "2026-09-12", "draft", "2026-09-12"),
    ];
    const reportsBeforeRender = mockReports.map((report) => ({ ...report }));

    render(<TopicReportPanel topic="shipping" />);

    expect(screen.getByTestId("link-topic-report-2")).not.toBeNull();
    expect(screen.queryByTestId("link-topic-report-1")).toBeNull();
    expect(screen.queryByText("15 Jun 2026")).toBeNull();
    expect(screen.getByTestId("summary-topic-report-archive").textContent).toContain("1");

    fireEvent.click(screen.getByTestId("summary-topic-report-archive"));

    expect(screen.getByTestId("link-topic-report-1")).not.toBeNull();
    expect(screen.getByText("15 Jun 2026")).not.toBeNull();
    expect(mockReports).toEqual(reportsBeforeRender);
  });

  it("does not show the view-all link when there are 6 or fewer reports", () => {
    mockReports = [
      makeReport(1, "shipping", "2026-01-01"),
      makeReport(2, "shipping", "2026-02-01"),
    ];
    render(<TopicReportPanel topic="shipping" />);
    expect(screen.queryByTestId("link-view-all-topic-reports")).toBeNull();
  });

  it("clicking 'New Shipping Watch' creates a draft, invalidates both caches, and navigates to the new report", async () => {
    mockCreateMutate = jest.fn((_body, opts) => {
      opts.onSuccess({ id: 42 });
    });

    render(<TopicReportPanel topic="shipping" />);

    const button = screen.getByTestId("button-new-topic-report");
    expect(button.textContent).toContain("New Shipping Watch");
    fireEvent.click(button);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    const [body] = mockCreateMutate.mock.calls[0];
    expect(body.data.topic).toBe("shipping");
    expect(body.data.title).toBe("Shipping Watch");
    expect(body.data.status).toBe("draft");

    await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledTimes(2));
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["reports"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["dashboard-overview"] });
    expect(mockSetLocation).toHaveBeenCalledWith("/reports/42");
  });

  it("ignores a second click while a create is already pending", () => {
    mockCreatePending = true;
    render(<TopicReportPanel topic="shipping" />);

    const button = screen.getByTestId("button-new-topic-report");
    expect(button.textContent).toContain("Creating…");
    fireEvent.click(button);

    expect(mockCreateMutate).not.toHaveBeenCalled();
  });

  it("does not send a second request before the first response", () => {
    render(<TopicReportPanel topic="shipping" />);
    const button = screen.getByTestId("button-new-topic-report");

    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
  });
});
