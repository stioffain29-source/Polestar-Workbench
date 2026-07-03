import {
  isNonKineticAssistanceItem,
  correctSeverity,
  correctPngIncidentSeverities,
} from "@/lib/pngSeverityCorrection";

describe("isNonKineticAssistanceItem — demote-only assistance detection", () => {
  it("flags non-kinetic assistance / prevention / PR copy", () => {
    const hits = [
      "Community leaders trained to help stop sorcery violence in Enga",
      "Tribal foundation helped displaced SARV victims",
      "NGO donates relief supplies to remote highlands district",
      "Awareness workshop launched for at-risk youth",
      "New health centre commissioned in Port Moresby",
      "Students graduate from vocational partnership programme",
    ];
    for (const t of hits) {
      expect(isNonKineticAssistanceItem(t, "")).toBe(true);
    }
  });

  it("spares genuine kinetic events even when assistance words appear", () => {
    const spared = [
      "Training camp attacked by gunmen in Hela",
      "Aid convoy ambushed on highlands highway",
      "Gunmen storm awareness workshop, three injured",
      "Relief centre raided by armed men overnight",
      "Two killed as tribal clash disrupts road opening ceremony",
    ];
    for (const t of spared) {
      expect(isNonKineticAssistanceItem(t, "")).toBe(false);
    }
  });

  it("spares homicide events even when an assistance lexicon token appears", () => {
    // Broad assistance tokens (launch*, commission*) must not demote a real
    // killing — the homicide veto (murder/killing/massacre/manslaughter) wins.
    const spared = [
      "Police launch manhunt after double murder in Lae",
      "Commissioner orders probe into highlands killings",
      "Task force launched following village massacre",
      "Man committed for manslaughter after highway death",
    ];
    for (const t of spared) {
      expect(isNonKineticAssistanceItem(t, "")).toBe(false);
    }
  });

  it("does not flag ordinary crime reporting (no assistance lexicon)", () => {
    const crime = [
      "Armed suspect shot during Manu Cash and Carry robbery",
      "Gang members jailed over Lae carjacking spree",
      "Man charged with attempted murder in Mount Hagen",
    ];
    for (const t of crime) {
      expect(isNonKineticAssistanceItem(t, "")).toBe(false);
    }
  });

  it("treats 'aid' as a word, never matching 'raid'", () => {
    expect(isNonKineticAssistanceItem("Police foil highlands raid plot", "")).toBe(false);
    expect(isNonKineticAssistanceItem("Foreign aid boosts district clinic", "")).toBe(true);
  });
});

describe("correctSeverity — caps above Low, never up-rates", () => {
  it("collapses high / moderate / extreme to low", () => {
    expect(correctSeverity("high")).toBe("low");
    expect(correctSeverity("High")).toBe("low");
    expect(correctSeverity("moderate")).toBe("low");
    expect(correctSeverity("extreme")).toBe("low");
  });

  it("leaves low / insignificant / unknown unchanged (no up-rate)", () => {
    expect(correctSeverity("low")).toBe("low");
    expect(correctSeverity("insignificant")).toBe("insignificant");
    expect(correctSeverity("")).toBe("");
    expect(correctSeverity(null)).toBe("");
  });
});

describe("correctPngIncidentSeverities — list mapping", () => {
  it("demotes assistance items, leaves crime and kinetic items intact", () => {
    const rows = [
      { title: "Community leaders trained to stop sorcery violence", severity: "high" },
      { title: "Armed suspect shot during robbery", severity: "low" },
      { title: "Training camp attacked by gunmen", severity: "high" },
      { title: "Foundation helped displaced victims", severity: "extreme" },
      { title: "Aid delivered to flood-hit village", severity: "insignificant" },
    ];
    const out = correctPngIncidentSeverities(rows);
    expect(out[0].severity).toBe("low"); // assistance demoted
    expect(out[1].severity).toBe("low"); // real crime untouched (already low)
    expect(out[2].severity).toBe("high"); // kinetic veto — spared
    expect(out[3].severity).toBe("low"); // assistance demoted from extreme
    expect(out[4].severity).toBe("insignificant"); // assistance but already below low
  });

  it("returns unchanged rows by reference (no needless clone)", () => {
    const rows = [{ title: "Armed suspect shot during robbery", severity: "high" }];
    const out = correctPngIncidentSeverities(rows);
    expect(out[0]).toBe(rows[0]);
  });
});
