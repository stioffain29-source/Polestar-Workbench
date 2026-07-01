import { buildIncidentSource } from "../../artifacts/api-server/src/routes/socialWatch";

// PROVENANCE INVARIANT under test (see routes/socialWatch.ts): promoting a
// KAMMI/BEM social-watch post stamps the pasted organiser (actor) + channel onto
// the new incident's `source`. A Telegram paste must NEVER be relabelled
// "Instagram", the captured channel/actor must survive into published
// intelligence, and a missing pair falls back to a stable "KAMMI Social Watch".
// This unit-tests all four branches of buildIncidentSource directly.

describe("buildIncidentSource", () => {
  it("actor + channel → organiser em-dash channel with Social Watch tag", () => {
    expect(
      buildIncidentSource({ actor: "BEM SI", channel: "bem_si (Telegram)" }),
    ).toBe("BEM SI — bem_si (Telegram) (Social Watch)");
  });

  it("channel only → channel with Social Watch tag", () => {
    expect(
      buildIncidentSource({ actor: null, channel: "bem_si (Telegram)" }),
    ).toBe("bem_si (Telegram) (Social Watch)");
  });

  it("actor only → actor with Social Watch tag", () => {
    expect(buildIncidentSource({ actor: "BEM SI", channel: null })).toBe(
      "BEM SI (Social Watch)",
    );
  });

  it("neither → stable KAMMI Social Watch fallback", () => {
    expect(buildIncidentSource({ actor: null, channel: null })).toBe(
      "KAMMI Social Watch",
    );
  });

  it("treats whitespace-only actor/channel as absent (trimmed)", () => {
    expect(buildIncidentSource({ actor: "   ", channel: "  " })).toBe(
      "KAMMI Social Watch",
    );
    expect(buildIncidentSource({ actor: "  ", channel: "bem_si (Telegram)" })).toBe(
      "bem_si (Telegram) (Social Watch)",
    );
  });

  it("never relabels a Telegram-channel item as Instagram", () => {
    const withActor = buildIncidentSource({
      actor: "BEM SI",
      channel: "bem_si (Telegram)",
    });
    const channelOnly = buildIncidentSource({
      actor: null,
      channel: "kammi_pusat (Telegram)",
    });
    expect(withActor).not.toMatch(/instagram/i);
    expect(withActor).toContain("(Telegram)");
    expect(channelOnly).not.toMatch(/instagram/i);
    expect(channelOnly).toContain("(Telegram)");
  });
});
