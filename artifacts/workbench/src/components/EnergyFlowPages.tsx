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

export type EnergyReportSectionGate = (key: string) => boolean;

type EnergyFlowBlock = {
  id: string;
  content: React.ReactNode;
  marginBottom?: number;
};

const ENERGY_FLOW_CONTENT_HEIGHT = "267mm";
const ENERGY_SECTION_GAP = 32;

function toBullets(text?: string | null, max = 7): string[] {
  const source = (text ?? "").trim();
  if (!source) return [];
  const marked = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*•])\s+/.test(line))
    .map((line) => line.replace(/^([-*•])\s+/, "").trim())
    .filter(Boolean);
  let items: string[];
  if (marked.length > 0) items = marked;
  else {
    items = source
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((paragraph) =>
        paragraph.length <= 220
          ? paragraph
          : (paragraph.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? paragraph.slice(0, 217) + "...").trim(),
      );
  }
  return items.slice(0, max);
}

function Paragraphs({ text }: { text?: string | null }) {
  if (!text) return null;
  const parts = text.split(/\n+/).filter(Boolean);
  return (
    <>
      {parts.map((paragraph, index) => (
        <p
          key={index}
          className="text-[14px] leading-[1.7] mb-3 font-light"
          style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}
        >
          {paragraph}
        </p>
      ))}
    </>
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
  return text.split(/\n+/).filter(Boolean).map((paragraph, index) => (
    <Paragraphs key={index} text={paragraph} />
  ));
}

function energyFlowBullets(text: string, max = 7): React.ReactNode[] {
  const items = toBullets(text, max);
  return items.map((item, index) => (
    <ul
      key={index}
      className="list-disc pl-5"
      style={{
        color: DUSK,
        fontFamily: "Roboto, sans-serif",
        marginBottom: index < items.length - 1 ? 6 : 0,
      }}
    >
      <li className="text-[14px] leading-[1.6] font-light">{item}</li>
    </ul>
  ));
}

function makeEnergySectionBlocks(
  id: string,
  title: string,
  content: React.ReactNode[],
): EnergyFlowBlock[] {
  const items = content.filter((item): item is React.ReactNode => item !== null && item !== undefined);
  if (items.length === 0) return [];
  return items.map((item, index) => ({
    id: `${id}-${index}`,
    content: index === 0 ? (
      <>
        <EnergyFlowHeading title={title} />
        {item}
      </>
    ) : item,
    marginBottom: index === items.length - 1 ? ENERGY_SECTION_GAP : 0,
  }));
}

