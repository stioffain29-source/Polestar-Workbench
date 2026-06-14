import { forwardRef } from "react";
import type { CardContent, BrandSettings, CardHighlight } from "@workspace/api-client-react";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  cardRatingColor,
  cardRatingLabel,
  cardRatingNote,
  highlightIcon,
  templateMeta,
} from "@/lib/cardTemplates";
import { MapPin, CalendarDays, Clock, Octagon, CalendarClock } from "lucide-react";
import CardMap from "@/components/CardMap";
// Default Polestar wordmark baked into every card so analysts never have to
// upload it. Reverse-white horizontal lockup reads cleanly on the dark brand
// gradient header. A per-card or brand-level logo upload still overrides it.
import defaultLogo from "@assets/Reverse_white_logo_hor_1779525768654.png";

export interface MasterCardProps {
  templateKey: string;
  content: CardContent;
  brand: BrandSettings;
}

// Constant Polestar tagline shown on the bottom strip of every card.
const TAGLINE = "Intelligence. Precision. Protection.";

// Clamp text to N lines without overflowing the fixed-height bands.
// NOTE: html2canvas (used to rasterise the card to PNG) does NOT support
// `-webkit-line-clamp` / `display: -webkit-box` — it renders the box as a
// legacy flexbox and vertically centre-clips the text, slicing letters in half.
// So we clamp with an explicit em-based max-height + overflow:hidden, which the
// browser preview and html2canvas export rasterise identically.
function clampLines(lines: number, lineHeight: number): React.CSSProperties {
  return {
    display: "block",
    overflow: "hidden",
    lineHeight,
    boxSizing: "content-box",
    maxHeight: `${(lines * lineHeight).toFixed(3)}em`,
    // html2canvas renders text a touch lower than the browser, so a clip edge
    // flush with the last line shears the glyph bottoms (descenders + the last
    // visible line). A small bottom pad drops the clip edge below the text
    // without revealing the next line — fixes the sheared-text export.
    paddingBottom: "0.3em",
  };
}

