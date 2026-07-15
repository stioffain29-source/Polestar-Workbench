import { pool } from "@workspace/db";
import { explainRelevance } from "../../lib/relevance/src/index.ts";

const { rows } = await pool.query(
  `SELECT title, summary, source, location, occurred_at::date AS d
   FROM incidents
   WHERE topic='conflict'
     AND (relevance_status='relevant' OR relevance_status IS NULL)
     AND occurred_at >= now() - interval '2 years'`,
);

const kept: any[] = [];
const dropped: any[] = [];
for (const r of rows) {
  const res = explainRelevance("conflict", {
    topic: "conflict",
    title: r.title,
    summary: r.summary,
    source: r.source,
    location: r.location,
  });
  (res.relevant ? kept : dropped).push({ ...r, reason: res.reason });
}

console.log(
  `DB relevant/NULL in 2y: ${rows.length} | engine KEEPS ${kept.length} | engine DROPS ${dropped.length}`,
);

const BUCKETS: [string, RegExp][] = [
  ["peace-talks/dialogue", /\b(peace talk|peace process|ceasefire|cease-fire|dialogue|negotiat|repatriat|reconcil|disarm|surrender talks|talks with|talks on|hold talks|for talks|proposes? .*talks)\b/i],
  ["diplomacy/envoy", /\b(envoy|diplomat|bilateral|delegation|summit|foreign minister|to visit|state visit|urges? .*to act|manoeuvr|maneuver)\b/i],
  ["court/legal", /\b(court|high court|supreme court|verdict|bail|sentenc|convict|acquit|hearing|tribunal|dismissal|petition|terror-funding|terror funding|testimony)\b/i],
  ["explainer/encyclopedia", /\b(explained|explainer| \| .*(ideology|leader|funding|history)|what is |who are |timeline|factbox|profile of)\b/i],
  ["opinion/analysis", /\b(opinion|editorial|column|commentary|analysis|perspective|viewpoint|experts see|think tank|op-ed)\b/i],
  ["culture/media", /\b(film|movie|book|novel|documentary|series|song|music|festival|exhibition|denies|denial|citing)\b/i],
  ["election/politics", /\b(election|poll|ballot|campaign|manifesto|sworn in|cabinet|by-election)\b/i],
  ["relief/aid", /\b(relief|humanitarian aid|rehabilitat|resettle|livelihood|donat|scholarship)\b/i],
];

const KINETIC = /\b(kill|killed|dead|ambush|gun ?battle|gunfight|firefight|shoot|shot|clash|attack|raid|blast|bomb|grenade|shell|airstrike|air strike|drone strike|missile|encounter|abduct|kidnap|massacre|casualt|wounded|injured|siege|stormed|open(ed)? fire|explosion|ied|landmine|beheaded|torched|arson)\b/i;

const flagged: Record<string, any[]> = {};
for (const k of kept) {
  const hay = `${k.title} ${k.summary ?? ""}`;
  if (KINETIC.test(hay)) continue; // has a kinetic cue → likely a real event, skip
  for (const [name, re] of BUCKETS) {
    if (re.test(hay)) {
      (flagged[name] ??= []).push(k);
      break;
    }
  }
}

console.log(`\n=== KEPT rows with NO kinetic cue, matching a junk bucket ===`);
let total = 0;
for (const [name, arr] of Object.entries(flagged)) {
  console.log(`\n## ${name} (${arr.length})`);
  total += arr.length;
  for (const r of arr.slice(0, 40)) console.log(`  [${r.d}] ${String(r.title).slice(0, 96)}`);
}
console.log(`\nTOTAL flagged non-kinetic junk still KEPT by engine: ${total}`);

// also: kept rows with NO kinetic cue and NO junk bucket (the grey zone)
const greyNoKinetic = kept.filter((k) => {
  const hay = `${k.title} ${k.summary ?? ""}`;
  if (KINETIC.test(hay)) return false;
  return !BUCKETS.some(([, re]) => re.test(hay));
});
console.log(`\n=== KEPT, NO kinetic cue, NO junk bucket (grey zone) : ${greyNoKinetic.length} ===`);
for (const r of greyNoKinetic.slice(0, 60)) console.log(`  [${r.d}] ${String(r.title).slice(0, 96)}`);

await pool.end();
