jest.mock("../../artifacts/workbench/src/lib/pdfChrome", () => {
  const textCalls: string[] = [];
  const record = (value: unknown) => {
    if (Array.isArray(value)) value.forEach((item) => textCalls.push(String(item)));
    else if (value != null) textCalls.push(String(value));
  };
  const pdf = new Proxy({}, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "splitTextToSize") return (value: unknown) => [String(value)];
      if (prop === "text") return (value: unknown) => record(value);
      if (prop === "getTextWidth" || prop === "getStringUnitWidth") return () => 10;
      if (prop === "getNumberOfPages") return () => 1;
      if (prop === "internal") return { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
      return () => undefined;
    },
  });
  const api: Record<string, unknown> = {
    __esModule: true,
    __textCalls: textCalls,
    __reset: () => textCalls.splice(0),
    createCtx: () => ({ pdf, MX: 40, CW: 515, W: 595, H: 100000, TOP: 40, BOTTOM: 40, y: 40 }),
    drawSectionHeading: () => undefined,
    renderProse: (_ctx: unknown, body: unknown) => record(body),
    drawSectionWithProse: (_ctx: unknown, _title: unknown, body: unknown) => record(body),
    drawSectionKeepTogether: (_ctx: unknown, _title: unknown, body: unknown) => record(body),
    drawBulletSection: (_ctx: unknown, _title: unknown, body: unknown) => record(body),
    drawBlufBox: (_ctx: unknown, body: unknown) => record(body),
    drawMiniBullets: (_ctx: unknown, body: unknown) => record(body),
    sanitize: (value: unknown) => value,
    sevKey: (value: unknown) => String(value ?? "").toLowerCase(),
    SEV_LABEL: { insignificant: "Insignificant", low: "Low", moderate: "Moderate", high: "High", extreme: "Extreme" },
    SEV_COLOR: { insignificant: "#9AA0A6", low: "#4655FF", moderate: "#F2A900", high: "#E8731C", extreme: "#A33232" },
    ensureRobotoLoaded: async () => undefined,
    prepareCoverImage: async () => undefined,
    NAVY: "#0B0B3D",
    POLAR: "#E2E2E2",
    DUSK: "#303030",
    WHITE: "#FFFFFF",
    ELECTRIC: "#4655FF",
    COVER_TOP_BAND_H: 100,
    COVER_BOTTOM_BLOCK_H: 100,
  };
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      return prop in target ? target[prop as string] : () => undefined;
    },
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import { exportShippingReportPdf } from "../../artifacts/workbench/src/lib/exportShippingReportPdf";
import { MARITIME_SEMANTIC_VERSION } from "@workspace/relevance";

const semantic = {
  version: MARITIME_SEMANTIC_VERSION,
  verdict: "valid",
  reason: "Source describes a confirmed maritime event.",
  eventOccurred: true,
  eventClass: "commercial_attack",
  commercialTargetValidated: true,
  commercialTarget: "vessel",
  commercialTargetName: "Tanker",
  commercialTargetEvidence: "Tanker was attacked",
  physicalLocation: "Bab el-Mandeb",
  physicalLocationEvidence: "at Bab el-Mandeb",
  country: "Yemen",
  coastalState: "Yemen",
  routeRelationship: { kind: "direct_passage", routeName: "Bab el-Mandeb", evidence: "at Bab el-Mandeb" },
  routingConsequence: { status: "none", claim: null, evidenceQuote: null, confidence: 0.4, kind: "none", description: null, evidence: null },
  commercialConsequence: { status: "none", claim: null, evidenceQuote: null, confidence: 0.4 },
  geopolitical: { relevant: false, claim: null, evidenceQuote: null },
  eventDate: "2026-06-14",
  developmentKey: "surface-attack-1",
  severity: "high",
  severityJustification: "The source describes an attack on a tanker.",
  severityEvidenceQuote: "Tanker was attacked",
  confidence: { event: 0.95, classification: 0.95, commercialTarget: 0.95, geography: 0.95, routeRelationship: 0.95, consequence: 0.8, date: 0.95 },
  contradictions: [],
  sourceQuotes: [{ quote: "Tanker was attacked at Bab el-Mandeb in Yemen.", claim: "Tanker attack." }],
  evidence: ["Tanker was attacked at Bab el-Mandeb in Yemen."],
};

const incidents = [{
  id: 1,
  topic: "shipping",
  title: "Tanker attacked at Bab el-Mandeb",
  summary: "Tanker was attacked at Bab el-Mandeb in Yemen.",
  source: "Maritime Desk",
  country: "Yemen",
  location: "Bab el-Mandeb",
  severity: "high",
  occurredAt: "2026-06-14T08:00:00.000Z",
  maritimeSemantic: semantic,
}];

const report = {
  topic: "shipping",
  issueDate: "2026-06-15",
  title: "Shipping Watch",
};

describe("Shipping publication surface integration", () => {
  it("renders the valid final bundle on preview without a validation card", () => {
    const html = renderToStaticMarkup(
      createElement(ShippingReportPreview, {
        report,
        incidents,
        movement: [],
        maritimeSecurityEvents: [],
      } as never),
    );

    expect(html).toContain("Maritime Intelligence");
    expect(html).toContain("Shipping Watch");
    expect(html).not.toContain("cannot be rendered");
    expect((html.match(/Tanker attacked at Bab el-Mandeb/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/\b(canonical|source[- ]grounded|semantic evidence|AIS movement|movement as evidence|validated incident|validated maritime|newly validated|route context|incident totals|shown separately|operational tables)\b/i);
  });

  it("keeps the full draft preview visible when validation fails", () => {
    const html = renderToStaticMarkup(
      createElement(ShippingReportPreview, {
        report: {
          ...report,
          // This is intentionally unsupported.  The saved executive-summary
          // wording must still survive beside the actionable warning.
          executiveSummary: "Saved analyst note for Bab el-Mandeb review.",
          whatMatters: "Insurance premiums doubled without source evidence.",
        },
        incidents,
        movement: [],
        maritimeSecurityEvents: [],
      } as never),
    );

    expect(html).toContain("Draft preview");
    expect(html).toContain("PDF export is blocked");
    expect(html).toContain("What Matters");
    expect(html).toContain("Action:");
    expect(html).toContain("Maritime Intelligence");
    expect(html).toContain("Fast Facts");
    expect(html).toContain("Saved analyst note for Bab el-Mandeb review.");
    expect(html).not.toContain("Shipping Watch cannot be rendered");
  });

  it("renders the same valid final bundle through the PDF boundary", async () => {
    const chrome = jest.requireMock("../../artifacts/workbench/src/lib/pdfChrome") as { __textCalls: string[]; __reset: () => void };
    chrome.__reset();
    await exportShippingReportPdf(
      report as never,
      incidents as never,
      "shipping.pdf",
      [],
      [],
      {},
    );
    const text = chrome.__textCalls.join("\n");

    expect(text).toContain("BOTTOM LINE UP FRONT");
    expect(text).toContain("overall maritime risk");
    expect((text.match(/Tanker attacked at Bab el-Mandeb/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/\b(canonical|source[- ]grounded|semantic evidence|AIS movement|movement as evidence|validated incident|validated maritime|newly validated|route context|incident totals|shown separately|operational tables)\b/i);
  });
});