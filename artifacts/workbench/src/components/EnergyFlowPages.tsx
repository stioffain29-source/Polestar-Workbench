import { useLayoutEffect, useRef, useState } from "react";
import type { MarketPrice } from "@workspace/api-client-react";
import { applyMarketPriceOverrides, type TopicSectionOverrides } from "@/lib/topicSectionOverrides";
import { DISCLAIMER_TEXT } from "@/lib/pdfChrome";
import { segmentEnergySituationProse } from "@/lib/energySituationLayout";
import { MarketPricesReportSection } from "@/components/MarketPrices";

const NAVY = "#0b0a3d";
const ELECTRIC = "#465bff";
const DUSK = "#363636";
const POLAR = "#e2e2e2";
const ENERGY_FLOW_CONTENT_HEIGHT = "267mm";
const ENERGY_SECTION_GAP = 24;

export type EnergyReportSectionGate = (key: string) => boolean;

type EnergyFlowBlock = {
  id: string;
  content: React.ReactNode;
  marginBottom?: number;
  /** Never divide visual grids and final/legal assessments between pages. */
  atomic?: boolean;
  /** A block which cannot be made legible on one page is a render error. */
  failIfOversize?: boolean;
  groupId?: string;
  /** Prefer a new page over stranding part of a short, complete assessment. */
  preferFreshPageWhenWholeFits?: boolean;
  overflowLabel?: string;
};

type MeasuredBlock = {
  id: string;
  height: number;
};

/**
 * Keep every source line in recommendations/watch items. In particular this
 * must not select only marked lines, cap the count, or turn a multi-sentence
 * recommendation into its first sentence. The native renderer uses these same
 * newline item boundaries.
 */
