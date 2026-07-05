import {
  namedPremises,
  incidentTypeKey,
  storyTokens,
  tokenJaccard,
  storyEntities,
  clusterSameStoryRows,
  consolidateCountryStories,
  type SameStoryRow,
} from "@/lib/countrySameStory";

const DAY = 86_400_000;
const base = Date.parse("2026-06-20T08:00:00.000Z");

function row(over: Partial<SameStoryRow> & { title: string }): SameStoryRow {
  return {
    province: null,
    typeKey: incidentTypeKey(over.title, over.category ?? null),
    dateMs: base,
    severityRank: 3,
    category: null,
    displayCategory: null,
    ...over,
  };
}

describe("namedPremises", () => {
  it("extracts the distinctive modifier before a premises noun", () => {
    expect([...namedPremises("Fire guts sandal factory in East Jakarta")]).toEqual([
      "sandal",
    ]);
  });
  it("ignores generic modifiers and bare premises words", () => {
    expect(namedPremises("Fire at the city market").size).toBe(0);
    expect(namedPremises("Large factory blaze reported").size).toBe(0);
  });
});

describe("incidentTypeKey", () => {
  it("collapses fire / blaze / explosion to one family", () => {
    expect(incidentTypeKey("Sandal factory blaze", null)).toBe("fire");
    expect(incidentTypeKey("Gas explosion rocks plant", null)).toBe("fire");
    expect(incidentTypeKey("Fire destroys warehouse", "Other security")).toBe("fire");
  });
  it("keys non-fire incidents off the category", () => {
    expect(incidentTypeKey("Armed robbery downtown", "Crime")).toBe("crime");
    expect(incidentTypeKey("Protest blocks highway", null)).toBe("other");
  });
});

