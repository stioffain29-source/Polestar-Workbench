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


const INDONESIA: CountryBaselineSeed = {
    countryNames: ["indonesia", "republic of indonesia"],
    operatingEnvironment:
      "Indonesia is the world's largest archipelagic state, organised across 38 provinces and home to roughly 280 million people. Jakarta concentrates the political, financial and media weight; resource extraction is dispersed across Kalimantan, Sulawesi, Sumatra and the eastern islands. Day-to-day operating risk is driven by urban congestion and crime in the Jakarta and Surabaya conurbations, recurring labour and student protests around fuel-subsidy and wage decisions, periodic communal flashpoints in Maluku and Central Sulawesi, and standing natural-hazard exposure (volcanism, earthquakes, tsunami, monsoon flooding).",
    securityContext:
      "Indonesian National Police (POLRI) lead day-to-day public-order management; TNI is deployed for counter-insurgency in Papua and in support of natural-disaster response. Protest cycles cluster around fuel-subsidy adjustments, omnibus-law / labour-reform legislation, student union calls (BEM SI), and electoral / inauguration dates. Counter-terrorism is handled by Densus 88; the Jemaah Islamiyah / JAD threat picture is materially reduced from the 2000s but still shapes posture around embassies and high-footfall venues.",
    knownRiskAreas: [
    "Greater Jakarta (Jabodetabek) — protest density around Patung Kuda / Istana / DPR, recurring labour mobilisation, monsoon flood disruption.",
    "Surabaya and the East Java industrial belt — labour action around minimum-wage cycles, port-worker disputes at Tanjung Perak.",
    "Central Sulawesi (Poso, Palu) — residual communal-tension legacy, occasional Mujahidin Indonesia Timur (MIT)-linked incidents.",
    "Maluku and North Maluku — recurring communal sensitivity, nickel-belt labour and indigenous-rights friction.",
    "Aceh — special autonomy region with Sharia by-laws, separate political calendar around the Helsinki MoU anniversary.",
    "Volcanic / seismic belt — Merapi, Semeru, Sinabung, Anak Krakatau, Lewotobi: standing eruption and lahar risk affecting aviation and ground movement.",
  ],
    keyCitiesProvinces: [
    "Jakarta (DKI)",
    "Surabaya (East Java)",
    "Bandung (West Java)",
    "Medan (North Sumatra)",
    "Makassar (South Sulawesi)",
    "Denpasar (Bali)",
    "Balikpapan / Samarinda (East Kalimantan)",
  ],
    movementConstraints:
      "Jakarta surface movement is heavily congested and degrades sharply during protest days around Monas / Istana and around major-match football fixtures. Inter-island travel is overwhelmingly by air (Garuda, Lion, Citilink, Batik) or ferry; sea travel exposure spikes during the monsoon transition. Volcanic ash episodes from Merapi, Semeru and Lewotobi periodically close Yogyakarta (JOG), Solo (SOC), Surabaya (SUB) and Bali (DPS). Road convoys to mining and plantation assets in Kalimantan and Sulawesi are routinely slowed by wet-season closures.",
    infrastructureLimits:
      "Power and telecoms are reliable in Java, Bali and the main Sumatran cities; coverage degrades in interior Kalimantan, Sulawesi, Maluku and Nusa Tenggara. Fuel logistics are Pertamina-dominated; subsidised-fuel rationing and price adjustments are recurring protest triggers. Major ports — Tanjung Priok (Jakarta), Tanjung Perak (Surabaya), Belawan (Medan), Makassar — are the chokepoints for domestic supply chains. Soekarno-Hatta (CGK) and Bali (DPS) are the principal international gateways.",
    medicalEvac:
      "Jakarta offers internationally-accredited private hospitals (RS Pondok Indah, Siloam, Mayapada); regional tier-1 capability is limited. Serious cases from eastern Indonesia typically route via Bali or Jakarta to Singapore by fixed-wing medevac. Dengue is year-round, with seasonal spikes; malaria is endemic across eastern Indonesia and parts of Sumatra and Kalimantan; rabies risk is present in Bali and Sulawesi.",
    resourceSectorExposure:
      "Nickel processing in Sulawesi (Morowali, Weda Bay) and Halmahera is the fastest-growing exposure, with recurring labour, environmental and Chinese-contractor-related friction. Coal in East and South Kalimantan (Adaro, Bumi, Bayan, KPC) sits on top of long-running concession and community disputes. Upstream oil and gas runs through Pertamina, with Eni (IDD), BP (Tangguh), Inpex (Masela) and Medco as the principal foreign operators. Palm oil concessions across Sumatra, Kalimantan and Papua carry standing land-tenure friction. Freeport's Grasberg is treated separately in the Papua baseline.",
    locationWatchlist: [
    { label: "Jakarta", note: "Capital, protest focal point around Istana / DPR / Patung Kuda", match: ["jakarta", "jabodetabek", "dki", "monas", "istana", "patung kuda"] },
    { label: "Surabaya", note: "East Java industrial and port hub", match: ["surabaya", "tanjung perak", "east java"] },
    { label: "Bandung", note: "West Java capital, university mobilisation centre", match: ["bandung", "west java"] },
    { label: "Medan / Belawan", note: "North Sumatra capital and port", match: ["medan", "belawan", "north sumatra"] },
    { label: "Makassar", note: "South Sulawesi gateway, eastern Indonesia hub", match: ["makassar", "south sulawesi"] },
    { label: "Bali (Denpasar)", note: "Tourism centre, low base risk but high-footfall venue exposure", match: ["bali", "denpasar", "kuta", "ubud", "dps"] },
    { label: "Morowali / Weda Bay nickel belt", note: "Sulawesi / Halmahera nickel processing, labour and contractor friction", match: ["morowali", "weda bay", "halmahera", "konawe"] },
    { label: "East Kalimantan coal belt", note: "Balikpapan, Samarinda, Kutai — coal logistics corridor", match: ["balikpapan", "samarinda", "kutai", "east kalimantan", "kalimantan timur"] },
    { label: "Aceh", note: "Special autonomy, separate political calendar", match: ["aceh", "banda aceh", "lhokseumawe"] },
    { label: "Central Sulawesi (Poso / Palu)", note: "Residual communal-tension legacy", match: ["poso", "palu", "central sulawesi", "sulawesi tengah"] },
    { label: "Volcanic / seismic belt", note: "Merapi, Semeru, Sinabung, Anak Krakatau, Lewotobi", match: ["merapi", "semeru", "sinabung", "krakatau", "lewotobi"] },
  ],
  };
  
const PHILIPPINES: CountryBaselineSeed = {
    countryNames: ["philippines", "the philippines", "republic of the philippines"],
    operatingEnvironment:
      "The Philippines is an archipelagic state of 17 regions and roughly 115 million people, with Metro Manila concentrating the political, financial and media weight. Risk is shaped by typhoon and seismic exposure, urban opportunistic crime and traffic congestion, a long-running but spatially contained communist insurgency (NPA) across remote Luzon, Visayas and Mindanao, and a more acute Islamist insurgency / kidnap-for-ransom threat in central and western Mindanao and the Sulu archipelago. Election cycles and high-profile court decisions routinely move protest tempo in the capital.",
    securityContext:
      "Philippine National Police (PNP) lead public-order management; the Armed Forces of the Philippines (AFP) run counter-insurgency in Mindanao and remote NPA-active areas. The Bangsamoro Autonomous Region in Muslim Mindanao (BARMM) is in political transition under the 2014 peace agreement; residual armed groups (Abu Sayyaf, BIFF, Dawlah Islamiyah, NPA splinters) remain active in defined corridors. Protest cycles cluster around the State of the Nation Address (SONA, July), commemorations of Martial Law (21 September) and EDSA (25 February), and minimum-wage / transport-fare decisions.",
    knownRiskAreas: [
    "Metro Manila — Mendiola / Plaza Miranda / EDSA protest corridor, opportunistic crime in transport hubs, monsoon flood disruption.",
    "Central Mindanao (Maguindanao del Norte / del Sur, Lanao del Sur, Cotabato, Sultan Kudarat) — BIFF / Dawlah Islamiyah operating area, recurring IED and clan-feud (rido) incidents.",
    "Sulu archipelago (Sulu, Basilan, Tawi-Tawi) — residual Abu Sayyaf presence, maritime kidnap-for-ransom risk in the Sulu and Celebes Seas.",
    "Eastern Visayas and Bicol — typhoon corridor, post-disaster logistics disruption, residual NPA presence in Samar / Eastern Samar / Northern Samar.",
    "Negros Island — NPA-active uplands, recurring labour and land-tenure friction in the sugar belt.",
    "West Philippine Sea / Spratlys — standing China Coast Guard friction with Philippine fisheries and resupply missions (Ayungin / Second Thomas Shoal, Scarborough).",
  ],
    keyCitiesProvinces: [
    "Metro Manila (NCR)",
    "Cebu (Central Visayas)",
    "Davao (Davao Region)",
    "Cagayan de Oro (Northern Mindanao)",
    "Zamboanga (Zamboanga Peninsula)",
    "Iloilo (Western Visayas)",
    "Baguio (Cordillera)",
  ],
    movementConstraints:
      "Metro Manila road movement is heavily congested and degrades sharply on protest days, presidential motorcade days and during transport-strike calls (tigil-pasada). EDSA, C5 and the airport approach are the most exposed corridors. Inter-island travel is by air (PAL, Cebu Pacific, AirAsia) or sea; ferry exposure spikes during typhoon season (Jun-Nov). Travel to central / western Mindanao and the Sulu archipelago is overland-restricted and requires security planning; martial-law-era movement controls have lapsed but checkpoints remain dense.",
    infrastructureLimits:
      "Power supply is fragile in the Visayas and Mindanao grids, with recurring brownouts during peak season. Mobile and fixed broadband are concentrated in NCR, Cebu and Davao. Major ports — Manila (North/South Harbor), Subic, Batangas, Cebu, Davao, General Santos — are the chokepoints for domestic supply. NAIA (MNL) is the principal international gateway; Clark (CRK), Cebu (CEB) and Davao (DVO) provide secondary capacity. Typhoon track shifts (PAGASA tropical-cyclone bulletins) routinely close ports and airports for 24-72 hours.",
    medicalEvac:
      "Metro Manila offers internationally-accredited private hospitals (St. Luke's BGC / QC, Makati Medical, The Medical City, Asian Hospital). Cebu and Davao provide secondary tier-1 capability. Mindanao and remote-island cases typically route via Manila or Cebu to Singapore / Hong Kong by fixed-wing medevac. Dengue is year-round; malaria is residual in Palawan and parts of Mindanao; rabies risk is present nationwide.",
    resourceSectorExposure:
      "Nickel and chromite operations in Surigao del Norte / del Sur, Zambales and Palawan carry recurring environmental and indigenous-rights friction. Copper-gold at OceanaGold's Didipio (Nueva Vizcaya) restarted under a renewed FTAA; Tampakan (Sagittarius / Glencore) remains paused. Upstream oil and gas are Malampaya-dominated (offshore Palawan), with West Philippine Sea exploration exposed to China Coast Guard friction. Geothermal (EDC, Aboitiz) and BPO real estate in NCR and Cebu sit at the centre of foreign operating exposure.",
    locationWatchlist: [
    { label: "Metro Manila", note: "Capital, protest focal point on Mendiola / EDSA / Plaza Miranda", match: ["manila", "metro manila", "ncr", "mendiola", "edsa", "plaza miranda", "quezon city", "makati", "bgc", "bonifacio global city"] },
    { label: "Cebu", note: "Central Visayas commercial centre", match: ["cebu", "central visayas"] },
    { label: "Davao", note: "Mindanao political centre, lower base risk than central Mindanao", match: ["davao", "davao region"] },
    { label: "Central Mindanao (BARMM)", note: "BIFF / Dawlah Islamiyah operating area, clan-feud (rido) risk", match: ["maguindanao", "lanao", "marawi", "cotabato", "sultan kudarat", "barmm", "bangsamoro"] },
    { label: "Sulu archipelago", note: "Residual Abu Sayyaf, maritime KFR risk", match: ["sulu", "jolo", "basilan", "tawi-tawi", "tawi tawi", "celebes sea"] },
    { label: "Zamboanga", note: "Western Mindanao gateway", match: ["zamboanga"] },
    { label: "Bicol / Eastern Visayas", note: "Typhoon corridor, residual NPA", match: ["bicol", "albay", "legazpi", "samar", "leyte", "tacloban"] },
    { label: "Negros uplands", note: "NPA-active sugar belt", match: ["negros", "bacolod", "dumaguete"] },
    { label: "West Philippine Sea", note: "China Coast Guard friction; Ayungin / Scarborough / Spratlys", match: ["west philippine sea", "ayungin", "second thomas", "scarborough", "spratly", "kalayaan"] },
    { label: "Palawan", note: "Malampaya gas, frontier exploration, eco-tourism corridor", match: ["palawan", "puerto princesa", "malampaya"] },
  ],
  };
  
