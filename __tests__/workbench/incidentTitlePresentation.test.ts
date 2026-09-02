import { displayIncidentTitle } from "../../artifacts/workbench/src/lib/incidentTitle";
import { readFileSync } from "node:fs";
import {
  buildShippingReportDataset,
  dedupeShippingMonitorRows,
} from "../../artifacts/workbench/src/lib/shippingReportDataset";
import { buildFlashpointReportDataset } from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { buildCargoGroupedDataset } from "../../artifacts/workbench/src/lib/cargoGroupedDataset";
import { buildMaritimeIntelligence } from "../../artifacts/workbench/src/lib/maritimeIntelligence";
import { toDraftableIncidents } from "../../artifacts/workbench/src/lib/topicProseResolution";
import { incidentBlock } from "../../artifacts/api-server/src/lib/countryProse";

describe("translated incident titles at presentation boundaries", () => {
  const rawTitle = "Mahasiswa menggelar demonstrasi di Jayapura";
  const englishTitle = "Students stage demonstration in Jayapura";

  test("shared resolver prefers a non-blank translated title", () => {
    expect(displayIncidentTitle(rawTitle, englishTitle)).toBe(englishTitle);
    expect(displayIncidentTitle(rawTitle, "   ")).toBe("");
    expect(displayIncidentTitle("Police arrest protesters in Sydney", null)).toBe(
      "Police arrest protesters in Sydney",
    );
  });

  test("world-map tooltips and popups stay behind the shared title resolver", () => {
    const source = readFileSync("artifacts/workbench/src/pages/Map.tsx", "utf8");
    expect(source).toContain("displayIncidentTitle(m.title, m.displayTitle)");
    expect(source).toContain("displayIncidentTitle(p.title, p.displayTitle)");
    expect(source).not.toMatch(/\\{(?:m|p)\\.title\\}/);
  });

  test("Shipping monitor dedupe preserves raw analysis fields and the translation", () => {
    const rows = dedupeShippingMonitorRows([
      {
        id: 1,
        title: "Kapal tanker diserang di Selat Malaka",
        displayTitle: "Tanker attacked in the Strait of Malacca",
        severity: "high",
        occurredDate: new Date("2026-08-18T08:00:00Z"),
        summary: "A tanker was attacked while transiting the shipping lane.",
        location: "Strait of Malacca",
        source: "Test Wire",
        sourceUrl: "https://example.com/shipping",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Kapal tanker diserang di Selat Malaka");
    expect(
      displayIncidentTitle(rows[0].title, rows[0].displayTitle),
    ).toBe("Tanker attacked in the Strait of Malacca");
  });

  test("Shipping report analysis stays raw while returned rows use displayTitle", () => {
    const translatedTitle = "English presentation title";
    const dataset = buildShippingReportDataset(
      [
        {
          id: 11,
          title: "Tanker attacked by armed skiffs in the Gulf of Aden",
          displayTitle: translatedTitle,
          topic: "shipping",
          severity: "high",
          occurredAt: "2026-08-18T08:00:00Z",
          country: "Yemen",
          location: "Gulf of Aden",
          summary: "Armed men in skiffs attacked a tanker underway.",
          source: "Test Wire",
          sourceUrl: "https://example.com/shipping-report",
        },
      ],
      "shipping",
      "2026-08-20",
    );

    // The non-operational translated wording cannot drive classification; the
    // raw headline still admits the incident, then the returned display row
    // resolves to the translated title.
    expect(dataset.canonicalIncidents).toHaveLength(1);
    expect(dataset.canonicalIncidents[0].title).toBe(translatedTitle);
  });

  test("Maritime board classifies raw titles and presents translated titles", () => {
    const translatedTitle = "English maritime presentation title";
    const board = buildMaritimeIntelligence({
      incidents: [
        {
          id: 12,
          title: "Tanker attacked by armed skiffs in the Gulf of Aden",
          displayTitle: translatedTitle,
          topic: "shipping",
          severity: "high",
          occurredAt: "2026-08-18T08:00:00Z",
          country: "Yemen",
          location: "Gulf of Aden",
          summary: "Armed men in skiffs attacked a tanker underway.",
          source: "Test Wire",
          sourceUrl: "https://example.com/maritime-board",
        },
      ],
      movement: [],
      windowStart: new Date("2026-08-14T00:00:00Z"),
      windowEnd: new Date("2026-08-20T23:59:59Z"),
    });

    expect(board.confirmedIncidents).toHaveLength(1);
    expect(board.confirmedIncidents[0].title).toBe(translatedTitle);
  });

  test("Cargo clusters group on raw titles and present translated titles", () => {
    const translatedTitle = "English cargo presentation title";
    const dataset = buildCargoGroupedDataset([
      {
        id: 13,
        topic: "cargo_watch",
        title: "Armed robbers hijack container truck carrying electronics in Malaysia",
        displayTitle: translatedTitle,
        severity: "high",
        occurredAt: "2026-08-18T08:00:00Z",
        country: "Malaysia",
        location: "North-South Expressway",
        summary: "The gang stole the commercial cargo from the truck.",
        source: "Test Wire",
        sourceUrl: "https://example.com/cargo-cluster",
      },
    ]);

    expect(dataset.clusters).toHaveLength(1);
    expect(dataset.clusters[0].title).toBe(translatedTitle);
    expect(dataset.clusters[0].primary.title).toContain("hijack");
  });

  test("Shipping monitor presentation paths cannot interpolate raw titles directly", () => {
    const source = readFileSync(
      "artifacts/workbench/src/pages/Shipping.tsx",
      "utf8",
    );
    const forbiddenDirectInterpolations = [
      "${latestSignificant.title}",
      "${row.latest!.title}",
      "title={v.title}",
      "${transitRecords[0].title}",
      "vesselIncidents[0]?.title ?? piracyIncidents[0]?.title",
      "${commercialRecords[0].title}",
    ];

    for (const rawInterpolation of forbiddenDirectInterpolations) {
      expect(source).not.toContain(rawInterpolation);
    }
  });

  test("Flashpoint report datasets expose English titles to previews and PDFs", () => {
    const dataset = buildFlashpointReportDataset(
      [
        {
          id: 2,
          title: rawTitle,
          displayTitle: englishTitle,
          topic: "flashpoint",
          severity: "moderate",
          occurredAt: "2026-08-18T08:00:00Z",
          country: "Indonesia",
          location: "Jayapura",
          summary: "Students staged a peaceful protest in Jayapura.",
          source: "Test Wire",
          sourceUrl: "https://example.com/flashpoint",
        },
      ],
      "flashpoint",
      "2026-08-20",
    );

    const renderedData = JSON.stringify(dataset);
    expect(renderedData).toContain(englishTitle);
    expect(renderedData).not.toContain(rawTitle);
  });

  test("deterministic topic prose receives the English title", () => {
    const [incident] = toDraftableIncidents([
      {
        id: 3,
        topic: "flashpoint",
        title: rawTitle,
        displayTitle: englishTitle,
        severity: "moderate",
        occurredAt: "2026-08-18T08:00:00Z",
      },
    ]);

    expect(incident.title).toBe(englishTitle);
  });

  test("country AI prompt blocks prefer displayTitle when it is supplied", () => {
    const promptBlock = incidentBlock([
      {
        id: 4,
        title: rawTitle,
        displayTitle: englishTitle,
        topic: "flashpoint",
        severity: "moderate",
        occurredAt: "2026-08-18T08:00:00Z",
        country: "Indonesia",
        location: "Jayapura",
        summary: "Students staged a peaceful protest.",
      } as Parameters<typeof incidentBlock>[0][number] & {
        displayTitle: string;
      },
    ]);

    expect(promptBlock).toContain(englishTitle);
    expect(promptBlock).not.toContain(rawTitle);
  });
});