import { readFileSync } from "fs";
import { isCountryRelevant } from "./lib/relevance/src/topicRelevance";
import {
  acceptedCountryTokens,
  incidentMatchesCountry,
  isCrossBorderPapuaPng,
  isIndonesianWestPapuaContext,
  isPapuaNewGuineaDominantContext,
  isForeignDominantContext,
} from "./artifacts/workbench/src/lib/countryMatch";

type Row = {
  id: string; topic: string; title: string; display_title: string | null;
  summary: string | null; source: string | null; sourceUrl: string | null;
  location: string | null; country: string; occurred: string; rel: string;
};
const rows: Row[] = JSON.parse(readFileSync("/tmp/papua_png_rows.json", "utf8"));

function pipeline(name: string) {
  const tokens = acceptedCountryTokens(name);
  const isPng = tokens.includes("papua new guinea");
  const isPapua = !isPng && tokens.includes("papua");
  const stripped: { stage: string; t: string }[] = [];
  const matched = rows.filter((i) => {
    if (!incidentMatchesCountry(i.country, name)) return false;
    const text = `${i.title ?? ""} ${i.summary ?? ""} ${i.source ?? ""} ${(i.sourceUrl ?? "").replace(/[-_/]/g, " ")}`;
    if (isPng && !isCrossBorderPapuaPng(i.country) && isIndonesianWestPapuaContext(text)) {
      stripped.push({ stage: "WP-strip", t: i.title }); return false;
    }
    if (isPapua && !isCrossBorderPapuaPng(i.country) && isPapuaNewGuineaDominantContext(text)) {
      stripped.push({ stage: "PNG-strip", t: i.title }); return false;
    }
    if (isForeignDominantContext(i.title, text, i.country, name)) {
      stripped.push({ stage: "foreign", t: i.title }); return false;
    }
    return true;
  });
  const relevant = matched.filter((i) => isCountryRelevant({
    topic: i.topic, title: i.title, summary: i.summary ?? null,
    source: i.source ?? null, sourceUrl: i.sourceUrl ?? null, location: i.location ?? null,
  }));
  const total = rows.filter((i) => incidentMatchesCountry(i.country, name)).length;
  console.log(`\n===== ${name} =====`);
  console.log(`country-matched=${total}  after-strips=${matched.length}  after-isCountryRelevant=${relevant.length}`);
  console.log(`stripped by disambiguation/foreign guards: ${stripped.length}`);
  for (const s of stripped) console.log(`  [${s.stage}] ${s.t.slice(0,72)}`);
}

pipeline("Papua New Guinea");
pipeline("Papua");
