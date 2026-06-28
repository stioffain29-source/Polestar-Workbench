import {
  classifyFireCause,
  summariseFireCauses,
} from "@/lib/countryFireCause";

describe("classifyFireCause — never infers a security cause", () => {
  it("a bare factory fire with no stated cause is cause-not-yet-reported (continuity, not arson)", () => {
    const r = classifyFireCause({
      title: "Fire guts sandal factory in East Jakarta",
      summary: "A blaze destroyed a footwear factory overnight; no injuries reported.",
    });
    expect(r.isFire).toBe(true);
    expect(r.cause).toBe("cause-not-yet-reported");
    expect(r.causeStated).toBe(false);
    expect(r.setting).toBe("industrial");
    expect(r.relevance).toBe("continuity");
  });

  it("a market fire with no cause reads continuity via setting, never security", () => {
    const r = classifyFireCause({ title: "Blaze tears through market stalls" });
    expect(r.relevance).toBe("continuity");
    expect(r.setting).toBe("commercial");
    expect(r.cause).toBe("cause-not-yet-reported");
  });

  it("a fire with no setting and no cause is unclear (not guessed)", () => {
    const r = classifyFireCause({ title: "Fire reported in the area" });
    expect(r.cause).toBe("cause-not-yet-reported");
    expect(r.relevance).toBe("unclear");
  });
});

describe("classifyFireCause — honours a STATED cause", () => {
  it("tags arson only when the source says so", () => {
    const r = classifyFireCause({ title: "Arson suspected in warehouse blaze" });
    expect(r.cause).toBe("arson-suspicious");
    expect(r.relevance).toBe("security");
    expect(r.causeStated).toBe(true);
  });

  it("torched / firebomb counts as suspected arson", () => {
    expect(classifyFireCause({ title: "Shop torched overnight" }).cause).toBe("arson-suspicious");
    expect(classifyFireCause({ title: "Molotov thrown at office" }).cause).toBe("arson-suspicious");
  });

  it("tags attack-related when a device or militants are named", () => {
    const r = classifyFireCause({ title: "Bomb blast sets fuel depot ablaze" });
    expect(r.cause).toBe("attack-related");
    expect(r.relevance).toBe("security");
  });

  it("tags protest-related when fire is tied to unrest", () => {
    const r = classifyFireCause({ title: "Rioters set vehicles on fire during protest" });
    expect(r.cause).toBe("protest-related");
    expect(r.relevance).toBe("security");
  });

  it("tags electrical and accidental causes as continuity", () => {
    expect(classifyFireCause({ title: "Short circuit blamed for house fire" }).cause).toBe(
      "electrical",
    );
    expect(classifyFireCause({ title: "Gas leak triggers kitchen blaze" }).cause).toBe(
      "accidental",
    );
    expect(classifyFireCause({ title: "Gas leak triggers kitchen blaze" }).relevance).toBe(
      "continuity",
    );
  });

  it("tags wildfire / land fires", () => {
    const r = classifyFireCause({ title: "Forest fire spreads across dry scrub" });
    expect(r.cause).toBe("wildfire");
    expect(r.setting).toBe("wildfire");
  });

  it("an explosion with no stated cause is tagged explosion with an open cause", () => {
    const r = classifyFireCause({ title: "Explosion rocks industrial estate" });
    expect(r.cause).toBe("explosion");
    expect(r.causeStated).toBe(false);
  });

  it("deliberate cause outranks setting (arson at a factory is security)", () => {
    const r = classifyFireCause({ title: "Arsonist torches factory" });
    expect(r.cause).toBe("arson-suspicious");
    expect(r.relevance).toBe("security");
  });
});

describe("summariseFireCauses", () => {
  it("splits security vs continuity vs unclear and flags the cause gap", () => {
    const s = summariseFireCauses([
      { title: "Arson suspected at depot" }, // security
      { title: "Short circuit blamed for house fire" }, // continuity
      { title: "Fire guts factory" }, // continuity (setting)
      { title: "Fire reported in the area" }, // unclear
      { title: "Council approves new budget" }, // not a fire — ignored
    ]);
    expect(s.total).toBe(4);
    expect(s.security).toBe(1);
    expect(s.continuity).toBe(2);
    expect(s.unclear).toBe(1);
    expect(s.hasCauseGap).toBe(true);
  });
});
