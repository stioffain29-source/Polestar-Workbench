import { isForeignSubjectNoHomeAnchor } from "../../artifacts/workbench/src/lib/countryMatch";

// Generic country briefs (Thailand / Philippines — no bespoke branch) were
// leaking OVERSEAS stories that a stray free-text country tag had filed under
// the report country. The guard drops a record only when its TITLE positively
// names a foreign country / capital / non-state actor AND the record carries no
// domestic anchor at all: no home country / province / city token in the title
// (or its English translation) and no resolved local `location`. It is a
// no-fabrication guard — a genuine local incident that merely names a foreign
// nationality, or that has ANY home anchor, is always retained.

// Foreign-subject records that were filed under Thailand only by a stray tag.
const THAI_DROP = [
  "US launches new Iran strikes, reimposes naval blockade",
  "UK announces social media curfew for under-16s",
  "Russia advances in eastern Ukraine",
  "Israel and Hamas trade fire as Gaza truce collapses",
  "Myanmar junta airstrikes kill 20 in Sagaing",
];

// Genuine Thai incidents (location assumed unresolved) that MUST be retained:
// each carries a home anchor (province / city / nationality-in-place) or names
// no foreign country at all.
const THAI_KEEP = [
  "Chinese national arrested in Udon Thani drug bust",
  "Bomb blast in Pattani market wounds three",
  "British tourist drowns off Phuket",
  "Thailand tightens security along Myanmar border",
  "Shooting at a Bangkok mall leaves two dead",
];

// The Philippines brief must keep South China Sea confrontations — they name
// China but are anchored to a Philippine place / demonym.
const PH_KEEP = [
  "China coast guard rams Philippine vessel near Scarborough Shoal",
  "Chinese militia swarm Palawan waters, Manila protests",
];

// Pure foreign stories with no Philippine anchor still drop.
const PH_DROP = [
  "China launches largest military drill near Taiwan",
  "US and Japan sign new defence pact in Tokyo",
];

describe("isForeignSubjectNoHomeAnchor", () => {
  it.each(THAI_DROP)("drops the foreign Thailand record: %s", (title) => {
    expect(isForeignSubjectNoHomeAnchor(title, null, null, "Thailand")).toBe(
      true,
    );
  });

  it.each(THAI_KEEP)("keeps the genuine Thailand record: %s", (title) => {
    expect(isForeignSubjectNoHomeAnchor(title, null, null, "Thailand")).toBe(
      false,
    );
  });

  it.each(PH_KEEP)("keeps the South China Sea Philippine record: %s", (title) => {
    expect(isForeignSubjectNoHomeAnchor(title, null, null, "Philippines")).toBe(
      false,
    );
  });

  it.each(PH_DROP)("drops the foreign Philippines record: %s", (title) => {
    expect(isForeignSubjectNoHomeAnchor(title, null, null, "Philippines")).toBe(
      true,
    );
  });

  it("keeps a foreign-subject title once a local `location` is resolved", () => {
    // The geocoder only fills `location` with a place inside the report country,
    // so a resolved location is itself a home anchor.
    expect(
      isForeignSubjectNoHomeAnchor(
        "US launches new Iran strikes",
        null,
        "Bangkok",
        "Thailand",
      ),
    ).toBe(false);
  });

  it("keeps a foreign-subject title anchored by its English translation", () => {
    expect(
      isForeignSubjectNoHomeAnchor(
        "Ledakan bom di Iran", // no home token in the Bahasa title
        "Bomb blast in Pattani after Iran-linked threat", // translation anchors it
        null,
        "Thailand",
      ),
    ).toBe(false);
  });

  it("never fires when no foreign subject is named", () => {
    expect(
      isForeignSubjectNoHomeAnchor("Protest in the capital", null, null, "Thailand"),
    ).toBe(false);
  });

  it("never fires on empty / nullish input", () => {
    expect(isForeignSubjectNoHomeAnchor("", null, null, "Thailand")).toBe(false);
    expect(isForeignSubjectNoHomeAnchor(null, null, null, "Thailand")).toBe(
      false,
    );
    expect(
      isForeignSubjectNoHomeAnchor(undefined, undefined, undefined, "Thailand"),
    ).toBe(false);
  });
});
