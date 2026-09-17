const fs = require('fs');
const file = 'artifacts/workbench/src/lib/regionalWeekly.ts';
let code = fs.readFileSync(file, 'utf8');

// Replace COUNTRY_FLAGS emoji with ISO codes
const flagsCode = `const COUNTRY_FLAGS: Record<string, string> = {
  "Australia": "au", "Bangladesh": "bd", "Bhutan": "bt", "Brunei": "bn",
  "Cambodia": "kh", "China": "cn", "Fiji": "fj", "Hong Kong": "hk",
  "India": "in", "Indonesia": "id", "Japan": "jp", "Kiribati": "ki",
  "Laos": "la", "Malaysia": "my", "Maldives": "mv", "Marshall Islands": "mh",
  "Micronesia": "fm", "Mongolia": "mn", "Myanmar": "mm", "Nauru": "nr",
  "Nepal": "np", "New Zealand": "nz", "North Korea": "kp", "Pakistan": "pk",
  "Palau": "pw", "Papua New Guinea": "pg", "Philippines": "ph", "Samoa": "ws",
  "Singapore": "sg", "Solomon Islands": "sb", "South Korea": "kr", "Sri Lanka": "lk",
  "Taiwan": "tw", "Thailand": "th", "Timor-Leste": "tl", "Tonga": "to",
  "Tuvalu": "tv", "Vanuatu": "vu", "Vietnam": "vn"
};`;

code = code.replace(/const COUNTRY_FLAGS: Record<string, string> = \{[\s\S]*?\};/, flagsCode);

// Add clipTitleToMeaningfulWords
const newClipFunc = `
export function clipTitleToMeaningfulWords(text: string, maxWords: number = 6): string {
  const clean = text.replace(/^[A-Za-z]+'s\\s+/, "").replace(/\\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  if (words.length <= maxWords) return clean;
  // No ellipsis, just truncate to words and strip trailing punctuation
  return words.slice(0, maxWords).join(" ").replace(/[,:;.\\!?]+$/, "");
}
`;
code = code.replace(/export function buildApacMapItems/, newClipFunc + '\nexport function buildApacMapItems');

// Update usage in buildApacMapItems
code = code.replace(/const label = clipRegionalWords\(cleanTitle, 5\)\.replace\(\/\^\[A-Za-z\]\+'s\\s\+\/\, ""\);/, 'const label = clipTitleToMeaningfulWords(cleanTitle, 5);');

fs.writeFileSync(file, code);
