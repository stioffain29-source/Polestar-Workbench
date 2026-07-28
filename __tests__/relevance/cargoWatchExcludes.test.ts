// Regression pins for the cargo_watch exclude stack, modelled on
// flashpointTitleExcludes.test.ts (task 449).
//
// cargoSlop.test.ts already pins the shared trade-press slop detector
// (matchCargoSlop). This suite pins the OTHER two cargo_watch gates in
// lib/relevance/src/topicRelevance.ts that the slop suite does not cover:
//   1. CARGO_EXCLUDE — retail/petty-crime homonyms, US-jurisdiction advisories,
//      industry-body lobbying, CJK out-of-region syndication, equity news;
//   2. the livestock scope ruling (CARGO_LIVESTOCK_RE gated by
//      CARGO_LIVESTOCK_COMMERCIAL_ANCHOR_RE) — routine rural/highway animal
//      theft is out UNLESS a commercial supply-chain anchor is present.
// Every fixture is a real headline seen in the live incidents table (stored
// relevance_reason column; replay source under artifacts/workbench/scripts/),
// pinning BOTH directions so a future regex tweak can neither re-admit noise
// nor collaterally swallow genuine in-region cargo-crime coverage.
import { explainRelevance, type RelevanceInput } from "@workspace/relevance";

function verdict(title: string, summary = ""): { relevant: boolean; reason: string } {
  const input: RelevanceInput = { topic: "cargo_watch", title, summary };
  return explainRelevance("cargo_watch", input);
}

// [class label, headline] — every row must DROP.
const DROP_FIXTURES: Array<[string, string]> = [
  // ---- Livestock without a commercial supply-chain anchor ----
  ["highway cattle robbery", "Robbers stop truck on highway and steal cattle in Sherpur"],
  ["cattle-truck hijack", "Truck loaded with cattle hijacked on Dhaka–Mawa Expressway"],
  ["buffalo truck looted", "Truck carrying 19 buffaloes looted on highway after barricade set up"],
  ["cows stolen from truck", "10 cows stolen from truck on Dhaka-Chittagong highway"],
  ["cattle-truck court aftermath", "Lorry driver acquitted of charge of transporting stolen cattle"],
  ["cattle recovery pursuit", "Truck recovered with 31 cattle after robbery and police pursuit"],
  ["market-bound buffalo loot", "Truck carrying 19 buffaloes looted after barricade on highway while en route to market"],
  // ---- CARGO_EXCLUDE: retail / petty-crime homonyms ----
  ["porch piracy", "Porch pirate caught on camera stealing packages in suburb"],
  ["car break-in", "Police warn of rising car break-in incidents at mall parking lots"],
  ["catalytic converter theft", "Catalytic converter theft ring targets parked vans"],
  ["home burglary", "Residential burglary suspects arrested after neighborhood spree"],
  // ---- CARGO_EXCLUDE: strategic-fraud jargon / trade-press playbook ----
  ["double-brokering playbook", "Cargo Theft's New Playbook: Strategic Fraud, Double Brokering, and Fictitious Pickups"],
  // ---- CARGO_EXCLUDE: US-agency advisory framing ----
  ["FBI advisory", "FBI warns of organized cargo theft rings targeting rail shipments"],
  // ---- CARGO_EXCLUDE: industry-body lobbying ----
  ["association lobbying", "Trucking association urges government to act on cargo theft crisis"],
  // ---- CARGO_EXCLUDE: equity / earnings framing ----
  ["logistics equity news", "Logistics giant's share price slides after quarterly results miss on freight volumes"],
  // ---- CARGO_EXCLUDE: out-of-region (Nigeria) leak ----
  ["Nigeria Ogun State leak", "Ogun State police arrest suspects in Nigeria highway robbery"],
  // ---- CARGO_EXCLUDE: petty school-canteen burglary ----
  ["kantin sekolah burglary", "Pencurian di kantin sekolah dekat gudang, pelaku ditangkap"],
];

// [class label, headline] — every row must KEEP. Each shares vocabulary with a
// DROP class above and pins that the gates stay precision-bound.
const KEEP_FIXTURES: Array<[string, string]> = [
  // Livestock WITH a commercial supply-chain anchor — the anchor exception.
  ["cold-store livestock consignment", "Frozen poultry stolen in cold storage warehouse theft in Karachi"],
  ["export livestock shipment", "Cattle truck hijacked en route to port, logistics operator reports export consignment loss"],
  // Genuine in-region cargo crime sharing truck/warehouse vocabulary.
  ["gang cargo robbery", "Six men from 'Geng Bhai' suspected in cargo robbery detained"],
  ["container thefts", "Video | Repeated container thefts in east Baghdad neighborhoods"],
  ["expressway truck theft", "Truck theft on Purvanchal Expressway at Loni Katra in Barabanki; FIR registered on SP's orders"],
  ["warehouse theft arrest", "Batu Police Criminal Investigation Unit Arrests Suspect in Warehouse Theft, Losses Tens of Millions"],
  ["insider truck-theft ring", "Former Driver Mastermind Behind Truck Thefts in Dukun and Panceng; Three Arrested by Gresik Police"],
  ["GPS-jammer truck gang", "Police Arrest Truck Theft Gang in Bogor, Seize GPS-Disabling Devices"],
  ["fuel-truck hijack murder", "Oil-filled truck hijacking and driver murder in Magura solved; 4 arrested"],
  ["warehouse robbery gang", "Six Rohingya charged with warehouse robbery, losses RM200,000"],
  ["rail depot truck theft", "Basti News: Truck stolen from railway goods depot"],
  ["bonded truck syndicate", "Bonded truck theft syndicate busted, seven arrested"],
];

describe("cargo_watch exclude stack (off-topic + livestock regression pins)", () => {
  describe.each(DROP_FIXTURES)("DROP: %s", (_label, title) => {
    it(`drops: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(false);
    });
  });

  describe.each(KEEP_FIXTURES)("KEEP: %s", (_label, title) => {
    it(`keeps: ${title}`, () => {
      const v = verdict(title);
      expect(v.relevant).toBe(true);
    });
  });

  it("the livestock gate reads the SUMMARY too — a commercial anchor there rescues", () => {
    // The gate scans the whole haystack: a cattle headline whose summary names
    // a slaughterhouse supply line carries the commercial anchor and keeps.
    const v = verdict(
      "Cattle truck hijacked on ring road, driver assaulted",
      "The consignment was bound for a licensed abattoir under a supply chain contract with a logistics operator.",
    );
    expect(v.relevant).toBe(true);
  });

  it("livestock without an anchor drops even with a genuine hijack frame", () => {
    const v = verdict("Truck loaded with buffaloes robbed in Puthia");
    expect(v.relevant).toBe(false);
  });
});
