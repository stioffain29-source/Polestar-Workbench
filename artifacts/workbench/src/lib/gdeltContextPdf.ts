import {
  type Ctx,
  drawSectionHeading,
  ensureSpace,
  newPage,
  setRoboto,
  setText,
  sanitize,
  NAVY,
  DUSK,
  ELECTRIC,
} from "./pdfChrome";
import {
  type GdeltContextItem,
  GDELT_CONTEXT_HEADING,
  GDELT_CONTEXT_INTRO,
} from "./gdeltContext";

// Headless PDF mirror of GdeltContextSection. Draws nothing when there is no
// supporting GDELT context, so an empty pull leaves the report unchanged.
export function drawGdeltContextPdf(ctx: Ctx, items: GdeltContextItem[]) {
  if (items.length === 0) return;
  const { pdf, MX, CW } = ctx;

  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  const introLines: string[] = pdf.splitTextToSize(
    sanitize(GDELT_CONTEXT_INTRO),
    CW,
  );
  const firstTitleLines: string[] = pdf.splitTextToSize(
    sanitize(items[0].title),
    CW,
  );
  const headingBlockH = 14 + 14 + 8 + 16;
  const firstNeed =
    headingBlockH + introLines.length * 17 + 14 + firstTitleLines.length * 13;
  if (ctx.y + firstNeed > ctx.H - ctx.BOTTOM) newPage(ctx);

  drawSectionHeading(ctx, GDELT_CONTEXT_HEADING);

  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  setText(pdf, DUSK);
  for (const ln of introLines) {
    ensureSpace(ctx, 17);
    pdf.text(ln, MX, ctx.y + 11);
    ctx.y += 17;
  }
  ctx.y += 8;

  for (const it of items) {
    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    const titleLines: string[] = pdf.splitTextToSize(sanitize(it.title), CW);
    const summaryLines =
      it.summary && it.kind === "story"
        ? pdf.splitTextToSize(sanitize(it.summary.slice(0, 400)), CW)
        : [];
    const need =
      14 + titleLines.length * 13 + summaryLines.length * 12 + 10;
    if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);

    setRoboto(pdf, "bold");
    pdf.setFontSize(7.5);
    setText(pdf, DUSK);
    const metaParts = [
      it.country.toUpperCase(),
      it.dateLabel,
      it.location,
      it.lane ? it.lane.toUpperCase() : it.kind === "story" ? "STORY" : "",
    ].filter(Boolean);
    pdf.text(sanitize(metaParts.join("  \u00B7  ")), MX, ctx.y + 9);
    ctx.y += 14;

    setRoboto(pdf, "regular");
    pdf.setFontSize(10);
    setText(pdf, NAVY);
    for (let i = 0; i < titleLines.length; i++) {
      ensureSpace(ctx, 13);
      if (i === 0) {
        pdf.textWithLink(titleLines[i], MX, ctx.y + 10, { url: it.url });
      } else {
        pdf.text(titleLines[i], MX, ctx.y + 10);
      }
      ctx.y += 13;
    }

    if (summaryLines.length > 0) {
      setRoboto(pdf, "light");
      pdf.setFontSize(9);
      setText(pdf, DUSK);
      for (const ln of summaryLines) {
        ensureSpace(ctx, 12);
        pdf.text(ln, MX, ctx.y + 10);
        ctx.y += 12;
      }
    }

    if (it.subBucket) {
      setRoboto(pdf, "bold");
      pdf.setFontSize(7);
      setText(pdf, ELECTRIC);
      pdf.text(sanitize(it.subBucket.toUpperCase()), MX, ctx.y + 8);
      ctx.y += 10;
    }

    ctx.y += 8;
  }
  ctx.y += 4;
}
