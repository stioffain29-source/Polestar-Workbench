import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("shared country report layout contract", () => {
  it("puts the map before BLUF in preview and headless structured PDF", () => {
    const body = read("components/PngCountryReportBody.tsx");
    const page = read("pages/CountryReport.tsx");
    const pdf = read("lib/exportCountryReportPdf.ts");
    expect(body.indexOf('mapAt("before-bluf")')).toBeLessThan(
      body.indexOf('title="Bottom Line Up Front"'),
    );
    expect(page.indexOf("{mapNode}")).toBeLessThan(
      page.indexOf('photoPlacement === "cover"'),
    );
    expect(page).toContain('mapPlacement="none"');
    const structured = pdf.slice(pdf.indexOf("function renderStructuredBrief"));
    expect(structured.indexOf("drawMapSection(ctx")).toBeLessThan(
      structured.indexOf('drawSectionWithProse(ctx, "Bottom Line Up Front"'),
    );
    const generic = pdf.slice(pdf.indexOf("// 1. Map —"));
    expect(generic.indexOf("drawMapSection(ctx")).toBeLessThan(
      generic.indexOf('drawNarrative(\n    ctx,\n    "Executive Summary"'),
    );
  });

  it("keeps the shared heading palette and pagination guards", () => {
    const body = read("components/PngCountryReportBody.tsx");
    expect(body).toContain('color: NAVY');
    expect(body).toContain('borderBottom: `2px solid ${ELECTRIC}`');
    expect(body).toContain('data-pdf-keep-with-next="true"');
    expect(body).toContain('data-pdf-keep="true"');
  });

  it("fits only validated coordinates and derives single-point fallback", () => {
    const map = read("components/IncidentMap.tsx");
    expect(map).toContain("Number.isFinite(p.lat)");
    expect(map).toContain("Number.isFinite(p.lng)");
    expect(map).toContain("map.fitBounds(L.latLngBounds(latLngs), { padding:");
    expect(map).toContain("map.setView(latLngs[0] as L.LatLngTuple");
    expect(map).not.toContain("map.setView([0, 120]");
  });

  it("consolidates generic PDF input through the shared story authority", () => {
    const pdf = read("lib/exportCountryReportPdf.ts");
    expect(pdf).toContain("const currentEvents = consolidateCountryStories(active.incidents)");
    expect(pdf).not.toContain("function consolidateCountryStories");
  });

  it("preserves the countryGate export log contract before fail-closed render", () => {
    const pdf = read("lib/exportCountryReportPdf.ts");
    const log = pdf.indexOf("console.error(");
    const fail = pdf.indexOf("if (!gate.passed)");
    const render = pdf.indexOf("renderStructuredBrief(ctx, structuredDataset");
    expect(pdf).toContain("[countryGate] ${country.name}: passed=${gate.passed}");
    expect(log).toBeGreaterThan(-1);
    expect(log).toBeLessThan(fail);
    expect(fail).toBeLessThan(render);
  });
});