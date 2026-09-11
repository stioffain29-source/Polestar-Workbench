/** @jest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server";
import { EnergySituationVisual } from "../../artifacts/workbench/src/components/EnergySituationVisual";

function renderMap(height: number, intensity = new Map([["Philippines", 25], ["Bangladesh", 3]])) {
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(<EnergySituationVisual intensity={intensity} mapHeight={height} />),
    "text/html",
  );
  const path = (country: string) =>
    document.querySelector(`[data-country="${country}"][data-world-copy="0"]`)!.getAttribute("d")!;
  const mainRing = (country: string) =>
    [...path(country).split("Z")[0].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  return { document, path, mainRing };
}

describe("Energy map world geography", () => {
  for (const height of [120, 165, 270]) {
    it(`keeps the Americas together and New Zealand intact at ${height}px`, () => {
      const map = renderMap(height);
      const usa = map.mainRing("United States");
      const brazil = map.mainRing("Brazil");
      const nz = map.mainRing("New Zealand");
      expect(usa.length).toBeGreaterThan(3);
      expect(brazil.length).toBeGreaterThan(3);
      expect(Math.max(...usa.map((p) => p.x))).toBeLessThan(250);
      expect(Math.max(...brazil.map((p) => p.x))).toBeLessThan(250);
      expect(Math.min(...nz.map((p) => p.x))).toBeGreaterThan(250);
      for (const point of [...usa, ...brazil, ...nz]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(500);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(height);
      }
      expect(map.document.querySelectorAll("svg text")).toHaveLength(0);
      expect(map.document.querySelectorAll('[data-country="Russia"]')).toHaveLength(3);
      expect(map.document.querySelector("g[clip-path]")).not.toBeNull();
    });
  }
  it("does not move continents when the affected-country set changes", () => {
    const apac = renderMap(165);
    const americas = renderMap(165, new Map([["Brazil", 5], ["United States", 2]]));
    for (const country of ["United States", "Brazil", "New Zealand"]) {
      expect(apac.path(country)).toBe(americas.path(country));
    }
  });
});