const THAILAND: CountryBaselineSeed = {
    countryNames: ["thailand", "kingdom of thailand"],
    operatingEnvironment:
      "Thailand is a constitutional monarchy of roughly 70 million people, organised across 76 provinces plus Bangkok. The Bangkok Metropolitan Region concentrates political, financial and media weight; the deep south (Pattani, Yala, Narathiwat, parts of Songkhla) sits on a long-running Malay-Muslim insurgency that runs in parallel to the rest of the country's risk picture. Operating risk is shaped by recurring political cycles around the monarchy, military and elected politicians, urban congestion in Bangkok, monsoon flooding across the central and northern plains, and tourism-density concentration in Phuket, Pattaya, Chiang Mai and Koh Samui.",
    securityContext:
      "Royal Thai Police (RTP) lead public-order management; the Royal Thai Army retains significant residual political weight after the 2006 and 2014 coups and runs counter-insurgency in the deep south through the Internal Security Operations Command (ISOC). Lèse-majesté (Article 112) prosecutions and Constitutional Court decisions on party dissolution / disqualification of MPs are recurring protest triggers; student-led mobilisation centred on Thammasat and Chulalongkorn cycles around these. The deep-south insurgency (BRN, residual PULO) produces a steady cadence of IED, small-arms and arson incidents.",
    knownRiskAreas: [
    "Bangkok (Ratchaprasong, Sanam Luang, Democracy Monument, Pathum Wan) — recurring protest corridor, occasional emergency-decree districts.",
    "Deep south (Pattani, Yala, Narathiwat, four districts of Songkhla) — Malay-Muslim insurgency, recurring IED / small-arms incidents against security forces.",
    "Thai-Myanmar border (Mae Sot, Mae Sai, Tak, Chiang Rai) — refugee flows, scam-compound activity, cross-border armed-group spillover.",
    "Thai-Cambodian border (Preah Vihear / Phra Wihan, Ta Krabey, Ta Moan) — periodic flare-ups around contested temples.",
    "Central plains (Ayutthaya, Pathum Thani, Nonthaburi) — monsoon flood corridor, supply-chain disruption to industrial estates.",
    "Tourist concentrations (Phuket, Krabi, Koh Samui, Pattaya, Chiang Mai) — opportunistic crime, road-traffic risk, periodic dive / boat incidents.",
  ],
    keyCitiesProvinces: [
    "Bangkok",
    "Chiang Mai",
    "Phuket",
    "Pattaya / Chonburi",
    "Hat Yai / Songkhla",
    "Nakhon Ratchasima (Korat)",
    "Khon Kaen",
  ],
    movementConstraints:
      "Bangkok surface movement is heavily congested; BTS / MRT are the practical norm. Protest days (Ratchaprasong, Democracy Monument) and major royal motorcade days routinely close key corridors. Inter-province movement is via Don Mueang (DMK), Suvarnabhumi (BKK), Chiang Mai (CNX), Phuket (HKT) and the rail network. Travel to deep-south provinces is restricted; martial-law / emergency-decree powers apply in Pattani, Yala and Narathiwat. Monsoon flooding (Aug-Oct) routinely closes routes across Ayutthaya / Pathum Thani and the lower north.",
    infrastructureLimits:
      "Power and telecoms are reliable across the country; coverage degrades in remote upland districts and along the Myanmar border. Major ports — Laem Chabang, Bangkok (Khlong Toei), Map Ta Phut — are the chokepoints for industrial supply. Suvarnabhumi (BKK) is the principal international gateway; Don Mueang (DMK), Phuket (HKT), Chiang Mai (CNX) and Hat Yai (HDY) provide secondary capacity. PM2.5 / agricultural-burn haze (Feb-Apr) routinely degrades aviation and outdoor work in the north.",
    medicalEvac:
      "Bangkok offers internationally-accredited private hospitals (Bumrungrad, Bangkok Hospital, Samitivej, BNH) — tier-1 in regional terms. Phuket, Chiang Mai and Pattaya provide secondary tier-1 capability. Serious cases from the deep south or border districts typically route via Bangkok or Hat Yai by fixed-wing medevac. Dengue is year-round; melioidosis risk is elevated in the northeast; rabies risk is present nationwide.",
    resourceSectorExposure:
      "PTT and Chevron dominate upstream oil and gas (Gulf of Thailand). Map Ta Phut (Rayong) is the principal petrochemical and refining complex. Eastern Economic Corridor (EEC — Chonburi, Rayong, Chachoengsao) hosts the largest concentration of foreign manufacturing investment (auto, electronics, semiconductors). Tourism, hospitality and BPO exposure is concentrated in Bangkok, Phuket, Chiang Mai and the eastern seaboard. Agribusiness (sugar, rice, rubber, cassava) sits across the central plains and the south.",
    locationWatchlist: [
    { label: "Bangkok", note: "Capital, protest focal point at Ratchaprasong / Democracy Monument", match: ["bangkok", "ratchaprasong", "sanam luang", "democracy monument", "pathum wan", "chatuchak"] },
    { label: "Chiang Mai", note: "Northern hub; PM2.5 haze season Feb-Apr", match: ["chiang mai", "cnx"] },
    { label: "Phuket", note: "Tourism centre, dive / boat / road-traffic exposure", match: ["phuket", "hkt", "patong"] },
    { label: "Pattaya / Chonburi / EEC", note: "Eastern seaboard manufacturing and tourism", match: ["pattaya", "chonburi", "rayong", "map ta phut", "eec", "eastern economic corridor", "chachoengsao", "laem chabang"] },
    { label: "Hat Yai / Songkhla", note: "Southern commercial hub, gateway to deep south", match: ["hat yai", "songkhla"] },
    { label: "Deep south (Pattani / Yala / Narathiwat)", note: "BRN insurgency, recurring IED / small-arms incidents", match: ["pattani", "yala", "narathiwat", "deep south"] },
    { label: "Thai-Myanmar border (Mae Sot / Mae Sai)", note: "Scam compounds, refugee flows, cross-border spillover", match: ["mae sot", "mae sai", "tak province", "chiang rai", "myawaddy"] },
    { label: "Thai-Cambodian border temples", note: "Preah Vihear / Ta Moan / Ta Krabey periodic flare-ups", match: ["preah vihear", "phra wihan", "ta moan", "ta krabey"] },
    { label: "Central plains flood corridor", note: "Ayutthaya / Pathum Thani / Nonthaburi monsoon exposure", match: ["ayutthaya", "pathum thani", "nonthaburi"] },
    { label: "Isaan (northeast)", note: "Khon Kaen / Udon Thani / Nakhon Ratchasima", match: ["khon kaen", "udon thani", "nakhon ratchasima", "korat", "isaan", "isan"] },
  ],
  };
  
const MALAYSIA: CountryBaselineSeed = {
    countryNames: ["malaysia"],
    operatingEnvironment:
      "Malaysia is a federal constitutional monarchy of 13 states and three federal territories, with a population of roughly 34 million split between Peninsular Malaysia and East Malaysia (Sabah, Sarawak on Borneo). Operating risk is comparatively low by regional standards: politics is contested but largely peaceful, courts are functional, and security forces are professional. Recurring risk drivers are racial and religious sensitivity (Bumiputera / Chinese / Indian / Orang Asli, Sunni-state framework), the Sabah east-coast kidnap-for-ransom threat, and monsoon flooding on the east coast and in Sarawak.",
    securityContext:
      "Royal Malaysia Police (PDRM) lead public-order management; the Malaysian Armed Forces (ATM) maintain the Eastern Sabah Security Command (ESSCOM) along the Sulu / Celebes Sea coast. Protest activity is permitted under the Peaceful Assembly Act but is comparatively contained; Bersih-era mass mobilisation is now historic. Recurring flashpoints include royal succession events, Federal Court rulings on Sharia / civil-court jurisdiction, and PAS-versus-secular-state friction over alcohol, gambling and dress-code policy.",
    knownRiskAreas: [
    "Kuala Lumpur (Dataran Merdeka, KLCC, Sogo) — periodic protest corridor; opportunistic crime in transport hubs.",
    "Sabah east coast (Lahad Datu, Semporna, Sandakan, Tawau) — standing kidnap-for-ransom threat from Sulu-archipelago armed groups; ESSCOM-managed zone.",
    "East coast peninsula (Kelantan, Terengganu, Pahang) — northeast monsoon flooding (Nov-Mar), recurring evacuations.",
    "Sarawak interior (Baram, Belaga, Kapit) — limited infrastructure, palm-oil and timber concession friction with Orang Ulu communities.",
    "Thai-Malaysia border (Perlis, Kedah, Kelantan) — cross-border smuggling and residual militant transit risk.",
  ],
    keyCitiesProvinces: [
    "Kuala Lumpur (Federal Territory)",
    "Johor Bahru (Johor)",
    "Penang (George Town)",
    "Kota Kinabalu (Sabah)",
    "Kuching (Sarawak)",
    "Ipoh (Perak)",
    "Kuantan (Pahang)",
  ],
    movementConstraints:
      "Surface movement is generally efficient; the North-South Expressway, ECRL (under construction) and PLUS network are the principal road / rail arteries. KLIA / KLIA2 are the principal international gateways; Penang (PEN), Kota Kinabalu (BKI), Kuching (KCH) and Johor Bahru (JHB) provide secondary capacity. Travel to Sabah east-coast districts (Lahad Datu, Semporna, Sandakan, Tawau) is permitted but requires ESSCOM-area security planning. East-coast monsoon flooding (Nov-Mar) routinely closes Kelantan / Terengganu corridors.",
    infrastructureLimits:
      "Power and telecoms are reliable across Peninsular Malaysia; coverage degrades in interior Sabah and Sarawak. Major ports — Port Klang, Tanjung Pelepas, Penang, Kuantan, Bintulu — are the principal chokepoints for trade. Petronas-operated upstream and downstream assets dominate the energy supply chain. Generator dependency is the norm at interior East Malaysia logging / plantation camps.",
    medicalEvac:
      "Kuala Lumpur offers internationally-accredited private hospitals (Gleneagles, Prince Court, Pantai, Subang Jaya Medical Centre). Penang, Johor Bahru, Kota Kinabalu and Kuching provide secondary tier-1 capability. Serious cases from East Malaysia or remote sites typically route via KL or Singapore by fixed-wing medevac. Dengue is year-round; rabies risk has re-emerged in Sarawak; malaria is residual in interior East Malaysia (knowlesi strain in particular).",
    resourceSectorExposure:
      "Petronas dominates upstream and downstream oil and gas, with PETRONAS Carigali, Shell, ExxonMobil and Hibiscus as the principal operators offshore Sabah, Sarawak and Peninsular Malaysia. The Pengerang Integrated Complex (Johor) and Bintulu LNG (Sarawak) are the principal downstream assets. Palm oil concessions across Sabah, Sarawak and Pahang carry standing land-tenure and labour-rights friction. Semiconductor packaging (Penang, Kulim) and data-centre buildout (Johor) are the fastest-growing manufacturing exposures.",
    locationWatchlist: [
    { label: "Kuala Lumpur", note: "Capital, protest focal point at Dataran Merdeka / KLCC", match: ["kuala lumpur", "kl", "klcc", "dataran merdeka", "putrajaya"] },
    { label: "Johor Bahru", note: "Manufacturing and data-centre corridor, Singapore land border", match: ["johor bahru", "johor", "jb", "iskandar", "pengerang", "tanjung pelepas"] },
    { label: "Penang", note: "Semiconductor and tourism centre", match: ["penang", "george town", "butterworth", "kulim"] },
    { label: "Sabah east coast (ESSCOM)", note: "Lahad Datu / Semporna / Sandakan / Tawau — kidnap-for-ransom zone", match: ["lahad datu", "semporna", "sandakan", "tawau", "esscom", "sulu sea", "celebes sea"] },
    { label: "Kota Kinabalu", note: "Sabah capital, tourism gateway", match: ["kota kinabalu", "bki", "sabah"] },
    { label: "Sarawak (Kuching / Bintulu / Miri)", note: "LNG, palm oil, timber corridor", match: ["sarawak", "kuching", "bintulu", "miri", "sibu"] },
    { label: "East coast peninsula monsoon belt", note: "Kelantan / Terengganu / Pahang Nov-Mar flooding", match: ["kelantan", "kota bharu", "terengganu", "kuala terengganu", "pahang", "kuantan"] },
    { label: "Thai-Malaysia border", note: "Perlis / Kedah / Kelantan cross-border activity", match: ["perlis", "kedah", "padang besar", "bukit kayu hitam", "rantau panjang"] },
    { label: "Port Klang", note: "Principal container gateway", match: ["port klang", "klang"] },
  ],
  };
  
const VIETNAM: CountryBaselineSeed = {
    countryNames: ["vietnam", "viet nam", "socialist republic of vietnam"],
    operatingEnvironment:
      "Vietnam is a single-party state of roughly 100 million people organised across 63 provinces. The Communist Party of Vietnam (CPV) concentrates political authority; Hanoi is the political capital, Ho Chi Minh City (HCMC) the commercial centre. Operating risk is comparatively low at street level — opportunistic crime, road-traffic risk and recurring typhoon / flood exposure dominate — but is structured by tight political-speech restrictions, periodic anti-corruption purges that move corporate exposure, and South China Sea / East Sea friction with China.",
    securityContext:
      "Ministry of Public Security (MPS) leads internal security; Vietnam People's Army (VPA) handles external defence and maritime presence. Public protest is highly restricted and rare outside narrowly-framed environmental, anti-China or land-tenure flashpoints. Recurring risk drivers are Party Central Committee plenums, National Assembly sessions, anti-corruption prosecutions (the 'blazing furnace' campaign), and South China Sea standoffs with China around the Paracels (Hoang Sa) and Spratlys (Truong Sa).",
    knownRiskAreas: [
    "Hanoi (Ba Dinh, Hoan Kiem) — government district, occasional small-scale protest, opportunistic crime in transport hubs.",
    "Ho Chi Minh City (Districts 1, 3, 10) — commercial centre, opportunistic crime, periodic environmental protest.",
    "Central coast (Da Nang, Hue, Quy Nhon, Nha Trang) — typhoon corridor (Sep-Nov), industrial and tourism exposure.",
    "Central Highlands (Dak Lak, Gia Lai, Kon Tum, Lam Dong) — coffee / rubber belt, residual Montagnard sensitivity, periodic land-tenure friction.",
    "Mekong Delta (Can Tho, An Giang, Ca Mau) — flood and salinity exposure, agribusiness corridor.",
    "South China Sea / East Sea — China Coast Guard friction with Vietnamese fisheries; offshore oil and gas concessions exposed to Chinese pressure.",
  ],
    keyCitiesProvinces: [
    "Hanoi",
    "Ho Chi Minh City",
    "Da Nang",
    "Hai Phong",
    "Can Tho",
    "Bac Ninh / Bac Giang (northern manufacturing belt)",
    "Binh Duong / Dong Nai (southern manufacturing belt)",
  ],
    movementConstraints:
      "Surface movement in Hanoi and HCMC is heavily congested; motorbike traffic dominates and road-traffic injury is the principal staff-safety risk. Noi Bai (HAN), Tan Son Nhat (SGN) and Da Nang (DAD) are the principal international gateways; Long Thanh (LTN) is under construction as HCMC's second airport. Domestic air travel is via Vietnam Airlines, VietJet and Bamboo. Typhoon-season closures (Sep-Nov) routinely affect central-coast airports and ports. Visa and work-permit regimes are tightly enforced.",
    infrastructureLimits:
      "Power supply is generally reliable but stressed during summer heatwaves; rationing has hit northern manufacturing belts in recent years. Telecoms coverage is dense in the urban corridors and across the manufacturing belts; coverage degrades in the Central Highlands and the upland north. Major ports — Hai Phong (Lach Huyen), Cai Mep (Vung Tau), Tan Cang-Cat Lai (HCMC), Da Nang — are the chokepoints for export supply chains. Hanoi-Lao Cai and Hanoi-Hai Phong are the principal rail freight corridors.",
    medicalEvac:
      "Hanoi and HCMC offer internationally-accredited private facilities (Vinmec, FV Hospital, Hanh Phuc, Family Medical Practice). Da Nang provides secondary tier-1 capability. Serious cases typically route to Singapore, Bangkok or Hong Kong by fixed-wing medevac. Dengue is year-round; rabies risk is present nationwide; air-quality (PM2.5) in Hanoi is poor for extended periods Oct-Mar.",
    resourceSectorExposure:
      "PetroVietnam (PVN) dominates upstream oil and gas; Block 06.1 / 12W and Nam Con Son operations carry recurring South China Sea exposure. Vinfast, Samsung Electronics (Bac Ninh / Thai Nguyen), Intel (HCMC), LG (Hai Phong) and the broader electronics-assembly base in Bac Giang / Bac Ninh / Dong Nai / Binh Duong sit at the core of foreign manufacturing exposure. Garment, footwear and furniture supply chains are concentrated around HCMC and the Mekong Delta. Coffee (Central Highlands), rubber and rice (Mekong Delta) anchor the agribusiness exposure.",
    locationWatchlist: [
    { label: "Hanoi", note: "Capital, government district, occasional protest", match: ["hanoi", "ba dinh", "hoan kiem", "ha noi"] },
    { label: "Ho Chi Minh City", note: "Commercial centre, opportunistic crime", match: ["ho chi minh", "hcmc", "saigon", "thu duc"] },
    { label: "Da Nang", note: "Central coast hub, typhoon exposure", match: ["da nang", "danang"] },
    { label: "Hai Phong / Lach Huyen", note: "Northern port and manufacturing gateway", match: ["hai phong", "lach huyen", "haiphong"] },
    { label: "Bac Ninh / Bac Giang", note: "Northern electronics manufacturing belt", match: ["bac ninh", "bac giang", "thai nguyen"] },
    { label: "Binh Duong / Dong Nai", note: "Southern manufacturing belt", match: ["binh duong", "dong nai", "bien hoa"] },
    { label: "Central Highlands", note: "Coffee / rubber belt, Montagnard sensitivity", match: ["dak lak", "gia lai", "kon tum", "lam dong", "buon ma thuot", "pleiku"] },
    { label: "Mekong Delta", note: "Can Tho / An Giang / Ca Mau — flood and salinity exposure", match: ["mekong delta", "can tho", "an giang", "ca mau", "kien giang"] },
    { label: "South China Sea / East Sea", note: "China Coast Guard friction; Paracels (Hoang Sa) / Spratlys (Truong Sa)", match: ["south china sea", "east sea", "paracels", "hoang sa", "spratlys", "truong sa", "vanguard bank"] },
    { label: "Cai Mep / Vung Tau", note: "Southern container and offshore-supply hub", match: ["cai mep", "vung tau", "ba ria"] },
  ],
  };
  
