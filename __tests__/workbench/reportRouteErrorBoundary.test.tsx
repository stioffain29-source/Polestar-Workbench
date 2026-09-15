/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import ReportRouteErrorBoundary from "../../artifacts/workbench/src/components/ReportRouteErrorBoundary";

function BrokenReport() {
  throw new Error("deliberate report render failure");
}

describe("ReportRouteErrorBoundary", () => {
  test("keeps the application shell available and logs report context", async () => {
    const originalFetch = global.fetch;
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ topic: "protests" }),
    } as Response);
    global.fetch = fetchMock;

    render(
      <div>
        <nav aria-label="Workbench navigation">Navigation</nav>
        <ReportRouteErrorBoundary reportId="81">
          <BrokenReport />
        </ReportRouteErrorBoundary>
      </div>,
    );

    expect(
      screen.getByRole("navigation", { name: "Workbench navigation" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "This report could not be displayed",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Back to reports" }).getAttribute("href"),
    ).toBe(
      "../reports",
    );
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "Report route render failed",
        expect.objectContaining({
          reportId: "81",
          topic: "protests",
          exception: "deliberate report render failure",
        }),
      ),
    );

    global.fetch = originalFetch;
    errorSpy.mockRestore();
  });
});