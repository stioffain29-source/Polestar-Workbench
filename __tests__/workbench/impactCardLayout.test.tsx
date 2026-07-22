/**
 * @jest-environment jsdom
 */
/**
 * Operational Map impact-card LAYOUT regression.
 *
 * Owner ruling (Jul 2026): the impact chips looked "sloppy" — chips crammed
 * beside wrapping titles overlapped and sat at different heights across cards.
 * The fixed layout puts the chip on its OWN row at the top of every card, so
 * chips line up at one consistent position and titles wrap freely below.
 *
 * Set IMPACT_CARD_HTML_OUT=/path.html to also write the rendered grid for a
 * real-browser screenshot (owner-gated app, so this is the visual substitute).
 */
import * as fs from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImpactCardGrid,
  type ImpactPoint,
} from "../../artifacts/workbench/src/components/CountryReportMap";

const POINTS: ImpactPoint[] = [
  {
    key: "central-highlands",
    marker: "1",
    location: "Central Highlands",
    issue: "KKB member killed in Yahukimo identified as killer of seven gold panners",
    relevance: "Possible staff movement concern if operating nearby",
    impact: "Indirect impact" as ImpactPoint["impact"],
  },
  {
    key: "jayapura",
    marker: "2",
    location: "Jayapura & North Coast",
    issue: "More photos of World War II bomb explosion victims in Biak, 9 dead and 6 injured",
    relevance: "Possible staff movement concern if operating nearby",
    impact: "Indirect impact" as ImpactPoint["impact"],
  },
  {
    key: "birds-head",
    marker: "3",
    location: "Bird's Head",
    issue: "Kaimana police arrest three suspects in motor vehicle theft",
    relevance: "No reported commercial impact",
    impact: "Monitor only" as ImpactPoint["impact"],
  },
  {
    key: "papua-tengah",
    marker: "4",
    location: "Papua Tengah",
    issue: "Magnitude 3.3 earthquake with epicenter on land 7 km",
    relevance: "Possible site or asset disruption if operating nearby",
    impact: "Indirect impact" as ImpactPoint["impact"],
  },
  {
    key: "papua-barat-daya",
    marker: "5",
    location: "Papua Barat Daya",
    issue: "PERMAHI Sorong urges thorough investigation of corruption",
    relevance: "No reported commercial impact",
    impact: "Monitor only" as ImpactPoint["impact"],
  },
];

function cardMarkups(markup: string): string[] {
  // Each card is a direct child of the grid; split on the card's distinctive
  // left-border style marker.
  return markup.split("border-left:3px solid").slice(1);
}

describe("Operational Map impact-card layout", () => {
  const markup = renderToStaticMarkup(<ImpactCardGrid points={POINTS} />);

  it("renders every card with the impact chip on its OWN row BEFORE the title", () => {
    for (const [i, card] of cardMarkups(markup).entries()) {
      const chipIdx = card.indexOf("Impact level:");
      const titleIdx = card.indexOf(POINTS[i].location.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
      expect(chipIdx).toBeGreaterThanOrEqual(0);
      expect(titleIdx).toBeGreaterThanOrEqual(0);
      // Chip row precedes the title in document order — consistent top row.
      expect(chipIdx).toBeLessThan(titleIdx);
    }
  });

  it("no longer uses the old cramped title/chip space-between header", () => {
    expect(markup).not.toContain("justify-content:space-between");
  });

  it("keeps the reader-facing wording intact", () => {
    expect(markup).toContain("What happened this period:");
    expect(markup).toContain("Business relevance:");
    expect(markup).toContain("Impact level: Monitor only");
    expect(markup).toContain("Impact level: Indirect impact");
  });

  it("optionally writes the rendered grid for a visual screenshot", () => {
    const out = process.env.IMPACT_CARD_HTML_OUT;
    if (!out) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:24px;background:#fff;font-family:Roboto,Arial,sans-serif}
      .wrap{max-width:965px}
      .mt-3{margin-top:12px}
    </style></head><body><div class="wrap">${markup}</div></body></html>`;
    fs.writeFileSync(out, html);
    expect(fs.existsSync(out)).toBe(true);
  });
});
