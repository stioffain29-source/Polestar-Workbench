import { forwardRef } from "react";
import type { CardContent, BrandSettings } from "@workspace/api-client-react";
import {
  CARD_WIDTH,
  CARD_HEIGHT,
  cardRatingColor,
  cardRatingTextColor,
  cardRatingLabel,
  templateMeta,
} from "@/lib/cardTemplates";

export interface MasterCardProps {
  templateKey: string;
  content: CardContent;
  brand: BrandSettings;
}

// Fixed 1080x1350 (4:5) master social card. Five regions, top→bottom:
//   1. Top header (brand + topic + date)
//   2. BLUF block (headline + bottom-line summary)
//   3. Visual / map panel
//   4. Key points (exactly three)
//   5. Rating + outlook footer
// Always rendered at native pixel dimensions; callers scale it via CSS transform
// for the preview, and exportCardToPng rasterises a clone at scale 1.
export const MasterCard = forwardRef<HTMLDivElement, MasterCardProps>(
  function MasterCard({ templateKey, content, brand }, ref) {
    const meta = templateMeta(templateKey);
    const ratingColor = cardRatingColor(content.rating);
    const ratingText = cardRatingTextColor(content.rating);
    const ratingLabel = cardRatingLabel(content.rating);

    const midnight = brand.colorMidnight || "#0B0B3D";
    const electric = brand.colorElectric || "#4655FF";
    const dusk = brand.colorDusk || "#303030";
    const polar = brand.colorPolar || "#E2E2E2";
    const headingFont = `'${brand.fontHeading || "Roboto Condensed"}', sans-serif`;
    const bodyFont = `'${brand.fontBody || "Roboto"}', sans-serif`;
    const logo = content.logoImage || brand.logoImage || "";
    const footer = content.footerText || brand.footerText || "Polestar Advisory";

    const keyPoints = (content.keyPoints ?? []).slice(0, 3);
    while (keyPoints.length < 3) keyPoints.push("");

    const SAFE = 64; // safe-zone padding

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
        {/* ---- Region 1: Top header ---- */}
        <div
          style={{
            background: midnight,
            color: "#ffffff",
            padding: `${SAFE * 0.7}px ${SAFE}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flex: "0 0 auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 30,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: polar,
              }}
            >
              {content.topic || meta.kicker}
            </div>
            <div style={{ fontFamily: bodyFont, fontSize: 26, color: "#ffffff" }}>
              {content.country || "—"}
              {content.eventDate ? `  ·  ${content.eventDate}` : ""}
            </div>
          </div>
          {logo ? (
            <img
              src={logo}
              alt="logo"
              crossOrigin="anonymous"
              style={{ height: 56, width: "auto", objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: polar,
                textAlign: "right",
                maxWidth: 280,
              }}
            >
              Polestar Advisory
            </div>
          )}
        </div>

        {/* ---- Region 2: BLUF block ---- */}
        <div
          style={{
            padding: `${SAFE * 0.65}px ${SAFE}px`,
            flex: "0 0 auto",
            borderBottom: `2px solid ${polar}`,
          }}
        >
          <div
            style={{
              fontFamily: headingFont,
              fontWeight: 700,
              fontSize: 58,
              lineHeight: 1.05,
              color: midnight,
              textTransform: "uppercase",
            }}
          >
            {content.headline || "Headline"}
          </div>
          {content.bluf && (
            <div
              style={{
                marginTop: 22,
                fontFamily: bodyFont,
                fontSize: 30,
                lineHeight: 1.35,
                color: dusk,
              }}
            >
              {content.bluf}
            </div>
          )}
        </div>

        {/* ---- Region 3: Visual / map panel ---- */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            margin: `${SAFE * 0.5}px ${SAFE}px`,
            border: `2px solid ${polar}`,
            background: content.mapImage ? "#ffffff" : "#F4F5F7",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {content.mapImage ? (
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
                color: "#9AA3AD",
              }}
            >
              {meta.panelLabel}
            </div>
          )}
          {(content.mapLocation || content.mapImage) && content.mapLocation && (
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                background: midnight,
                color: "#ffffff",
                fontFamily: bodyFont,
                fontSize: 24,
                padding: "12px 22px",
              }}
            >
              {content.mapLocation}
            </div>
          )}
        </div>

        {/* ---- Region 4: Key points (exactly three) ---- */}
        <div
          style={{
            padding: `${SAFE * 0.35}px ${SAFE}px`,
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {keyPoints.map((kp, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
              <div
                style={{
                  flex: "0 0 auto",
                  width: 40,
                  height: 40,
                  background: electric,
                  color: "#ffffff",
                  fontFamily: headingFont,
                  fontWeight: 700,
                  fontSize: 24,
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
                  fontSize: 27,
                  lineHeight: 1.3,
                  color: dusk,
                  paddingTop: 3,
                }}
              >
                {kp || "Key point"}
              </div>
            </div>
          ))}
        </div>

        {/* ---- Region 5: Rating + outlook footer ---- */}
        <div
          style={{
            background: midnight,
            color: "#ffffff",
            padding: `${SAFE * 0.55}px ${SAFE}px`,
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: SAFE * 0.6,
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              background: ratingColor,
              color: ratingText,
              padding: "20px 28px",
              textAlign: "center",
              minWidth: 220,
            }}
          >
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: 18,
                letterSpacing: 3,
                textTransform: "uppercase",
                opacity: 0.85,
              }}
            >
              Risk Rating
            </div>
            <div
              style={{
                fontFamily: headingFont,
                fontWeight: 700,
                fontSize: 44,
                textTransform: "uppercase",
                lineHeight: 1.05,
                marginTop: 4,
              }}
            >
              {ratingLabel}
            </div>
          </div>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div
              style={{
                fontFamily: bodyFont,
                fontSize: 18,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: polar,
                marginBottom: 6,
              }}
            >
              Outlook
            </div>
            <div style={{ fontFamily: bodyFont, fontSize: 25, lineHeight: 1.3 }}>
              {content.outlook || "—"}
            </div>
          </div>
        </div>

        {/* Source note + footer strip */}
        <div
          style={{
            background: dusk,
            color: polar,
            padding: `14px ${SAFE}px`,
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: bodyFont,
            fontSize: 18,
          }}
        >
          <span style={{ opacity: 0.9 }}>{content.sourceNote || ""}</span>
          <span style={{ fontWeight: 500 }}>{footer}</span>
        </div>
      </div>
    );
  },
);
