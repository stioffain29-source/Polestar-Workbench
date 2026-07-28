// Regression pins for the flashpoint TITLE hard-exclude stack.
//
// FLASHPOINT_TITLE_HARD_EXCLUDE in lib/relevance/src/topicRelevance.ts now
// carries ~40 precision-bound patterns (sports rallies, fact-checks,
// diplomatic protests, think-piece/retrospective essays, commission-report
// aftermath). Their correctness was previously only checked by manually
// replaying live DB rows (artifacts/workbench/scripts/replayFlashpointRelevance.ts).
// These fixtures are drawn from real headlines seen in that replay and pin
// BOTH directions:
//   - DROP: noise classes that must never re-enter the feed;
//   - KEEP: live coverage that shares surface vocabulary with a noise class
//     (High Commission street protests, anniversary marches, "demands release
//     of commission report") and must never be collaterally swallowed by a
//     future regex tweak.
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "flashpoint", title, summary };
  return explainRelevance("flashpoint", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- Sports "rally"/"protest"/"march" homonyms ----
  ["sports comeback rally", "Thailand rally past Malaysia to seal group top spot"],
  ["referee protest", "Malaysia awarded takraw title after Thailand protest referee's call"],
  ["sports progression march", "Indonesia march into the semi-finals after shootout win"],
  ["world cup fan colour", "Some wave protest flags as Iran plays World Cup opener"],
  ["play-football colour", "'We're here to play football', Iran downplays protest ahead of opener"],
  // ---- Misinformation / fact-check ----
  ["fact-check debunk", "Video falsely shared as footage of Gen-Z protest in Kathmandu"],
  ["fake-content debunk", "Fake letter falsely claims university backed student protest"],
  ["AI-generated debunk", "AI-generated video of Jakarta riot circulates online, AFP fact check finds"],
  // ---- Diplomatic / filed protest (a note, not a street event) ----
  ["filed diplomatic protest", "Manila files diplomatic protest after South China Sea clash"],
  ["lodged formal protest", "Vietnam lodges a formal protest over survey ship incursion"],
  // ---- Enforcement showcase 'demonstration' ----
  ["showcase demonstration", "Drug smuggling crackdown demonstration at Incheon Airport inspection checkpoint"],
  // ---- Metaphor / electoral / figurative ----
  ["instant-protest metaphor", "'Instant protest' erupts online over ticket prices"],
  ["protest vote", "Analysts see protest vote surge shaping Nepal's by-elections"],
  // ---- Retrospective administrative / compensation aftermath ----
  ["compensation aftermath", "September protest damage claims settled after nine months"],
  ["dated disciplinary aftermath", "University punishes staff over 2024 protest crackdown"],
  // ---- Explainer / question-framed analysis ----
  ["what's-behind explainer", "What's behind Bangladesh's protest against PM Sheikh Hasina?"],
  ["why-are explainer", "Why are farmers protesting across northern India?"],
  ["symbolism explainer", "What does pink symbolize at the Women's Alliance protest?"],
  ["can-question debate piece", "Can Nepal actually enforce its Human Rights Commission's findings?"],
  ["who-was profile", "Who was Sharif Osman Hadi? The rise and killing of Bangladesh's protest icon"],
  // ---- Think-piece / retrospective essays ----
  ["essay thesis copula", "Nepal's Gen Z protests are a call for democratic renewal"],
  ["essay thesis colon", "Nepal's youth protests: A warning for South Asian democracies"],
  ["lessons-from distillation", "The questions emerging from Nepal's Gen Z protests"],
  ["may-learn-from essay", "What authoritarians may learn about censorship from Nepal's protests"],
  ["protest-fueled arc", "Nepal's protest-fueled transition enters a fragile phase"],
  ["post-protest label", "Post-protest Bangladesh: Restoration more than renewal"],
  ["broader-shift trend piece", "Balen Shah's political rise reflects a broader shift after youth-led protests"],
  ["heritage retrospective", "How NAIDOC grew from a one-day protest to a week-long celebration"],
  // ---- Commission / inquiry aftermath procedure ----
  ["commission submits report", "Nepal commission submits September protest probe report"],
  ["inquiry seeks extension", "Inquiry commission seeks extra month to probe protest crackdown"],
  ["further investigation directed", "Inquiry panel directs fresh investigation into protest organizers"],
  // ---- Crime-syndicate crackdown colour ----
  ["syndicate crackdown", "'Counter-setting syndicate' active at Johor border, KLIA despite crackdown"],
];

// [class label, headline] — every row must KEEP. Each shares vocabulary with a
// DROP class above and pins that the exclude stays precision-bound.
const KEEP_FIXTURES: Array<[string, string]> = [
  ["High Commission street protest", "Protesters gather outside Indian High Commission in Dhaka"],
  ["demands release of commission report", "Gen Z Alliance protests in Kathmandu, demands release of Karki commission report"],
  // NOTE: an anniversary march naming an explicit YEAR ("march for 2024
  // uprising victims") is dropped by the dated-retrospective exclude by
  // design; the undated live march must keep.
  // (the ambiguous token "march" needs a public-order companion cue — here
  // "protesters" — to clear the REQUIRED gate, mirroring live coverage.)
  ["anniversary march", "Protesters join anniversary march for uprising victims in Dhaka"],
  ["live protest naming a year", "2026 protest erupts in Dhaka as garment workers block roads"],
  ["compensation grievance rally", "Protesters demand compensation claims for demolished homes"],
  ["crackdown on protesters", "Police launch crackdown on protesters outside parliament"],
  ["demonstration against a crackdown", "Hundreds stage demonstration against the crackdown in Jakarta"],
  ["protest turns violent (not heritage arc)", "Student protest turns violent as police fire tear gas in Kathmandu"],
  ["protesters file past parliament", "Protesters file past parliament demanding electoral reform"],
  ["teachers protest (title-rescue)", "Teachers protest abduction of colleague in Manila"],
];

describe("flashpoint title hard-excludes (protest-noise regression pins)", () => {
  describe.each(DROP_FIXTURES)("DROP: %s", (_label, title) => {
    it(`drops: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(false);
    });
  });

  describe.each(KEEP_FIXTURES)("KEEP: %s", (_label, title) => {
    it(`keeps: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(true);
    });
  });

  it("hard excludes fire on the TITLE even when the summary carries live-protest cues", () => {
    // A think-piece whose summary quotes street clashes must still drop — the
    // title exclude runs before any body-level rescue.
    const v = verdict(
      "Nepal's Gen Z protests are a call for democratic renewal",
      "Protesters clashed with riot police and tear gas was fired during the September unrest.",
    );
    expect(v.relevant).toBe(false);
  });
});
