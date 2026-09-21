/**
 * Regional maps are remote CARTO images, not self-contained vector charts.
 * A map-less PDF is not a successful export. Wait for every tile under one
 * bounded deadline, and let the editor show an actionable error on failure.
 */
export async function waitForRegionalMapTiles(
  host: HTMLElement,
  timeoutMs = 10_000,
): Promise<void> {
  const images = Array.from(host.querySelectorAll<HTMLImageElement>("img[data-regional-map-tile]"));
  if (images.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    let remaining = images.length;
    const cleanups: Array<() => void> = [];
    const cleanup = () => {
      clearTimeout(timeout);
      cleanups.forEach((fn) => fn());
    };
    const fail = () => {
      cleanup();
      reject(new Error("The regional basemap could not be loaded. Check your connection and retry Download PDF."));
    };
    const loaded = () => {
      remaining--;
      if (remaining === 0) {
        cleanup();
        resolve();
      }
    };
    const timeout = setTimeout(fail, timeoutMs);
    for (const image of images) {
      if (image.complete) {
        if (image.naturalWidth > 0) loaded();
        else {
          fail();
          break;
        }
      } else {
        image.addEventListener("load", loaded, { once: true });
        image.addEventListener("error", fail, { once: true });
        cleanups.push(() => {
          image.removeEventListener("load", loaded);
          image.removeEventListener("error", fail);
        });
      }
    }
  });
}