function EnergySituationSegment({
  segment,
}: {
  segment: ReturnType<typeof segmentEnergySituationProse>[number];
}) {
  return (
    <div
      data-energy-situation-segment={segment.kind}
      style={{ breakInside: "avoid", marginBottom: 10 }}
    >
      {segment.heading && (
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
      {segment.kind === "paragraph" && <Paragraphs text={segment.text} />}
    </div>
  );
}

function energySituationFlowContent(text: string): React.ReactNode[] {
  const segments = segmentEnergySituationProse(text);
  const content: React.ReactNode[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    // A saved location label is a heading for the paragraph immediately after
    // it. Keep both in one measured block so pagination cannot orphan a label.
    if (segment.kind === "standalone-label" && segments[index + 1]?.kind === "paragraph") {
      content.push(
        <div key={`${index}-label-group`} style={{ display: "flow-root" }}>
          <EnergySituationSegment segment={segment} />
          <EnergySituationSegment segment={{ ...segments[index + 1], heading: null }} />
        </div>,
      );
      index += 1;
    } else {
      content.push(<EnergySituationSegment key={index} segment={segment} />);
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
        breakInside: "avoid",
        pageBreakInside: "avoid",
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

/**
 * The post-overview Energy report is paginated from measured content rather
 * than from a fixed sequence of page breaks. The hidden page uses the exact
 * A4 content height and the same blocks as the visible pages. This matters for
 * live market-card heights, wrapped headings, and webfont reflow.
 */
function EnergyFlowingPages({ blocks }: { blocks: EnergyFlowBlock[] }) {
  const measurementRef = useRef<HTMLDivElement>(null);
  const [pageGroups, setPageGroups] = useState<string[][] | null>(null);
  const blockSignature = blocks.map((block) => block.id).join("|");

  useLayoutEffect(() => {
    setPageGroups(null);
    const measure = () => {
      const root = measurementRef.current;
      if (!root) return;
      const page = root.querySelector<HTMLElement>("[data-energy-flow-measure-page]");
      if (!page) return;
      const capacity =
        page.clientHeight ||
        page.getBoundingClientRect().height ||
        (267 * 96) / 25.4;
      if (!capacity) return;
      const measured = Array.from(
        root.querySelectorAll<HTMLElement>("[data-energy-flow-measure-block]"),
      );
      const nextGroups: string[][] = [];
      let current: string[] = [];
      let used = 0;
      for (const element of measured) {
        const styles = window.getComputedStyle(element);
        const marginBottom = Number.parseFloat(styles.marginBottom) || 0;
        const height = element.getBoundingClientRect().height + marginBottom;
        if (current.length > 0 && used + height > capacity) {
          nextGroups.push(current);
          current = [];
          used = 0;
        }
        current.push(element.dataset.energyFlowMeasureBlock ?? "");
        used += height;
      }
      if (current.length > 0) nextGroups.push(current);
      if (nextGroups.length === 0) nextGroups.push([]);
      setPageGroups((previous) => (
        JSON.stringify(previous) === JSON.stringify(nextGroups) ? previous : nextGroups
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
      ? new ResizeObserver(() => {
          scheduleMeasure();
        })
      : null;
    if (root) {
      resizeObserver?.observe(root);
      root.querySelectorAll<HTMLElement>("[data-energy-flow-measure-block]")
        .forEach((element) => resizeObserver?.observe(element));
    }
    const fontsReady = document.fonts?.ready.then(() => {
      scheduleMeasure();
    });
    const onResize = () => {
      scheduleMeasure();
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      void fontsReady;
    };
  }, [blockSignature]);

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
          style={{
            width: "170mm",
            height: ENERGY_FLOW_CONTENT_HEIGHT,
            boxSizing: "border-box",
          }}
        >
          {blocks.map((block) => (
            <div
              key={block.id}
              data-energy-flow-measure-block={block.id}
              style={{
                display: "flow-root",
                marginBottom: block.marginBottom ?? 0,
              }}
            >
              {block.content}
            </div>
          ))}
        </div>
      </div>
      <div
        data-energy-flowing-pages
        style={{ visibility: pageGroups ? "visible" : "hidden" }}
      >
        {(pageGroups ?? []).map((group, pageIndex) => (
          <div
            key={`energy-flow-page-${pageIndex}`}
            className="energy-report-page energy-flow-page"
            data-energy-page={pageIndex + 3}
          >
            {group.map((id) => {
              const block = blockById.get(id);
              if (!block) return null;
              return (
                <div
                  key={block.id}
                  data-energy-flow-block={block.id}
                  style={{
                    display: "flow-root",
                    marginBottom: block.marginBottom ?? 0,
                  }}
                >
                  {block.content}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

export function EnergyFlowPages({
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
  const priceRows = applyMarketPriceOverrides(
    marketPrices ?? [],
    sectionOverrides?.marketPriceOverrides,
  );

  if (show("market-prices")) {
    flowBlocks.push(
      ...makeEnergySectionBlocks("market-prices", "Market Prices", [
        <MarketPricesReportSection key="market-prices-content" rows={priceRows} compact />,
      ]),
    );
  }

  const energySituationText = [
    show("situation") ? situationText : "",
    show("what-happened") ? whatHappenedText : "",
  ]
    .filter((text) => text.trim())
    .join("\n");
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
      ...makeEnergySectionBlocks(
        "what-matters",
        "What Matters",
        energyFlowParagraphs(whatMattersText),
      ),
    );
  }
  if (show("implications")) {
    flowBlocks.push(
      ...makeEnergySectionBlocks(
        "implications",
        "Implications for Business",
        energyFlowBullets(implicationsText),
      ),
    );
  }
  if (show("watch-next")) {
    flowBlocks.push(
      ...makeEnergySectionBlocks(
        "watch-next",
        "Watch Next",
        energyFlowBullets(watchNextText, 8),
      ),
    );
  }

  let polestarBlocks = show("polestar-view") && polestarViewText.trim()
    ? makeEnergySectionBlocks(
        "polestar-view",
        "Polestar View",
        energyFlowParagraphs(polestarViewText),
      )
    : [];
  if (polestarBlocks.length > 0) {
    const last = polestarBlocks[polestarBlocks.length - 1];
    last.marginBottom = 0;
  }

  const disclaimerFooter = (
    <>
      <EnergyReportDisclaimer />
      <EnergyReportFooter />
    </>
  );
  if (polestarBlocks.length > 0) {
    const last = polestarBlocks[polestarBlocks.length - 1];
    polestarBlocks = [
      ...polestarBlocks.slice(0, -1),
      {
        ...last,
        id: "polestar-view-final-with-disclaimer",
        content: (
          <>
            {last.content}
            {disclaimerFooter}
          </>
        ),
      },
    ];
    flowBlocks.push(...polestarBlocks);
  } else {
    flowBlocks.push({
      id: "energy-disclaimer-footer",
      content: disclaimerFooter,
    });
  }

  return <EnergyFlowingPages blocks={flowBlocks} />;
}