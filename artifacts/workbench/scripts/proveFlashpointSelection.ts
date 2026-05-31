import { selectFlashpointUsable, type FlashpointReportIncident, type FlashpointRejectStage } from "../src/lib/flashpointReportDataset";
const API="http://localhost:80";
async function f(t:string){return await (await fetch(`${API}/api/incidents?topic=${t}&limit=5000`)).json();}
const ISSUE = process.argv[2] ?? "2026-05-24";
const merged=[...(await f("flashpoint")),...(await f("protests"))];
const inp:FlashpointReportIncident[]=merged.map((r:any)=>({id:r.id,title:r.title,topic:r.topic,severity:r.severity??"Low",occurredAt:r.occurredAt??"",country:r.country,summary:r.summary,source:r.source,sourceUrl:r.sourceUrl,location:r.location??r.country}));
const sel=selectFlashpointUsable(inp,"flashpoint",ISSUE);
const REASON:Record<FlashpointRejectStage,string>={
  "off-topic":"Off-topic — failed the public-order relevance gate (sports/finance/weather/military/entertainment homonym of rally/strike, or no protest/strike/unrest signal at all).",
  "kinetic-only":"Kinetic-only — militant/terror/armed violence with no protest or public-order linkage.",
  "court-only":"Court-only — pure legal-process reporting (verdict/sentencing/plea) with no live civil-unrest hook.",
  "out-of-scope-crime":"Out-of-scope crime — armed robbery / generic crime, not activism or civil unrest.",
  "duplicate":"Duplicate — a syndicated rewrite of another kept incident (deduped so one event is not double-counted).",
  "weak-novelty":"Weak/novelty — parody, meme, satire or 'founder responds' commentary with no mobilisation signal.",
  "weak-operational":"Weak-operational — surface keyword only, no live operational signal (stock-photo caption, suspended/cancelled strike, diplomatic démarche, legislative process, legal aftermath, anticipatory/negated non-event, or a non-APAC story syndicated by an APAC outlet).",
};
let out="";
const w=(s:string)=>{out+=s+"\n";};
const window6=(()=>{const d=new Date(ISSUE+"T00:00:00Z");const s=new Date(d);s.setUTCDate(d.getUTCDate()-6);return `${s.toISOString().slice(0,10)} \u2192 ${ISSUE}`;})();
w("# Flashpoint Weekly — Selection Proof");
w(`Issue date: ${ISSUE}   |   7-day window: ${window6}`);
w(`Raw in-window records (flashpoint + protests buckets): ${sel.rawWindowCount}`);
w(`INCLUDED in report: ${sel.enriched.length}   |   REJECTED: ${sel.rejected.length}`);
w("");
w("================================================================");
w("INCLUDED — every in-scope country with genuine activity this week");
w("================================================================");
const byC:Record<string,any[]>={};
for(const u of sel.enriched)(byC[u.country??"\u2014"]??=[]).push(u);
const ranked=Object.entries(byC).sort((a,b)=>b[1].length-a[1].length);
for(const [c,rows] of ranked){
  w(`\n${c} (${rows.length})`);
  for(const r of rows.sort((a:any,b:any)=>(b.occurredAt??"").localeCompare(a.occurredAt??"")))
    w(`   \u2022 ${(r.occurredAt??"").slice(0,10)}  ${r.title}`);
}
w(`\nCountry spread (ranked): ${ranked.map(([c,r])=>`${c} ${r.length}`).join("  \u00b7  ")}`);
w("");
w("================================================================");
w("REJECTED — with reason (proof that noise was removed deliberately)");
w("================================================================");
const stages:FlashpointRejectStage[]=["off-topic","weak-operational","weak-novelty","duplicate","court-only","kinetic-only","out-of-scope-crime"];
for(const st of stages){
  const items=sel.rejected.filter(r=>r.stage===st);
  if(!items.length)continue;
  w(`\n[${st}] \u2014 ${items.length}`);
  w(`   reason: ${REASON[st]}`);
  for(const r of items.sort((a,b)=>(b.date).localeCompare(a.date)))
    w(`   \u2715 [${r.country}] ${r.date}  ${r.title}`);
}
const fs=await import("node:fs");
fs.writeFileSync("screenshots/flashpoint_selection_proof.txt",out);
console.log(out);
console.log("\n\nWROTE screenshots/flashpoint_selection_proof.txt");
