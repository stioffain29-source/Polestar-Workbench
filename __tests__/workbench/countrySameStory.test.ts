import {
  namedPremises,
  incidentTypeKey,
  storyTokens,
  tokenJaccard,
  storyEntities,
  storySimilarity,
  clusterSameStoryRows,
  consolidateCountryStories,
  readableRepresentativeIndex,
  type SameStoryRow,
} from "@/lib/countrySameStory";
import { isLikelyNonEnglish } from "@/lib/incidentTitle";
import { buildWestPapuaReportDataset } from "@/lib/pngReportDataset";

const DAY = 86_400_000;
const base = Date.parse("2026-06-20T08:00:00.000Z");

describe("storySimilarity — 3-day fold window", () => {
  // The Top-3 fold (isStrongSameTopStory) REMOVES a duplicate from the location
  // buckets, so it must require within3d. Formulaic PNG tribal-violence headlines
  // let two genuinely distinct clashes weeks apart hit jaccard>=0.5; without the
  // window the later one would be silently dropped.
  const title = "Tribal clash in Enga province leaves several dead";
  it("flags within3d true and high jaccard inside the window", () => {
    const s = storySimilarity(
      { title, dateMs: base },
      { title, dateMs: base + 2 * DAY },
    );
    expect(s.jaccard).toBeGreaterThanOrEqual(0.5);
    expect(s.within3d).toBe(true);
  });
  it("flags within3d false beyond the window even when headlines are identical", () => {
    const s = storySimilarity(
      { title, dateMs: base },
      { title, dateMs: base + 10 * DAY },
    );
    expect(s.jaccard).toBeGreaterThanOrEqual(0.5);
    expect(s.within3d).toBe(false);
  });
});

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

  it("collapses the same pilot story even with crossProvince OFF (PATH 3 bypasses the province gate)", () => {
    // A shared STRONG DISTINCTIVE ENTITY (US-national pilot) + shared fatal class
    // identifies ONE event, so PATH 3 now runs BEFORE the province / category
    // gates — the same foreign-national casualty story is collapsed on a
    // NATIONWIDE report (Indonesia, crossProvince off) too, not only on the
    // single-theatre Papua report.
    const clusters = clusterSameStoryRows(pilotRows());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("STILL keeps the province gate for WEAK paths with no strong entity (crossProvince off)", () => {
    // No foreign-national victim, so PATH 3 cannot fire. Two same-category
    // clashes in different provinces must NOT merge with the gate on — proving
    // the PATH 3 reorder did not open the weak paths across provinces.
    const rows = [
      row({
        title: "Five killed in tribal clash in Enga province",
        province: "Enga",
        category: "Tribal violence",
        dateMs: base,
      }),
      row({
        title: "Five killed in tribal clash in Hela province",
        province: "Hela",
        category: "Tribal violence",
        dateMs: base + DAY,
      }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(2);
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

describe("clusterSameStoryRows PATH 4 (armed-clash syndication)", () => {
  // One gunfight/cordon operation re-reported by several outlets across two days,
  // worded so differently that Jaccard falls below the PATH-1 floor. The shared
  // DISTINCTIVE TOWN ("Shopian") plus a tight window is what identifies it.
  it("collapses the same Shopian operation across differently-worded reports", () => {
    const rows = [
      row({ title: "Gunfight erupts in Shopian, two militants trapped", dateMs: base, severityRank: 4 }),
      row({ title: "Security forces tighten cordon in Shopian as gunfight rages", dateMs: base + DAY, severityRank: 3 }),
      row({ title: "Two LeT militants killed in Shopian gunfight", dateMs: base + DAY, severityRank: 3 }),
      row({ title: "Army and police surround militants in Shopian orchard", dateMs: base + 2 * DAY, severityRank: 3 }),
    ];
    const clusters = clusterSameStoryRows(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("does NOT merge two DIFFERENT towns that share only an armed-group NAME", () => {
    // The architect's counterexample: both name Lashkar and both are gunfights
    // within two days, but Kulgam and Shopian are distinct operations. An org
    // name must never anchor a merge (it is generic across every clash).
    const rows = [
      row({ title: "Two Lashkar militants killed in Kulgam gunfight", dateMs: base }),
      row({ title: "Lashkar commander trapped in Shopian encounter", dateMs: base + DAY }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(2);
  });

  it("does NOT merge the same town when the reports are more than two days apart", () => {
    const rows = [
      row({ title: "Gunfight erupts in Shopian", dateMs: base }),
      row({ title: "Forces besiege holed-up militants in Shopian", dateMs: base + 4 * DAY }),
    ];
    expect(clusterSameStoryRows(rows)).toHaveLength(2);
  });

  it("does NOT merge two Papua clashes in different regencies that share only the group name (crossProvince)", () => {
    // crossProvince disables the province gate, so PATH 4 relies wholly on the
    // place anchor. Sharing "TPNPB" must not merge Nduga and Ilaga operations.
    const rows = [
      row({
        title: "TPNPB rebels clash with troops in Nduga",
        province: "Papua Pegunungan",
        category: "Conflict",
        dateMs: base,
      }),
      row({
        title: "TPNPB gunmen ambush road workers in Ilaga",
        province: "Papua Tengah",
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

// ---------------------------------------------------------------------------
// Readable (English) representative selection — the Bahasa-leads-Top-3 fix.
// ---------------------------------------------------------------------------
describe("readableRepresentativeIndex", () => {
  // idx: 0 foreign/high, 1 english/high, 2 english/moderate, 3 foreign/high
  const foreign = [true, false, false, true];
  const rank = [4, 4, 3, 4];
  const date = [300, 200, 500, 400];
  const rf = (i: number) => foreign[i];
  const sr = (i: number) => rank[i];
  const dm = (i: number) => date[i];

  it("keeps cluster[0] unchanged when it already renders in English", () => {
    expect(readableRepresentativeIndex([1, 0, 2], rf, sr, dm)).toBe(1);
  });

  it("re-selects the English member in the same top severity tier when cluster[0] is foreign", () => {
    expect(readableRepresentativeIndex([0, 3, 1], rf, sr, dm)).toBe(1);
  });

  it("never downgrades severity: ignores a lower-tier English member", () => {
    // cluster [0 foreign/high, 2 english/moderate] — no high-tier English → keep 0
    expect(readableRepresentativeIndex([0, 2], rf, sr, dm)).toBe(0);
  });

  it("falls back to cluster[0] when no English sibling exists (honest gap)", () => {
    expect(readableRepresentativeIndex([0, 3], rf, sr, dm)).toBe(0);
  });

  it("prefers the NEWEST English member when several share the top tier", () => {
    const fgn = [true, false, false];
    const rnk = [4, 4, 4];
    const dts = [900, 100, 800];
    expect(
      readableRepresentativeIndex([0, 1, 2], (i) => fgn[i], (i) => rnk[i], (i) => dts[i]),
    ).toBe(2);
  });
});

describe("consolidateCountryStories — leads with the English version of a bilingual story", () => {
  // Identical raw titles guarantee the two rows cluster; they differ only in
  // whether an English display_title has landed yet.
  const bahasa = "Penembakan pilot di Yahukimo Papua menewaskan warga sipil";

  it("returns the translated member, dropping the newest untranslated Bahasa duplicate", () => {
    const out = consolidateCountryStories([
      {
        id: "new-bahasa",
        title: bahasa,
        displayTitle: null,
        severity: "high",
        occurredAt: "2026-07-10T08:00:00.000Z",
        category: "Armed conflict",
      },
      {
        id: "old-english",
        title: bahasa,
        displayTitle: "Pilot shooting in Yahukimo, Papua kills a civilian",
        severity: "high",
        occurredAt: "2026-07-09T08:00:00.000Z",
        category: "Armed conflict",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("old-english");
    expect(isLikelyNonEnglish(out[0].displayTitle ?? out[0].title)).toBe(false);
  });

  it("leaves an already-English newest representative untouched (no flip)", () => {
    const english = "Pilot shot dead in Yahukimo, Papua";
    const out = consolidateCountryStories([
      {
        id: "new-english",
        title: english,
        displayTitle: null,
        severity: "high",
        occurredAt: "2026-07-10T08:00:00.000Z",
        category: "Armed conflict",
      },
      {
        id: "old-english",
        title: english,
        displayTitle: null,
        severity: "high",
        occurredAt: "2026-07-09T08:00:00.000Z",
        category: "Armed conflict",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("new-english");
  });
});

describe("buildWestPapuaReportDataset — Top 3 never leads with untranslated Bahasa", () => {
  const bahasa = "Penembakan pilot di Yahukimo Papua menewaskan warga sipil";
  const mk = (over: Record<string, unknown>) => ({
    country: "Indonesia",
    location: "Yahukimo, Papua Pegunungan",
    source: "Test Wire",
    ...over,
  });
  const windowIncidents = [
    mk({
      id: 31229,
      title: bahasa,
      displayTitle: null,
      severity: "high",
      occurredAt: "2026-07-10T08:00:00.000Z",
    }),
    mk({
      id: 30641,
      title: bahasa,
      displayTitle: "Pilot shooting in Yahukimo, Papua kills a civilian",
      severity: "high",
      occurredAt: "2026-07-09T08:00:00.000Z",
    }),
  ];

  it("surfaces the translated English headline in the Top 3, not the newest Bahasa one", () => {
    const ds = buildWestPapuaReportDataset({
      windowIncidents,
      previousWindowIncidents: [],
      thirtyDay: windowIncidents,
      ninetyDay: windowIncidents,
      baselineWatchlist: [],
      periodLabel: "7\u201310 July 2026",
    });
    const yahu = ds.topThree.find((i) => /yahukimo/i.test(i.title));
    expect(yahu).toBeDefined();
    expect(isLikelyNonEnglish(yahu!.title)).toBe(false);
  });
});
