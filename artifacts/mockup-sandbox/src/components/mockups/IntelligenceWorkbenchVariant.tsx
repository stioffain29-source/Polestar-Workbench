import { useState } from "react";
import {
  Activity, Bell, ChevronDown, CircleAlert, Clock3, Database,
  FileText, Flag, Layers3, Map, Search, Settings2, ShieldAlert,
  Ship, SlidersHorizontal, Sparkles, Target, Zap,
} from "lucide-react";

const nav = [
  { label: "Overview", icon: Activity, active: true },
  { label: "Live map", icon: Map },
  { label: "Incidents", icon: CircleAlert, count: "12" },
  { label: "Timeline", icon: Clock3 },
];
const topics = [
  { label: "Conflict watch", icon: ShieldAlert, tone: "red" },
  { label: "Shipping watch", icon: Ship, tone: "amber" },
  { label: "Energy watch", icon: Zap, tone: "cyan" },
];
const incidents = [
  { time: "14:32", title: "Port closure reported after overnight strike", place: "Al Hudaydah · Yemen", level: "HIGH", tone: "red", source: "Reuters" },
  { time: "13:48", title: "Fuel tanker traffic slows through the Bab el-Mandeb", place: "Red Sea · Maritime", level: "ELEVATED", tone: "amber", source: "AIS / MarineTraffic" },
  { time: "12:16", title: "Power network damage confirmed near industrial zone", place: "Basra · Iraq", level: "WATCH", tone: "blue", source: "Local authority" },
  { time: "11:04", title: "New airspace restriction affects three commercial routes", place: "Gulf region · Aviation", level: "WATCH", tone: "blue", source: "NOTAM" },
];

