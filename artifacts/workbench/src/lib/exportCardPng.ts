import html2canvas from "html2canvas";
import { CARD_WIDTH, CARD_HEIGHT } from "./cardTemplates";

async function waitForFontsAndImages(element: HTMLElement): Promise<void> {
  if ("fonts" in document) {
    await document.fonts.ready;
  }
  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      if (img.complete && img.naturalWidth > 0) return;
      try {
        await img.decode();
      } catch {
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }
    }),
  );
}

export function slugifyForFilename(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "card"
  );
}

/**
 * Export a master card node to a pixel-exact 1080x1350 PNG, independent of the
 * preview's on-screen scale. The on-screen preview is wrapped in a CSS
 * `transform: scale(...)`; here we clone the un-scaled full-size card node into a
 * detached, off-screen container at its native dimensions, rasterise at scale 1,
 * then clean up.
 */
export async function exportCardToPng(
  cardEl: HTMLElement,
  filename: string,
): Promise<void> {
  const clone = cardEl.cloneNode(true) as HTMLElement;
  clone.style.position = "absolute";
  clone.style.left = "-10000px";
  clone.style.top = "0";
  clone.style.margin = "0";
  clone.style.transform = "none";
  clone.style.width = `${CARD_WIDTH}px`;
  clone.style.height = `${CARD_HEIGHT}px`;
  clone.style.maxWidth = "none";
  clone.style.maxHeight = "none";
  clone.style.overflow = "hidden";

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${CARD_WIDTH}px`;
  host.style.height = `${CARD_HEIGHT}px`;
  host.style.background = "#ffffff";
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    await waitForFontsAndImages(clone);
    const canvas = await html2canvas(clone, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      windowWidth: CARD_WIDTH,
      windowHeight: CARD_HEIGHT,
      scale: 1,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    host.remove();
  }
}
