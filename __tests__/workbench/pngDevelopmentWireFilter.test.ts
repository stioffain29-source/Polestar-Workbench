import {
  isDevelopmentWireItem,
  buildPngReportDataset,
  buildWestPapuaReportDataset,
  type PngReportItem,
  type PngSourceIncident,
  type BuildArgs,
} from "@/lib/pngReportDataset";

// Minimal PngReportItem for the pure predicate — it reads only title, summary
// and severityRank, but the type requires the full shape.
function pi(over: { title: string; summary?: string; severityRank: number }): PngReportItem {
  return {
    id: "x",
    title: over.title,
    summary: over.summary ?? "",
    province: null,
    location: null,
    category: "Other security",
    displayCategory: "Other security",
    businessImpact: "",
    severity: "low",
    severityLabel: "Low",
    severityRank: over.severityRank,
    reportedDate: new Date("2026-07-01T08:00:00.000Z"),
    incidentDate: null,
    occurredEarlier: false,
    source: "Test Wire",
    url: null,
    confidence: "unrated",
  } as unknown as PngReportItem;
}

describe("isDevelopmentWireItem — guardrails (strict under-filter bias)", () => {
  it("drops low-severity development / promotional wire copy", () => {
    const drops = [
      "Road upgrade brings hope to isolated Lumusa communities",
      "PNG music legend brings joy to Giligili Prison",
      "PC Online Tidbits",
      "IFC and CPL Group continue to strengthen partnership",
      "Countdown Begins: Solomon Airlines inaugural POM-Honiara flight",
      "Rai Coast DDA invests in flight subsidies",
      "PNG Aviation Network to benefit from new Niusky investments",
      "PMIA Domestic Terminal expansion project moves forward with contract signing",
      "Gereka road upgrade links communities",
      "US, Papua New Guinea leaders during Tamiok Strike 26 groundbreaking ceremony",
      "Peace ceremony for late Abraham Polly",
      "U.S., Papua New Guinea engineers prepare Igam Barracks classrooms for renovation",
      "PNG Air bids farewell to its DASH 8 fleet and embraces a new era of aviation",
      "PNG inflation remains uneven",
      "K92 Mining awards 100 community bursaries to host community students",
      "Digicel di PNG siap kembangkan jaringan 5G",
      "PNG designer Linda Philau Pius returns to Brisbane runway with new collection",
      "US and PNG celebrate enduring relationship during Tamiok Strike",
      "PNG Health Access strengthened through Australia aviation partnership",
    ];
    for (const title of drops) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(true);
    }
  });

  it("still keeps a low-severity crime item even when it carries a newly-added PR word (veto)", () => {
    const keeps = [
      "Gunmen ambush convoy near airport runway",
      "Arsonist torches classroom in Goroka school attack",
      "Robbers raid store during groundbreaking ceremony",
    ];
    for (const title of keeps) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("keeps low-severity fire / crash hazard items (fire|blaze|crash veto)", () => {
    const keeps = [
      "Fire destroys classroom block in Goroka",
      "Plane skids off runway at Nadzab airport", // 'runway' no longer a wire token
      "Truck crash on Highlands Highway kills two",
      "Blaze guts Lae market overnight",
    ];
    for (const title of keeps) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("keeps low-severity Bahasa crime rows that reach the PNG window (Bahasa veto)", () => {
    const keeps = [
      "Polisi bongkar jaringan narkoba di Jayapura", // jaringan is no longer a wire token
      "Penembakan warga di perbatasan Papua Nugini",
      "Perampokan bersenjata di Port Moresby",
    ];
    for (const title of keeps) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("still drops the fashion-runway and 5G rollout PR (via designer/new collection and \\b5g\\b)", () => {
    expect(
      isDevelopmentWireItem(
        pi({ title: "PNG designer returns to Brisbane runway with new collection", severityRank: 2 }),
      ),
    ).toBe(true);
    expect(
      isDevelopmentWireItem(pi({ title: "Digicel di PNG siap kembangkan jaringan 5G", severityRank: 2 })),
    ).toBe(true);
  });

  it("drops low-severity awards / recognition human-interest PR", () => {
    const drops = [
      // The live PNG leak: an abstract "demonstration of leadership" metaphor
      // that evaded the protest-demonstration homonym guard upstream.
      "‘Leadership means stepping aside’: Pascoe Events founder declines WOW Awards Nomination to make space for rising leaders",
      "K92 student wins national science prize",
      "Local designer crowned at Miss PNG pageant",
      "Governor hands accolade to retiring headmaster",
      "Nurse nominated for regional excellence award",
    ];
    for (const title of drops) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(true);
    }
  });

  it("does NOT treat 'reward' / 'denomination' as awards PR (word-boundary anchors)", () => {
    const keeps = [
      "Reward offered for information on Lae store robbery", // 'reward' != \baward
      "Church denomination opens new Goroka mission", // 'denomination' != \bnominat
    ];
    for (const title of keeps) {
      // 'robbery' vetoes the first; the second has no wire token at all.
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("drops low-severity joint-military-exercise PR (labour-strike homonym)", () => {
    const drops = [
      "U.S., Papua New Guinea launch Tamiok Strike 26 [Image 5 of 8] - DVIDS",
      "U.S. Embassy Port Moresby announces Exercise Tamiok Strike 2026",
      "US, Papua New Guinea launch Tamiok Strike 26 - army.mil",
      "PNGDF take flight for Exercise Pitch Black",
      "PNG joins Australia for bilateral military exercise",
    ];
    for (const title of drops) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(true);
    }
  });

  it("keeps genuine security items that carry a new PR word (awards/exercise veto)", () => {
    const keeps = [
      "Award-winning officer shot dead at ceremony", // award + ceremony PR, 'shot' vetoes
      "Two soldiers killed during joint military exercise", // exercise PR, 'killed' vetoes
      "Rioters clash with police at beauty pageant", // pageant PR, 'riot'/'police' veto
    ];
    for (const title of keeps) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("NEVER drops a Moderate+ item, even with promotional wording", () => {
    expect(
      isDevelopmentWireItem(
        pi({ title: "Airport expansion project halted after riot", severityRank: 3 }),
      ),
    ).toBe(false);
    expect(
      isDevelopmentWireItem(pi({ title: "Road upgrade brings hope", severityRank: 4 })),
    ).toBe(false);
  });

  it("NEVER drops a low-severity item carrying a security term (veto)", () => {
    const keeps = [
      "Man robbed at knifepoint near a new road upgrade",
      "Former captain convicted of attempted murder",
      "Police recruitment drive announced in Hela",
      "Community leaders trained to help stop sorcery violence",
    ];
    for (const title of keeps) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("NEVER drops a low-severity natural-hazard item", () => {
    const hazards = [
      "Magnitude 5.8 earthquake strikes near Lae",
      "Bougainville volcano eruption prompts alert",
      "Ramu grid power outage hits Lae",
    ];
    for (const title of hazards) {
      expect(isDevelopmentWireItem(pi({ title, severityRank: 2 }))).toBe(false);
    }
  });

  it("keeps a plain low-severity item with no promotional wording", () => {
    expect(
      isDevelopmentWireItem(pi({ title: "Aviation safety: airstrip landing incident detailed", severityRank: 2 })),
    ).toBe(false);
  });

  it("drops a Moderate 'PC Online Tidbits' round-up column (structural non-incident, any severity)", () => {
    expect(isDevelopmentWireItem(pi({ title: "PC Online Tidbits", severityRank: 3 }))).toBe(true);
    // Even at High — a round-up column carries no event to lose.
    expect(isDevelopmentWireItem(pi({ title: "PC Online Tidbits", severityRank: 4 }))).toBe(true);
  });

  it("drops a bare 'PC Online Tidbits' even when its grab-bag summary mentions crime (title-only veto)", () => {
    // Mirrors the live row: the column title is always bare, but its miscellany
    // routinely mentions unrelated police/theft snippets. Title has no security
    // term, so the structural-column marker still drops it.
    expect(
      isDevelopmentWireItem(
        pi({
          title: "PC Online Tidbits",
          summary: "Retailers annoyed over trading hours. Police recovered a stolen vehicle.",
          severityRank: 3,
        }),
      ),
    ).toBe(true);
  });

  it("keeps a 'tidbits'-titled edition whose TITLE names a real event (veto wins)", () => {
    expect(
      isDevelopmentWireItem(
        pi({ title: "PC Online Tidbits: gunmen raid Lae store", severityRank: 3 }),
      ),
    ).toBe(false);
  });

  it("keeps a real article whose SUMMARY merely mentions tidbits (title-only match)", () => {
    expect(
      isDevelopmentWireItem(
        pi({
          title: "Highlands Highway ambush leaves two dead",
          summary: "The report shares tidbits from witnesses at the scene.",
          severityRank: 2,
        }),
      ),
    ).toBe(false);
  });
});

const DAY = 86_400_000;
const base = Date.parse("2026-07-01T08:00:00.000Z");

function inc(over: Partial<PngSourceIncident> & { title: string }): PngSourceIncident {
  return {
    title: over.title,
    severity: over.severity ?? "low",
    occurredAt: over.occurredAt ?? new Date(base).toISOString(),
    country: over.country ?? "Papua New Guinea",
    location: over.location ?? "Port Moresby",
    source: over.source ?? "Test Wire",
    ...over,
  };
}

function argsFor(windowIncidents: PngSourceIncident[]): BuildArgs {
  return {
    windowIncidents,
    thirtyDay: windowIncidents,
    ninetyDay: windowIncidents,
    baselineWatchlist: [],
    periodLabel: "Test period",
  };
}

describe("filterDevelopmentWire wiring — promoted to every theatre", () => {
  const devWire = inc({ title: "Road upgrade brings hope to isolated Lumusa communities", severity: "low" });
  const crime = inc({ title: "Man robbed at knifepoint in Port Moresby settlement", severity: "low" });
  const hazard = inc({
    title: "Magnitude 5.8 earthquake strikes near Lae",
    severity: "low",
    location: "Lae",
    occurredAt: new Date(base - DAY).toISOString(),
  });
  const window = [devWire, crime, hazard];

  it("PNG window drops the development wire item but keeps crime and hazard", () => {
    const png = buildPngReportDataset(argsFor(window));
    const titles = png.windowItems.map((i) => i.title);
    expect(titles.some((t) => /robbed at knifepoint/i.test(t))).toBe(true);
    expect(titles.some((t) => /earthquake/i.test(t))).toBe(true);
    expect(titles.some((t) => /brings hope/i.test(t))).toBe(false);
  });

  it("West Papua now ALSO drops the development wire item (filter promoted to all theatres)", () => {
    const wp = buildWestPapuaReportDataset(argsFor(window));
    const titles = wp.windowItems.map((i) => i.title);
    expect(titles.some((t) => /robbed at knifepoint/i.test(t))).toBe(true);
    expect(titles.some((t) => /earthquake/i.test(t))).toBe(true);
    expect(titles.some((t) => /brings hope/i.test(t))).toBe(false);
  });

  it("PNG never empties a window that is all development wire (falls back to unfiltered)", () => {
    const allWire = [
      inc({ title: "Road upgrade brings hope to Lumusa", severity: "low" }),
      inc({ title: "Airline inaugural flight countdown begins", severity: "insignificant" }),
    ];
    const png = buildPngReportDataset(argsFor(allWire));
    expect(png.windowItems.length).toBeGreaterThan(0);
  });
});
