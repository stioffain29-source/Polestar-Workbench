import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => children,
  TileLayer: () => null,
  GeoJSON: () => null,
}));

import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";

const WATCH_NEXT = [
  "Additional attacks or outages at Saudi refining infrastructure",
  "Changes to aircraft refuelling restrictions at Russian airports",
  "Signs that refiners continue prioritising diesel over ship fuel",
].join("\n");

describe("Fuel Watch warning-only draft preview", () => {
  it("renders the complete report and unchanged Watch Next warnings", () => {
    const html = renderToStaticMarkup(
      createElement(ReportPreview as never, {
        report: {
          title: "Fuel Watch",
          topic: "fuel",
          status: "draft",
          issueDate: "2026-09-11",
          executiveSummary:
            "The clearest driver was strain around the Strait of Hormuz alongside a Saudi refinery attack, with benchmark crude prices rising and shortage reporting.",
          whatHappened:
            "Reporting from Pakistan and Indonesia said refiners were favouring diesel, squeezing bunker fuel availability and raising the prospect of marine fuel shortages.",
          watchNext: WATCH_NEXT,
        },
        incidents: [],
      } as never),
    );

    expect(html).toContain("review findings — warnings only; export available");
    expect(html).toContain('data-fuel-validation-blocked="false"');
    expect(html).toContain('class="no-print"');
    expect(html).not.toContain("<details open");
    expect(html).toContain("WARNING — watchNext:");
    expect(html).toContain("WARNING — executiveSummary:");
    expect(html).toContain("WARNING — whatHappened:");
    expect(html).not.toContain("final export blocked");
    expect(html).toContain(
      "Additional attacks or outages at Saudi refining infrastructure",
    );
    expect(html).toContain(
      "Changes to aircraft refuelling restrictions at Russian airports",
    );
    expect(html).toContain(
      "Signs that refiners continue prioritising diesel over ship fuel",
    );
    expect(html).toContain("pdf-cover-page");
  });
});