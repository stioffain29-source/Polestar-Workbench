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
} from "./pdfChrome";
import {
  type SituationalContextItem,
  SITUATIONAL_CONTEXT_HEADING,
  SITUATIONAL_CONTEXT_INTRO,
} from "./situationalContext";

// Headless PDF mirror of SituationalContextSection. Draws nothing when there
// is no supporting context, so an absent/unapproved ReliefWeb feed leaves the
// report unchanged. Section order and wording match the preview exactly.
export function drawSituationalContextPdf(
  ctx: Ctx,
  items: SituationalContextItem[],
) {
  if (items.length === 0) return;
  const { pdf, MX, CW } = ctx;

  // Keep the heading with the intro and the first item.
  setRoboto(pdf, "light");
  pdf.setFontSize(11);
  const introLines: string[] = pdf.splitTextToSize(
    sanitize(SITUATIONAL_CONTEXT_INTRO),
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

  drawSectionHeading(ctx, SITUATIONAL_CONTEXT_HEADING);

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
    const need = 14 + titleLines.length * 13 + 10;
    if (ctx.y + need > ctx.H - ctx.BOTTOM) newPage(ctx);

    // Meta line: ORG · DATE
    setRoboto(pdf, "bold");
    pdf.setFontSize(7.5);
    setText(pdf, DUSK);
    const meta = sanitize(
      [it.org, it.dateLabel].filter(Boolean).join("  \u00B7  ").toUpperCase(),
    );
    pdf.text(meta, MX, ctx.y + 9);
    ctx.y += 14;

    // Title (first line carries the link).
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
    ctx.y += 8;
  }
  ctx.y += 4;
}
