// TEMPORARY M1 proof script — delete after milestone confirmation.
// Fetches local-language cargo-crime feeds, translates + screens each item via the
// Replit OpenAI integration, and prints KEEP vs SLOP so we can judge value before
// touching the real ingest pipeline.

const BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!BASE || !KEY) {
  console.error("Missing AI integration env vars; BASE set:", !!BASE, "KEY set:", !!KEY);
  process.exit(1);
}

const mkurl = (q: string, hl: string, gl: string, ceid: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;

type Item = { title: string; link: string; desc: string };
function parseItems(xml: string): Item[] {
  const out: Item[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  const grab = (b: string, tag: string) => {
    const r = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const x = r.exec(b);
    return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, "") : "";
  };
  const unesc = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  while ((m = re.exec(xml))) {
    const b = m[1];
    const title = unesc(grab(b, "title")).trim();
    const link = grab(b, "link").trim();
    const desc = unesc(grab(b, "description").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    out.push({ title, link, desc });
  }
  return out;
}

const FEEDS = [
  {
    lang: "Indonesian",
    url: mkurl(
      `("pencurian kargo" OR "pembajakan truk" OR "perampokan truk" OR "pencurian gudang" OR "pencurian kontainer" OR "pembobolan gudang")`,
      "id", "ID", "ID:id",
    ),
  },
  {
    lang: "Arabic/Gulf",
    url: mkurl(`("سرقة شحنة" OR "سرقة بضائع" OR "سرقة مستودع" OR "سطو على شاحنة")`, "ar", "AE", "AE:ar"),
  },
  {
    lang: "Thai",
    url: mkurl(`("ขโมยสินค้า" OR "ปล้นรถบรรทุก" OR "โจรกรรมสินค้า")`, "th", "TH", "TH:th"),
  },
];

const SYS = `You screen foreign-language news items for a CARGO-CRIME intelligence feed covering ONLY the Asia-Pacific and Middle East regions.
Return STRICT JSON: {"inScope":boolean,"titleEn":string,"summaryEn":string,"country":string|null,"city":string|null,"reason":string}.
KEEP (inScope=true) ONLY a concrete, real-world cargo/freight/logistics theft incident: truck/lorry hijacking or robbery, warehouse/depot break-in, container or shipment theft, freight/cargo pilferage — that occurred in an Asia-Pacific or Middle East country.
REJECT (inScope=false, slop) ALL of: opinion/analysis/commentary/statistics/"rising theft" think-pieces; product/insurance/webinar/press-release marketing; incidents OUTSIDE APAC/Middle East (US, Latin America, Europe, Africa); NON-cargo theft (utility/fuel-line/electricity/water/ration-PDS/coal/data/identity/shoplifting/retail-store theft, pickpocketing); generic crime with no cargo/freight/warehouse target.
country = canonical English country name of the incident location, or null if unclear. city = English city/place name or null. Translate titleEn/summaryEn faithfully to English. reason = <=12 words why kept/rejected.`;

type Verdict = {
  inScope?: boolean;
  titleEn?: string;
  summaryEn?: string;
  country?: string | null;
  city?: string | null;
  reason?: string;
  error?: string;
};

async function screen(it: Item): Promise<Verdict> {
  const body = {
    model: "gpt-5-mini",
    max_completion_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: `TITLE: ${it.title}\nSUMMARY: ${it.desc || "(none)"}` },
    ],
  };
  for (let a = 0; a < 4; a++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 30000);
      const r = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      }).finally(() => clearTimeout(t));
      if (r.status === 429) {
        await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
        continue;
      }
      const j: any = await r.json();
      const c = j.choices?.[0]?.message?.content;
      if (!c) throw new Error("no content: " + JSON.stringify(j).slice(0, 200));
      return JSON.parse(c) as Verdict;
    } catch (e: any) {
      if (a === 3) return { error: e.message };
      await new Promise((s) => setTimeout(s, 1200 * (a + 1)));
    }
  }
  return { error: "exhausted" };
}

async function pool<T, R>(arr: T[], fn: (x: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(arr.length);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      out[k] = await fn(arr[k]);
    }
  }
  await Promise.all(Array.from({ length: n }, w));
  return out;
}

const SAMPLE = 12;

(async () => {
  const only = process.argv[2]?.toLowerCase();
  const feeds = only ? FEEDS.filter((f) => f.lang.toLowerCase().includes(only)) : FEEDS;
  let totalKeep = 0;
  let totalSlop = 0;
  for (const f of feeds) {
    const r = await fetch(f.url, { headers: { "user-agent": "Mozilla/5.0" } });
    const its = parseItems(await r.text()).slice(0, SAMPLE);
    const res = await pool(its, screen, 4);
    const keeps = res.filter((v) => v.inScope && !v.error);
    const slop = res.filter((v) => !v.inScope && !v.error);
    const errs = res.filter((v) => v.error);
    totalKeep += keeps.length;
    totalSlop += slop.length;

    console.log(`\n${"=".repeat(70)}\n${f.lang}  —  sample ${its.length}   KEEP ${keeps.length}   SLOP ${slop.length}   ERR ${errs.length}\n${"=".repeat(70)}`);
    console.log(`\n  KEPT (genuine in-scope cargo incidents):`);
    if (!keeps.length) console.log("    (none)");
    res.forEach((v) => {
      if (v.inScope && !v.error) {
        console.log(`    • [${v.country ?? "?"}${v.city ? "/" + v.city : ""}] ${v.titleEn}`);
        console.log(`        ↳ ${v.reason}`);
      }
    });
    console.log(`\n  DROPPED AS SLOP:`);
    res.forEach((v, i) => {
      if (!v.inScope && !v.error) {
        console.log(`    ✗ "${its[i].title.slice(0, 70)}"  →  ${v.reason}`);
      }
    });
    if (errs.length) console.log(`\n  (${errs.length} errors: ${errs.map((e) => e.error).join("; ").slice(0, 200)})`);
  }
  console.log(`\n${"#".repeat(70)}\nTOTAL across 3 feeds (sample ${SAMPLE} each): KEEP ${totalKeep}  SLOP ${totalSlop}\n${"#".repeat(70)}`);
})();