export default function IntelligenceWorkbenchVariant() {
  const [activeTab, setActiveTab] = useState("All signals");
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = incidents.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  return (
    <div style={{ minHeight: "100vh", background: "#f4f5f7", color: "#202530", fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif", fontSize: 13 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing:border-box } button,input { font:inherit } button { cursor:pointer }
        .iw-hover:hover { background:#f1f3f7 !important; color:#263d68 !important }
        .iw-row:hover { background:#fafbfd }
        @media(max-width:760px){ .iw-sidebar{display:none!important}.iw-main{padding:18px!important}.iw-grid{grid-template-columns:1fr!important}.iw-kpis{grid-template-columns:repeat(2,1fr)!important}.iw-hide-sm{display:none!important} }
      `}</style>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside className="iw-sidebar" style={{ width: 220, background: "#162039", color: "#d9dfeb", padding: "22px 12px", flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "0 10px 24px", borderBottom: "1px solid #2c3852" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: "#5b76e8", display: "grid", placeItems: "center", color: "white" }}><Target size={16} /></div>
              <div style={{ color: "#fff", fontSize: 14, fontWeight: 700, letterSpacing: ".03em" }}>POLESTAR</div>
            </div>
            <div style={{ marginTop: 12, color: "#8895b1", fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase" }}>Advisory workbench</div>
          </div>
          <div style={{ padding: "24px 0 10px", color: "#8290ab", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", paddingLeft: 12 }}>Workspace</div>
          {nav.map((item) => <NavItem key={item.label} {...item} />)}
          <div style={{ padding: "25px 12px 10px", color: "#8290ab", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>Watchlists</div>
          {topics.map((item) => <NavItem key={item.label} {...item} />)}
          <div style={{ marginTop: "auto", borderTop: "1px solid #2c3852", padding: "16px 10px 0", display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 7, height: 7, background: "#53c49a", borderRadius: "50%", boxShadow: "0 0 0 4px #53c49a22" }} />
            <span style={{ color: "#96a2ba", fontSize: 11 }}>All systems operational</span>
          </div>
        </aside>
        <main className="iw-main" style={{ flex: 1, minWidth: 0, padding: "26px 32px 40px", maxWidth: 1320, margin: "0 auto" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 29 }}>
            <div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#718096", letterSpacing: ".12em", textTransform: "uppercase" }}>Monday · 06 July 2026 · 14:40 UTC</div>
              <h1 style={{ margin: "7px 0 0", fontSize: 27, letterSpacing: "-.04em", lineHeight: 1.05, fontWeight: 700 }}>Situation overview</h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label className="iw-hide-sm" style={{ width: 200, position: "relative" }}>
                <Search size={15} color="#8791a2" style={{ position: "absolute", top: 10, left: 11 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search signals" style={{ width: "100%", height: 35, border: "1px solid #d9dee7", borderRadius: 6, padding: "0 10px 0 32px", outline: "none", background: "#fff", color: "#273043" }} />
              </label>
              <button aria-label="Notifications" className="iw-hover" style={{ width: 35, height: 35, background: "#fff", border: "1px solid #d9dee7", borderRadius: 6, display: "grid", placeItems: "center", color: "#5b6679" }}><Bell size={15} /></button>
              <div style={{ width: 31, height: 31, borderRadius: "50%", background: "#d9e0f2", color: "#34466f", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>AR</div>
            </div>
          </header>

          <section className="iw-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 25 }}>
            <Kpi label="Active signals" value="38" detail="+6 since 08:00" accent="#5b76e8" />
            <Kpi label="High priority" value="07" detail="2 new in last hour" accent="#d75a5a" />
            <Kpi label="Countries in focus" value="12" detail="Across 4 theatres" accent="#d49a46" />
            <Kpi label="Sources online" value="94.2%" detail="1 degraded feed" accent="#48a987" />
          </section>

          <div className="iw-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(270px,.8fr)", gap: 18 }}>
            <section style={{ background: "#fff", border: "1px solid #e0e4eb", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "17px 19px 14px", borderBottom: "1px solid #e7eaf0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div><div style={{ fontWeight: 700, fontSize: 15 }}>Signal feed</div><div style={{ color: "#8791a2", fontSize: 11, marginTop: 4 }}>Corroborated developments, newest first</div></div>
                <button onClick={() => setSaved(!saved)} className="iw-hover" style={{ color: saved ? "#5b76e8" : "#7a8495", background: "transparent", border: "1px solid #e0e4eb", borderRadius: 5, padding: "7px 9px", display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}><SlidersHorizontal size={13} /> Filters <ChevronDown size={12} /></button>
              </div>
              <div style={{ display: "flex", gap: 4, padding: "12px 16px 4px" }}>
                {["All signals", "High priority", "Shipping"].map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} style={{ border: 0, borderBottom: activeTab === tab ? "2px solid #5b76e8" : "2px solid transparent", background: "transparent", color: activeTab === tab ? "#304d9d" : "#7e8999", padding: "5px 8px 8px", fontSize: 11, fontWeight: activeTab === tab ? 700 : 500 }}>{tab}</button>)}
              </div>
              {filtered.map((item) => <div className="iw-row" key={item.time} style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: 13, padding: "16px 19px", borderTop: "1px solid #eef0f4" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#8a94a6", paddingTop: 3 }}>{item.time}</div>
                <div><div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, color: "#283140" }}>{item.title}</div><div style={{ display: "flex", gap: 10, color: "#8a94a6", marginTop: 7, fontSize: 11 }}><span>{item.place}</span><span>•</span><span>{item.source}</span></div></div>
                <span style={{ alignSelf: "start", fontSize: 9, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: tone(item.tone), background: `${tone(item.tone)}14`, padding: "4px 6px", borderRadius: 3 }}>{item.level}</span>
              </div>)}
              <button onClick={() => setQuery("")} style={{ width: "100%", background: "#fafbfd", border: 0, borderTop: "1px solid #eef0f4", color: "#5b76e8", fontSize: 11, fontWeight: 600, padding: 13 }}>View full signal register →</button>
            </section>
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <section style={{ background: "#18223a", color: "#e9edf6", borderRadius: 8, padding: 19, minHeight: 224 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ color: "#9ba8c2", fontSize: 10, textTransform: "uppercase", letterSpacing: ".13em" }}>Theatre pressure</div><Sparkles size={15} color="#8ca5ff" /></div>
                <div style={{ marginTop: 17, fontSize: 28, fontWeight: 700, letterSpacing: "-.04em" }}>Elevated</div>
                <div style={{ marginTop: 5, fontSize: 11, color: "#aeb8cb" }}>Red Sea · Gulf corridor</div>
                <div style={{ marginTop: 25, height: 5, background: "#35405a", borderRadius: 5, overflow: "hidden" }}><div style={{ width: "72%", height: "100%", background: "#d49a46", borderRadius: 5 }} /></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "#9ba8c2", fontSize: 10 }}><span>Baseline</span><span>72 / 100</span></div>
              </section>
              <section style={{ background: "#fff", border: "1px solid #e0e4eb", borderRadius: 8, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}><div style={{ fontWeight: 700, fontSize: 14 }}>Briefing queue</div><FileText size={15} color="#778397" /></div>
                {[["Gulf shipping outlook", "Draft · due 16:00"], ["Daily risk digest", "Ready for review"], ["Maritime watch", "Published 12:10"]].map(([name, status]) => <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #edf0f4", padding: "11px 0", fontSize: 11 }}><span style={{ fontWeight: 600 }}>{name}</span><span style={{ color: status.startsWith("Ready") ? "#4a9b7b" : "#8993a3", whiteSpace: "nowrap" }}>{status}</span></div>)}
              </section>
            </div>
          </div>
          <div style={{ marginTop: 24, display: "flex", gap: 10, color: "#8892a2", fontSize: 10, alignItems: "center" }}><Database size={13} /> Data refreshed 2 min ago <span style={{ color: "#c9ced7" }}>·</span> <Settings2 size={13} /> Workspace settings <span style={{ marginLeft: "auto", fontFamily: "'Space Mono', monospace" }}>POL-OPS / 06JUL26</span></div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ label, icon: Icon, active, count, tone }: { label: string; icon: typeof Activity; active?: boolean; count?: string; tone?: string }) {
  return <button className="iw-hover" style={{ width: "100%", border: 0, background: active ? "#293653" : "transparent", color: active ? "#fff" : "#a7b1c5", borderRadius: 6, display: "flex", alignItems: "center", gap: 11, padding: "10px 12px", textAlign: "left", marginBottom: 2, fontSize: 12, position: "relative" }}><Icon size={15} color={active ? "#8da5ff" : tone === "red" ? "#d87575" : tone === "amber" ? "#dcb06a" : tone === "cyan" ? "#6bc6cf" : "currentColor"} /><span>{label}</span>{count && <span style={{ marginLeft: "auto", color: "#92a0bc", fontFamily: "'Space Mono', monospace", fontSize: 10 }}>{count}</span>}</button>;
}
function Kpi({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return <div style={{ background: "#fff", border: "1px solid #e0e4eb", borderRadius: 8, padding: "15px 17px", borderTop: `3px solid ${accent}` }}><div style={{ color: "#818b9d", fontSize: 10, textTransform: "uppercase", letterSpacing: ".1em" }}>{label}</div><div style={{ marginTop: 8, fontFamily: "'Space Mono', monospace", fontSize: 25, color: "#273143", letterSpacing: "-.05em" }}>{value}</div><div style={{ color: "#8a94a3", fontSize: 10, marginTop: 5 }}>{detail}</div></div>;
}
function tone(value: string) { return value === "red" ? "#c45656" : value === "amber" ? "#b87c29" : "#4e6fc8"; }