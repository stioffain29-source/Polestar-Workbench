/**
 * @jest-environment jsdom
 *
 * Locks the "KAMMI protest monitoring context" panel wiring on country reports.
 *
 * KAMMI social-watch posts are ADDITIVE context — never incidents. The panel
 * must appear only on the RIGHT theatre's report and never leak Indonesian
 * protest chatter onto the PNG (or any other) brief. The pure geography
 * resolver already has unit coverage (kammiGeography.test.ts); this asserts the
 * React component honours that routing for each theatre value, that PNG / null
 * render nothing, and that the heading text is exactly the owner-facing label.
 *
 * The page is owner-gated, so it cannot be verified with a live screenshot or
 * the Clerk-based testing skill — see owner-gated-ui-verification.md. We render
 * the component headlessly with renderToStaticMarkup and mock the Orval hook.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportTheatre } from "@workspace/ingest/kammiGeography";

let mockItems: Array<Record<string, unknown>>;

jest.mock("@workspace/api-client-react", () => ({
  __esModule: true,
  useListSocialWatchItems: () => ({ data: mockItems }),
  getListSocialWatchItemsQueryKey: () => ["social-watch"],
}));

import CountrySocialWatchContext from "@/components/CountrySocialWatchContext";

const westPapuaPost = {
  id: 1,
  channel: "@kammipusat",
  status: "active",
  province: "Papua",
  location: "Wamena",
  caption: "Aksi mahasiswa di Wamena.",
  promotedIncidentId: null,
  url: null,
  city: null,
  eventDate: null,
  postedAt: null,
  eventTimeText: null,
};

const jakartaPost = {
  id: 2,
  channel: "@kammipusat",
  status: "planned",
  province: null,
  location: "Monas, Jakarta Pusat",
  caption: "Longmarch menuju Istana di Jakarta Pusat.",
  promotedIncidentId: null,
  url: null,
  city: null,
  eventDate: null,
  postedAt: null,
  eventTimeText: null,
};

const nationalPost = {
  id: 3,
  channel: "@kammipusat",
  status: "active",
  province: "Jawa Barat",
  location: "Bandung",
  caption: "Aksi di Bandung menuntut transparansi.",
  promotedIncidentId: null,
  url: null,
  city: null,
  eventDate: null,
  postedAt: null,
  eventTimeText: null,
};

function renderFor(theatre: ReportTheatre): string {
  return renderToStaticMarkup(
    <CountrySocialWatchContext reportTheatre={theatre} />,
  );
}

describe("CountrySocialWatchContext", () => {
  beforeEach(() => {
    mockItems = [westPapuaPost, jakartaPost, nationalPost];
  });

  it("shows the West-Papua post only on the westPapua report", () => {
    const html = renderFor("westPapua");
    expect(html).toContain("Wamena");
    expect(html).not.toContain("Jakarta Pusat");
    expect(html).not.toContain("Bandung");
    // ...and never leaks onto the national Indonesia brief.
    expect(renderFor("indonesia")).not.toContain("Wamena");
  });

  it("shows Jakarta posts on jakarta and indonesia, never westPapua", () => {
    const jakarta = renderFor("jakarta");
    expect(jakarta).toContain("Jakarta Pusat");
    expect(jakarta).not.toContain("Wamena");

    const indonesia = renderFor("indonesia");
    expect(indonesia).toContain("Jakarta Pusat");

    const westPapua = renderFor("westPapua");
    expect(westPapua).not.toContain("Jakarta Pusat");
  });

  it("shows national posts on indonesia only", () => {
    expect(renderFor("indonesia")).toContain("Bandung");
    expect(renderFor("jakarta")).not.toContain("Bandung");
    expect(renderFor("westPapua")).not.toContain("Bandung");
  });

  it("renders nothing for png and null reports", () => {
    expect(renderFor("png")).toBe("");
    expect(renderFor(null)).toBe("");
  });

  it("renders nothing when there are no KAMMI posts, even on an Indonesian theatre", () => {
    mockItems = [];
    expect(renderFor("indonesia")).toBe("");
  });

  it("uses exactly the 'KAMMI protest monitoring context' heading", () => {
    const html = renderFor("indonesia");
    // The heading is rendered as the text of a single <div>; assert that node's
    // text is EXACTLY the label, so an appended/prefixed variant would fail.
    const match = html.match(/text-transform:uppercase[^>]*>([^<]*)</);
    expect(match?.[1]).toBe("KAMMI protest monitoring context");
  });
});
