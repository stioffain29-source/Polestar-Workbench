// Seed data for country_baselines. Mirrors the previous static
// `artifacts/workbench/src/lib/countryBaselines.ts` registry that
// shipped with the workbench. Used once on startup to populate the
// table when no row exists for a given country slug.
//
// Each entry resolves to a country_reports row by case-insensitive
// `name` match. If no matching country report exists yet, the seed
// is skipped (a baseline cannot exist without a country to hang off).

import type { CountryBaselineWatchlistItem } from "@workspace/db";

export interface CountryBaselineSeed {
  // Case-insensitive country names to match against
  // country_reports.name. The first match wins.
  countryNames: string[];
  operatingEnvironment: string;
  securityContext: string;
  knownRiskAreas: string[];
  keyCitiesProvinces: string[];
  movementConstraints: string;
  infrastructureLimits: string;
  medicalEvac: string;
  resourceSectorExposure: string;
  locationWatchlist: CountryBaselineWatchlistItem[];
}

const PAPUA: CountryBaselineSeed = {
  countryNames: ["papua", "west papua", "indonesian papua", "papua (indonesia)"],
  operatingEnvironment:
    "Papua is the Indonesian-administered western half of New Guinea, split since 2022 into six provinces (Papua, West Papua, Central Papua, Highland Papua, South Papua, Southwest Papua). The operating picture is shaped by a long-running low-intensity insurgency, recurring student and church-led protests over Jakarta's resource and security policy, and severe geographical isolation across the highlands and the southern lowlands. Movement is highly weather- and permit-dependent; large stretches of the interior are reachable only by missionary aviation and chartered helicopter.",
  securityContext:
    "Indonesian military (TNI) and police (POLRI) maintain a heavy presence across the highlands and around resource assets, with periodic surges following clashes with the West Papua National Liberation Army (TPNPB-OPM). Civil unrest cycles run around anniversaries (1 December independence flag-raising, 1 May Papua-to-Indonesia transfer, Trikora 19 December), student-led campaigns out of Jayapura and Manokwari universities, and church/diocesan statements on militarisation. Foreign journalist and NGO access remains tightly restricted; reporting depth varies sharply between coastal cities and the central highlands.",
  knownRiskAreas: [
    "Highland Papua — Nduga, Intan Jaya, Puncak, Puncak Jaya, Yahukimo: active TPNPB-OPM operating area, recurring clashes with TNI/POLRI, civilians caught between.",
    "Mimika regency / Tembagapura — Freeport Grasberg copper-gold corridor: standing armed-group threat to mine convoys, contractor camps and the Tembagapura-Timika road.",
    "Border with Papua New Guinea — Keerom, Pegunungan Bintang, Boven Digoel: cross-border movement of armed groups, refugee flows during clash cycles.",
    "Jayapura urban area — university campuses (Cenderawasih, USTJ) and the Abepura corridor: focal point for student protest, May Day and 1 December commemorations.",
    "Manokwari and Sorong (West Papua / Southwest Papua) — coastal LNG corridor (Tangguh), recurring labour and indigenous-rights friction around resource concessions.",
  ],
  keyCitiesProvinces: [
    "Jayapura (Papua province capital)",
    "Sorong (Southwest Papua, LNG hub)",
    "Manokwari (West Papua capital)",
    "Timika / Mimika (Freeport mining belt)",
    "Wamena (Highland Papua, Baliem Valley)",
    "Merauke (South Papua, agribusiness corridor)",
    "Nabire (Central Papua)",
  ],
  movementConstraints:
    "Surat Jalan (travel permit) regimes apply to foreign visitors across most of the highlands. Road networks are sparse and frequently cut by landslides during the wet season (Nov-Apr); the Trans-Papua highway is partially built and unreliable. Internal travel between provincial capitals is overwhelmingly by air via Sentani (DJJ), Sorong (SOQ), Timika (TIM), Manokwari (MKW) and Wamena (WMX). Internet shutdowns have been imposed in response to past unrest cycles. Highland districts routinely become inaccessible during security operations.",
  infrastructureLimits:
    "Power supply is fragile outside the main coastal cities; generator dependency is the norm at resource sites and mission stations. Mobile coverage is concentrated along the north coast and around Timika; large interior areas have no cellular service and rely on HF/VHF radio and satellite. Fuel supply chains for the highlands run almost entirely via air-bridge, with significant price premiums. Sentani and Timika are the only airports able to take regular jet traffic; most highland strips are STOL-only.",
  medicalEvac:
    "Tier-1 medical care is not available in-province. Serious cases route to Makassar, Jakarta or (for Freeport / Tangguh contractors) Singapore via fixed-wing medevac. RSUD Jayapura and the Freeport hospital at Tembagapura provide the highest in-province capability. Highland evacuation is weather-dependent and routinely delayed by cloud cover in the Baliem Valley. Malaria, dengue and tuberculosis are endemic across the lowlands; altitude sickness is a real consideration above 1,500 m.",
  resourceSectorExposure:
    "Freeport McMoRan / PT Freeport Indonesia operates the Grasberg copper-gold complex at Tembagapura — the single largest foreign-operated asset in eastern Indonesia, with a standing armed-group threat to convoys and a long history of disputes with local communities. BP operates the Tangguh LNG plant in Bintuni Bay (West Papua); Eni and Genting operate smaller upstream assets. Palm oil, timber and nickel concessions across South Papua and Southwest Papua carry recurring indigenous-rights and land-tenure friction. Mining and energy assets are typically protected by a combination of TNI/POLRI elements and contracted security.",
  locationWatchlist: [
    { label: "Jayapura", note: "Provincial capital, university protest focal point", match: ["jayapura", "abepura", "sentani"] },
    { label: "Sorong", note: "Southwest Papua, LNG and port hub", match: ["sorong"] },
    { label: "Manokwari", note: "West Papua capital, Tangguh corridor", match: ["manokwari", "bintuni"] },
    { label: "Timika / Mimika (Freeport belt)", note: "Grasberg copper-gold corridor, armed-group threat to convoys", match: ["timika", "mimika", "tembagapura", "freeport", "grasberg"] },
    { label: "Wamena (Baliem Valley)", note: "Highland Papua, weather-dependent access", match: ["wamena", "baliem", "jayawijaya"] },
    { label: "Nduga / Intan Jaya / Puncak", note: "Active TPNPB-OPM operating area", match: ["nduga", "intan jaya", "puncak", "puncak jaya", "yahukimo"] },
    { label: "Merauke", note: "South Papua agribusiness corridor", match: ["merauke"] },
    { label: "Nabire", note: "Central Papua, coastal staging point", match: ["nabire"] },
    { label: "PNG border districts", note: "Keerom / Pegunungan Bintang / Boven Digoel cross-border movement", match: ["keerom", "pegunungan bintang", "boven digoel", "vanimo"] },
    { label: "Highlands airstrips", note: "Sentani (DJJ), Timika (TIM), Sorong (SOQ), Manokwari (MKW), Wamena (WMX)", match: ["sentani", "djj", "tim", "soq", "mkw", "wmx"] },
    { label: "Trans-Papua highway corridor", note: "Partially built, wet-season landslide closures", match: ["trans-papua", "trans papua"] },
  ],
};