const MYANMAR: CountryBaselineSeed = {
    countryNames: ["myanmar", "burma", "republic of the union of myanmar"],
    operatingEnvironment:
      "Myanmar is in active civil conflict following the February 2021 military coup. The State Administration Council (SAC) junta controls the central dry zone and most major cities; ethnic armed organisations (EAOs) and the National Unity Government (NUG)-aligned People's Defence Force (PDF) control or contest large parts of Sagaing, Magway, Chin, Kachin, Karen, Karenni (Kayah), northern Shan and Rakhine. Operating risk is acute and structurally different from any other country in the regional watchlist: airstrikes, artillery, IED, conscription enforcement, banking-sector controls and electricity / fuel shortages are routine.",
    securityContext:
      "Myanmar Armed Forces (Tatmadaw / Sit-Tat) under SAC retain air power, heavy weapons and most major garrisons but have lost or are contesting hundreds of police stations and military bases since Operation 1027 (Oct 2023). The Three Brotherhood Alliance (MNDAA, TNLA, AA) controls most of northern Shan and is contesting western Rakhine; the KIA holds much of Kachin; the KNU / KNLA and Karenni resistance contest Karen and Karenni states; PDF formations operate across Sagaing and Magway. Conscription under the 2010 People's Military Service Law was activated in February 2024 and is a recurring flashpoint for outward migration and protest.",
    knownRiskAreas: [
    "Sagaing and Magway — heaviest PDF / Tatmadaw clash density, recurring airstrikes on villages, conscription enforcement.",
    "Rakhine state — Arakan Army offensive against SAC garrisons; Sittwe, Kyaukphyu (China-backed deep-sea port / SEZ) under sustained pressure; Rohingya population still in IDP / refugee status.",
    "Northern Shan — MNDAA / TNLA-controlled corridors, Lashio / Hsipaw / Kyaukme front; scam-compound activity in Kokang / Wa areas.",
    "Karen and Karenni states — KNLA / KNDF operating areas; cross-border refugee flows into Mae Sot / Mae Hong Son.",
    "Yangon and Mandalay — junta-controlled but with periodic urban PDF / Special Task Force incidents (IED, assassinations of administrators).",
    "Chin state — Chin Defence Force / CNF operating areas, refugee flows into Mizoram (India).",
  ],
    keyCitiesProvinces: [
    "Yangon (commercial capital)",
    "Naypyidaw (administrative capital)",
    "Mandalay",
    "Sittwe (Rakhine)",
    "Kyaukphyu (Rakhine — China SEZ)",
    "Lashio (northern Shan)",
    "Myawaddy (Karen — Thai border)",
  ],
    movementConstraints:
      "Movement is heavily restricted. Yangon (RGN) and Mandalay (MDL) remain operational but with reduced international airline service; Myanmar Airways International and Myanmar Airways domestic still operate. Overland movement between regions is exposed to PDF / EAO checkpoints, Tatmadaw checkpoints, and active fighting. Conscription enforcement at checkpoints and at the airport (men 18-35, women 18-27) is an exit risk for nationals. Fuel rationing, banking restrictions and recurring internet shutdowns shape daily operating exposure.",
    infrastructureLimits:
      "Electricity supply is severely constrained — Yangon and Mandalay receive intermittent grid power, generator and solar dependency is the norm. Mobile internet is throttled or shut down in conflict areas. Fuel supply is intermittent and price-controlled, with extended queues at retail stations. Banking is heavily restricted: foreign-currency controls, mandatory FX surrender rules, and SWIFT / correspondent-banking constraints affect every commercial transaction. Yangon port is operating but with reduced throughput; Kyaukphyu (China-backed deep-sea port) is contested.",
    medicalEvac:
      "In-country tier-1 medical care is not reliable. Yangon's private hospitals (Pun Hlaing, Victoria) operate with intermittent staffing and supply constraints. Serious cases route via Yangon (RGN) to Bangkok or Singapore by fixed-wing medevac when commercial routes permit; charter capacity is limited by overflight clearances. Dengue and malaria are endemic; landmine and UXO risk is present across all conflict-affected states.",
    resourceSectorExposure:
      "Upstream oil and gas — Yadana (Total / Chevron divested 2022, now MOGE-operated with PTTEP and ONGC), Yetagun (depleted), Zawtika (PTTEP), Shwe (POSCO / Daewoo, Rakhine offshore) — provide the junta's principal foreign-currency revenue. Kyaukphyu deep-sea port and SEZ (CITIC / China) is the strategic China asset under sustained AA pressure. Jade (Hpakant, Kachin), tin (Wa region), rare earths (Kachin / Shan border with China), copper (Letpadaung, Sagaing) and timber concessions carry standing conflict, sanctions and ESG exposure. Garment manufacturing in Yangon's industrial zones operates under sustained sanctions and trade-preference scrutiny.",
    locationWatchlist: [
    { label: "Yangon", note: "Commercial capital, periodic urban PDF / STF incidents", match: ["yangon", "rangoon", "rgn"] },
    { label: "Naypyidaw", note: "Administrative capital, junta seat", match: ["naypyidaw", "nay pyi taw"] },
    { label: "Mandalay", note: "Second city, junta-controlled but with PDF activity nearby", match: ["mandalay", "mdl"] },
    { label: "Sagaing / Magway", note: "Heaviest PDF / Tatmadaw clash density", match: ["sagaing", "magway", "magwe", "monywa", "letpadaung"] },
    { label: "Rakhine state", note: "Arakan Army offensive; Sittwe / Kyaukphyu", match: ["rakhine", "arakan", "sittwe", "kyaukphyu", "maungdaw", "buthidaung", "mrauk-u"] },
    { label: "Northern Shan", note: "Three Brotherhood Alliance corridor; Lashio / Hsipaw / Kyaukme", match: ["northern shan", "lashio", "hsipaw", "kyaukme", "muse", "kokang", "laukkai"] },
    { label: "Karen / Karenni", note: "KNLA / KNDF operating areas; Myawaddy scam-compound belt", match: ["karen state", "kayin", "karenni", "kayah", "loikaw", "myawaddy", "hpapun"] },
    { label: "Kachin", note: "KIA operating area; jade / rare-earth belt", match: ["kachin", "myitkyina", "bhamo", "hpakant"] },
    { label: "Chin", note: "CDF / CNF operating areas, India border", match: ["chin state", "hakha", "falam", "thantlang"] },
    { label: "Yadana / Zawtika / Shwe", note: "Upstream gas — junta foreign-currency lifeline", match: ["yadana", "zawtika", "shwe gas", "yetagun", "moge"] },
  ],
  };
  
const INDIA: CountryBaselineSeed = {
    countryNames: ["india", "republic of india", "bharat"],
    operatingEnvironment:
      "India is a federal parliamentary republic of 28 states and 8 union territories, with a population of roughly 1.43 billion. Delhi (NCR), Mumbai, Bengaluru, Hyderabad, Chennai and Kolkata concentrate political, financial and IT-services weight. Operating risk is highly variable across states: low-base routine exposure (opportunistic crime, road-traffic risk, communal sensitivity, monsoon disruption) sits alongside acute pockets — Jammu and Kashmir, the Northeast, Maoist / Naxalite-affected districts in the central tribal belt, and periodic communal flashpoints around religious commemorations and electoral cycles.",
    securityContext:
      "State police lead day-to-day public-order management; the Central Armed Police Forces (CRPF, BSF, CISF, ITBP, SSB) and paramilitary RAF / NDRF provide reinforcement. The Indian Army runs counter-insurgency in Jammu and Kashmir and parts of the Northeast under AFSPA-designated areas. Protest cycles cluster around farmers' agitations (Punjab / Haryana / UP), labour and minimum-wage decisions, religious processions (Ram Navami, Muharram, Ganesh Chaturthi), and electoral cycles. Section 144 / CrPC 163 prohibitory orders, internet shutdowns and curfews are routine instruments of public-order management.",
    knownRiskAreas: [
    "Jammu and Kashmir — post-Article 370 security posture, recurring infiltration and small-arms incidents along the LoC and in south Kashmir districts.",
    "Northeast (Manipur, Nagaland, Mizoram, Arunachal Pradesh, Assam) — ethnic and inter-community tension; Manipur Meitei-Kuki conflict active since May 2023.",
    "Maoist / Naxalite belt — Chhattisgarh (Bastar, Sukma, Dantewada, Bijapur), Jharkhand, parts of Odisha, Maharashtra (Gadchiroli) and Andhra Pradesh / Telangana: residual LWE insurgency, recurring landmine and ambush incidents.",
    "Delhi NCR — Jantar Mantar / India Gate / Ramlila Maidan protest corridor; recurring farmers' marches and political mobilisation.",
    "Mumbai and Maharashtra — Maratha / OBC reservation agitation, recurring monsoon flooding, opportunistic crime.",
    "Punjab — Khalistani-revival narrative, farmers' agitation staging area, India-Pakistan border posture.",
    "India-China Line of Actual Control (LAC) — Ladakh (Galwan, Pangong, Demchok, Depsang), Arunachal Pradesh (Tawang) standoff zones.",
  ],
    keyCitiesProvinces: [
    "Delhi NCR (Delhi, Gurugram, Noida, Faridabad)",
    "Mumbai (Maharashtra)",
    "Bengaluru (Karnataka)",
    "Hyderabad (Telangana)",
    "Chennai (Tamil Nadu)",
    "Kolkata (West Bengal)",
    "Ahmedabad / Surat (Gujarat)",
  ],
    movementConstraints:
      "Surface movement in NCR and Mumbai is heavily congested; metro networks are the practical norm. Protest days, religious processions and political rallies routinely close arterials. Inter-state air travel is via the major hubs — DEL, BOM, BLR, HYD, MAA, CCU, AMD — with low-cost carriers (IndiGo, Air India, Akasa, SpiceJet) dominant. Travel to J&K, the Northeast and Naxal-affected districts is permitted but with route, daylight and escort planning. Inner Line Permit (ILP) regimes apply to Arunachal Pradesh, Nagaland, Mizoram and parts of Manipur. Section 144 / curfew and internet shutdowns are imposed at short notice.",
    infrastructureLimits:
      "Power supply is reliable in the metros and tier-1 cities; rural and tier-3 coverage is uneven, with peak-summer load-shedding. Mobile telecoms (Jio, Airtel, Vi) provide dense national coverage; internet shutdowns are imposed at short notice during public-order incidents. Major ports — JNPT (Nhava Sheva), Mundra, Chennai, Vizag, Kolkata / Haldia, Cochin, Tuticorin, Kandla — anchor the supply chain. NCR's air quality (PM2.5) is hazardous Oct-Feb and routinely degrades operations.",
    medicalEvac:
      "India offers world-class private tier-1 hospitals across NCR (Max, Fortis, Medanta, Apollo), Mumbai (Hinduja, Kokilaben, Lilavati, Breach Candy), Bengaluru (Manipal, Apollo, Narayana), Chennai (Apollo, MIOT), Hyderabad (Apollo, AIG) and Kolkata. Serious cases from remote sites typically route via the nearest metro by fixed-wing medevac. Dengue and chikungunya are seasonal; air-quality risk in NCR is a year-on-year operating consideration; rabies risk is present nationwide.",
    resourceSectorExposure:
      "ONGC and Reliance dominate upstream oil and gas; Reliance Jamnagar (Gujarat) is the world's largest refining complex. Adani Mundra, JSW, Tata Steel and ArcelorMittal Nippon anchor heavy-industry exposure. IT services (Bengaluru, Hyderabad, Chennai, Pune, Gurugram, Noida) and GCC / BPO exposure is concentrated in the metros. Coal India operations in the central tribal belt overlap with Maoist-affected districts. Foreign-pharma manufacturing (Hyderabad, Gujarat, Goa, Sikkim) is large and growing. Defence-industrial corridors (UP, Tamil Nadu) anchor a growing foreign-OEM presence.",
    locationWatchlist: [
    { label: "Delhi NCR", note: "Capital region, protest focal point at Jantar Mantar / India Gate / Ramlila Maidan", match: ["delhi", "new delhi", "ncr", "gurugram", "gurgaon", "noida", "faridabad", "jantar mantar", "india gate", "ramlila"] },
    { label: "Mumbai", note: "Commercial capital, recurring monsoon and communal sensitivity", match: ["mumbai", "bombay", "thane", "navi mumbai", "maharashtra"] },
    { label: "Bengaluru", note: "IT services centre, low base risk", match: ["bengaluru", "bangalore", "karnataka"] },
    { label: "Hyderabad", note: "IT and pharma centre", match: ["hyderabad", "telangana"] },
    { label: "Chennai", note: "Tamil Nadu capital, auto-manufacturing belt", match: ["chennai", "tamil nadu", "madras"] },
    { label: "Kolkata", note: "Eastern political centre", match: ["kolkata", "calcutta", "west bengal"] },
    { label: "Punjab / Haryana", note: "Farmers' agitation staging area, India-Pakistan border posture", match: ["punjab", "amritsar", "ludhiana", "chandigarh", "haryana"] },
    { label: "Jammu and Kashmir", note: "LoC infiltration, south Kashmir small-arms incidents", match: ["jammu", "kashmir", "srinagar", "anantnag", "pulwama", "kupwara", "loc"] },
    { label: "Manipur / Northeast", note: "Meitei-Kuki conflict, ILP regimes", match: ["manipur", "imphal", "nagaland", "kohima", "mizoram", "aizawl", "arunachal", "itanagar", "tawang", "assam", "guwahati"] },
    { label: "Naxalite / LWE belt", note: "Chhattisgarh (Bastar) / Jharkhand / Odisha / Gadchiroli", match: ["chhattisgarh", "bastar", "sukma", "dantewada", "bijapur", "jharkhand", "gadchiroli", "naxal", "maoist", "lwe"] },
    { label: "Ladakh / LAC", note: "Galwan / Pangong / Demchok / Depsang standoff zones", match: ["ladakh", "leh", "galwan", "pangong", "demchok", "depsang", "lac"] },
    { label: "Gujarat industrial belt", note: "Ahmedabad / Surat / Jamnagar / Mundra", match: ["gujarat", "ahmedabad", "surat", "jamnagar", "mundra", "vadodara"] },
  ],
  };
  
