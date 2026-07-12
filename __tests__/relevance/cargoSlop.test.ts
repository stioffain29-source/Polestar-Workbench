import { explainRelevance, matchCargoSlop } from "@workspace/relevance";

// Cargo Watch is a feed of concrete APAC / Middle-East cargo-crime EVENTS, not
// a feed of US / UK trade-press commentary, legislation, statistics, webinars,
// vendor marketing or out-of-region incidents that merely say "cargo theft".
// The shared cargo-slop detector drops that framing on BOTH the ingest
// relevance gate (below) and the frontend scope classifier.

const cargo = (title: string) =>
  explainRelevance("cargo_watch", { topic: "cargo_watch", title });

describe("cargo slop detector — trade-press commentary / non-incidents are flagged", () => {
  const SLOP = [
    // Economic-impact commentary.
    "Cargo Theft Costs Trucking $18M Daily",
    "Cargo theft costs everyone, including consumers",
    "Is cargo theft costing $60 billion annually? What that number actually represents",
    "Highway robbery: 'Skyrocketing' cargo theft costs $35 billion a year",
    "Heists and Hijackings: How rampant cargo theft is costing America's supply chain billions",
    "Geotab: Cargo theft firmly in the cyber era as losses exceed $6B",
    // Statistics / trend / landscape.
    "Cargo Theft Up 17 Percent in 2025",
    "Losses Jump 60% as cargo theft surges",
    "2024 a Record Year for Cargo Theft",
    "Cargo Theft Numbers Show Downward Trend",
    "Elevated Cargo Theft Landscape Settles Into New Normal",
    // Legislation / hearings / government process.
    "SAFER Transport Act takes aim at cargo theft",
    "ATA-backed cargo theft bill advances in the House",
    "Federal lawmakers target rising cargo theft across the supply chain",
    "Hearing on cargo theft airs on C-SPAN",
    "New Cargo Theft Database Goes Live",
    "DOT seeks input on cargo theft crackdown",
    // Explainer / how-to / opinion / conference collateral.
    "Why cargo theft is exploding across the country",
    "How fleets can protect freight for the July 4 weekend",
    "How to mitigate and respond to cargo theft",
    "LPM Webinar now on-demand: cargo theft trends",
    "Beyond the breach: inside a cargo theft actor's post-compromise playbook",
    "Proofpoint tracks cargo theft gang's post-breach tactics",
    // Advisory / warning / vendor-trend marketing.
    "Rising Cargo Theft Puts Healthcare Shipments Under Pressure",
    "Strategic cargo theft leaves drivers, brokers liable",
    "Red flags raised over growing cargo theft and freight fraud",
    "Major organizations warn of rise in cargo theft",
    "Rising cargo theft and fraud necessitate proactive shipping risk management",
    "Landstar tackles cargo theft, fraud with AI and a specialized department",
    "C.H. Robinson strengthens anti-cargo theft strategy",
    "Matson responds to growing cargo theft in intermodal shipments",
    "Ceva Logistics loses high-value shipments amid rise in cargo theft",
    // Cyber / AI trend commentary.
    "AI Contributes to Surge in Cargo Theft and Freight Fraud",
    "AI Drives New Wave of Cargo Theft",
    "NMFTA warns of surge and sophistication of cyber-enabled cargo theft",
    // Out-of-region / US identifiers.
    "Inside a $400,000 Lobster Cargo Theft and What It Signals for Supply Chain Risk",
    "Cargo Theft in Latin America: A Persistent Threat",
    "LAPD recovers nearly $4 million in stolen freight",
    "Police recover over $5 million in goods from SoCal cargo theft ring",
    "L.A. hardware store was a front for a $4.5-million cargo theft ring",
  ];

  it.each(SLOP)("flags and drops slop: %s", (title) => {
    expect(matchCargoSlop(title)).not.toBeNull();
    expect(cargo(title).relevant).toBe(false);
  });
});

describe("cargo slop detector — genuine in-region incidents are never flagged", () => {
  // These carry a loss/value figure or a place name but NO cost/statistics/
  // legislation/explainer framing, so the precision-first detector leaves them
  // alone. Contraband customs seizures stay neutral (not slop, not promoted).
  const KEEP = [
    "Repeat thief in Tuban arrested after warehouse break-in",
    "Singkawang police arrest syndicate for motorcycle and furniture warehouse theft",
    "Soetta Airport police arrest repeat cargo theft offender",
    "Five suspects of container truck robbery on Pemalang Ring Road arrested, loss of Rp1.8 billion",
    "Moments of the hijacking of the cigarette truck worth IDR 3.1 billion",
    "Madiun police examine witnesses in Rp3.1 billion cigarette truck robbery",
    "Warehouse theft worth $80,000 reported in Beirut, Lebanon",
    "Cargo theft ring busted in Shanghai, China",
    "Cargo theft at Busan port, South Korea",
    "Customs seizes smuggled cigarettes in Fo Tan warehouse raid",
    "Cargo theft surges amid new tariff regime at Jebel Ali",
    "Cargo theft probe at Port Klang amid record throughput",
    // Local-currency per-incident loss figures — the "$"-gated loss-aggregate
    // line must NOT treat "Losses Reach Rp/IDR X Million" as industry commentary.
    "Kendari Police Reveal Theft at PT Indomarco Prismatama Warehouse; Losses Reach IDR 23 Million",
    "Satreskrim Polresta Kendari Reveals Theft at PT Indomarco Prismatama Warehouse, Losses Reach Rp23 Million",
    "Candidate KDMP warehouse in Gunungkidul broken into, losses reach IDR 17.5 million",
    "Staple Food Warehouse Theft in Selomerto Wonosobo Uncovered, Losses Reach Rp526 Million",
    // A local police task force making arrests in a real hijacking — not a
    // named US "Cargo Theft Task Force" commentary piece.
    "Combined Aceh police task force arrests three suspects for box truck hijacking",
    // In-region rows whose SUMMARY may name an official but carry no cargo
    // legislative framing — the gated legislative line must leave them alone.
    "FIA to probe agency raid on jewellery shop in Karachi's Sarafa Bazaar",
    "Civil servants' asset declarations to be made public in redacted form, says govt",
    // "L.A." embedded in a dotted abbreviation must NOT trip the standalone
    // Los-Angeles token — India (M.L.A.) is the top in-region cargo source.
    "M.L.A. demands probe into truck hijacking in Ludhiana",
    "P.L.A. convoy movement reported near Ladakh cargo depot",
  ];

  it.each(KEEP)("does not flag: %s", (title) => {
    expect(matchCargoSlop(title)).toBeNull();
  });
});
