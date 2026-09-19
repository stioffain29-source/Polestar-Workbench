import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/auditRegionalProductionOutput.ts <extracted-text>");
const text = readFileSync(path, "utf8");
const section = (start: string, end: string) =>
  (text.split(start)[1] ?? "").split(end)[0] ?? "";
const words = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
const outlook = section("REGIONAL OUTLOOK", "REGIONAL RISK MAP");
const risk = section("REGIONAL RISK PICTURE", "KEY DEVELOPMENTS");
const implicationsAfterHeading = text.split("BUSINESS IMPLICATIONS")[1] ?? "";
const implications = implicationsAfterHeading.split(/7 DAY WATCH|POLESTAR OUTLOOK/)[0] ?? "";
const finalOutlook = section("POLESTAR OUTLOOK", "DISCLAIMER");
const developmentBlock = section("KEY DEVELOPMENTS", "7 DAY WATCH");
const developmentTitles = developmentBlock.match(/^\s+[A-Za-z][A-Za-z .'-]+ \| .+$/gm) ?? [];
const developments = developmentTitles.length;
const titleWords = developmentTitles.map((line) => line.split("|")[1]?.trim().split(/\s+/).length ?? 0);
const normalizedTitles = new Set(developmentTitles.map((line) => line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
const sentences = text.split(/(?<=[.!?])\s+/).map((value) => value.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()).filter((value) => value.length > 70);
const sentenceCounts = new Map<string, number>();
for (const sentence of sentences) sentenceCounts.set(sentence, (sentenceCounts.get(sentence) ?? 0) + 1);
const repeatedSentences = [...sentenceCounts.values()].some((count) => count > 1);
const indicators = (finalOutlook.match(/(?:track|watch|confirm|monitor)[^.]{20,120}/gi) ?? []).map((value) => value.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim());
const banned = /This week's .* assessment is defined by|most material changes were|Business Insider|https?:\/\/|www\.|\.{2,}|…|World's 9th strongest|The position should be reviewed against confirmed operating evidence|The assessment should be revised when recovery|Dawn|ua\.news|Reuters|Straits Times|thepamphlet|fuel\.com|Mandaue traffic enforcement|illegal drag racing|Operators should assess the named|The operational priority is to confirm|The next decision point is whether|in Australia, the test is whether security pressure changes route or facility access/i;
const checks = [
  ["section names", ["REGIONAL OUTLOOK", "REGIONAL RISK PICTURE", "KEY DEVELOPMENTS", "BUSINESS IMPLICATIONS", "POLESTAR OUTLOOK"].every((name) => text.includes(name))],
  ["regional outlook 250-300 words", words(outlook) >= 250 && words(outlook) <= 300],
  ["risk picture 300-400 words", words(risk) >= 300 && words(risk) <= 400],
  ["business implications 180-220 words", words(implications) >= 180 && words(implications) <= 220],
  ["Polestar Outlook 150-200 words", words(finalOutlook) >= 150 && words(finalOutlook) <= 200],
  ["maximum four developments", developments <= 4],
  ["development titles are unique and <=10 words", normalizedTitles.size === developments && titleWords.every((count) => count <= 10)],
  ["no duplicate sentences across output", !repeatedSentences],
  ["no repeated forward indicators", new Set(indicators).size === indicators.length],
  ["development country/title consistency", developmentTitles.every((line) => line.includes("|") && !/\b(?:Iran \| Oman|Oman \| Iran)\b/i.test(line))],
  ["map labels use intelligence titles", !/SAUDI ARABIA HALTS YANBU PORT|WORLD'S 9TH STRONGEST/i.test(text)],
  ["region-bound country consistency", !/POLESTAR APAC WEEKLY/i.test(text) || !/\bOman\b/.test(developmentBlock)],
  ["final chart/map labels are selected development labels", !/REGIONAL RISK MAP[\s\S]*\b(?:Mandaue|drag racing|Kuwait Airport T4)\b/i.test(text)],
  ["category-specific outlook is data-derived", !/(?:Pakistan:\s*staff-safety|Australia:\s*visa eligibility|India:\s*export-levy)/i.test(finalOutlook)],
  ["development fields are event-specific", !/Operators should assess the named|The operational priority is to confirm|The next decision point is whether/i.test(text) && !/This is a decision-relevant exposure, not a regional risk conclusion/i.test(text)],
  ["banned phrases/source leakage/ellipsis absent", !banned.test(text)],
];
for (const [label, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
if (checks.some(([, pass]) => !pass)) process.exit(1);