const PAKISTAN: CountryBaselineSeed = {
    countryNames: ["pakistan", "islamic republic of pakistan"],
    operatingEnvironment:
      "Pakistan is a federal parliamentary republic of four provinces (Punjab, Sindh, Khyber Pakhtunkhwa, Balochistan), plus Azad Jammu and Kashmir, Gilgit-Baltistan and the Islamabad Capital Territory. Population is roughly 240 million. Politics is polarised between the PTI (Imran Khan), PML-N and PPP, with the military establishment a structural actor. Operating risk is shaped by an active TTP-led insurgency in KP and parts of Balochistan, a Baloch-nationalist insurgency (BLA, BLF, BRAS) across Balochistan, recurring PTI political mobilisation, sectarian flashpoints (especially Parachinar / Kurram), and persistent macroeconomic and FX stress.",
    securityContext:
      "Provincial police forces and the Frontier Corps (in KP and Balochistan) lead day-to-day security; the Pakistan Army retains decisive weight and runs counter-terrorism operations across the former FATA, Waziristan, Khyber, and central / southern Balochistan. The Pakistan Rangers manage Karachi and the Indian border. ISI is the principal intelligence service. Recurring flashpoints include PTI protests over Imran Khan's detention and election-result disputes, lawyer / pharmacist / labour strikes, Section 144 prohibitory orders, sectarian incidents in Parachinar and DI Khan, and TTP / ISKP-claimed attacks across KP and the tribal districts.",
    knownRiskAreas: [
    "Khyber Pakhtunkhwa (former FATA, Bannu, DI Khan, Tank, Lakki Marwat, Swat, Bajaur, Khyber, Kurram) — TTP-led insurgency, recurring IED, ambush and assassination incidents against police and military.",
    "Balochistan (Quetta, Mastung, Khuzdar, Turbat, Gwadar, Kech, Bolan) — Baloch-nationalist insurgency against security forces, Chinese personnel and CPEC infrastructure; sectarian Hazara targeting in Quetta.",
    "Karachi — opportunistic crime, residual political violence, periodic Lyari and Malir district flashpoints.",
    "Islamabad / Rawalpindi — PTI protest staging point, container blockades, recurring mobile-internet suspensions.",
    "Punjab — PTI mobilisation, recurring sectarian sensitivity in Bahawalpur / Multan / Jhang; smog (Oct-Feb) in Lahore.",
    "India-Pakistan LoC and working boundary (AJK) — periodic ceasefire violations, infiltration cycles.",
  ],
    keyCitiesProvinces: [
    "Islamabad / Rawalpindi (Federal Capital)",
    "Karachi (Sindh)",
    "Lahore (Punjab)",
    "Peshawar (Khyber Pakhtunkhwa)",
    "Quetta (Balochistan)",
    "Faisalabad (Punjab)",
    "Multan (Punjab)",
  ],
    movementConstraints:
      "Surface movement in Islamabad and Rawalpindi degrades sharply during PTI mobilisation and Red Zone / Constitution Avenue lockdowns; container blockades on the Islamabad Expressway are routine. Karachi-Lahore-Islamabad inter-city movement is mainly by air (PIA, AirSial, AirBlue, SereneAir, FlyJinnah). Travel to KP tribal districts, Waziristan and most of Balochistan requires No-Objection Certificates (NOCs) and security escort; Gwadar is a controlled-access zone. Mobile-internet suspensions are imposed at short notice during protests and elections.",
    infrastructureLimits:
      "Power supply is unreliable nationwide; load-shedding (4-12 hours/day depending on season and feeder) is the norm. Generator and UPS dependency is standard. Mobile telecoms are dense in cities; coverage is patchy in tribal districts and most of Balochistan. Gas supply is rationed in winter. Major ports — Karachi, Port Qasim, Gwadar (China-backed) — anchor the supply chain. Aviation gateways are Karachi (KHI), Islamabad (ISB), Lahore (LHE) and Peshawar (PEW).",
    medicalEvac:
      "Karachi (Aga Khan University Hospital, South City), Lahore (Doctors, Hameed Latif, Shaukat Khanum) and Islamabad (Shifa, KRL) offer the best in-country tier-1 capability. Serious cases from KP, Balochistan and remote sites typically route via Karachi or Islamabad to Dubai, Bangkok or Singapore by fixed-wing medevac. Dengue is seasonal with major Lahore and Rawalpindi outbreaks; polio is residual in KP and Balochistan; smog in Lahore (Oct-Feb) is a year-on-year operating consideration.",
    resourceSectorExposure:
      "Upstream oil and gas (OGDCL, PPL, MOL, Eni, UEPL) is concentrated in Sindh and KP. Reko Diq copper-gold (Barrick / Government of Pakistan / Balochistan) in Chagai is the largest mining-sector exposure, sitting inside the Balochistan insurgency footprint. Saindak (China-operated) is also in Chagai. China-Pakistan Economic Corridor (CPEC) — Gwadar port, Karakoram Highway, energy and industrial-zone investments — concentrates Chinese personnel and is a standing BLA target. Textile and garment manufacturing (Punjab, Karachi) anchors the export base.",
    locationWatchlist: [
    { label: "Islamabad / Rawalpindi", note: "Capital and GHQ; PTI protest staging area, Red Zone lockdowns", match: ["islamabad", "rawalpindi", "red zone", "constitution avenue", "d-chowk", "isb"] },
    { label: "Karachi", note: "Commercial capital, opportunistic crime, residual political violence", match: ["karachi", "sindh", "lyari", "malir", "khi", "port qasim"] },
    { label: "Lahore", note: "Punjab capital, PTI mobilisation, smog Oct-Feb", match: ["lahore", "punjab", "lhe", "mall road", "minar-e-pakistan"] },
    { label: "Peshawar / KP", note: "TTP-led insurgency, recurring IED and ambush incidents", match: ["peshawar", "khyber pakhtunkhwa", "kp", "swat", "bajaur", "khyber agency", "waziristan", "north waziristan", "south waziristan", "bannu", "di khan", "dera ismail khan", "tank", "lakki marwat", "kurram", "parachinar"] },
    { label: "Quetta / Balochistan", note: "Baloch-nationalist insurgency, sectarian Hazara targeting", match: ["quetta", "balochistan", "mastung", "khuzdar", "turbat", "kech", "gwadar", "bolan", "panjgur", "chagai"] },
    { label: "Reko Diq", note: "Barrick copper-gold, Chagai district", match: ["reko diq", "saindak", "chagai"] },
    { label: "CPEC corridor", note: "Karakoram Highway, Gwadar, China-backed infrastructure", match: ["cpec", "karakoram highway", "gilgit", "diamer", "kohistan"] },
    { label: "LoC / AJK", note: "India-Pakistan ceasefire violation corridor", match: ["loc", "line of control", "ajk", "azad kashmir", "muzaffarabad", "kotli", "neelum"] },
    { label: "Faisalabad / Multan / Bahawalpur", note: "Southern Punjab textile and sectarian sensitivity belt", match: ["faisalabad", "multan", "bahawalpur", "jhang", "rahim yar khan"] },
    { label: "Karachi port / Port Qasim / Gwadar", note: "Principal trade gateways", match: ["karachi port", "port qasim", "gwadar port"] },
  ],
  };
  
const BANGLADESH: CountryBaselineSeed = {
    countryNames: ["bangladesh", "people's republic of bangladesh"],
    operatingEnvironment:
      "Bangladesh is a parliamentary republic of roughly 170 million people in eight divisions. Dhaka and Chittagong concentrate political, financial and industrial weight; the ready-made-garment (RMG) sector dominates the export base. Operating risk is shaped by an unsettled post-July-2024 political environment (after the fall of the Sheikh Hasina government and the installation of the Yunus-led interim administration), recurring labour and student mobilisation, monsoon flooding, Rohingya refugee dynamics in Cox's Bazar, and Chittagong Hill Tracts (CHT) ethnic-armed-group activity.",
    securityContext:
      "Bangladesh Police, Rapid Action Battalion (RAB) and Border Guard Bangladesh (BGB) lead internal security; the Bangladesh Army was deployed in aid-to-civil-power roles through the July-August 2024 transition and remains visible. The interim government has pursued accountability cases against former Awami League figures while managing recurring student-coordinator protests, RMG sector wage agitation, and BNP / Jamaat political mobilisation. Hartal / blockade calls remain a recurring operational disruptor.",
    knownRiskAreas: [
    "Dhaka — Shahbagh / Press Club / Dhaka University / Secretariat protest corridor; periodic student and political mobilisation, transport disruption.",
    "Chittagong / Chattogram — port and industrial corridor, RMG-belt labour mobilisation in adjoining EPZs.",
    "RMG belt (Ashulia, Savar, Gazipur, Narayanganj) — recurring wage-related strikes, road blockades on the Dhaka-Mymensingh / Dhaka-Chittagong highways.",
    "Chittagong Hill Tracts (Rangamati, Khagrachhari, Bandarban) — JSS / UPDF / MNP factional violence, Bawm-Kuki-Chin armed-group activity in Bandarban.",
    "Cox's Bazar — Rohingya refugee camps (Kutupalong, Balukhali), recurring intra-camp armed-group violence, security restrictions on access.",
    "Sundarbans and coastal Khulna / Barisal — cyclone exposure (Apr-Jun, Oct-Nov), recurring flood and storm-surge events.",
  ],
    keyCitiesProvinces: [
    "Dhaka (Dhaka Division)",
    "Chittagong / Chattogram (Chattogram Division)",
    "Sylhet",
    "Rajshahi",
    "Khulna",
    "Barisal",
    "Mymensingh",
  ],
    movementConstraints:
      "Dhaka surface movement is heavily congested; flyover network and the Dhaka Metro (partial) ease but do not solve it. Protest, hartal and blockade days routinely close arterials; the Dhaka-Chittagong highway and the Dhaka-Mymensingh highway are the most exposed inter-city corridors. Hazrat Shahjalal (DAC) is the principal international gateway; Chittagong (CGP), Sylhet (ZYL) and Cox's Bazar (CXB) provide secondary capacity. Inland river ferry traffic peaks around Eid travel and is exposed to cyclone-season disruption.",
    infrastructureLimits:
      "Power supply has improved materially since 2010 but remains stressed during peak summer, with rolling load-shedding when LNG / coal imports tighten. Mobile telecoms (Grameenphone, Robi, Banglalink) provide dense coverage; internet shutdowns have been imposed in response to student mobilisation. Chittagong Port handles roughly 90% of containerised trade; Mongla and Payra provide secondary capacity. Padma Bridge has materially reduced southwestern transit time.",
    medicalEvac:
      "Dhaka offers tier-1 private capability (United, Apollo / Evercare, Square, Labaid). Serious cases typically route to Bangkok, Singapore or Chennai by fixed-wing medevac. Dengue is seasonal with major Dhaka outbreaks; cholera and waterborne disease risk is elevated post-flood; air-quality (PM2.5) in Dhaka is hazardous for extended periods.",
    resourceSectorExposure:
      "Petrobangla and IOCs (Chevron at Bibiyana / Moulvibazar / Jalalabad) dominate domestic gas supply. Two coal-fired plants (Payra, Rampal — the latter near the Sundarbans, with standing ESG friction) anchor base load. Garment manufacturing in the Ashulia / Savar / Gazipur / Narayanganj belt is the foreign-buyer exposure; Rana Plaza (2013) and subsequent factory-fire incidents shape the compliance regime. Chittagong's ship-breaking yards (Sitakunda) carry standing ESG and occupational-safety exposure.",
    locationWatchlist: [
    { label: "Dhaka", note: "Capital, protest corridor Shahbagh / Press Club / DU", match: ["dhaka", "shahbagh", "press club", "dhaka university", "secretariat", "gulshan", "banani"] },
    { label: "Chittagong / Chattogram", note: "Port and industrial capital", match: ["chittagong", "chattogram", "ctg", "cgp"] },
    { label: "RMG belt", note: "Ashulia / Savar / Gazipur / Narayanganj — wage strikes, road blockades", match: ["ashulia", "savar", "gazipur", "narayanganj", "tongi"] },
    { label: "Chittagong Hill Tracts", note: "JSS / UPDF / MNP factional violence; Bawm-Kuki-Chin in Bandarban", match: ["chittagong hill tracts", "cht", "rangamati", "khagrachhari", "bandarban", "kuki-chin", "kuki chin", "kncf"] },
    { label: "Cox's Bazar / Rohingya camps", note: "Intra-camp armed-group violence, access restrictions", match: ["cox's bazar", "coxs bazar", "kutupalong", "balukhali", "ukhiya", "teknaf", "rohingya"] },
    { label: "Sundarbans / coastal Khulna", note: "Cyclone and storm-surge corridor", match: ["sundarbans", "khulna", "satkhira", "bagerhat", "rampal"] },
    { label: "Sylhet", note: "Northeast, expatriate-remittance corridor, monsoon flood-prone", match: ["sylhet", "zyl"] },
    { label: "Payra / Rampal", note: "Coal-fired power and ESG-sensitive sites", match: ["payra", "rampal"] },
    { label: "Bibiyana / Jalalabad", note: "Chevron upstream gas fields", match: ["bibiyana", "jalalabad gas field", "moulvibazar"] },
    { label: "India-Bangladesh border", note: "BGB / BSF interactions, smuggling corridor", match: ["jessore", "benapole", "akhaura", "petrapole"] },
  ],
  };
  