describe("clusterSameStoryRows", () => {
  it("consolidates the same named-premises fire reported across several days", () => {
    const rows = [
      row({ title: "Fire destroys sandal factory in East Jakarta", dateMs: base, severityRank: 4 }),
      row({
        title: "Sandal factory blaze in Jakarta brought under control",
        dateMs: base + 2 * DAY,
        severityRank: 3,
      }),
      row({
        title: "Footwear plant fire: dozens of workers evacuated, Jakarta",
        dateMs: base + 1 * DAY,
        severityRank: 3,
      }),
    ];
    const clusters = clusterSameStoryRows(rows);
    // First two share the "sandal" premises within 3 days -> one cluster. The
    // third names no shared premises ("footwear plant") and overlaps weakly, so
    // it is allowed to stand apart (conservative: never over-merge).
    const sandal = clusters.find((c) => c.includes(0));
    expect(sandal).toContain(1);
    // The representative is the highest-severity member.
    expect(sandal && sandal[0]).toBe(0);
  });

  it("does NOT merge two distinct fires that share no named premises", () => {
    const rows = [
      row({ title: "Garment factory fire in Bekasi", dateMs: base }),
      row({ title: "Chemical warehouse fire in Bekasi", dateMs: base + DAY }),
    ];
    const clusters = clusterSameStoryRows(rows);
    expect(clusters).toHaveLength(2);
  });

  it("merges identical canonical titles regardless of date (PATH 0)", () => {
    const rows = [
      row({ title: "Riot grips capital - Reuters", dateMs: base }),
      row({ title: "Riot grips capital - The Straits Times", dateMs: base + 10 * DAY }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(1);
  });

  it("keeps the existing strong-overlap adjacent-day merge (PATH 1)", () => {
    const rows = [
      row({
        title: "Five killed in tribal clash in Enga province",
        province: "Enga",
        category: "Tribal violence",
        dateMs: base,
      }),
      row({
        title: "Tribal clash in Enga province leaves five killed",
        province: "Enga",
        category: "Tribal violence",
        dateMs: base + DAY,
      }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(1);
  });

  it("does not merge unrelated stories with low overlap", () => {
    const rows = [
      row({ title: "Armed robbery at city bank", category: "Crime" }),
      row({ title: "Flooding closes coastal highway", category: "Natural hazard" }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(2);
  });

  // The Papua pilot story: one real-world event carried by three outlets that
  // (a) geocode it to three different Papua sub-provinces and (b) phrase it so
  // differently that bag-of-words Jaccard falls well below the 0.5 floor.
  const pilotRows = () => [
    row({
      title: "Indonesia confirms evacuation of American pilot's body killed by Papua rebels",
      province: "Papua",
      category: "Conflict",
      dateMs: base,
      severityRank: 4,
    }),
    row({
      title: "Body of American pilot killed in Yahukimo shooting evacuated to Timika",
      province: "Papua Tengah",
      category: "Conflict",
      dateMs: base + DAY,
      severityRank: 4,
    }),
    row({
      title:
        "Indonesian military: AMA Air pilot, US citizen, allegedly shot dead by OPM at Ipdeheik Airport",
      province: "Papua Pegunungan",
      category: "Conflict",
      dateMs: base + 2 * DAY,
      severityRank: 4,
    }),
  ];

  it("collapses the same pilot story across sibling Papua sub-provinces (PATH 3, crossProvince)", () => {
    const clusters = clusterSameStoryRows(pilotRows(), { crossProvince: true });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort()).toEqual([0, 1, 2]);
  });

  it("keeps the province gate when crossProvince is off (multi-city safety)", () => {
    // With the gate on, the three different provinces block the merge, proving
    // the relaxation is what enables the collapse — not an over-eager PATH 3.
    const clusters = clusterSameStoryRows(pilotRows());
    expect(clusters).toHaveLength(3);
  });

  it("does NOT merge two DISTINCT Papua incidents that merely share common words", () => {
    // Both name Papua rebels + a death, but they are different events on
    // different subjects (a soldier vs civilian roadworkers). No shared STRONG
    // distinctive victim entity, so PATH 3 must not collapse them.
    const rows = [
      row({
        title: "Soldier killed in clash with Papua rebels in Nduga",
        province: "Papua Pegunungan",
        category: "Conflict",
        dateMs: base,
      }),
      row({
        title: "Two road workers shot dead by separatists in Yahukimo",
        province: "Papua Tengah",
        category: "Conflict",
        dateMs: base + DAY,
      }),
    ];
    expect(clusterSameStoryRows(rows, { crossProvince: true })).toHaveLength(2);
  });

  it("does NOT merge a foreign-national victim story that shares no event-nature class", () => {
    // Same victim entity (American pilot) but one is a fatal shooting and the
    // other an unrelated visa/administrative item — no shared fatal/evacuation
    // class, so a shared entity alone must not merge them.
    const rows = [
      row({
        title: "American pilot shot dead by OPM in Papua highlands",
        province: "Papua Pegunungan",
        category: "Conflict",
        dateMs: base,
      }),
      row({
        title: "American pilot praised for charity flights across Papua",
        province: "Papua",
        category: "Conflict",
        dateMs: base + DAY,
      }),
    ];
    expect(clusterSameStoryRows(rows, { crossProvince: true })).toHaveLength(2);
  });
});

describe("storyEntities", () => {
  it("anchors on the foreign-national victim; the actor is only a corroborator", () => {
    const a = storyEntities("American pilot's body killed by Papua rebels");
    expect(a.strong.has("victim:us-pilot")).toBe(true);
    expect(a.classes.has("actor:opm")).toBe(true);
    expect(a.classes.has("fatal")).toBe(true);
    // The recurring actor must NOT be a strong anchor on its own.
    expect(a.strong.has("actor:opm")).toBe(false);

    const b = storyEntities("AMA Air pilot, US citizen, shot dead by OPM");
    expect(b.strong.has("victim:us-pilot")).toBe(true);
    expect(b.classes.has("actor:opm")).toBe(true);
  });

  it("emits no strong entity for a generic local headline", () => {
    const e = storyEntities("Two killed in tribal clash in the highlands");
    expect(e.strong.size).toBe(0);
    expect(e.classes.has("fatal")).toBe(true);
  });
});

describe("consolidateCountryStories", () => {
  it("collapses the window to one row per consolidated story, keeping the worst severity", () => {
    const incidents = [
      { title: "Fire destroys sandal factory in East Jakarta", severity: "high", occurredAt: "2026-06-20T08:00:00Z", category: "Fire" },
      { title: "Sandal factory blaze in Jakarta brought under control", severity: "moderate", occurredAt: "2026-06-22T08:00:00Z", category: "Fire" },
      { title: "Armed robbery at city bank", severity: "moderate", occurredAt: "2026-06-21T08:00:00Z", category: "Crime" },
    ];
    const out = consolidateCountryStories(incidents);
    expect(out).toHaveLength(2);
    const fire = out.find((i) => i.title.includes("sandal") || i.title.includes("Sandal"));
    expect(fire?.severity).toBe("high");
  });

  it("returns the input unchanged when there is nothing to merge", () => {
    const incidents = [
      { title: "Only incident this week", severity: "low", occurredAt: "2026-06-20T08:00:00Z" },
    ];
    expect(consolidateCountryStories(incidents)).toHaveLength(1);
  });
});

describe("token helpers", () => {
  it("storyTokens drops stopwords and short tokens", () => {
    const t = storyTokens("The fire was in a big plant");
    expect(t.has("fire")).toBe(true);
    expect(t.has("plant")).toBe(true);
    expect(t.has("the")).toBe(false);
    expect(t.has("a")).toBe(false);
  });
  it("tokenJaccard is 1 for identical sets and 0 for disjoint", () => {
    expect(tokenJaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(tokenJaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});