const PAPUA_NEW_GUINEA: CountryBaselineSeed = {
  countryNames: ["papua new guinea", "png"],
  operatingEnvironment:
    "Papua New Guinea (PNG) is an independent Commonwealth realm covering the eastern half of New Guinea plus the Bismarck Archipelago and Bougainville. Governance is decentralised across 22 provinces; tribal and clan structures remain the primary unit of dispute resolution outside Port Moresby and Lae. Operating risk is dominated by inter-clan violence (especially in the highlands), urban opportunistic crime in Port Moresby and Lae, recurring resource-sector disputes, and severe infrastructure limits across the interior.",
  securityContext:
    "Royal PNG Constabulary (RPNGC) capacity is uneven and concentrated in the main cities; PNG Defence Force (PNGDF) is small. Bougainville's post-referendum independence process continues to shape political risk on the island. Recurring flashpoints include settlement clearances in Port Moresby, university protest cycles at UPNG, tribal-fight escalations in Enga, Hela and Southern Highlands, and labour disputes around the resource projects.",
  knownRiskAreas: [
    "Port Moresby — settlement areas (Gerehu, Morata, 6-Mile, 8-Mile, 9-Mile), opportunistic and organised violent crime.",
    "Highlands region — Enga, Hela, Southern Highlands, Western Highlands: recurring tribal fights with high-calibre weapons, road ambushes on the Highlands Highway.",
    "Lae and Highlands Highway corridor — main supply route to the highlands, recurring ambushes, fuel-tanker hijackings.",
    "Bougainville (Autonomous Region) — post-referendum political transition, recurring localised tension around resource access.",
    "Hela / PNG LNG corridor — recurring landowner disputes around ExxonMobil's PNG LNG plant and upstream wellpads.",
  ],
  keyCitiesProvinces: [
    "Port Moresby (National Capital District)",
    "Lae (Morobe)",
    "Mount Hagen (Western Highlands)",
    "Madang",
    "Wewak (East Sepik)",
    "Buka / Arawa (Bougainville)",
    "Tabubil / Kiunga (Western)",
  ],
  movementConstraints:
    "The Highlands Highway is the only sealed road link to the resource provinces and is regularly disrupted by landslides, tribal fights and ambushes. Domestic air travel via Air Niugini and PNG Air is the practical norm; ground movement between provinces is rarely advisable for staff without armed escort. Curfews in Port Moresby and Lae are imposed at short notice in response to settlement clearances or election cycles.",
  infrastructureLimits:
    "Power and water supply are unreliable outside the main cities; generator dependency is standard. Mobile coverage is concentrated around Port Moresby, Lae, Mount Hagen and the resource sites. Fuel supply is vulnerable to Highlands Highway closures and waterfront strikes at Lae. Jacksons (POM) is the primary international gateway; Nadzab (LAE) and Mount Hagen (HGU) are the principal domestic hubs.",
  medicalEvac:
    "In-country tier-1 care is limited. Pacific International Hospital in Port Moresby is the main private facility; serious cases route to Cairns, Brisbane or Singapore via fixed-wing medevac. Highlands evacuation is weather-dependent. Malaria is endemic across the lowlands; tuberculosis prevalence is high.",
  resourceSectorExposure:
    "ExxonMobil operates PNG LNG (Hides upstream, Hela province, plus pipeline to the Port Moresby plant). TotalEnergies leads the Papua LNG project. Newcrest (now Newmont) Lihir on Lihir Island, Barrick / Zijin Porgera in Enga, Ok Tedi in Western, and the resumed Wafi-Golpu project (Newmont / Harmony) carry the largest mining-sector exposure. Each carries standing landowner-dispute risk and a track record of operational pauses tied to local agreements.",
  locationWatchlist: [
    { label: "Port Moresby", note: "National Capital District, settlement-area crime focus", match: ["port moresby", "moresby", "ncd", "national capital district", "gerehu", "morata"] },
    { label: "Lae", note: "Morobe province, port and Highlands Highway head", match: ["lae", "morobe", "nadzab"] },
    { label: "Mount Hagen", note: "Western Highlands, tribal-fight focal point", match: ["mount hagen", "mt hagen", "hagen", "western highlands"] },
    { label: "Enga / Porgera", note: "Tribal violence, Barrick / Zijin Porgera mine", match: ["enga", "porgera", "wabag"] },
    { label: "Hela / PNG LNG", note: "ExxonMobil PNG LNG upstream, landowner disputes", match: ["hela", "tari", "hides", "png lng", "komo"] },
    { label: "Southern Highlands", note: "Tribal fights, fuel-tanker ambush corridor", match: ["southern highlands", "mendi"] },
    { label: "Bougainville", note: "Post-referendum political transition", match: ["bougainville", "buka", "arawa", "panguna"] },
    { label: "Highlands Highway", note: "Ambush corridor between Lae and resource provinces", match: ["highlands highway"] },
    { label: "Lihir / Newmont Lihir", note: "Lihir Island gold operation", match: ["lihir"] },
    { label: "Ok Tedi", note: "Western Province copper-gold mine", match: ["ok tedi", "tabubil", "kiunga"] },
  ],
};

export const COUNTRY_BASELINE_SEEDS: CountryBaselineSeed[] = [PAPUA, PAPUA_NEW_GUINEA];