const SRI_LANKA: CountryBaselineSeed = {
    countryNames: ["sri lanka", "ceylon", "democratic socialist republic of sri lanka"],
    operatingEnvironment:
      "Sri Lanka is a presidential republic of roughly 22 million people across nine provinces. Colombo concentrates the political, financial and port-logistics weight; the north and east carry the legacy of the 1983-2009 civil war. Operating risk is comparatively low at street level — opportunistic crime, road-traffic risk and monsoon flooding dominate — but is structurally shaped by post-2022 macroeconomic recovery, IMF-programme-driven fiscal tightening, recurring tea / public-sector labour mobilisation, and Tamil minority / land-tenure issues in the north and east.",
    securityContext:
      "Sri Lanka Police lead day-to-day public-order management; the Sri Lanka Army retains visible posture in the Northern and Eastern Provinces and around key infrastructure. The State Intelligence Service (SIS) and Criminal Investigation Department (CID) handle counter-terrorism following the April 2019 Easter Sunday bombings. Recurring flashpoints are protests over electricity tariffs, fuel-price adjustments, IMF-programme austerity, university-fees and the Online Safety Act; Galle Face / Lipton Circus / Town Hall are the principal Colombo protest corridors.",
    knownRiskAreas: [
    "Colombo (Galle Face, Fort, Lipton Circus, Town Hall) — central protest corridor; recurring labour and political mobilisation.",
    "Northern Province (Jaffna, Kilinochchi, Mullaitivu, Vavuniya, Mannar) — Tamil-majority districts, residual militarisation, recurring land and missing-persons protests.",
    "Eastern Province (Trincomalee, Batticaloa, Ampara) — mixed Tamil / Muslim / Sinhala population, periodic communal flashpoints.",
    "Up-country tea belt (Nuwara Eliya, Hatton, Maskeliya, Badulla) — recurring estate-worker wage protests.",
    "Central Highlands — monsoon landslide exposure (May-Sep southwest monsoon, Oct-Jan northeast).",
  ],
    keyCitiesProvinces: [
    "Colombo (Western Province)",
    "Kandy (Central Province)",
    "Galle (Southern Province)",
    "Jaffna (Northern Province)",
    "Trincomalee (Eastern Province)",
    "Anuradhapura (North Central)",
    "Hambantota (Southern, port and industrial zone)",
  ],
    movementConstraints:
      "Surface movement in Colombo is congested but manageable; protest days at Galle Face / Lipton Circus routinely close central arterials. Bandaranaike International (CMB) is the principal gateway; Mattala (HRI) in Hambantota provides secondary capacity. Domestic air-taxi (Cinnamon Air, FitsAir) supplements rail and road. Travel to the north and east is unrestricted but security-posture awareness is needed around former conflict zones. Monsoon flooding routinely closes upland routes (May-Sep, Oct-Jan).",
    infrastructureLimits:
      "Power supply has stabilised since the 2022 crisis but remains exposed to fuel-import disruptions; load-shedding has historically been used during balance-of-payments stress. Telecoms (Dialog, SLT-Mobitel) provide dense coverage. Colombo Port (including the CICT and East Container Terminal) and the Hambantota Port (China-leased) anchor maritime trade; Hambantota carries standing strategic-China exposure.",
    medicalEvac:
      "Colombo offers tier-1 private capability (Asiri, Lanka Hospitals, Nawaloka, Hemas). Serious cases typically route to Singapore, Chennai or Bangkok by fixed-wing medevac. Dengue is year-round with seasonal spikes; rabies risk is present nationwide.",
    resourceSectorExposure:
      "Hambantota Port (CMPort, Chinese 99-year lease) and the adjacent industrial / port-city zone in Colombo (Port City Colombo, CHEC-backed) concentrate Chinese strategic exposure. Tourism (south and west coast, Kandy, Cultural Triangle) is the principal foreign-currency earner. Apparel manufacturing (Gampaha, Katunayake EPZ) and tea exports anchor the legacy industrial base. Refining is via the Sapugaskanda refinery; LNG terminal projects are in long-running discussion.",
    locationWatchlist: [
    { label: "Colombo", note: "Capital, protest corridor Galle Face / Lipton Circus / Town Hall", match: ["colombo", "galle face", "lipton circus", "town hall", "fort", "pettah", "cmb"] },
    { label: "Kandy", note: "Central highlands, periodic communal sensitivity", match: ["kandy", "central province"] },
    { label: "Galle", note: "Southern tourism hub", match: ["galle", "matara", "weligama", "mirissa"] },
    { label: "Jaffna / Northern Province", note: "Tamil-majority, residual militarisation", match: ["jaffna", "kilinochchi", "mullaitivu", "vavuniya", "mannar", "northern province"] },
    { label: "Trincomalee / Eastern Province", note: "Mixed-community districts, periodic communal flashpoints", match: ["trincomalee", "batticaloa", "ampara", "eastern province"] },
    { label: "Up-country tea belt", note: "Nuwara Eliya / Hatton / Badulla — estate-worker wage protests", match: ["nuwara eliya", "hatton", "maskeliya", "badulla", "talawakelle"] },
    { label: "Hambantota Port", note: "China-leased deep-water port, strategic exposure", match: ["hambantota", "mattala", "hri"] },
    { label: "Port City Colombo", note: "CHEC-backed reclaimed-land project", match: ["port city colombo"] },
    { label: "Katunayake EPZ", note: "Apparel manufacturing belt around the airport", match: ["katunayake", "gampaha", "negombo"] },
    { label: "Cultural Triangle", note: "Anuradhapura / Polonnaruwa / Sigiriya tourism corridor", match: ["anuradhapura", "polonnaruwa", "sigiriya", "dambulla"] },
  ],
  };
  
const SOUTH_KOREA: CountryBaselineSeed = {
    countryNames: ["south korea", "republic of korea", "korea, republic of", "korea (south)", "rok"],
    operatingEnvironment:
      "The Republic of Korea (ROK) is a presidential republic of roughly 51 million people, with Seoul and the surrounding metropolitan area (Gyeonggi, Incheon) concentrating around half the population. Operating risk is structurally low at street level — opportunistic crime is rare, public-order policing is professional, infrastructure is excellent — but is shaped by the standing inter-Korean military posture, recurring large-scale labour and political mobilisation (KCTU / FKTU, conservative / progressive rallies), and acute political-cycle volatility (the December 2024 martial-law episode and subsequent impeachment / Constitutional Court proceedings being the most recent example).",
    securityContext:
      "Korean National Police Agency (KNPA) leads public-order management; the ROK Armed Forces maintain a heavy posture along the DMZ and in support of the US-ROK Combined Forces Command. The National Intelligence Service (NIS) handles counter-intelligence. Protest cycles cluster around Gwanghwamun / Yeouido / Seoul Plaza / Yongsan, with KCTU general-strike days, conservative rallies (often Saturday) and Constitutional Court / impeachment-decision days as recurring focal points. North Korea-linked missile / drone / GPS-jamming incidents recur but rarely escalate to kinetic action south of the DMZ.",
    knownRiskAreas: [
    "Seoul — Gwanghwamun, Seoul Plaza, Yeouido (National Assembly), Yongsan (Presidential Office), Yeouido Park: principal protest corridor.",
    "DMZ and Northern Limit Line (NLL) — recurring NK provocations (missile tests, drone incursions, GPS jamming, balloons); NLL maritime friction in the West Sea around Yeonpyeong / Baengnyeong.",
    "Industrial belts (Ulsan, Pohang, Geoje, Gwangyang) — recurring heavy-industrial labour mobilisation (Hyundai, POSCO, HD Hyundai, Samsung Heavy).",
    "Jeju — recurring protest cycles around the Gangjeong naval base and tourism-density crime exposure.",
    "Gangwon and east coast — wildfire exposure (Mar-May), recurring industrial-coastal incidents.",
  ],
    keyCitiesProvinces: [
    "Seoul",
    "Busan",
    "Incheon",
    "Daegu",
    "Daejeon",
    "Gwangju",
    "Ulsan",
  ],
    movementConstraints:
      "Surface movement in Seoul is congested but well-supported by a dense metro network; protest days around Gwanghwamun and Yongsan close arterials at short notice. Incheon (ICN) is the principal international gateway, with Gimpo (GMP), Busan (PUS) and Jeju (CJU) the principal domestic hubs. KTX high-speed rail provides reliable inter-city movement (Seoul-Busan ~2.5h). Travel to areas north of the Civilian Control Line near the DMZ is restricted.",
    infrastructureLimits:
      "Power, telecoms and transport infrastructure are tier-1 by global standards. 5G coverage is dense in cities and inter-city corridors. Major ports — Busan, Incheon, Gwangyang, Ulsan, Pohang — anchor exports. Winter air quality (PM2.5) in the western half of the peninsula is poor for extended periods Nov-Apr.",
    medicalEvac:
      "ROK offers tier-1 medical capability domestically (Asan Medical Center, Samsung Medical Center, Seoul National University Hospital, Severance, Seoul St. Mary's). Medevac is rarely required out-of-country; international cases typically route via Incheon if escalation is needed. Seasonal influenza and norovirus are routine; air-quality risk in spring is a known operating consideration.",
    resourceSectorExposure:
      "Manufacturing and heavy-industrial exposure is concentrated in the southeast (Ulsan, Busan, Pohang, Changwon, Geoje, Gwangyang) and the Gyeonggi semiconductor / display belt (Suwon, Yongin, Pyeongtaek, Hwaseong). Samsung, SK hynix, LG, Hyundai, Kia, POSCO, HD Hyundai, Hanwha and Doosan dominate. Refining is run by SK Innovation, GS Caltex, S-Oil and HD Hyundai Oilbank. Defence-industrial exposure (KAI, LIG Nex1, Hanwha Aerospace, Hyundai Rotem) is a growing export base. No domestic upstream oil and gas of operational scale; LNG imports flow through Incheon, Pyeongtaek, Tongyeong and Samcheok terminals.",
    locationWatchlist: [
    { label: "Seoul", note: "Capital, protest focal point at Gwanghwamun / Yeouido / Yongsan", match: ["seoul", "gwanghwamun", "yeouido", "yongsan", "seoul plaza", "city hall", "myeongdong", "gangnam"] },
    { label: "Busan", note: "Principal container port and second city", match: ["busan", "pusan"] },
    { label: "Incheon", note: "International gateway and port", match: ["incheon", "icn"] },
    { label: "Ulsan", note: "Heavy-industrial and petrochemical capital", match: ["ulsan"] },
    { label: "Pohang / Gwangyang", note: "POSCO steel and Gwangyang refining / petrochemical", match: ["pohang", "gwangyang"] },
    { label: "Geoje / Tongyeong", note: "Shipyards (Samsung Heavy, Hanwha Ocean)", match: ["geoje", "tongyeong"] },
    { label: "Pyeongtaek / Hwaseong / Yongin", note: "Samsung / SK hynix semiconductor and display belt", match: ["pyeongtaek", "hwaseong", "yongin", "suwon", "icheon"] },
    { label: "DMZ / NLL", note: "Inter-Korean military boundary and West Sea friction", match: ["dmz", "panmunjom", "jsa", "nll", "yeonpyeong", "baengnyeong", "paju", "yeoncheon"] },
    { label: "Jeju", note: "Tourism centre, Gangjeong naval-base protest cycles", match: ["jeju", "gangjeong"] },
    { label: "Daegu / Daejeon / Gwangju", note: "Regional capitals", match: ["daegu", "daejeon", "gwangju"] },
  ],
  };
  
const JAPAN: CountryBaselineSeed = {
    countryNames: ["japan"],
    operatingEnvironment:
      "Japan is a constitutional monarchy of roughly 124 million people in 47 prefectures, with Tokyo and the surrounding Kanto area concentrating the political, financial and media weight. Operating risk is structurally low at street level — opportunistic crime is rare, public-order policing is professional, infrastructure is among the world's most reliable — and is shaped principally by natural-hazard exposure (earthquakes, typhoons, volcanism, tsunami), recurring China / North Korea / Russia regional security incidents, and a slow-moving demographic / labour-market backdrop.",
    securityContext:
      "Prefectural police lead public-order management under the National Police Agency (NPA); Japan Self-Defense Forces (JSDF — GSDF, MSDF, ASDF) handle external defence under the US-Japan Alliance. The Public Security Intelligence Agency (PSIA) handles domestic intelligence. Protest activity is permitted and orderly; recurring focal points include Diet-front rallies on defence, Article 9, US-base (Okinawa) and nuclear-restart issues. Lone-actor political-violence incidents (the Abe assassination, the Kishida pipe-bomb attempt) have shaped current VIP-protection posture.",
    knownRiskAreas: [
    "Nankai Trough and Japan Trench — standing megathrust earthquake / tsunami exposure across the Pacific coast.",
    "Volcanic belt — Sakurajima (Kagoshima), Aso (Kumamoto), Asama (Gunma / Nagano), Ontake (Nagano / Gifu), Fuji (Yamanashi / Shizuoka): standing eruption risk.",
    "Typhoon corridor — Okinawa, Kyushu, Shikoku, Pacific-coast Honshu: Jun-Nov, with peak Aug-Sep.",
    "Hokkaido and Tohoku — winter snow / blizzard exposure, recurring transport disruption.",
    "Senkaku Islands (Okinawa) — standing China Coast Guard friction.",
    "Okinawa / Yokosuka / Iwakuni / Misawa US-base footprint — recurring base-related protest and political sensitivity.",
  ],
    keyCitiesProvinces: [
    "Tokyo",
    "Yokohama",
    "Osaka",
    "Nagoya",
    "Sapporo",
    "Fukuoka",
    "Naha (Okinawa)",
  ],
    movementConstraints:
      "Surface movement in Tokyo, Osaka and Nagoya is congested but extremely well-supported by metro / Shinkansen / private-rail networks; service disruption from earthquakes or typhoons is the practical risk vector. Haneda (HND), Narita (NRT), Kansai (KIX) and Chubu (NGO) are the principal international gateways. Domestic air via ANA, JAL and Skymark supplements Shinkansen. Typhoon-season flight and rail disruption is routine; volcanic-ash events can close regional airports.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1 by global standards. Power supply has structural east-west frequency split (50Hz Tokyo, 60Hz Osaka) and post-Fukushima dependence on LNG / coal imports; demand-response calls recur in winter peak. Major ports — Tokyo, Yokohama, Nagoya, Osaka, Kobe, Hakata — anchor exports. Earthquake / tsunami exposure dominates business-continuity planning.",
    medicalEvac:
      "Japan offers world-class domestic medical capability. International medevac is rarely required; specialist cases occasionally route to Singapore or the US. Seasonal influenza is routine; norovirus outbreaks recur; heatstroke (Jul-Aug) is a meaningful operational risk in older facilities without AC.",
    resourceSectorExposure:
      "Manufacturing exposure spans automotive (Toyota in Aichi, Honda in Saitama / Mie, Nissan in Kanagawa, Mazda in Hiroshima, Subaru in Gunma), electronics (Sony, Panasonic, Sharp, Hitachi), semiconductors (Kioxia, Renesas, Sony Semi, plus TSMC's JASM in Kumamoto and Rapidus in Hokkaido), machinery, chemicals and pharmaceuticals. Refining and LNG terminals (JERA, ENEOS, Idemitsu, Cosmo) sit along the Pacific coast. No domestic upstream oil and gas of operational scale.",
    locationWatchlist: [
    { label: "Tokyo", note: "Capital, government district, Diet-front protests", match: ["tokyo", "nagatacho", "kasumigaseki", "shibuya", "shinjuku", "marunouchi", "haneda", "narita"] },
    { label: "Yokohama / Kawasaki / Chiba", note: "Greater Tokyo industrial and port belt", match: ["yokohama", "kawasaki", "chiba"] },
    { label: "Osaka / Kobe / Kyoto", note: "Kansai industrial and financial centre", match: ["osaka", "kobe", "kyoto", "kansai", "kix"] },
    { label: "Nagoya / Aichi", note: "Toyota / automotive heartland", match: ["nagoya", "aichi", "toyota city", "ngo"] },
    { label: "Hokkaido / Sapporo", note: "Rapidus semiconductor build, winter weather exposure", match: ["hokkaido", "sapporo", "chitose"] },
    { label: "Kyushu / Fukuoka / Kumamoto", note: "TSMC JASM build, volcanic and typhoon exposure", match: ["fukuoka", "kumamoto", "kyushu", "kagoshima", "sakurajima"] },
    { label: "Okinawa", note: "US-base footprint, Senkaku friction, typhoon corridor", match: ["okinawa", "naha", "futenma", "henoko", "kadena", "senkaku"] },
    { label: "Tohoku / Fukushima", note: "2011 disaster legacy, decommissioning at Fukushima Daiichi", match: ["tohoku", "sendai", "fukushima", "miyagi", "iwate"] },
    { label: "Nankai Trough / Japan Trench", note: "Standing megathrust earthquake / tsunami exposure", match: ["nankai trough", "japan trench", "tonankai"] },
    { label: "Volcanic belt", note: "Sakurajima / Aso / Asama / Ontake / Fuji", match: ["aso", "asama", "ontake", "fuji", "shinmoedake"] },
  ],
  };
  
