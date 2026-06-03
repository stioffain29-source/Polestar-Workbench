import Parser from "rss-parser";
(async () => {
const p = new Parser({ timeout: 15000 });
const queries: [string,string][] = [
  ["PNG all when:10d", "https://news.google.com/rss/search?q=%22Papua+New+Guinea%22+when:10d&hl=en-PG&gl=PG&ceid=PG:en"],
  ["Port Moresby when:10d", "https://news.google.com/rss/search?q=%22Port+Moresby%22+when:10d&hl=en-PG&gl=PG&ceid=PG:en"],
  ["PNG security when:14d", "https://news.google.com/rss/search?q=%22Papua+New+Guinea%22+(tribal+OR+highlands+OR+killed+OR+police+OR+violence+OR+stabbed+OR+robbery+OR+shooting)+when:14d&hl=en-PG&gl=PG&ceid=PG:en"],
  ["Post-Courier", "https://www.postcourier.com.pg/feed/"],
  ["RNZ Pacific", "https://www.rnz.co.nz/rss/pacific.xml"],
];
const now = Date.now();
for (const [label,url] of queries) {
  try {
    const f = await p.parseURL(url);
    const recent = (f.items||[]).filter(i=>{
      const t = i.isoDate?Date.parse(i.isoDate):(i.pubDate?Date.parse(i.pubDate):NaN);
      return !isNaN(t) && (now-t) < 15*864e5;
    });
    console.log(`\n### ${label} — ${recent.length}/${f.items?.length||0} recent`);
    for (const i of recent.slice(0,16)) {
      const d = (i.isoDate||i.pubDate||"").slice(0,10);
      console.log(`  ${d}  ${(i.title||"").slice(0,94)}`);
    }
  } catch(e:any){ console.log(`\n### ${label} ERROR ${e.message}`); }
}
})();