export function energyFlowBulletItems(text?: string | null): string[] {
  return (text ?? "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s*/, ""));
}

/**
 * A manual page shell cannot split a single DOM block. Break unusually long
 * source paragraphs at whitespace (without removing or rewriting text) so
 * their normal wrapped lines can continue on the next measured page. The
 * chunks have no visual paragraph gap between them.
 */
function splitFlowableParagraph(text: string, targetLength = 420): string[] {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (current && current.length + token.length > targetLength) {
      chunks.push(current);
      current = token;
    } else {
      current += token;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

function EnergyFlowParagraph({
  text,
  marginBottom = 12,
}: {
  text: string;
  marginBottom?: number;
}) {
  return (
    <p
      className="text-[14px] leading-[1.7] font-light"
      style={{ color: DUSK, fontFamily: "Roboto, sans-serif", marginBottom }}
    >
      {text}
    </p>
  );
}

function EnergyFlowHeading({ title }: { title: string }) {
  return (
    <h2
      className="uppercase pb-2 mb-4 tracking-wide"
      data-pdf-keep-with-next="true"
      style={{
        color: NAVY,
        fontFamily: "Roboto, sans-serif",
        fontWeight: 700,
        fontSize: 18,
        borderBottom: `2px solid ${ELECTRIC}`,
      }}
    >
      {title}
    </h2>
  );
}

function energyFlowParagraphs(text: string): React.ReactNode[] {
  return text
    .split(/\n+/)
    .filter(Boolean)
    .flatMap((paragraph, paragraphIndex) => {
      const chunks = splitFlowableParagraph(paragraph);
      return chunks.map((chunk, chunkIndex) => (
        <EnergyFlowParagraph
          key={`${paragraphIndex}-${chunkIndex}`}
          text={chunk}
          marginBottom={chunkIndex === chunks.length - 1 ? 12 : 0}
        />
      ));
    });
}

function energyFlowBullets(text: string): React.ReactNode[] {
  return energyFlowBulletItems(text).flatMap((item, itemIndex) => {
    const chunks = splitFlowableParagraph(item);
    return chunks.map((chunk, chunkIndex) => {
      const isFirstChunk = chunkIndex === 0;
      const isLastChunk = chunkIndex === chunks.length - 1;
      return isFirstChunk ? (
        <ul
          key={`${itemIndex}-${chunkIndex}`}
          className="list-disc pl-5"
          style={{
            color: DUSK,
            fontFamily: "Roboto, sans-serif",
            marginBottom: isLastChunk ? 6 : 0,
          }}
        >
          <li className="text-[14px] leading-[1.6] font-light">{chunk}</li>
        </ul>
      ) : (
        <div
          key={`${itemIndex}-${chunkIndex}`}
          className="text-[14px] leading-[1.6] font-light"
          style={{
            color: DUSK,
            fontFamily: "Roboto, sans-serif",
            paddingLeft: 20,
            marginBottom: isLastChunk ? 6 : 0,
          }}
        >
          {chunk}
        </div>
      );
    });
  });
}

function makeEnergySectionBlocks(
  id: string,
  title: string,
  content: React.ReactNode[],
  options: Pick<EnergyFlowBlock, "preferFreshPageWhenWholeFits"> = {},
): EnergyFlowBlock[] {
  const items = content.filter((item): item is React.ReactNode => item !== null && item !== undefined);
  if (items.length === 0) return [];
  return items.map((item, index) => ({
    id: `${id}-${index}`,
    groupId: id,
    preferFreshPageWhenWholeFits: options.preferFreshPageWhenWholeFits,
    // The heading and its first paragraph/item are deliberately one measured
    // unit. This is what prevents a heading from being orphaned at page end.
    content: index === 0 ? (
      <>
        <EnergyFlowHeading title={title} />
        {item}
      </>
    ) : item,
    marginBottom: index === items.length - 1 ? ENERGY_SECTION_GAP : 0,
  }));
}

function makeAtomicEnergySectionBlock(
  id: string,
  title: string,
  content: React.ReactNode,
  options: Pick<EnergyFlowBlock, "marginBottom" | "overflowLabel"> = {},
): EnergyFlowBlock {
  return {
    id,
    atomic: true,
    failIfOversize: true,
    overflowLabel: options.overflowLabel ?? title,
    marginBottom: options.marginBottom ?? ENERGY_SECTION_GAP,
    content: (
      <>
        <EnergyFlowHeading title={title} />
        {content}
      </>
    ),
  };
}

function EnergySituationSegment({
  segment,
  text = segment.text,
  showHeading = true,
  marginBottom = 10,
}: {
  segment: ReturnType<typeof segmentEnergySituationProse>[number];
  text?: string;
  showHeading?: boolean;
  marginBottom?: number;
}) {
  return (
    <div data-energy-situation-segment={segment.kind} style={{ breakInside: "avoid", marginBottom }}>
      {showHeading && segment.heading && (
        <h3
          className="uppercase tracking-wide"
          style={{
            color: NAVY,
            fontFamily: "Roboto, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          {segment.kind === "standalone-label" ? segment.text : segment.heading}
        </h3>
      )}
      {segment.kind === "paragraph" && <EnergyFlowParagraph text={text} marginBottom={0} />}
    </div>
  );
}

function energySituationFlowContent(text: string): React.ReactNode[] {
  const segments = segmentEnergySituationProse(text);
  const content: React.ReactNode[] = [];
  const paragraphChunks = (segment: ReturnType<typeof segmentEnergySituationProse>[number]) =>
    splitFlowableParagraph(segment.text);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    // A saved location label and its first prose item are one block, while
    // later paragraphs stay independently pageable.
    if (segment.kind === "standalone-label" && segments[index + 1]?.kind === "paragraph") {
      const following = segments[index + 1];
      const chunks = paragraphChunks(following);
      content.push(
        <div key={`${index}-label-group`} style={{ display: "flow-root" }}>
          <EnergySituationSegment segment={segment} />
          <EnergySituationSegment
            segment={{ ...following, heading: null }}
            text={chunks[0]}
            marginBottom={chunks.length === 1 ? 10 : 0}
          />
        </div>,
      );
      chunks.slice(1).forEach((chunk, chunkIndex) => {
        content.push(
          <EnergySituationSegment
            key={`${index}-following-${chunkIndex + 1}`}
            segment={{ ...following, heading: null }}
            text={chunk}
            showHeading={false}
          />,
        );
      });
      index += 1;
    } else {
      const chunks = segment.kind === "paragraph" ? paragraphChunks(segment) : [segment.text];
      chunks.forEach((chunk, chunkIndex) => {
        content.push(
          <EnergySituationSegment
            key={`${index}-${chunkIndex}`}
            segment={segment}
            text={chunk}
            showHeading={chunkIndex === 0}
            marginBottom={chunkIndex === chunks.length - 1 ? 10 : 0}
          />,
        );
      });
    }
  }
  return content;
}

function EnergyReportDisclaimer() {
  return (
    <aside
      data-energy-disclaimer
      style={{
        padding: "10px 13px",
        fontFamily: "Roboto, sans-serif",
        color: DUSK,
        background: "#fff",
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: "9pt", fontWeight: 700, color: NAVY }}>
        DISCLAIMER
      </h2>
      <p
        style={{
          margin: 0,
          fontFamily: "Roboto, sans-serif",
          fontSize: "9pt",
          lineHeight: 1.2,
          fontWeight: 300,
        }}
      >
        {DISCLAIMER_TEXT}
      </p>
    </aside>
  );
}

function EnergyReportFooter() {
  return (
    <div
      className="pdf-preview-footer px-10 flex items-center justify-between"
      style={{
        background: POLAR,
        color: DUSK,
        fontFamily: "Roboto, sans-serif",
        fontSize: 11,
        minHeight: 36,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <span>polestar-advisory.com</span>
      <span>info@polestar-advisory.com</span>
      <span style={{ opacity: 0.7 }}>Page numbers added at export</span>
    </div>
  );
}

function paginateMeasuredBlocks(
  measured: MeasuredBlock[],
  blocks: EnergyFlowBlock[],
  capacity: number,
): { groups: string[][]; error: string | null } {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const groupsById = new Map<string, MeasuredBlock[]>();
  for (const entry of measured) {
    const groupId = blockById.get(entry.id)?.groupId;
    if (!groupId) continue;
    const group = groupsById.get(groupId) ?? [];
    group.push(entry);
    groupsById.set(groupId, group);
  }

  const nextGroups: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (let index = 0; index < measured.length; index += 1) {
    const entry = measured[index];
    const block = blockById.get(entry.id);
    if (!block) continue;
    if (block.failIfOversize && entry.height > capacity) {
      return {
        groups: [],
        error: `${block.overflowLabel ?? "This section"} is too tall to render as one page. Shorten the assessment rather than clipping or shrinking it.`,
      };
    }

    const group = block.groupId ? groupsById.get(block.groupId) : undefined;
    const isGroupStart = !group || group[0]?.id === entry.id;
    const groupHeight = group?.reduce((total, item) => total + item.height, 0) ?? entry.height;
    const shouldStartFresh =
      block.preferFreshPageWhenWholeFits &&
      isGroupStart &&
      current.length > 0 &&
      groupHeight <= capacity &&
      used + groupHeight > capacity;
    if (current.length > 0 && (shouldStartFresh || used + entry.height > capacity)) {
      nextGroups.push(current);
      current = [];
      used = 0;
    }
    current.push(entry.id);
    used += entry.height;
  }
  if (current.length > 0) nextGroups.push(current);
  if (nextGroups.length === 0) nextGroups.push([]);
  return { groups: nextGroups, error: null };
}

/**
 * Every page after the cover is assembled from measured blocks. Page numbers
 * are only labels; section placement is always determined by current content.
 */
function EnergyFlowingPages({ blocks }: { blocks: EnergyFlowBlock[] }) {
  const measurementRef = useRef<HTMLDivElement>(null);
  const [pageGroups, setPageGroups] = useState<string[][] | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const blockSignature = blocks.map((block) => block.id).join("|");

  useLayoutEffect(() => {
    setPageGroups(null);
    setPaginationError(null);
    const measure = () => {
      const root = measurementRef.current;
      const page = root?.querySelector<HTMLElement>("[data-energy-flow-measure-page]");
      if (!root || !page) return;
      const capacity = page.clientHeight || page.getBoundingClientRect().height || (267 * 96) / 25.4;
      if (!capacity) return;
      const measured = Array.from(root.querySelectorAll<HTMLElement>("[data-energy-flow-measure-block]"))
        .map((element) => {
          const styles = window.getComputedStyle(element);
          const marginBottom = Number.parseFloat(styles.marginBottom) || 0;
          return {
            id: element.dataset.energyFlowMeasureBlock ?? "",
            height: element.getBoundingClientRect().height + marginBottom,
          };
        });
      const result = paginateMeasuredBlocks(measured, blocks, capacity);
      setPaginationError((previous) => previous === result.error ? previous : result.error);
      setPageGroups((previous) => (
        JSON.stringify(previous) === JSON.stringify(result.groups) ? previous : result.groups
      ));
    };

    let frame = 0;
    const scheduleMeasure = () => {
      if (typeof window.requestAnimationFrame === "function") {
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(measure);
      } else {
        measure();
      }
    };
    scheduleMeasure();
    const root = measurementRef.current;
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(scheduleMeasure)
      : null;
    if (root) {
      resizeObserver?.observe(root);
      root.querySelectorAll<HTMLElement>("[data-energy-flow-measure-block]")
        .forEach((element) => resizeObserver?.observe(element));
    }
    const fontsReady = document.fonts?.ready.then(scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      void fontsReady;
    };
  }, [blockSignature, blocks]);

  const blockById = new Map(blocks.map((block) => [block.id, block]));
  return (
    <>
      <div
        ref={measurementRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-100000px",
          top: 0,
          width: "170mm",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        <div
          data-energy-flow-measure-page
          style={{ width: "170mm", height: ENERGY_FLOW_CONTENT_HEIGHT, boxSizing: "border-box" }}
        >
          {blocks.map((block) => (
            <div
              key={block.id}
              data-energy-flow-measure-block={block.id}
              style={{ display: "flow-root", marginBottom: block.marginBottom ?? 0 }}
            >
              {block.content}
            </div>
          ))}
        </div>
      </div>
      {paginationError ? (
        <div
          className="energy-report-page"
          data-energy-flow-error="true"
          style={{ color: "#a33232", fontFamily: "Roboto, sans-serif", fontSize: 14, paddingTop: "30mm" }}
        >
          <strong>Energy Watch pagination error:</strong> {paginationError}
        </div>
      ) : (
        <div data-energy-flowing-pages style={{ visibility: pageGroups ? "visible" : "hidden" }}>
          {(pageGroups ?? []).map((group, pageIndex) => (
            <div
              key={`energy-flow-page-${pageIndex}`}
              className="energy-report-page energy-flow-page"
              data-energy-page={pageIndex + 2}
            >
              {group.map((id) => {
                const block = blockById.get(id);
                if (!block) return null;
                return (
                  <div
                    key={block.id}
                    data-energy-flow-block={block.id}
                    style={{ display: "flow-root", marginBottom: block.marginBottom ?? 0 }}
                  >
                    {block.content}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function EnergyFlowPages({
  fastFactsContent,
  execText,
  mapContent,
  marketPrices,
  situationText,
  whatHappenedText,
  whatMattersText,
  implicationsText,
  watchNextText,
  polestarViewText,
  show,
  sectionOverrides,
}: {
  fastFactsContent: React.ReactNode;
  execText: string;
  mapContent: React.ReactNode;
  marketPrices?: MarketPrice[];
  situationText: string;
  whatHappenedText: string;
  whatMattersText: string;
  implicationsText: string;
  watchNextText: string;
  polestarViewText: string;
  show: EnergyReportSectionGate;
  sectionOverrides?: TopicSectionOverrides | null;
}) {
  const flowBlocks: EnergyFlowBlock[] = [];
  const priceRows = applyMarketPriceOverrides(marketPrices ?? [], sectionOverrides?.marketPriceOverrides);

  if (show("fast-facts")) {
    flowBlocks.push(makeAtomicEnergySectionBlock("fast-facts", "Fast Facts", fastFactsContent));
  }
  if (show("executive-summary") && execText.trim()) {
    flowBlocks.push(
      ...makeEnergySectionBlocks("bluf", "BLUF", energyFlowParagraphs(execText), {
        preferFreshPageWhenWholeFits: true,
      }),
    );
  }
  if (show("situation")) {
    flowBlocks.push(
      makeAtomicEnergySectionBlock("energy-situation-map", "Energy Situation Map", mapContent, {
        overflowLabel: "Energy Situation Map",
      }),
    );
  }
  if (show("market-prices")) {
    // The complete two-column grid moves as one visual section. Individual
    // market cards therefore never separate from their chart/source details.
    flowBlocks.push(
      makeAtomicEnergySectionBlock(
        "market-prices",
        "Market Prices",
        <MarketPricesReportSection rows={priceRows} compact />,
        { overflowLabel: "Market Prices" },
      ),
    );
  }

  const energySituationText = [
    show("situation") ? situationText : "",
    show("what-happened") ? whatHappenedText : "",
  ].filter((text) => text.trim()).join("\n");
  if (energySituationText.trim()) {
    flowBlocks.push(
      ...makeEnergySectionBlocks(
        "energy-situation",
        "Energy Situation",
        energySituationFlowContent(energySituationText),
      ),
    );
  }
  if (show("what-matters") && whatMattersText.trim()) {
    flowBlocks.push(
      ...makeEnergySectionBlocks("what-matters", "What Matters", energyFlowParagraphs(whatMattersText), {
        preferFreshPageWhenWholeFits: true,
      }),
    );
  }
  if (show("implications") && implicationsText.trim()) {
    flowBlocks.push(
      ...makeEnergySectionBlocks(
        "implications",
        "Implications for Business",
        energyFlowBullets(implicationsText),
        { preferFreshPageWhenWholeFits: true },
      ),
    );
  }
  if (show("watch-next") && watchNextText.trim()) {
    flowBlocks.push(
      ...makeEnergySectionBlocks("watch-next", "Watch Next", energyFlowBullets(watchNextText), {
        preferFreshPageWhenWholeFits: true,
      }),
    );
  }
  if (show("polestar-view") && polestarViewText.trim()) {
    flowBlocks.push(
      makeAtomicEnergySectionBlock(
        "polestar-view",
        "Polestar View",
        <>{energyFlowParagraphs(polestarViewText)}</>,
        { marginBottom: 12, overflowLabel: "Polestar View" },
      ),
    );
  }
  // Legal copy remains a separate atomic block. It may use the next page, but
  // never gets coupled to Polestar View simply to fill empty vertical space.
  flowBlocks.push({
    id: "energy-disclaimer",
    atomic: true,
    failIfOversize: true,
    overflowLabel: "Disclaimer",
    content: (
      <>
        <EnergyReportDisclaimer />
        <EnergyReportFooter />
      </>
    ),
  });

  return <EnergyFlowingPages blocks={flowBlocks} />;
}