const TAIWAN: CountryBaselineSeed = {
    countryNames: ["taiwan", "republic of china", "taiwan, republic of china", "chinese taipei"],
    operatingEnvironment:
      "Taiwan (Republic of China) is a democratic state of roughly 23 million people across the main island plus Penghu, Kinmen, Matsu and the Spratlys' Taiping. Taipei concentrates the political and financial weight; Hsinchu / Tainan / Kaohsiung anchor the semiconductor and heavy-industrial base. Operating risk is structurally low at street level — opportunistic crime is rare, public-order policing is professional — and is shaped principally by typhoon and earthquake exposure and the standing PLA pressure across the Taiwan Strait (ADIZ incursions, exercise envelopes, grey-zone maritime activity).",
    securityContext:
      "National Police Agency leads public-order management; the ROC Armed Forces maintain a heavy posture along the western coast and outer islands. The National Security Bureau (NSB) handles intelligence. Protest activity is permitted and orderly; recurring focal points include Ketagalan Boulevard, the Legislative Yuan and presidential inauguration cycles. Cross-Strait deterioration around presidential elections, inauguration days, and senior US visits routinely triggers PLA exercise responses (Joint Sword 2024A / 2024B / 2025 cycles).",
    knownRiskAreas: [
    "Taiwan Strait — PLA Air Force ADIZ incursions, median-line crossings, PLA Navy exercise envelopes; recurring around political-calendar dates.",
    "Outer islands — Kinmen, Matsu, Wuqiu, Dongyin: Chinese maritime militia and Coast Guard presence; subsea cable incidents around Matsu.",
    "Pacific coast — typhoon corridor (Jun-Nov, peak Aug-Sep), earthquake exposure across the entire island.",
    "Hualien / Taitung — east-coast seismic exposure (April 2024 Hualien quake) and landslide risk.",
    "Taipei (Ketagalan / Legislative Yuan / Liberty Square) — protest corridor.",
  ],
    keyCitiesProvinces: [
    "Taipei",
    "New Taipei",
    "Taoyuan",
    "Hsinchu",
    "Taichung",
    "Tainan",
    "Kaohsiung",
  ],
    movementConstraints:
      "Surface movement is well-supported by metro and high-speed rail; HSR Taipei-Kaohsiung is ~1.5-2h. Taoyuan (TPE) is the principal international gateway; Songshan (TSA), Kaohsiung (KHH) and Taichung (RMQ) provide secondary capacity. Typhoon-season flight and rail disruption is routine; major exercise-led airspace closures recur. Travel to outer islands is via short-haul air and ferry.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1 by regional standards, but power supply is structurally tight — nuclear phase-down, LNG import dependency and recurring summer demand peaks have produced rotating blackouts in past years. Major ports — Kaohsiung, Taichung, Keelung, Taipei (Taoyuan) — anchor exports. Subsea cable diversity from Taiwan to the rest of the internet is a known resilience pinch point.",
    medicalEvac:
      "Taiwan offers tier-1 domestic medical capability (NTUH, Chang Gung, Taipei Veterans General, Mackay, Cathay). International medevac is rarely required; specialist cases occasionally route to Singapore or the US. Dengue is seasonal in the south; air quality (PM2.5) is moderate to poor in the western half of the island Oct-Mar.",
    resourceSectorExposure:
      "Semiconductor manufacturing — TSMC (Hsinchu Science Park, Tainan Fab 18 / Fab 22, Kaohsiung Fab 22, Taichung), UMC, PSMC, Vanguard, Winbond, Macronix — anchors the foreign exposure and is the single largest concentration of global advanced-node capacity. Foxconn, Pegatron, Quanta, Wistron, Compal and Inventec assemble electronics. Petrochemical and refining (CPC, Formosa Petrochemical) sits in Mailiao / Kaohsiung. No domestic upstream oil and gas of scale; LNG imports flow through Yung-An, Taichung and the planned Third Terminal.",
    locationWatchlist: [
    { label: "Taipei", note: "Capital, protest corridor Ketagalan / Liberty Square / Legislative Yuan", match: ["taipei", "ketagalan", "legislative yuan", "liberty square", "songshan", "xinyi"] },
    { label: "Kaohsiung", note: "Principal southern port and petrochemical hub", match: ["kaohsiung", "khh"] },
    { label: "Hsinchu Science Park", note: "TSMC headquarters and advanced-node concentration", match: ["hsinchu", "science park"] },
    { label: "Tainan", note: "TSMC Fab 18 / Fab 22 advanced-node belt", match: ["tainan"] },
    { label: "Taichung", note: "Central industrial and port hub", match: ["taichung"] },
    { label: "Taoyuan", note: "International gateway and manufacturing belt", match: ["taoyuan", "tpe"] },
    { label: "Kinmen / Matsu / Wuqiu / Dongyin", note: "Outer islands, Chinese maritime militia and cable incidents", match: ["kinmen", "matsu", "wuqiu", "dongyin", "lienchiang"] },
    { label: "Taiwan Strait / ADIZ", note: "PLA Air Force incursions, exercise envelopes", match: ["taiwan strait", "adiz", "median line", "joint sword"] },
    { label: "Hualien / Taitung", note: "East coast, seismic and landslide exposure", match: ["hualien", "taitung"] },
    { label: "Mailiao", note: "Formosa Petrochemical complex (Yunlin)", match: ["mailiao", "formosa petrochemical", "yunlin"] },
  ],
  };
  
const CHINA: CountryBaselineSeed = {
    countryNames: ["china", "people's republic of china", "prc", "mainland china"],
    operatingEnvironment:
      "The People's Republic of China is a single-party state of roughly 1.4 billion people across 23 provinces, 5 autonomous regions, 4 directly-administered municipalities and 2 SARs (Hong Kong, Macau). The CCP concentrates political authority; Beijing is the political capital, Shanghai the financial and commercial centre. Operating risk at street level is comparatively low — opportunistic crime is rare, public-order policing is dense — but is structurally shaped by tight political-speech and assembly restrictions, periodic anti-corruption / industry-rectification campaigns that move corporate exposure, regulatory and exit-control risk for foreign staff, and acute air-quality / hazardous-weather exposure across the north and west.",
    securityContext:
      "Ministry of Public Security (MPS) and the People's Armed Police (PAP) lead internal security; Ministry of State Security (MSS) handles intelligence and counter-intelligence. Public protest is highly restricted; the November 2022 'white paper' protests (Beijing, Shanghai, Urumqi) and recurring local incidents (wage / housing / village land disputes) are managed by rapid PAP deployment, internet controls and short-term concessions. Recurring focal-point dates — Tiananmen anniversary (4 June), 1 October, Party Congress / Plenum cycles — drive heightened posture in central Beijing.",
    knownRiskAreas: [
    "Xinjiang (Urumqi, Kashgar, Hotan, Aksu, Yili) — heavy security posture; foreign-business access tightly managed.",
    "Tibet Autonomous Region (Lhasa, Shigatse, Nyingchi) — foreign-access permit regime, periodic political sensitivity around Dalai Lama-linked dates.",
    "Beijing central districts (Tiananmen, Zhongnanhai, government district) — recurring sensitive-date posture.",
    "South China Sea / East China Sea — standing maritime friction with Philippines, Vietnam, Japan; ADIZ activity around Taiwan and Senkaku.",
    "Pollution / weather — winter heating-season PM2.5 across the North China Plain (Nov-Mar); summer flood exposure in the Yangtze and Pearl basins.",
  ],
    keyCitiesProvinces: [
    "Beijing",
    "Shanghai",
    "Guangzhou (Guangdong)",
    "Shenzhen (Guangdong)",
    "Chengdu (Sichuan)",
    "Chongqing",
    "Wuhan (Hubei)",
  ],
    movementConstraints:
      "Surface movement in tier-1 cities is congested but well-supported by metro networks. High-speed rail (CR / CRH) provides reliable inter-city movement. Beijing (PEK, PKX), Shanghai (PVG, SHA), Guangzhou (CAN), Shenzhen (SZX) and Chengdu (TFU, CTU) are the principal international gateways. Visa, residence-permit and exit-control regimes are tightly enforced; updated Counter-Espionage Law (2023) and exit-ban practice carry meaningful operating risk for foreign staff. VPN and end-to-end-encrypted messaging are restricted; corporate IT planning must assume the Great Firewall and content-inspection regime.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1 across the east coast; coverage and reliability degrade west of the Hu Line. Major ports — Shanghai, Ningbo-Zhoushan, Shenzhen, Guangzhou, Qingdao, Tianjin, Xiamen — dominate global container throughput. Power supply has been periodically rationed during summer peak in the southern grid (Sichuan / Chongqing 2022). Air-quality (PM2.5) across the North China Plain is hazardous Nov-Mar.",
    medicalEvac:
      "Tier-1 international-standard hospitals are available in Beijing (Beijing United Family, Peking Union, Raffles), Shanghai (Jiahui, ParkwayHealth, Shanghai United Family, Huashan international), Guangzhou and Shenzhen. Serious cases from secondary cities typically route via Beijing / Shanghai to Hong Kong, Singapore or further onward by fixed-wing medevac. Seasonal influenza, dengue (south) and norovirus are recurring; air-quality exposure is a year-on-year operating consideration.",
    resourceSectorExposure:
      "Foreign exposure spans automotive (Tesla Shanghai, BMW / Mercedes JVs, VW), semiconductors (Intel Dalian, SMIC, YMTC, CXMT), consumer electronics (Apple supply chain across Zhengzhou, Shenzhen, Suzhou, Kunshan), retail (Starbucks, Yum China, KFC, McDonald's), financial services and energy services. State-owned majors (CNPC, Sinopec, CNOOC, China Shenhua, China Baowu, China Mobile / Telecom / Unicom) dominate domestic operations. CCP industry-rectification cycles (education / tech / property / gaming / private tutoring) periodically move sectoral exposure at short notice.",
    locationWatchlist: [
    { label: "Beijing", note: "Capital, sensitive-date posture, government district", match: ["beijing", "peking", "tiananmen", "zhongnanhai", "chaoyang", "haidian"] },
    { label: "Shanghai", note: "Financial centre", match: ["shanghai", "pudong", "puxi"] },
    { label: "Guangzhou / Shenzhen / Pearl River Delta", note: "Manufacturing and electronics belt", match: ["guangzhou", "shenzhen", "guangdong", "dongguan", "foshan", "zhuhai", "pearl river"] },
    { label: "Yangtze River Delta", note: "Suzhou / Kunshan / Hangzhou / Ningbo electronics and trade hub", match: ["suzhou", "kunshan", "hangzhou", "ningbo", "wuxi"] },
    { label: "Sichuan / Chongqing", note: "Southwest industrial belt, summer power-rationing exposure", match: ["chengdu", "chongqing", "sichuan", "tfu", "ctu"] },
    { label: "Zhengzhou", note: "Foxconn / Apple supply-chain concentration", match: ["zhengzhou", "henan", "foxconn"] },
    { label: "Xinjiang", note: "Heavy security posture, restricted foreign-business access", match: ["xinjiang", "urumqi", "kashgar", "hotan", "aksu", "yili", "uyghur"] },
    { label: "Tibet", note: "Permit regime, political sensitivity", match: ["tibet", "lhasa", "shigatse", "nyingchi", "xizang"] },
    { label: "South China Sea / East China Sea", note: "Maritime friction with Philippines / Vietnam / Japan", match: ["south china sea", "east china sea", "spratly", "paracel", "scarborough", "senkaku", "diaoyu"] },
    { label: "Taiwan Strait ADIZ", note: "PLA exercise envelopes", match: ["taiwan strait", "adiz", "joint sword"] },
  ],
  };
  
const HONG_KONG: CountryBaselineSeed = {
    countryNames: ["hong kong", "hong kong sar", "hong kong, china", "hk"],
    operatingEnvironment:
      "Hong Kong is a Special Administrative Region of China of roughly 7.5 million people. Operating risk at street level is low — opportunistic crime is rare, public-order policing is professional, infrastructure is tier-1 — and is structurally shaped by the post-2020 National Security Law (NSL) and 2024 Article 23 (Safeguarding National Security Ordinance) regimes, which materially reshaped the political, civil-society and media environment relative to the pre-2019 baseline.",
    securityContext:
      "Hong Kong Police Force leads public-order management; the National Security Department (NSD) and the Office for Safeguarding National Security of the CPG handle NSL enforcement. Mass street mobilisation has not recurred since the 2019-20 cycle; public assembly is permitted but tightly managed under the Public Order Ordinance. Recurring focal points are sensitive-date posture around 1 July, 1 October and 4 June, and US sanctions / Magnitsky listings of HK officials.",
    knownRiskAreas: [
    "Central / Admiralty / Wan Chai — government district, sensitive-date posture.",
    "Cross-boundary chokepoints — Lo Wu, Lok Ma Chau, West Kowloon HSR, HZMB: customs / immigration / data-export exposure.",
    "Typhoon corridor — Jun-Nov, with T8 / T10 signals routinely closing markets, ports and the airport.",
    "Off-peak air-quality (PM2.5) — north-westerly winter monsoon brings periodic Pearl River Delta haze.",
  ],
    keyCitiesProvinces: [
    "Hong Kong Island (Central, Admiralty, Wan Chai, Causeway Bay)",
    "Kowloon (Tsim Sha Tsui, Mong Kok)",
    "New Territories (Sha Tin, Tsuen Wan, Yuen Long)",
    "Lantau / Tung Chung (airport, Disneyland)",
    "Cross-boundary points (Lo Wu, Lok Ma Chau, West Kowloon, HZMB)",
  ],
    movementConstraints:
      "Surface and rail movement is excellent (MTR, Light Rail, ferries). Hong Kong International (HKG) is the principal regional gateway. Cross-boundary movement to mainland China is via Lo Wu / Lok Ma Chau / Futian rail crossings, the West Kowloon HSR terminus, and the Hong Kong-Zhuhai-Macau Bridge (HZMB). Typhoon T8 / T10 signals close markets and most ground transport for the duration. Sensitive-date posture (1 Jul, 1 Oct, 4 Jun) brings heavier police presence in Central, Admiralty and Causeway Bay.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1. Container port throughput has declined relative to Shenzhen / Guangzhou but remains operationally robust. Banking and FX infrastructure are tier-1 globally; data-localisation and sanctions-screening exposure is the principal compliance pinch point.",
    medicalEvac:
      "Hong Kong offers tier-1 private capability (Hong Kong Sanatorium, Matilda, Adventist, Gleneagles, Hong Kong Adventist). Public hospitals are world-class. Medevac is rarely required out-of-region; specialist cases typically route to Singapore or onward to North America / Europe. Seasonal influenza and dengue are routine.",
    resourceSectorExposure:
      "Hong Kong's exposure is financial-services-led: banking (HSBC, Standard Chartered, BOC HK, Hang Seng), asset management, IPO listings, and family-office operations. Real estate (Sun Hung Kai, CK Asset, Henderson, New World) anchors property exposure. Trade and logistics flow through the airport (cargo) and port. No domestic upstream oil and gas; CLP and HK Electric provide power.",
    locationWatchlist: [
    { label: "Central / Admiralty", note: "Government district, sensitive-date posture", match: ["central", "admiralty", "government house", "legco"] },
    { label: "Causeway Bay / Wan Chai", note: "Protest-corridor history, commercial centre", match: ["causeway bay", "wan chai", "victoria park"] },
    { label: "Tsim Sha Tsui / Mong Kok", note: "Kowloon commercial and tourism centres", match: ["tsim sha tsui", "tst", "mong kok", "kowloon"] },
    { label: "HKIA / Lantau", note: "Airport, Disneyland, AsiaWorld-Expo", match: ["chek lap kok", "hkia", "lantau", "tung chung"] },
    { label: "Cross-boundary points", note: "Lo Wu / Lok Ma Chau / West Kowloon HSR / HZMB", match: ["lo wu", "lok ma chau", "futian", "west kowloon", "hzmb", "shenzhen bay"] },
    { label: "Sha Tin / New Territories", note: "Hong Kong Science Park, Chinese University", match: ["sha tin", "new territories", "tai po", "yuen long", "tuen mun"] },
  ],
  };
  
