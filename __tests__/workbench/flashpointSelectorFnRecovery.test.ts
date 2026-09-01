import {
  selectFlashpointUsable,
  hasStrongPublicOrderCue,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";

const ISSUE = "2026-05-31";

function fp(over: Partial<FlashpointReportIncident>): FlashpointReportIncident {
  return {
    id: over.id ?? Math.random(),
    title: over.title ?? "Workers protest in Kathmandu",
    summary: over.summary ?? "",
    topic: "flashpoint",
    country: over.country ?? "Nepal",
    location: over.location ?? null,
    severity: over.severity ?? "moderate",
    occurredAt: over.occurredAt ?? "2026-05-28T08:00:00Z",
    ...over,
  } as FlashpointReportIncident;
}

describe("Flashpoint selector FN recovery (FP-02)", () => {
  it("hasStrongPublicOrderCue recognises Gen Z protest crackdown rows", () => {
    expect(
      hasStrongPublicOrderCue(
        "Former Nepal PM K P Sharma Oli arrested over Gen Z protest crackdown",
      ),
    ).toBe(true);
    expect(
      hasStrongPublicOrderCue(
        "NHRC recommends action against Oli, Lekhak, Gurung over Gen Z protest deaths",
      ),
    ).toBe(true);
  });

  it("does not rescue UN legal-process commentary (FP-01 belt-and-suspenders)", () => {
    expect(
      hasStrongPublicOrderCue(
        "Hasina's Lawyer Urges UN to Retract Bangladesh Protest Death Toll Report",
      ),
    ).toBe(false);
  });

  it("keeps Dhaka campus violence / clash rows", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title:
            "Violence Erupts in Bangladesh as Police Clash with Dhaka University Students",
          country: "Bangladesh",
          location: "Dhaka",
          severity: "high",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched).toHaveLength(1);
  });

  it("keeps Tokyo anti-war rally rows", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title:
            "Thousands rally in Tokyo against Takaichi moves under 'No War' banner",
          country: "Japan",
          location: "Tokyo",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched).toHaveLength(1);
  });

  it("keeps Manila labour May Day rally legal follow-up", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "BAYAN, labor leaders face raps over May 1 rally in Manila",
          country: "Philippines",
          location: "Manila",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched).toHaveLength(1);
  });

  it("keeps Nepal Gen Z crackdown accountability rows", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Former Nepal PM K P Sharma Oli arrested over Gen Z protest crackdown",
          country: "Nepal",
        }),
        fp({
          title:
            "Use of lethal force, Oli & Lamichhane under lens—Nepal's NHRC on Gen Z protests",
          country: "Nepal",
        }),
        fp({
          title: "Dhaka Protests Demanding Justice For Ramisa Akhter",
          country: "Bangladesh",
          location: "Dhaka",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched.length).toBeGreaterThanOrEqual(2);
  });

  it("still drops motorsport rally homonyms", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Ogier extends WRC Rally Japan lead after SS12",
          summary: "The rally leader pulled away on the dirt stages near Sapporo.",
          country: "Japan",
        }),
        fp({
          title: "Thousands rally in Tokyo against Takaichi moves under 'No War' banner",
          country: "Japan",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched.some((r) => /WRC Rally Japan/i.test(r.title))).toBe(false);
    expect(sel.enriched.some((r) => /No War/i.test(r.title))).toBe(true);
  });

  it("still drops diplomatic UN retract slop at selector", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title:
            "Hasina's Lawyer Urges UN to Retract Bangladesh Protest Death Toll Report",
          country: "Bangladesh",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });

  it("still drops stock-market rally homonyms", () => {
    const sel = selectFlashpointUsable(
      [
        fp({
          title: "Samsung shares rally as foreign interest returns to KOSPI",
          country: "South Korea",
        }),
      ],
      "flashpoint",
      ISSUE,
    );
    expect(sel.enriched).toHaveLength(0);
  });
});