// Fixed 1080x1350 (4:5) master social card, eight stacked bands top→bottom:
//   1. Gradient header   — logo (left) + topic line (right)
//   2. Title + meta      — headline (left) + location/date/time column (right)
//   3. Section label     — electric "Situation Update" rule
//   4. BLUF block        — electric tag + dark navy summary box
//   5. Content row        — visual/map panel (left) + highlight callouts (right)
//   6. Key points         — three numbered columns
//   7. Rating footer     — rating + outlook in a bordered light box
//   8. Bottom strip      — wordmark | source | tagline
// Rendered at native pixel dimensions; callers scale it via CSS transform for
// the preview, and exportCardToPng rasterises a clone at scale 1 — so the
// on-screen preview and the exported PNG are the same DOM.
export const MasterCard = forwardRef<HTMLDivElement, MasterCardProps>(
  function MasterCard({ templateKey, content, brand }, ref) {
    const meta = templateMeta(templateKey);
    const ratingColor = cardRatingColor(content.rating);
    const ratingLabel = cardRatingLabel(content.rating);
    const ratingNote = content.ratingNote?.trim() || cardRatingNote(content.rating);

    const midnight = brand.colorMidnight || "#0B0B3D";
    const electric = brand.colorElectric || "#4655FF";
    const dusk = brand.colorDusk || "#303030";
    const polar = brand.colorPolar || "#E2E2E2";
    // Brand band gradient on the header. The report chrome uses -130deg, but on
    // this wide header that drops the bright electric on the LEFT and midnight on
    // the right — backwards. Mirror it to 130deg so the gradient reads midnight
    // (left) -> electric (right), the way it should.
    const brandGradient = `linear-gradient(130deg, ${midnight} 0%, ${electric} 100%)`;
    const headingFont = `'${brand.fontHeading || "Roboto Condensed"}', sans-serif`;
    const bodyFont = `'${brand.fontBody || "Roboto"}', sans-serif`;
    const logo = content.logoImage || brand.logoImage || defaultLogo;
    const footer = content.footerText || brand.footerText || "Polestar Advisory";
    const muted = "#8A93A0";

    const keyPoints = (content.keyPoints ?? []).slice(0, 3);
    while (keyPoints.length < 3) keyPoints.push("");

    const highlights: CardHighlight[] = (content.highlights ?? [])
      .filter((h) => (h.label ?? "").trim() || (h.body ?? "").trim())
      .slice(0, 4);
    const hasHighlights = highlights.length > 0;

    const SAFE = 56; // horizontal safe-zone padding

    const mapLat = typeof content.mapLat === "number" ? content.mapLat : NaN;
    const mapLng = typeof content.mapLng === "number" ? content.mapLng : NaN;
    const useMap =
      content.mapMode === "map" && !Number.isNaN(mapLat) && !Number.isNaN(mapLng);

    // Header meta column rows — only rendered when a value is present, so a
    // bare card never shows empty icon rows.
    const locationText = [content.country, content.mapLocation]
      .map((s) => (s ?? "").trim())
      .filter(Boolean)
      .join("  |  ");
    const metaRows: Array<{ Icon: typeof MapPin; text: string }> = [];
    if (locationText) metaRows.push({ Icon: MapPin, text: locationText });
    if ((content.eventDate ?? "").trim()) metaRows.push({ Icon: CalendarDays, text: content.eventDate!.trim() });
    if ((content.eventTime ?? "").trim()) metaRows.push({ Icon: Clock, text: content.eventTime!.trim() });

    return (
      <div
        ref={ref}
        style={{
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          background: "#ffffff",
          fontFamily: bodyFont,
          color: dusk,
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* ---- Band 1: Gradient header — logo + topic ---- */}
        <div
          style={{
            background: brandGradient,
            color: "#ffffff",
            height: 104,
            padding: `0 ${SAFE}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: "0 0 auto",
          }}
        >
          {logo ? (
            <img
              src={logo}
              alt="logo"
              crossOrigin="anonymous"
              style={{ height: 48, width: "auto", objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#ffffff",
              }}
            >
              Polestar Advisory
            </div>
          )}
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 26,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: polar,
              textAlign: "right",
              maxWidth: 560,
              ...clampLines(2, 1.15),
            }}
          >
            {content.topic || meta.kicker}
          </div>
        </div>

        {/* ---- Band 2: Title + meta column ---- */}
        <div
          style={{
            padding: `34px ${SAFE}px 26px`,
            flex: "0 0 auto",
            display: "flex",
            alignItems: "flex-start",
            gap: 32,
            borderBottom: `2px solid ${polar}`,
          }}
        >
          <div
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 60,
              lineHeight: 1.02,
              color: midnight,
              textTransform: "uppercase",
              ...clampLines(3, 1.02),
            }}
          >
            {content.headline || "Headline"}
          </div>
          {metaRows.length > 0 && (
            <div
              style={{
                flex: "0 0 auto",
                width: 300,
                borderLeft: `2px solid ${polar}`,
                paddingLeft: 26,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {metaRows.map(({ Icon, text }, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <Icon size={26} color={electric} strokeWidth={2.25} style={{ flex: "0 0 auto", marginTop: 2 }} />
                  <div
                    style={{
                      fontFamily: bodyFont,
                      fontWeight: 600,
                      fontSize: 23,
                      lineHeight: 1.2,
                      color: midnight,
                      ...clampLines(2, 1.2),
                    }}
                  >
                    {text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ---- Band 3: Section label ---- */}
        <div
          style={{
            padding: `22px ${SAFE}px 0`,
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 25,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: electric,
            }}
          >
            {meta.sectionLabel}
          </div>
          <div style={{ flex: "1 1 auto", height: 2, background: polar }} />
        </div>

        {/* ---- Band 4: BLUF block ---- */}
        {(content.bluf ?? "").trim() && (
          <div
            style={{
              padding: `16px ${SAFE}px 0`,
              flex: "0 0 auto",
              display: "flex",
              alignItems: "stretch",
              gap: 0,
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                background: electric,
                color: "#ffffff",
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 26,
                letterSpacing: 2,
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 26px",
              }}
            >
              BLUF
            </div>
            <div
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                background: midnight,
                color: "#ffffff",
                fontFamily: bodyFont,
                fontSize: 25,
                lineHeight: 1.32,
                padding: "18px 26px",
                ...clampLines(2, 1.32),
              }}
            >
              {content.bluf}
            </div>
          </div>
        )}

        {/* ---- Band 5: Content row — visual panel + highlights ---- */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            margin: `22px ${SAFE}px`,
            display: "flex",
            gap: 24,
          }}
        >
          <div
            style={{
              flex: hasHighlights ? "1.35 1 0" : "1 1 0",
              minWidth: 0,
              border: `2px solid ${polar}`,
              background: useMap || content.mapImage ? "#ffffff" : "#F4F5F7",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {useMap ? (
              <CardMap
                lat={mapLat}
                lng={mapLng}
                zoom={typeof content.mapZoom === "number" ? content.mapZoom : 6}
                color={electric}
                label={content.mapLocation || undefined}
              />
            ) : content.mapImage ? (
              <img
                src={content.mapImage}
                alt="visual"
                crossOrigin="anonymous"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  fontFamily: headingFont,
                  fontWeight: 700,
                  fontSize: 26,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: muted,
                }}
              >
                {meta.panelLabel}
              </div>
            )}
            {!useMap && content.mapLocation && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  background: midnight,
                  color: "#ffffff",
                  fontFamily: bodyFont,
                  fontSize: 22,
                  padding: "10px 20px",
                }}
              >
                {content.mapLocation}
              </div>
            )}
          </div>

          {hasHighlights && (
            <div
              style={{
                flex: "1 1 0",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {highlights.map((h, i) => {
                const Icon = highlightIcon(h.icon);
                return (
                  <div
                    key={i}
                    style={{
                      flex: "1 1 0",
                      minHeight: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "14px 0",
                      borderBottom:
                        i < highlights.length - 1 ? `2px solid ${polar}` : "none",
                    }}
                  >
                    <div
                      style={{
                        flex: "0 0 auto",
                        width: 54,
                        height: 54,
                        background: electric,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon size={28} color="#ffffff" strokeWidth={2.25} />
                    </div>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: headingFont,
                          fontWeight: 700,
                          fontSize: 23,
                          letterSpacing: 1,
                          textTransform: "uppercase",
                          color: midnight,
                          lineHeight: 1.1,
                          ...clampLines(1, 1.1),
                        }}
                      >
                        {h.label || ""}
                      </div>
                      {(h.body ?? "").trim() && (
                        <div
                          style={{
                            fontFamily: bodyFont,
                            fontSize: 19,
                            lineHeight: 1.25,
                            color: dusk,
                            marginTop: 4,
                            ...clampLines(2, 1.25),
                          }}
                        >
                          {h.body}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- Band 6: Key points — three numbered columns ---- */}
        <div style={{ padding: `0 ${SAFE}px 22px`, flex: "0 0 auto" }}>
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: midnight,
              marginBottom: 14,
            }}
          >
            Key Points
          </div>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            {keyPoints.map((kp, i) => (
              <div
                key={i}
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  paddingLeft: i === 0 ? 0 : 22,
                  paddingRight: i === keyPoints.length - 1 ? 0 : 22,
                  borderRight: i < keyPoints.length - 1 ? `2px solid ${polar}` : "none",
                }}
              >
                <div
                  style={{
                    flex: "0 0 auto",
                    width: 38,
                    height: 38,
                    background: electric,
                    color: "#ffffff",
                    fontFamily: headingFont,
                    fontWeight: 700,
                    fontSize: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </div>
                <div
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 21,
                    lineHeight: 1.28,
                    color: dusk,
                    paddingTop: 2,
                    ...clampLines(4, 1.28),
                  }}
                >
                  {kp || "Key point"}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Band 7: Rating + outlook footer (bordered light box) ---- */}
        <div
          style={{
            margin: `0 ${SAFE}px 18px`,
            flex: "0 0 auto",
            border: `2px solid ${polar}`,
            display: "flex",
            alignItems: "stretch",
          }}
        >
          <div style={{ flex: "1 1 0", minWidth: 0, padding: "20px 26px" }}>
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: muted,
                marginBottom: 8,
              }}
            >
              {meta.ratingHeading}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <Octagon size={40} color={ratingColor} fill={ratingColor} strokeWidth={1.5} style={{ flex: "0 0 auto" }} />
              <div
                style={{
                  fontFamily: headingFont,
                  fontWeight: 700,
                  fontSize: 42,
                  lineHeight: 1,
                  textTransform: "uppercase",
                  color: ratingColor,
                }}
              >
                {ratingLabel}
              </div>
            </div>
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: 19,
                lineHeight: 1.25,
                color: dusk,
                marginTop: 10,
                ...clampLines(2, 1.25),
              }}
            >
              {ratingNote}
            </div>
          </div>
          <div
            style={{
              flex: "1.3 1 0",
              minWidth: 0,
              padding: "20px 26px",
              borderLeft: `2px solid ${polar}`,
            }}
          >
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: muted,
                marginBottom: 8,
              }}
            >
              Outlook
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <CalendarClock size={36} color={electric} strokeWidth={2.25} style={{ flex: "0 0 auto", marginTop: 2 }} />
              <div
                style={{
                  fontFamily: bodyFont,
                  fontSize: 22,
                  lineHeight: 1.3,
                  color: dusk,
                  ...clampLines(3, 1.3),
                }}
              >
                {content.outlook || "—"}
              </div>
            </div>
          </div>
        </div>

        {/* ---- Band 8: Bottom strip — wordmark | source | tagline ---- */}
        <div
          style={{
            borderTop: `2px solid ${polar}`,
            padding: `14px ${SAFE}px`,
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
          }}
        >
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: midnight,
              flex: "0 0 auto",
            }}
          >
            {footer}
          </span>
          <span
            style={{
              fontFamily: bodyFont,
              fontSize: 16,
              color: muted,
              flex: "1 1 auto",
              textAlign: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {content.sourceNote || ""}
          </span>
          <span
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: electric,
              flex: "0 0 auto",
            }}
          >
            {TAGLINE}
          </span>
        </div>
      </div>
    );
  },
);