const SINGAPORE: CountryBaselineSeed = {
    countryNames: ["singapore", "republic of singapore"],
    operatingEnvironment:
      "Singapore is a city-state of roughly 5.9 million people. Operating risk is the lowest in the region — opportunistic crime is rare, public-order policing is professional, infrastructure is tier-1 globally, and political-public-order incidents are highly contained. Risk drivers are principally regional spillover (terrorism, cyber, sanctions-evasion exposure), tight regulatory / data-localisation regimes (PDPA, Cybersecurity Act, OB markers), recurring transboundary haze from Indonesian peatland fires, and dengue cycles.",
    securityContext:
      "Singapore Police Force leads public-order management; Internal Security Department (ISD) handles intelligence and counter-terrorism; SAF maintains a regional deterrent posture. Public assembly is restricted to Hong Lim Park's Speakers' Corner. The Public Order Act, POFMA, Foreign Interference (Countermeasures) Act and other instruments tightly manage the speech / assembly environment.",
    knownRiskAreas: [
    "CBD / Marina Bay — high-density commercial centre, terror-target hardening exposure.",
    "Changi Airport — regional hub, tightly managed but exposure point.",
    "Singapore Strait — heavy maritime traffic, recurring small-vessel armed-robbery incidents in TSS approaches.",
    "Transboundary haze corridor — Aug-Oct PSI spikes from Sumatran / Kalimantan fires.",
  ],
    keyCitiesProvinces: [
    "Central Region (CBD, Marina Bay, Orchard)",
    "Jurong (industrial / petrochemical)",
    "Tuas (port and industrial)",
    "Changi (airport / aerospace)",
    "Woodlands (Causeway crossing to Johor)",
  ],
    movementConstraints:
      "Surface and rail movement is excellent (MRT, LRT, taxi, bus). Changi (SIN) is the principal regional gateway; Seletar (XSP) handles private aviation. Causeway and Tuas Second Link crossings to Johor are heavily trafficked during Singaporean-weekend and Malaysian-weekday peaks. PSI / PM2.5 haze episodes (Aug-Oct) periodically degrade outdoor work.",
    infrastructureLimits:
      "Power, telecoms, water, transport are tier-1 globally. Banking, exchange and clearing infrastructure are tier-1. Jurong Island concentrates the petrochemical and refining base. Tuas Mega Port build-out is the principal logistics-resilience programme.",
    medicalEvac:
      "Singapore offers tier-1 medical capability (Singapore General, NUH, Mount Elizabeth, Raffles, Gleneagles, Parkway). Singapore is itself the principal regional medevac destination; out-bound medevac is rarely required.",
    resourceSectorExposure:
      "Financial services and asset management (DBS, OCBC, UOB, plus global majors), oil and gas (ExxonMobil, Shell, Chevron, ENOC, ARAMCO, PETRONAS Jurong / Tuas), petrochemicals (Jurong Island), commodities trading (Trafigura, Vitol, Glencore, Mercuria, Cargill, Wilmar, Olam), semiconductors (GlobalFoundries, UMC, Micron, TSMC), MICE / hospitality, and aviation (SIA, Changi Airport Group). MAS regulates the financial sector to global tier-1 standard.",
    locationWatchlist: [
    { label: "CBD / Marina Bay", note: "Commercial centre, MBS / MBFC / financial district", match: ["cbd", "marina bay", "raffles place", "shenton way", "downtown", "mbs", "marina bay sands"] },
    { label: "Orchard Road", note: "Retail and tourism corridor", match: ["orchard", "scotts road"] },
    { label: "Jurong Island / Tuas", note: "Petrochemical and refining belt; Tuas Mega Port", match: ["jurong island", "tuas", "tuas mega port"] },
    { label: "Changi Airport / Seletar", note: "Aviation gateway", match: ["changi", "sin", "seletar", "xsp"] },
    { label: "Woodlands / Tuas crossings", note: "Causeway and Second Link to Johor", match: ["woodlands", "causeway", "tuas second link", "tuas link"] },
    { label: "Singapore Strait TSS", note: "Maritime traffic chokepoint, small-vessel armed-robbery incidents", match: ["singapore strait", "tss", "phillip channel"] },
    { label: "Sentosa", note: "Tourism / hospitality concentration", match: ["sentosa", "resorts world sentosa", "rws"] },
  ],
  };
  
const CAMBODIA: CountryBaselineSeed = {
    countryNames: ["cambodia", "kingdom of cambodia", "kampuchea"],
    operatingEnvironment:
      "Cambodia is a constitutional monarchy of roughly 17 million people across 25 provinces. The Cambodian People's Party (CPP) under Prime Minister Hun Manet (succeeding his father Hun Sen in 2023) dominates the political system. Operating risk is comparatively low at street level — opportunistic crime, road-traffic risk and flood exposure dominate — and is structurally shaped by scam-compound / human-trafficking exposure (Sihanoukville, Bavet, Poipet), Chinese-investment concentration, and a highly constrained civil-society / political-speech environment.",
    securityContext:
      "Cambodian National Police lead public-order management; Royal Gendarmerie and Royal Cambodian Armed Forces (RCAF) provide reinforcement. Opposition political mobilisation is heavily constrained (CNRP dissolution 2017, Candlelight Party disqualification 2023). Recurring risk drivers are scam-compound enforcement / international pressure cycles, Thai-Cambodian border-temple flare-ups (Preah Vihear, Ta Moan, Ta Krabey), and labour mobilisation in the Phnom Penh / Kandal garment belt.",
    knownRiskAreas: [
    "Sihanoukville (Preah Sihanouk) — concentration of Chinese-investment casinos, scam compounds and informal economy; periodic enforcement raids.",
    "Bavet (Svay Rieng, Vietnam border) and Poipet (Banteay Meanchey, Thai border) — scam-compound and casino corridors.",
    "Phnom Penh / Kandal garment belt — recurring labour mobilisation around minimum-wage cycles.",
    "Thai-Cambodian border — Preah Vihear, Ta Moan, Ta Krabey, Oddar Meanchey periodic flare-ups.",
    "Mekong corridor — seasonal flooding, Tonle Sap fisheries pressure.",
  ],
    keyCitiesProvinces: [
    "Phnom Penh",
    "Sihanoukville (Preah Sihanouk)",
    "Siem Reap",
    "Battambang",
    "Poipet (Banteay Meanchey)",
    "Bavet (Svay Rieng)",
    "Kampong Cham",
  ],
    movementConstraints:
      "Surface movement in Phnom Penh is moderately congested. Phnom Penh (PNH) is the principal international gateway, with the new Techo Takhmao (KTI) airport recently opened; Siem Reap (SAI / new) and Sihanoukville (KOS) provide secondary capacity. Road movement to remote provinces is wet-season-affected. Travel to border-temple zones requires security awareness around Thai-Cambodian flare-ups.",
    infrastructureLimits:
      "Power supply has improved materially but remains exposed to seasonal hydropower availability and import dependency on Thailand / Laos / Vietnam. Mobile telecoms are dense in cities; coverage degrades in remote provinces. Sihanoukville is the principal deepwater port; Phnom Penh Autonomous Port handles river-borne trade. Internet infrastructure routes through the National Internet Gateway, with content-inspection exposure.",
    medicalEvac:
      "Phnom Penh offers limited tier-1 capability (Royal Phnom Penh, Sunrise Japan, Raffles Medical). Serious cases typically route to Bangkok or Singapore by fixed-wing medevac. Dengue is year-round; malaria is present in remote forested areas; HIV / TB prevalence is meaningful.",
    resourceSectorExposure:
      "Garment and footwear manufacturing in the Phnom Penh / Kandal / Kampong Speu belt anchors the export base. Chinese investment in Sihanoukville (casinos, real estate, port), the Ream naval-base upgrade and the Funan Techo Canal carry strategic exposure. Rice, rubber and cassava agribusiness sit across the lower Mekong provinces. Limited upstream oil and gas activity offshore (Block A, KrisEnergy / Apsara legacy).",
    locationWatchlist: [
    { label: "Phnom Penh", note: "Capital, garment-belt labour mobilisation", match: ["phnom penh", "pnh", "kandal"] },
    { label: "Sihanoukville", note: "Chinese-investment / scam-compound concentration, Ream naval base", match: ["sihanoukville", "preah sihanouk", "kos", "ream"] },
    { label: "Siem Reap", note: "Tourism centre, Angkor", match: ["siem reap", "angkor"] },
    { label: "Poipet", note: "Thai-border scam-compound / casino corridor", match: ["poipet", "banteay meanchey"] },
    { label: "Bavet", note: "Vietnam-border scam-compound / casino corridor", match: ["bavet", "svay rieng"] },
    { label: "Thai border temples", note: "Preah Vihear / Ta Moan / Ta Krabey flare-ups", match: ["preah vihear", "ta moan", "ta krabey", "oddar meanchey"] },
    { label: "Funan Techo Canal", note: "China-backed Mekong-to-coast canal project", match: ["funan techo", "funan canal"] },
    { label: "Battambang / Kampong Cham", note: "Provincial centres", match: ["battambang", "kampong cham", "kampong thom"] },
  ],
  };
  
const LAOS: CountryBaselineSeed = {
    countryNames: ["laos", "lao pdr", "lao people's democratic republic"],
    operatingEnvironment:
      "Laos is a single-party state of roughly 7.6 million people across 17 provinces plus Vientiane prefecture. The Lao People's Revolutionary Party (LPRP) concentrates political authority. Operating risk is comparatively low at street level — public-order incidents are rare — and is structurally shaped by acute macroeconomic and FX stress, heavy debt exposure to China (Laos-China Railway, hydropower projects), recurring drug-trade and trafficking activity in the Golden Triangle (Bokeo, Luang Namtha), and significant UXO contamination from the Vietnam-War-era bombing.",
    securityContext:
      "Lao People's Security Forces lead internal security; Lao People's Armed Forces handle defence. Public protest is highly restricted and rare. Recurring risk drivers are scam-compound activity in the Golden Triangle Special Economic Zone (Bokeo) and Boten (Luang Namtha), narcotics-trafficking enforcement cycles, and UXO incidents in the central and southern provinces (Xieng Khouang, Savannakhet, Khammouane).",
    knownRiskAreas: [
    "Golden Triangle SEZ (Bokeo, Ton Pheung district) — Kings Romans casino, scam-compound concentration, narcotics-trafficking node.",
    "Boten (Luang Namtha, China border) — China-SEZ, Laos-China Railway terminus.",
    "UXO-contaminated provinces — Xieng Khouang (Plain of Jars), Savannakhet, Khammouane, Salavan, Sekong, Attapeu.",
    "Mekong corridor — seasonal flood and drought exposure, hydropower-disruption sensitivity.",
  ],
    keyCitiesProvinces: [
    "Vientiane",
    "Luang Prabang",
    "Savannakhet",
    "Pakse (Champasak)",
    "Vang Vieng",
    "Boten (Luang Namtha)",
    "Bokeo (Houayxay / Golden Triangle SEZ)",
  ],
    movementConstraints:
      "Surface movement is sparse outside Vientiane. The Laos-China Railway (Vientiane-Boten) and the Laos-China Railway extension projects have materially reduced north-south transit time. Wattay (VTE) is the principal international gateway; Luang Prabang (LPQ) and Pakse (PKZ) provide secondary capacity. Travel to UXO-contaminated provinces requires UXO-awareness planning.",
    infrastructureLimits:
      "Power supply is hydropower-dominated and exposed to seasonal availability; Laos is a net power exporter to Thailand. Mobile telecoms (Lao Telecom, Unitel, ETL) are dense in urban areas. Banking sector is FX-stressed; cash and informal-channel exposure is meaningful. Vientiane is the principal logistics gateway.",
    medicalEvac:
      "In-country tier-1 medical capability is limited. Vientiane offers Alliance International Medical Centre and a few private clinics. Serious cases typically route to Udon Thani (Thailand, ~1h by road), Bangkok or Singapore by ground or fixed-wing medevac. Dengue is year-round; malaria is present in the south; UXO is a standing operational hazard in rural areas.",
    resourceSectorExposure:
      "Hydropower (Nam Theun 2, Xayaburi, Don Sahong, Nam Ou cascades) anchors the export base, with EDL-Gen and Chinese / Thai developers as principal operators. The 2018 Xe-Pian Xe-Namnoy dam collapse (Attapeu) shapes ESG exposure. Mining (Sepon copper-gold, Phu Bia gold) is concentrated in Savannakhet and Xaisomboun. Garment manufacturing and Chinese SEZ investment (Boten, Golden Triangle, Saysettha Vientiane) sit across the rest of the foreign exposure.",
    locationWatchlist: [
    { label: "Vientiane", note: "Capital, banking and gateway", match: ["vientiane", "wattay", "vte"] },
    { label: "Luang Prabang", note: "Tourism centre, UNESCO site", match: ["luang prabang", "lpq"] },
    { label: "Golden Triangle SEZ", note: "Bokeo, Kings Romans, scam-compound concentration", match: ["golden triangle", "bokeo", "ton pheung", "kings romans", "houayxay", "houei sai"] },
    { label: "Boten", note: "China border, Laos-China Railway terminus", match: ["boten", "luang namtha", "mohan"] },
    { label: "Savannakhet / Pakse", note: "Southern logistics corridor", match: ["savannakhet", "pakse", "champasak"] },
    { label: "Plain of Jars / Xieng Khouang", note: "Heavy UXO contamination", match: ["xieng khouang", "plain of jars", "phonsavan"] },
    { label: "Mekong hydropower corridor", note: "Xayaburi / Don Sahong / Nam Theun 2 / Nam Ou", match: ["xayaburi", "don sahong", "nam theun", "nam ou", "xe pian", "xe-pian"] },
    { label: "Laos-China Railway", note: "Vientiane-Boten high-speed line", match: ["laos-china railway", "laos china railway", "boten-vientiane"] },
  ],
  };
  
