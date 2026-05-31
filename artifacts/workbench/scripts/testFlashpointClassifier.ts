// Flashpoint relevance classifier acceptance test.
//
// Run with:
//   cd artifacts/workbench && npx tsx scripts/testFlashpointClassifier.ts
//
// Exits non-zero if any case fails. Covers the ten acceptance examples
// the user nominated plus a representative homonym for each excluded
// category (sports, finance, weather, military, entertainment) and
// representative legitimate records that must be retained (real
// labour action, real protest, real student mobilisation).

import { isTopicRelevant } from "../src/lib/topicRelevance";

interface Case {
  name: string;
  title: string;
  summary?: string;
  source?: string;
  expect: boolean;
}

const cases: Case[] = [
  // ── User-nominated EXCLUDED cases ────────────────────────────────
  { name: "Sports / baseball rally",
    title: "Rays rally past Yankees with ninth-inning comeback",
    summary: "Tampa Bay scored three runs in the bottom of the ninth to beat New York.",
    expect: false },
  { name: "Finance / stock rally",
    title: "Stocks extend rally as tech shares lead gains",
    summary: "The S&P 500 closed at a fresh high after a three-day rally driven by chip stocks.",
    expect: false },
  { name: "Finance / currency rally",
    title: "Ringgit ends 3-day rally against the dollar",
    summary: "The Malaysian currency weakened in late trade after three sessions of gains versus the USD.",
    expect: false },
  { name: "Motorsport / Rally Japan",
    title: "Preview: Round 7 - Rally Japan",
    summary: "WRC drivers prepare for the seventh round of the world rally championship in Japan.",
    expect: false },
  { name: "Weather / thunder strike",
    title: "Rain and thunder strike four provinces overnight",
    summary: "Heavy rain and lightning strikes were reported across four provinces, with several houses damaged.",
    expect: false },
  { name: "Military / Ukrainian strike on college",
    title: "10 dead in Ukrainian strike on college in Russian-occupied town",
    summary: "A Ukrainian missile strike hit a college building in a Russian-occupied town, killing ten.",
    expect: false },

  // ── User-nominated RETAINED cases ───────────────────────────────
  { name: "Labour action / chemists strike",
    title: "Chemists strike on May 20 over GST hike",
    summary: "All India Chemists and Druggists Association announced a nationwide strike notice for May 20 against new GST rates; pharmacists across major cities will shut shop.",
    expect: true },
  { name: "Political mobilisation / PTI protest drive",
    title: "PTI launches protest drive against rigged election",
    summary: "Pakistan Tehreek-e-Insaf workers held a rally in Lahore and announced a long march; police arrested several activists.",
    expect: true },
  { name: "Student mobilisation / Balochistan",
    title: "Students hold protest in Balochistan over enforced disappearances",
    summary: "Student union activists staged a sit-in outside the press club; police baton-charged the demonstrators.",
    expect: true },
  { name: "Section 144 protest activity",
    title: "Section 144 imposed in Karachi after protest activity",
    summary: "Authorities invoked Section 144 banning assemblies of more than four people after JI workers held a march; opposition called a city-wide strike.",
    expect: true },

  // ── Spot-check additions per category ───────────────────────────
  { name: "Entertainment / concert rally (Anne Curtis)",
    title: "Anne Curtis leads rally for Gracie Abrams concert tickets",
    summary: "Fans gathered outside the venue to rally for last-minute concert tickets.",
    expect: false },
  { name: "Military / IBO encounter",
    title: "35 terrorists killed in intelligence-based operation",
    summary: "Security forces neutralised 35 militants during an IBO in the border district.",
    expect: false },
  { name: "Weather / lightning strike fatalities",
    title: "Lightning strike kills three farmers in field",
    summary: "Three farmers were killed when lightning struck during a thunderstorm.",
    expect: false },
  { name: "Finance / oil rally",
    title: "Brent crude rally fizzles on demand worries",
    summary: "Oil prices retreated after a multi-day rally as traders priced in weaker Chinese demand.",
    expect: false },
  { name: "Student crime / non-mobilisation",
    title: "Student abducted from campus, search underway",
    summary: "A 19-year-old student was abducted from a university campus on Monday evening.",
    expect: false },
  { name: "Real / general strike",
    title: "Workers' union calls general strike across textile sector",
    summary: "The trade union has issued a strike notice over wage arrears; industrial action begins Monday.",
    expect: true },
  { name: "Finance / PSEi Wall Street rally",
    title: "PSEi rebounds above 5,900 on Wall Street rally - Manila Standard",
    summary: "The Philippine Stock Exchange index closed higher tracking Wall Street's overnight rally.",
    expect: false },
  { name: "Real / opposition rally with police",
    title: "Opposition rally turns violent as police use tear gas",
    summary: "Riot police fired tear gas at demonstrators during an opposition rally in the capital.",
    expect: true },

  // ── Client-flagged production noise (regression) ─────────────────
  { name: "Motorsport / Taklimakan rally-raid (client-flagged)",
    title: "Taklimakan Rally 2026: GWM TANK Dominates the Unforgiving Desert - The Manila Times",
    source: "Google News — Philippines (Civil Unrest)",
    expect: false },
  { name: "Sports betting / NBA strike deal (client-flagged)",
    title: "ArenaPlus, NBA strike sports betting deal in Philippines - Philstar.com",
    source: "Google News — Philippines (Civil Unrest)",
    expect: false },
  // Feed-category poison: the source label "(Civil Unrest)" must NOT by
  // itself satisfy the public-order tier. A space-industry "rally" with no
  // real public-order cue in title/summary must be dropped even when it
  // arrives on the Civil-Unrest feed.
  { name: "Feed-category poison / space rally on Civil-Unrest feed",
    title: "Space rally gets reality check with Blue Origin blowup - The Japan Times",
    source: "Google News — Japan (Civil Unrest)",
    expect: false },
  { name: "Feed-category poison / market 'strike' on Civil-Unrest feed",
    title: "Zelensky says Russia preparing 'new massive strike' - BSS",
    source: "Google News — Bangladesh (Civil Unrest)",
    expect: false },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const c of cases) {
  const got = isTopicRelevant("flashpoint", {
    topic: "flashpoint",
    title: c.title,
    summary: c.summary ?? null,
    source: c.source ?? null,
    sourceUrl: null,
    location: null,
  });
  const ok = got === c.expect;
  if (ok) {
    passed++;
    console.log(`  ok  : ${c.name}`);
  } else {
    failed++;
    failures.push(`${c.name}\n      title : ${c.title}\n      expect: ${c.expect}, got: ${got}`);
    console.log(`  FAIL: ${c.name}  (expect=${c.expect}, got=${got})`);
  }
}

console.log("");
console.log(`Flashpoint classifier: ${passed}/${cases.length} passed, ${failed} failed`);
if (failed > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of failures) console.log("  " + f);
  process.exit(1);
}
