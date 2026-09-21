import { waitForRegionalMapTiles } from "../../artifacts/workbench/src/lib/regionalReportMapAssets";

class Tile extends EventTarget {
  complete = false;
  naturalWidth = 0;
}
const host = (...images: Tile[]) => ({
  querySelectorAll: () => images,
}) as unknown as HTMLElement;

test("cached successful tiles are immediately ready", async () => {
  const image = new Tile();
  image.complete = true;
  image.naturalWidth = 512;
  await expect(waitForRegionalMapTiles(host(image))).resolves.toBeUndefined();
});

test("capture waits for every tile, not just the first", async () => {
  const first = new Tile();
  const second = new Tile();
  let ready = false;
  const pending = waitForRegionalMapTiles(host(first, second)).then(() => { ready = true; });
  first.dispatchEvent(new Event("load"));
  await Promise.resolve();
  expect(ready).toBe(false);
  second.dispatchEvent(new Event("load"));
  await pending;
  expect(ready).toBe(true);
});

test("a failed tile blocks a misleading map-less export with an actionable error", async () => {
  const image = new Tile();
  const pending = waitForRegionalMapTiles(host(image));
  const assertion = expect(pending).rejects.toThrow("Check your connection and retry Download PDF");
  image.dispatchEvent(new Event("error"));
  await assertion;
});

test("cached failed tiles are rejected too", async () => {
  const image = new Tile();
  image.complete = true;
  await expect(waitForRegionalMapTiles(host(image))).rejects.toThrow("basemap could not be loaded");
});

test("an unresponsive image cannot leave Download PDF hanging", async () => {
  jest.useFakeTimers();
  try {
    const pending = waitForRegionalMapTiles(host(new Tile()), 100);
    const assertion = expect(pending).rejects.toThrow("basemap could not be loaded");
    jest.advanceTimersByTime(100);
    await assertion;
  } finally {
    jest.useRealTimers();
  }
});

test("non-map chart exports are unaffected", async () => {
  await expect(waitForRegionalMapTiles(host())).resolves.toBeUndefined();
});