const TIMOR_LESTE: CountryBaselineSeed = {
    countryNames: ["timor-leste", "timor leste", "east timor", "democratic republic of timor-leste"],
    operatingEnvironment:
      "Timor-Leste is a semi-presidential republic of roughly 1.4 million people across 13 municipalities, with Dili as the capital. Independent since 2002, the country has a young population, a small economy heavily reliant on petroleum-fund drawdowns, and is in the late stages of ASEAN-accession negotiation. Operating risk at street level is comparatively low — opportunistic crime, road-traffic risk and wet-season flooding dominate — and is structurally shaped by Greater Sunrise development uncertainty, recurring veterans-pension and political-party flashpoints, and severe infrastructure limits outside Dili.",
    securityContext:
      "Polícia Nacional de Timor-Leste (PNTL) lead public-order management; FALINTIL-FDTL (F-FDTL) is the small national defence force. UNMIT departed in 2012; Australia and Portugal maintain bilateral security cooperation. Recurring risk drivers are political-party mobilisation around presidential / parliamentary cycles (Fretilin, CNRT, PD), veterans-pension grievances, martial-arts-group (IKS / KORK) sporadic clashes, and Indonesian-border (Oecusse / Bobonaro) sensitivity.",
    knownRiskAreas: [
    "Dili central districts — political-rally focal point; opportunistic crime in waterfront and market areas.",
    "Indonesia border (Bobonaro, Cova Lima, Oecusse enclave) — periodic land-tenure friction, refugee-legacy exposure.",
    "Wet-season corridor — Nov-Apr, recurring flash flooding and landslides along the Dili-Baucau coastal road and interior districts.",
    "Greater Sunrise area (Timor Sea) — long-running maritime-boundary and gas-development friction.",
  ],
    keyCitiesProvinces: [
    "Dili",
    "Baucau",
    "Maliana (Bobonaro)",
    "Same (Manufahi)",
    "Oecusse (Pante Macassar)",
    "Suai (Cova Lima)",
    "Lospalos (Lautém)",
  ],
    movementConstraints:
      "Surface movement is sparse; the Dili-Baucau coastal road is the principal artery and is exposed to wet-season landslides. Presidente Nicolau Lobato (DIL) in Dili is the principal international gateway, with limited regional connections (Darwin, Bali, Singapore). Travel to Oecusse requires sea crossing or transit through Indonesian West Timor. Road movement to interior municipalities is slow and 4WD-dependent.",
    infrastructureLimits:
      "Power supply has expanded significantly with the Hera and Betano heavy-fuel-oil plants but remains intermittent in rural areas. Mobile telecoms (Telkomcel, Timor Telecom, Telemor) provide coverage along the coastal corridor; interior coverage is patchy. Dili Port is the principal logistics gateway; Tibar Bay deepwater port is under construction. No domestic refining; fuel imports dominate.",
    medicalEvac:
      "In-country tier-1 medical capability is not available. Hospital Nacional Guido Valadares (Dili) provides the highest in-country capacity. Serious cases typically route to Darwin (Australia, ~1.5h flight) or Singapore by fixed-wing medevac. Dengue is year-round; malaria is residual; TB prevalence is high.",
    resourceSectorExposure:
      "Bayu-Undan (Santos / SK E&S / Inpex / TEPCO, currently in decommissioning) and the long-pending Greater Sunrise project (Woodside / Osaka Gas / Timor GAP) anchor the petroleum-sector exposure. Tasi Mane south-coast development (Suai, Betano, Beaço) is the planned downstream / refining hub. Coffee (Ermera, Aileu) is the principal agricultural export.",
    locationWatchlist: [
    { label: "Dili", note: "Capital, political focal point", match: ["dili", "dil"] },
    { label: "Baucau", note: "Second city, eastern corridor", match: ["baucau"] },
    { label: "Oecusse enclave", note: "Indonesian-territory enclave (Pante Macassar)", match: ["oecusse", "pante macassar", "ambeno"] },
    { label: "Bobonaro / Cova Lima border", note: "Indonesia border districts", match: ["bobonaro", "maliana", "cova lima", "suai"] },
    { label: "Tasi Mane south coast", note: "Planned downstream / refining hub (Suai / Betano / Beaço)", match: ["tasi mane", "betano", "beaco"] },
    { label: "Greater Sunrise / Bayu-Undan", note: "Timor Sea gas assets", match: ["greater sunrise", "bayu-undan", "bayu undan", "timor sea"] },
    { label: "Lautém / Lospalos", note: "Easternmost municipality, Jaco Island", match: ["lospalos", "lautem", "lautém", "jaco"] },
  ],
  };
  
const AUSTRALIA: CountryBaselineSeed = {
    countryNames: ["australia", "commonwealth of australia"],
    operatingEnvironment:
      "Australia is a federal parliamentary democracy of roughly 26 million people across six states and two territories. Canberra is the political capital; Sydney and Melbourne concentrate financial and media weight. Operating risk at street level is low — opportunistic crime is the principal urban concern, public-order policing is professional, infrastructure is tier-1 — and is structurally shaped by bushfire / flood / cyclone exposure across the seasonal cycle, Indigenous-affairs and offshore-detention politics, and resource-sector industrial-relations cycles (Pilbara iron ore, WA / NT / QLD LNG).",
    securityContext:
      "State police forces lead public-order management; Australian Federal Police (AFP) handle federal jurisdiction and counter-terrorism alongside ASIO. Australian Defence Force (ADF) is deployed in disaster response and offshore patrols. Recurring focal points are climate / Indigenous-rights protests in Sydney / Melbourne / Canberra, pro-Palestine / Israel-Gaza-linked mobilisation since October 2023, Pine Gap and AUKUS-linked protests, and bushfire / flood emergency declarations.",
    knownRiskAreas: [
    "Bushfire corridor — NSW Blue Mountains and South Coast, Victorian East Gippsland, WA south-west, Tasmania: Oct-Mar peak season.",
    "Tropical cyclone corridor — Queensland (Townsville-Cairns), Northern Territory, WA Pilbara / Kimberley: Nov-Apr.",
    "Sydney CBD / Town Hall, Melbourne CBD / State Library — recurring protest corridors.",
    "Pilbara (WA) — iron-ore industrial-relations exposure (BHP, Rio Tinto, FMG), worksite-incident concentration.",
    "Cyber and foreign-interference posture — recurring large data-breach incidents (Optus, Medibank legacy) shape regulatory environment.",
  ],
    keyCitiesProvinces: [
    "Sydney (NSW)",
    "Melbourne (VIC)",
    "Brisbane (QLD)",
    "Perth (WA)",
    "Adelaide (SA)",
    "Canberra (ACT)",
    "Darwin (NT)",
  ],
    movementConstraints:
      "Surface and rail movement is excellent in capital cities. Sydney (SYD), Melbourne (MEL), Brisbane (BNE) and Perth (PER) are the principal international gateways. Domestic air via Qantas, Virgin Australia, Jetstar and Rex. Western Sydney (WSI) is opening as a second Sydney gateway. Bushfire- and cyclone-season transport disruption is recurring. Remote-area travel (Outback, Top End, Pilbara) requires fuel / comms / heat planning.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1 by global standards. Power supply is in transition (coal phase-down, renewables and storage build-out); peak-summer demand-response is recurring in NSW and Victoria. Major ports — Port Botany (Sydney), Melbourne, Brisbane, Fremantle, Port Hedland and Dampier (iron ore) — anchor exports.",
    medicalEvac:
      "Australia offers tier-1 medical capability domestically. Royal Flying Doctor Service (RFDS) provides remote-area medevac. International medevac is rarely required; regional cases (PNG, Solomons, Timor-Leste, Pacific Islands) commonly route to Cairns, Darwin or Brisbane. Sun exposure, snake / spider / marine-fauna and heatstroke are routine operational hazards in remote work.",
    resourceSectorExposure:
      "Mining and resources anchor foreign-investor exposure: iron ore (BHP, Rio Tinto, FMG, Hancock in the Pilbara), coal (BHP, Glencore, Whitehaven, Yancoal in NSW / QLD), copper-gold (Newcrest / Newmont, BHP Olympic Dam), nickel and lithium (WA), bauxite / alumina (QLD, WA). LNG exposure across the North West Shelf, Gorgon, Wheatstone, Ichthys (NT) and the QLD CBM LNG hub (Curtis Island). Agribusiness, financial services (Big Four banks, Macquarie), defence-industrial (AUKUS-aligned), and education / tourism complete the picture.",
    locationWatchlist: [
    { label: "Sydney", note: "Largest city, CBD / Town Hall protest corridor", match: ["sydney", "nsw", "new south wales", "town hall"] },
    { label: "Melbourne", note: "Second city, CBD / State Library protest corridor", match: ["melbourne", "vic", "victoria", "state library"] },
    { label: "Brisbane / SE Queensland", note: "Cyclone exposure to north, Olympics build-out", match: ["brisbane", "queensland", "qld", "gold coast", "sunshine coast"] },
    { label: "Perth / WA", note: "Resource-sector capital, Pilbara hinterland", match: ["perth", "western australia", "wa"] },
    { label: "Pilbara iron-ore belt", note: "Port Hedland / Dampier / Karratha / Newman; BHP, Rio, FMG", match: ["pilbara", "port hedland", "dampier", "karratha", "newman", "tom price", "paraburdoo"] },
    { label: "Darwin / NT", note: "Tropical north, defence-industrial, INPEX Ichthys", match: ["darwin", "northern territory", "nt", "alice springs", "pine gap"] },
    { label: "Cairns / Far North QLD", note: "Cyclone corridor, Cairns medevac hub", match: ["cairns", "townsville", "far north queensland"] },
    { label: "Canberra", note: "Federal capital, Parliament House protest cycles", match: ["canberra", "act", "parliament house"] },
    { label: "Curtis Island", note: "QLD CBM LNG export hub", match: ["curtis island", "gladstone"] },
    { label: "Northwest Shelf / Gorgon / Wheatstone", note: "WA LNG corridor", match: ["northwest shelf", "north west shelf", "gorgon", "wheatstone", "ichthys", "scarborough"] },
  ],
  };
  
const NEW_ZEALAND: CountryBaselineSeed = {
    countryNames: ["new zealand", "aotearoa", "aotearoa new zealand", "nz"],
    operatingEnvironment:
      "New Zealand / Aotearoa is a constitutional monarchy of roughly 5.2 million people, organised across 16 regions on two main islands plus Stewart Island and a small Pacific footprint. Wellington is the political capital; Auckland concentrates the commercial weight. Operating risk at street level is low — opportunistic crime is the principal urban concern, public-order policing is professional, infrastructure is tier-1 — and is structurally shaped by seismic exposure (Alpine Fault, Hikurangi subduction zone, Wellington Fault), volcanism, and recurring storm / flood events.",
    securityContext:
      "New Zealand Police lead public-order management; New Zealand Defence Force (NZDF) is small. Government Communications Security Bureau (GCSB) and NZ Security Intelligence Service (NZSIS) handle intelligence. Recurring focal points are Wellington (Parliament forecourt) protest cycles (the 2022 anti-mandate occupation being the most significant recent event), Treaty / co-governance debate around Waitangi Day (6 February), and climate / dairy / oil-and-gas-related mobilisation.",
    knownRiskAreas: [
    "Alpine Fault / Hikurangi subduction zone — standing megathrust earthquake exposure across South Island and lower North Island.",
    "Volcanic belt — Taupō Volcanic Zone (Ruapehu, Tongariro, Ngauruhoe, Whakaari/White Island, Tarawera): standing eruption risk.",
    "Wellington / Hutt Valley — Wellington Fault exposure, recurring storm and slip events.",
    "East Coast (Gisborne, Hawke's Bay) — Cyclone Gabrielle (Feb 2023) legacy, recurring flood and slip exposure.",
    "Auckland — recurring flood events (Jan 2023), volcanic-field exposure (Auckland Volcanic Field).",
  ],
    keyCitiesProvinces: [
    "Auckland",
    "Wellington",
    "Christchurch",
    "Hamilton",
    "Tauranga",
    "Dunedin",
    "Queenstown",
  ],
    movementConstraints:
      "Surface movement is well-supported in urban areas. Auckland (AKL), Wellington (WLG), Christchurch (CHC) and Queenstown (ZQN) are the principal aviation gateways. Cook Strait ferry crossing (Wellington-Picton) is exposed to storm-related disruption. Inter-island air via Air New Zealand and Jetstar. Remote South Island and West Coast travel requires weather planning.",
    infrastructureLimits:
      "Power, telecoms and transport are tier-1 by global standards. Power supply is hydropower-dominated, with seasonal-hydrology exposure during dry years. Ports of Auckland, Tauranga, Lyttelton (Christchurch), Napier and Wellington anchor trade.",
    medicalEvac:
      "New Zealand offers tier-1 medical capability domestically. International medevac is rarely required; specialist cases occasionally route to Australia. Seasonal influenza is routine.",
    resourceSectorExposure:
      "Dairy (Fonterra), meat (Silver Fern, Alliance), forestry, horticulture and tourism anchor the export base. Limited upstream oil and gas (Taranaki basin); the 2018 offshore exploration ban shaped the policy environment. No active onshore mining of global scale; lignite (Solid Energy legacy) and gold (Macraes, Waihi) are residual. Financial services (the Big Four Australian-owned banks plus Kiwibank) and education are stable contributors.",
    locationWatchlist: [
    { label: "Auckland", note: "Largest city, AVF volcanic-field exposure, recurring flood events", match: ["auckland", "akl"] },
    { label: "Wellington", note: "Capital, Wellington Fault, Parliament protest cycles", match: ["wellington", "wlg", "parliament forecourt"] },
    { label: "Christchurch / Canterbury", note: "2010-11 earthquake legacy", match: ["christchurch", "canterbury", "chc"] },
    { label: "East Coast / Hawke's Bay", note: "Cyclone Gabrielle legacy, recurring flood and slip", match: ["gisborne", "hawke's bay", "hawkes bay", "napier", "hastings", "wairoa"] },
    { label: "Taupō Volcanic Zone", note: "Ruapehu / Tongariro / Whakaari / Tarawera", match: ["ruapehu", "tongariro", "ngauruhoe", "whakaari", "white island", "tarawera", "taupo"] },
    { label: "Alpine Fault / Hikurangi", note: "Megathrust earthquake exposure", match: ["alpine fault", "hikurangi"] },
    { label: "Taranaki", note: "Upstream oil and gas, dairy", match: ["taranaki", "new plymouth"] },
    { label: "Queenstown / Southern Lakes", note: "Tourism centre", match: ["queenstown", "wanaka", "zqn"] },
    { label: "Cook Strait", note: "Wellington-Picton ferry corridor", match: ["cook strait", "picton"] },
  ],
  };
  
export const COUNTRY_BASELINE_SEEDS: CountryBaselineSeed[] = [
    PAPUA,
    PAPUA_NEW_GUINEA,
    INDONESIA,
  PHILIPPINES,
  THAILAND,
  MALAYSIA,
  VIETNAM,
  MYANMAR,
  INDIA,
  PAKISTAN,
  BANGLADESH,
  SRI_LANKA,
  SOUTH_KOREA,
  JAPAN,
  TAIWAN,
  CHINA,
  HONG_KONG,
  SINGAPORE,
  CAMBODIA,
  LAOS,
  TIMOR_LESTE,
  AUSTRALIA,
  NEW_ZEALAND,
  ];
  