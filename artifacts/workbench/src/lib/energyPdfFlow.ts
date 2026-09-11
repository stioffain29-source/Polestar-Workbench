import { drawSectionHeading, drawSubtitle, ensureSpace, newPage, sanitize, setRoboto, setText, DUSK, type Ctx } from "./pdfChrome";

/** Content-driven Energy text. Measurements use the exact drawing metrics. */
export function drawEnergyProse(
  ctx: Ctx,
  heading: string | undefined,
  body: string,
  options: { atomic?: boolean; bullets?: boolean; subheading?: string } = {},
) {
  const fontSize = 11;
  const lineHeight = 17;
  const paragraphGap = 10;
  const indent = options.bullets ? 10 : 0;
  const style = () => {
    setRoboto(ctx.pdf, "light");
    ctx.pdf.setFontSize(fontSize);
    setText(ctx.pdf, DUSK);
  };
  style();
  const paragraphs = sanitize(body).split(/\n+/).map((p) => p.trim()).filter(Boolean)
    .map((p) => options.bullets ? p.replace(/^(?:[-*•]|\d+[.)])\s*/, "") : p);
  const blocks: string[][] = paragraphs.map((p) => ctx.pdf.splitTextToSize(p, ctx.CW - indent));
  if (!blocks.length) return;
  const pageHeight = ctx.H - ctx.TOP - ctx.BOTTOM;
  const headingHeight = (fresh: boolean) =>
    (heading ? (fresh ? 30 : 50) : 0) +
    (options.subheading ? (fresh && !heading ? 6 : 16) : 0);
  const bodyHeight = blocks.reduce((n, lines) => n + lines.length * lineHeight + paragraphGap, 0);
  const freshHeight = headingHeight(true) + bodyHeight;
  if (options.atomic && freshHeight > pageHeight) {
    throw new Error(`${heading ?? "Assessment"} is longer than one readable page. Shorten this assessment before exporting; its text will not be split or reduced.`);
  }
  const fresh = ctx.y <= ctx.TOP + 4;
  const remaining = ctx.H - ctx.BOTTOM - ctx.y;
  // Short sections stay together; longer sections expand naturally.
  if (freshHeight <= pageHeight) {
    if (headingHeight(fresh) + bodyHeight > remaining && !fresh) newPage(ctx);
  } else {
    const firstHeight = blocks[0].length * lineHeight + paragraphGap;
    const firstReserve = firstHeight + headingHeight(true) <= pageHeight
      ? firstHeight : Math.min(2, blocks[0].length) * lineHeight;
    if (headingHeight(fresh) + firstReserve > remaining && !fresh) newPage(ctx);
  }
  if (heading) drawSectionHeading(ctx, heading, { skipEnsureSpace: true });
  if (options.subheading) drawSubtitle(ctx, options.subheading);
  style();
  blocks.forEach((lines, index) => {
    const height = lines.length * lineHeight + paragraphGap;
    // First paragraph was reserved with its heading. A paragraph too tall to
    // fit alongside that heading must flow, not abandon the heading.
    const capacity = pageHeight - (index === 0 ? headingHeight(true) : 0);
    if (height <= capacity && height > ctx.H - ctx.BOTTOM - ctx.y) newPage(ctx);
    lines.forEach((line, lineIndex) => {
      ensureSpace(ctx, lineHeight);
      style();
      if (options.bullets && lineIndex === 0) ctx.pdf.text("•", ctx.MX + 2, ctx.y + fontSize);
      ctx.pdf.text(line, ctx.MX + indent, ctx.y + fontSize);
      ctx.y += lineHeight;
    });
    ctx.y += paragraphGap;
  });
}