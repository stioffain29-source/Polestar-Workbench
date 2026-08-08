import { evaluateIncidentRelevance } from "@workspace/relevance";

function verdict(title: string) {
  return evaluateIncidentRelevance("shipping", { topic: "shipping", title });
}

describe("shipping relevance verb-order, passive-voice, and sinking coverage", () => {
  it.each([
    "Yemen's Houthis say they attacked Saudi oil tankers in Red Sea",
    "Houthis say they launched a missile attack on a Saudi oil tanker off the coast of Yanbu",
    "Indian-flagged commercial ship sank off Yemen after being struck by an explosive-laden boat",
    "An Indian-flagged merchant vessel, MSV Faize Noore Oliya, came under attack off the coast of Yemen",
  ])("keeps a hostile vessel incident regardless of headline word order: %s", (title) => {
    const result = verdict(title);

    expect(result.relevant).toBe(true);
    expect(result.status).toBe("relevant");
  });

  it.each([
    "Container ship arrives on schedule at Rotterdam port",
    "Cruise ship attacked by stomach virus outbreak, dozens ill",
  ])("drops non-security shipping news: %s", (title) => {
    const result = verdict(title);

    expect(result.relevant).toBe(false);
    expect(result.status).toBe("irrelevant");
  });
});
