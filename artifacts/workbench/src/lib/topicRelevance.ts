// Per-topic relevance filter.
//
// Reports must only include records that match the report's operational
// purpose. A record that merely mentions "fuel" in a hiking obituary is
// not a fuel incident and must not appear in the Fuel report table,
// Fast Facts or prose.
//
// The filter is keyword based: each topic has a list of REQUIRED phrases
// (one must match) plus a shared list of EXCLUDED phrases that mark a
// record as off-topic regardless of keyword hits (live news blogs,
// general death/travel stories, etc).

export interface RelevanceInput {
  topic: string;
  title: string;
  summary?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  location?: string | null;
}

// Exclusions for clearly off-topic items. Keep these narrow so they only
// strip recognisable noise (live news blogs, hiking obituaries, sports
// and entertainment fluff) and never drop legitimate operational records.
const EXCLUDE_PHRASES: RegExp[] = [
  /\bnews live\b/,
  /\blive (updates?|blog)\b/,
  /^live:/,
  /\bhiking\b/,
  /\binca trail\b/,
  /\btourist who died\b/,
  /\bobituary\b/,
  /\bsport(s)? results?\b/,
  /\bmatch report\b/,
  /\bbox office\b/,
  /\bcelebrity\b/,
  /\bentertainment news\b/,
  /\brecipe\b/,
];

// Cargo-specific exclusions. Cargo Watch covers operational cargo and
// logistics-node crime: hijack, truck/container theft, warehouse and
// depot pilferage, broken seals and logistics-crime stories. Pure
// retail-theft tickers, shoplifting, vehicle break-ins, residential
// burglary and stock-price commentary on logistics groups are not the
// same risk picture and must not pollute the report.
const CARGO_EXCLUDE: RegExp[] = [
  /\b(shoplift|shoplifting|shoplifter)/,
  /\b(retail (theft|crime) (index|tracker|ticker|wave))/,
  /\bsmash[- ]and[- ]grab\b/,
  /\bporch (pirate|theft)/,
  /\b(car|vehicle) (theft|break[- ]in)\b/,
  /\bcatalytic converter (theft|stolen)/,
  /\b(home|house|residential) (burglary|invasion)/,
  /\b(share price|stock price|equity|earnings|quarterly (result|results)|dividend|buyback|ipo|market cap) .{0,40}(logistics|freight|transport|shipping|cargo)/,
  /^other cargo incident$/i,
  // Advisory, explainer, conference and enforcement-commentary pieces.
  // Cargo Watch reports concrete in-region theft/hijack EVENTS — not
  // op-eds about cargo-theft trends, agency warnings, industry-body
  // lobbying or conference agendas, even when they say "cargo theft".
  /\b(cargo|freight) (theft|crime) (scheme|schemes|recovery|prevention|awareness|trend|trends|statistics|report|conference|summit|meeting|playbook|enforcement)\b/,
  /\b(to tackle|tackling|combat(?:ing)?|fight(?:ing)?|crack(?:ing)? down on) .{0,20}(cargo|freight) (theft|crime)\b/,
  /\b(valid carrier authorities|carrier authority|double[- ]brokering|fictitious pickup|strategic theft)\b/,
  /\bbusiness meeting\b/,
  /\b(fbi|interpol|europol|homeland security|\bdhs\b)\b.{0,30}(warn|warns|warning|alert|advisory)/,
  // US-jurisdiction agency advisories (incl. foreign-language syndication of
  // them) are not APAC cargo-operational incidents. Gate FBI on advisory/
  // warning framing (incl. CJK "경고"/"警告") so a genuine APAC hijack that
  // merely mentions FBI assistance is NOT dropped.
  /\bfbi\b.{0,20}(warn|warns|warning|alert|alerts|advisory|advises?|caution|경고|警告)/i,
  /(경고|警告).{0,10}\bfbi\b/i,
  // Out-of-region (Nigeria) leak: this is the APAC cargo report, so an Ogun
  // State incident is out of scope. Gate on Nigeria/police context rather
  // than a bare "ogun" token so an APAC record can never be hard-dropped.
  /\bogun\b.{0,30}(nigeria|nigerian|police|state)|(nigeria|nigerian).{0,30}\bogun\b/i,
  /\b(association|federation|council|chamber|industry body)\b.{0,40}(urges?|calls? on|requests?|asks?|press(?:es)?|demands?).{0,30}(govern|justice|ministry|department|police|\bdoj\b|authorities)/,
  /\bshows what enforcement can do\b/,
];

// Fuel-specific exclusions. Pure market speculation, equity/finance news
// and broad oil-price commentary with no operational signal must never
// lead a Fuel Watch. These records may mention "oil" or "fuel" but they
// are not fuel-operational incidents.
const FUEL_EXCLUDE: RegExp[] = [
  /\b(share price|stock price|equity|investor (call|day|update)|earnings|quarterly (result|results|report)|annual report|dividend|buyback|ipo|market cap)/,
  /\b(oil futures|crude futures|brent futures|wti futures|futures contract|options trading|hedge fund|speculat(or|ors|ion|ive))/,
  /\b(analyst (note|target|forecast)|broker (note|target)|price target|sell[- ]side|buy[- ]side rating|upgrade rating|downgrade rating)/,
  /\b(oil (price|prices) (forecast|outlook|view|prediction|projection) (for|to))/,
  // Bank/research-house price-call commentary on crude / Brent / WTI.
  // These read as market projections, not fuel-operational incidents,
  // and were polluting Related Incidents (e.g. "Citi forecasts Brent
  // crude to reach $120 per barrel"). Match any "<verb> <oil/crude>
  // (… to reach|hit|climb|fall|drop|surge|… per barrel|… per bbl|…
  // \$NN)" pattern, plus an explicit list of bank/research names.
  /\b(forecasts?|projects?|projecting|predicts?|predicting|expects?|expecting|sees|seeing|targets?|targeting|raises?|raising|lowers?|lowering|cuts?|cutting|hikes?|hiking) (its )?(brent|wti|crude|oil) .{0,40}(to (reach|hit|rise|climb|fall|drop|surge|touch|near|trade)|at \$|near \$|above \$|below \$|per barrel|per bbl)/,
  // Bank/research-house headlines that are explicitly price-call
  // commentary. We require BOTH a forecast-style verb AND a price-call
  // context word (brent|wti|crude|oil|price|target|per barrel|$NN) in
  // the same headline so we do not suppress legitimate operational
  // headlines such as "Citi raises concerns about refinery outage".
  /\b(citi|citigroup|goldman( sachs)?|jpmorgan|jp morgan|morgan stanley|hsbc|barclays|ubs|deutsche bank|standard chartered|bank of america|baml|wood ?mac(kenzie)?|rystad|argus|s&p global|platts|sp global) (forecasts?|projects?|sees|expects?|predicts?|targets?|raises?|lowers?|cuts?|hikes?) .{0,60}(brent|wti|crude|oil|price target|per barrel|per bbl|\$\d)/,
  // Generic "petrol prices today / diesel rates today" headlines with no
  // change indicator. These read as live-blog tickers, not operational
  // fuel signal, and dilute the Related Incidents table.
  /\b(petrol|diesel|fuel) (price|prices|rate|rates) today\b/,
  /\b(today'?s (petrol|diesel|fuel) (price|prices|rate|rates))/,
  // Records that the upstream classifier dropped into the catch-all
  // "Other fuel incident" bucket carry no operational signal and must
  // not lead a Fuel Watch.
  /^other fuel incident$/i,
  // EV / demand-shift commentary. "Oil shock sparks surge in EV sales"
  // is a demand-substitution story, not a fuel-supply incident, even
  // though it mentions oil.
  /\b(ev|electric vehicle|electric[- ]car|electric[- ]vehicle) sales?\b/,
  /\bsurge in ev\b/,
  // PR / booster commentary — subsidy-leadership praise and industry-
  // dialogue applause are promotional, not operational fuel signal.
  /\b(applauds?|lauds?|praises?|hails?|welcomes?|congratulates?)\b.{0,40}(leadership|reform|initiative|vision|dialogue|effort|stewardship)/,
];

// Shipping-specific exclusions. Food-price commentary, airline fuel cost
// stories and food-security analysis must never lead a Shipping report,
// even when the text mentions a chokepoint or freight word in passing.
// These records may discuss shipping in macro terms but they are not
// operational maritime incidents.
// Flashpoint-specific exclusions. The Flashpoint surface covers
// activism, protest, labour action and civil unrest. The word "rally"
// is heavily overloaded (sports, motorsport, equities, FX, bond, oil,
// concert/fan rallies) and the word "strike" is heavily overloaded
// (lightning/thunder/storm strike, military strike, drone/missile
// strike). Country-name Google News queries pull these homonyms in
// directly, and they were leaking into the Activism Records table.
// Each pattern below kills a recognised homonym so the relevance
// gate can keep the legitimate public-order meaning of those words.
const FLASHPOINT_EXCLUDE: RegExp[] = [
  // Sports: baseball/cricket/football "rally", "rally past", "rally to
  // beat", "rally to win", "wins after rally", "late rally", "ninth-
  // inning rally", "tournament rally", "racing rally", motorsport
  // event names ("Rally Japan", "WRC Rally", "Round N - Rally X").
  /\brally (past|to (beat|defeat|win|tie|overcome)|caps|seals|secures|stuns|sinks|past the|from \d+)/,
  /\b(wins?|won|beats?|beat|stuns?|stunned|tops|topped|edges?|edged) .{0,40}(after|with|on) .{0,20}rally\b/,
  /\b(late|ninth[- ]inning|eighth[- ]inning|seventh[- ]inning|fourth[- ]quarter|comeback|come[- ]from[- ]behind|game[- ]winning|series[- ]clinching|tournament) rally\b/,
  /\brally (japan|finland|sweden|portugal|mexico|argentina|chile|spain|italy|monte[- ]carlo|kenya|safari|estonia|croatia|acropolis|catalunya|wales|gb|australia|new zealand)\b/,
  /\b(wrc|world rally championship|rally championship|rally cross|rallycross|dakar rally|paris[- ]dakar)\b/,
  /\bround \d+ [-–] rally\b/,
  /\b(rays|yankees|mets|red sox|cubs|dodgers|giants|astros|orioles|phillies|braves|cardinals|marlins|blue jays|royals|tigers|twins|rangers|mariners|angels|athletics|padres|rockies|nationals|brewers|pirates|reds|guardians|white sox|d[- ]?backs|diamondbacks) (rally|rallied|rallies)/,

  // Finance / markets: stock, share, equity, bond, currency, FX,
  // commodity rallies. "Ringgit rally", "Rupee rally", "Stocks extend
  // rally", "Brent rally", "Gold rally", "Bitcoin rally".
  /\b(stock|stocks|share|shares|equity|equities|market|markets|index|nifty|sensex|nikkei|kospi|hang seng|shanghai composite|kse[- ]?100|psx|jci|ftse|s&p|nasdaq|dow|asx|set index|pse(i)?|vn[- ]index|wall street|wall[- ]?st|main street) .{0,60}rally\b/,
  /\brally\b .{0,30}(stocks?|shares?|equit(y|ies)|markets?|bonds?|treasur(y|ies)|currenc(y|ies)|commodities?|wall street|nikkei|kospi|sensex|nifty|hang seng|ftse|s&p|nasdaq|dow|psei|jci)/,
  // "PSEi rebounds above 5,900 on Wall Street rally" — index name +
  // points/level + "on … rally" is unambiguously a markets headline.
  /\b(psei|nifty|sensex|nikkei|kospi|hang seng|shanghai composite|ftse|s&p|nasdaq|dow|asx|jci|kse[- ]?100|vn[- ]index|set index) .{0,50}(rally|rebound|surge|jump|gain|loss|drop|slip|fall|close|opens?)/,
  /\brally (in|across) .{0,20}(stocks?|shares?|equit(y|ies)|markets?|bonds?|treasur(y|ies)|currenc(y|ies)|commodities?)/,
  /\b(extend|extends|extended|extending|continues?|continued|continuing|halts?|halted|stalls?|stalled|fades?|faded|sparks?|sparked|ignites?|ignited|drives?|drove|lifts?|lifted|powers?|powered|fuels?|fuelled|fueled) (its |a |the )?rally\b/,
  /\b(\d+[- ]day|multi[- ]day|two[- ]day|three[- ]day|week[- ]long|month[- ]long|year[- ]end|santa|relief|bear[- ]market|bull[- ]market|tech|chip|ai|crypto|bitcoin|ethereum|gold|silver|oil|crude|brent|wti|copper|iron ore|treasury|bond|dollar|yen|euro|pound|sterling|yuan|renminbi|ringgit|rupee|rupiah|peso|baht|dong|kyat|taka|kip) rally\b/,
  /\brally (fizzles|stalls|fades|ends|cools|extends|continues|pauses|resumes)\b/,
  /\bends? .{0,15}rally\b/,
  /\b(ringgit|rupee|rupiah|peso|baht|yuan|renminbi|dong|kyat|taka|kip|won|yen|dollar|euro|pound|sterling|riyal|dirham|lira) .{0,20}(rally|rallied|rallies|gains?|jumps?|surges?)\b.{0,40}(against|versus|vs\.?) /,
  /\brally past (\$|us\$|usd|inr|rs\.?|rm|php|idr|myr|jpy|cny|eur|gbp|sgd|aud|hkd|krw)/,

  // Weather / natural: "lightning/thunder/storm strike", "rain and
  // thunder strike", "cyclone strike", "typhoon strike", "tsunami
  // strike". These are weather events, not industrial action.
  /\b(lightning|thunder|storm|rain|hail|snow|blizzard|cyclone|typhoon|hurricane|tornado|tsunami|earthquake|quake|flood|monsoon|heatwave|cold wave) (strike|strikes|struck|striking)/,
  /\b(strike|strikes|struck|striking) .{0,30}(provinces?|districts?|villages?|towns?|cities|coast|region) .{0,40}(rain|thunder|lightning|storm|cyclone|typhoon|hurricane|monsoon|flood)/,
  /\brain and thunder\b/,

  // Military / kinetic homonyms. "Drone strike", "missile strike",
  // "air strike", "airstrike", "Ukrainian strike", "Russian strike",
  // "Israeli strike", "junta strike", "military strike", "IBO",
  // "intelligence-based operation", named militant groups attacking.
  // The flashpointReportDataset kinetic filter is the deeper guard,
  // but blocking these at the relevance gate prevents them from ever
  // being scored as activism in the first place.
  /\b(drone|missile|air|artillery|naval|precision|cruise|ballistic|hypersonic|stealth|tactical|surgical|retaliatory|pre[- ]?emptive|joint|coalition|allied) (strike|strikes|struck|striking)/,
  /\bair[- ]?strike(s)?\b/,
  /\b(ukrainian|russian|israeli|hamas|hezbollah|houthi|iranian|us|american|nato|saudi[- ]led|coalition|israeli[- ]defen[cs]e|idf|junta|myanmar (army|junta|military)|tatmadaw|pla|chinese (army|pla)|indian (army|military)|pakistani (army|military)|afghan (taliban|forces)|taliban|isis|islamic state|isk|iskp|al[- ]qaeda|tehrik[- ]?i[- ]?taliban|\bttp\b|\bbla\b|baloch (liberation|raj)|maoist|naxal|lashkar|jaish) .{0,30}(strike|strikes|struck)/,
  /\bstrike (on|against|at|hits|hit|kills|killed|destroyed|levels?|leveled|levelled) .{0,40}(college|school|hospital|town|village|city|base|airfield|airbase|airport|port|depot|barracks|convoy|installation|facility|refinery|pipeline|grid|building|residential)/,
  /\b(intelligence[- ]based operation|\bibo\b|counter[- ]?terror(ism)? (operation|raid|action)|search (and|&) (cordon|destroy) operation|cordon and search)/,
  /\b\d+\s+(terrorists?|militants?|insurgents?|gunmen|attackers?|fighters?)\s+(killed|neutralis(e|ed)|gunned down|eliminated|dead)\b/,

  // Entertainment / events: concert rallies, fan rallies, product
  // launch rallies, promotional rallies, "rally for <artist> concert".
  /\b(concert|fan|gig|tour|album|product launch|launch|promotional|promo|brand|sale|crowdfund|donation drive) rally\b/,
  /\brally (for|to see|to meet|to support|to celebrate) .{0,30}(concert|gig|tour|album|launch|artist|singer|band|actor|star|celebrity|idol)/,
  /\b(anne curtis|taylor swift|bts|blackpink|gracie abrams|ed sheeran|coldplay|harry styles|olivia rodrigo|sabrina carpenter)\b/i,

  // Finance / markets, second pass. The patterns above key on an explicit
  // instrument word adjacent to "rally"; these catch the cases where the
  // market signal is a *result* word (rout, valuation, profit, earnings,
  // a percentage move) rather than a named instrument — e.g. "Japan cable
  // maker rout exposes cracks in AI infrastructure rally", "Nokia's 140%
  // rally turns AI comeback into valuation puzzle", "tin rally lifts profit
  // fivefold".
  /\b\d+(\.\d+)?%\s+rally\b/,
  /\b(ai|tech|chip|semiconductor|infrastructure|valuation|earnings|ipo|listing) (\w+ ){0,2}rally\b/,
  /\b(rout|sell[- ]?off|valuation|profit|profits|earnings|fivefold|record (high|low)|investors?) .{0,40}rally\b/,
  /\brally\b .{0,40}(rout|valuation|profit|profits|earnings|fivefold|investors?|record (high|low)|shares?)/,
  /\b(tin|copper|aluminium|aluminum|nickel|zinc|steel|smelting|smelter|palm oil|crude|brent|wti) (\w+ ){0,2}rally\b/,
  /\brally lifts? (profit|profits|earnings|shares?|sales|stock)/,

  // Sports, second pass. Match-report vocabulary that the named-league
  // list above misses: a goal "strike" reported at half/full time, players
  // "rallying" behind a team-mate, a "protest" over a referee's call, and
  // the regional sports the league list omits (sepak takraw, kabaddi, etc).
  // "half-time"/"full-time" only when a match-report word is adjacent —
  // bare "full-time workers rally" is a legitimate labour headline and must
  // NOT be dropped.
  /\b(half|full)[- ]time\b.{0,40}\b(goal|score|scored|leads?|ahead|trail|equalis|equaliz|against|kick[- ]?off|win|won|beat|draw|drawn|nil|penalty|striker)\b/,
  /\b(goal|score|scored|leads?|ahead|trail|equalis|equaliz|kick[- ]?off|striker|midfield|winger|keeper)\b.{0,40}\b(half|full)[- ]time\b/,
  /\bplayers rally\b/,
  /\brally behind .{0,30}(player|team|club|coach|captain|striker|side|squad)/,
  /\b(sepak )?takraw\b|\b(kabaddi|badminton|volleyball|netball|handball|futsal|sepaktakraw)\b/,
  /\b(protest|protests|protested|protesting) .{0,20}(referee|umpire|umpiring|the call|the decision|the result|the score|penalty|red card|offside|\bvar\b|disqualif)/,
  /\breferee.?s? (call|decision|ruling)\b/,

  // Business "strike a deal" — commercial agreement, not industrial action.
  /\bstrik(e|es|ing) (a |the |an |new |fresh |landmark |historic )?(deal|agreement|accord|pact|partnership|bargain|alliance|truce)\b/,

  // Fact-check / debunk pieces that explicitly say the footage is NOT a
  // protest, plus generic misinformation framing.
  /\bnot (a |an )?(protest|rally|riot|demonstration|march)\b/,
  /\b(fact[- ]check|misleading|false(ly)? (claim|shared)|debunk(ed|s)?|no evidence|misrepresent|old (video|clip|footage)|unrelated (video|clip|footage|event))\b/,

  // Opinion-poll / approval-rating stories — a survey result, not an event.
  /\b(net satisfaction|satisfaction rating|approval rating|disapproval rating|net trust|opinion poll|pollster|\bsws\b|pulse asia|survey (shows|finds|reveals|said|found))\b/,

  // Public-health outbreaks caught on "outbreak" co-occurring with civil
  // unrest vocabulary elsewhere in the feed. A disease outbreak is not
  // civil unrest.
  /\b(bird flu|avian (influenza|flu)|h5n1|swine flu|dengue|malaria|cholera|measles|nipah|covid|coronavirus) (outbreak|case|cases|confirmed|detected|spread|death|deaths)\b/,
  /\b(disease|virus|flu) outbreak\b/,
];

const SHIPPING_EXCLUDE: RegExp[] = [
  /\bfao\b/,
  /\bfood price (index|inflation|increase|rise|surge)/,
  /\bfood (prices|inflation|security|crisis|insecurity)\b/,
  /\b(world food (program|programme)|wfp)\b/,
  /\bairline (fuel|jet fuel) (cost|price|prices|surcharge)/,
  /\bjet fuel (cost|price|prices|surcharge)/,
  /\b(grain|wheat|rice|corn|soybean|edible oil) (price|prices|market|outlook)\b/,
  /\bcommodity price index\b/,
  // Vessel sale-and-purchase / newbuild / ship-finance deals. Commercial
  // tonnage trading ("suezmax newbuilds", "cashes in on ageing suezmax
  // pair", "lands $65m for ageing suezmax", "pockets $29m gain from
  // veteran suezmax disposal") is not a maritime-security or disruption
  // incident, even though it names a vessel class. Gate "newbuild" on
  // commercial/orderbook framing so a genuine attack/seizure of a newly
  // built tanker is NOT dropped (EXCLUDE runs before REQUIRED).
  /\b(heads? back to|returns? to|back in|reverts? to|orders?|orderbook|order book|fleet renewal|invests? in|expands?.{0,15}fleet|signs?|inks?|places?|cancels?|delivery of|delivered)\b.{0,25}newbuild/i,
  /\bnewbuild(s|ing)?\b.{0,25}(order|orders|orderbook|order book|programme|program|deal|contract|delivery|delivered|christen|named|spree|push|tally|wave)/i,
  /\b(suezmax|vlcc|aframax|panamax|capesize|handysize|bulker|boxship|containership) (pair|trio|duo|disposal|sale|resale)\b/,
  /\b(cashes? in|pockets?|nets?|bags?|lands?|snaps? up|offloads?|disposes?|sells?|buys?|orders?)\b.{0,30}(suezmax|vlcc|aframax|panamax|capesize|bulker|boxship|containership|tanker|vessel|tonnage)\b/,
  /\b(ageing|aging|veteran|elderly|second[- ]hand|secondhand) (suezmax|vlcc|aframax|panamax|capesize|bulker|boxship|containership|tanker|vessel|pair|trio|duo|tonnage)\b/,
  /\b\$\d+\s*m?\s*(gain|profit) from\b/,
  /\bgain from .{0,20}(disposal|sale|vessel|tanker)\b/,
];

const REQUIRED: Record<string, RegExp[]> = {
  fuel: [
    /\bfuel (shortage|price|prices|protest|protests|supply|stockout|rationing|tanker|truck)/,
    /\bpetrol (shortage|price|prices|station)/,
    /\bdiesel (shortage|price|prices|supply)/,
    /\b(refinery|refineries) (disruption|outage|shutdown|fire|attack|maintenance|closure|halt)/,
    // Narrowed: macro oil/crude commentary is admitted only when it
    // carries an operational signal (disruption, shortage, halt, ban,
    // attack, sanctions or supply-side event). Plain "oil prices rose"
    // commentary is intentionally excluded — it belongs in market notes.
    /\b(oil|crude) (shortage|supply (cut|halt|disruption|squeeze)|export ban|export halt|embargo|sanctions|outage|attack|sabotage|spill)/,
    /\b(subsidy|subsidies|levy|levies|duty|excise|tax) .{0,30}(fuel|petrol|diesel|gas|lpg|kerosene|jet fuel)/,
    /\b(fuel|petrol|diesel|gas|lpg|kerosene|jet fuel) .{0,30}(subsidy|levy|duty|excise|tax) (cut|hike|raise|removal|removed|reform|reintroduce)/,
    /\btanker (driver|drivers|strike|shortage|attack|convoy|blockade)/,
    /\b(lpg|cng) (shortage|price|supply)/,
    /\bpump (price|prices)\b/,
    /\bforecourt (closure|queue|disruption|shut)/,
    /\bhormuz .{0,40}(oil|crude|tanker|fuel|shipping|supply|price)/,
    /\b(oil|crude|tanker|fuel|shipping|supply|price) .{0,40}hormuz\b/,
  ],
  fertiliser: [
    /\bfertili[sz]er (shortage|price|prices|supply|export|import|stockout|subsidy)/,
    /\b(urea|potash|dap|nitrogen|phosphate|ammonia) (price|prices|export|import|supply|shortage|plant)/,
    /\bfarmer.{0,15}(protest|strike|rally)/,
    /\bplant (closure|shutdown|outage|maintenance) .{0,30}(fertili[sz]er|urea|potash|dap|ammonia|phosphate)/,
    /\bfood security\b/,
  ],
  energy: [
    /\b(power|grid|electricity) (outage|cut|blackout|disruption|failure|shortage|crisis|tariff)/,
    /\bload[ -]shedd/,
    /\bsubstation (fire|attack|failure|outage|sabotage)/,
    /\b(generation|capacity) shortfall/,
    /\b(transmission|pipeline) (attack|sabotage|disruption|outage|failure)/,
    /\b(gas|diesel|coal) .{0,20}power\b/,
    /\benergy (crisis|shortage|tariff|emergency)/,
  ],
  shipping: [
    /\b(vessel|tanker|ship|cargo ship|container ship|bulk carrier) (attack|attacked|seizure|seized|boarding|missile|drone|fire|sinking|collision|adrift)/,
    /\battack (on|against) (a |an |the )?(vessel|tanker|ship|cargo ship|container ship|bulk carrier|crew)/,
    /\b(missile|drone) (strike|attack) .{0,30}(ship|vessel|tanker|maritime|port|hormuz|red sea)/,
    /\bport (closure|shutdown|strike|congestion|disruption|attack|berth|backlog)/,
    /\bchokepoint\b/,
    /\b(strait of hormuz|bab[- ]el[- ]mandeb|suez|malacca|singapore strait)/,
    /\b(naval|maritime) (advisory|warning|alert|patrol|operation)/,
    /\b(war risk|p&i|insurance premium) .{0,30}(shipping|vessel|tanker|maritime)/,
    /\b(route|routing|reroute|diversion) .{0,30}(vessel|tanker|ship|maritime|red sea|hormuz|suez|cape)/,
    /\bfreight rate/,
  ],
  cargo_watch: [
    /\b(cargo|truck|container|warehouse|depot) (theft|robbery|hijack|raid|pilferage|stolen|loss)/,
    /\b(hijack|hijacked|hijacking) .{0,30}(truck|lorry|convoy|cargo|container)/,
    /\bseal tamper/,
    /\binsider .{0,20}(theft|pilferage|tip-off)/,
    /\blogistics crime/,
    /\b(broken seal|seal break|seal broken)/,
  ],
  // Protests / Flashpoint use a two-tier match: an UNAMBIGUOUS phrase
  // alone is sufficient, but the ambiguous tokens "rally", "strike"
  // and "student(s)" must additionally co-occur with a public-order
  // cue (see FLASHPOINT_AMBIGUOUS_RE + FLASHPOINT_PUBLIC_ORDER_CUE_RE
  // below). The REQUIRED entries here represent only the unambiguous
  // tier; the ambiguous tier is enforced separately in
  // `isTopicRelevant` for `protests` and `flashpoint`.
  protests: [
    /\b(protest|demonstration|march|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|crackdown|industrial action|strike notice|hartal|bandh|gherao)\b/,
    /\b(farmers|workers|union|opposition|civil society|activists) .{0,30}(protest|march|gather|demonstrate|mobilis(e|ed)|mobiliz(e|ed))/,
    /\b(police|security forces?) .{0,30}(clash|crackdown|tear gas|baton|rubber bullet|water cannon) .{0,30}(protest|demonstration|march|crowd|mob|sit[- ]?in)/,
    /\b(curfew|state of emergency|martial law|lockdown imposed|section\s*144|assembly ban)\b/,
  ],
  flashpoint: [
    /\b(protest|demonstration|march|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|crackdown|industrial action|strike notice|hartal|bandh|gherao)\b/,
    /\b(farmers|workers|union|opposition|civil society|activists) .{0,30}(protest|march|gather|demonstrate|mobilis(e|ed)|mobiliz(e|ed))/,
    /\b(police|security forces?|military) .{0,30}(clash|crackdown|tear gas|baton|rubber bullet|water cannon) .{0,30}(protest|demonstration|march|crowd|mob|sit[- ]?in)/,
    /\b(curfew|state of emergency|martial law|lockdown imposed|section\s*144|assembly ban)\b/,
  ],
};

// Ambiguous tier for the flashpoint/protests relevance gate. These
// tokens are too heavily overloaded to admit on their own — they need
// an explicit public-order companion in the same record.
const FLASHPOINT_AMBIGUOUS_RE =
  /\b(rally|rallies|rallied|strike|strikes|striking|struck|students?)\b/;

// Public-order companion. If a record's only flashpoint signal is an
// ambiguous token (rally/strike/student), one of these cues must also
// be present or the record is dropped. This is the rule the user
// requires for headlines like "Stocks extend rally" or "Lightning
// strike kills three" — both have an ambiguous trigger but no
// public-order companion, so they are not flashpoint material.
const FLASHPOINT_PUBLIC_ORDER_CUE_RE =
  /\b(protest|demonstration|march|sit[- ]?in|picket|union|labour|labor|workers|workers'|trade union|activist|activists|police|arrest|arrested|detained|detention|curfew|assembly ban|section\s*144|roadblock|blockade|public disorder|civil unrest|strike notice|walkout|stoppage|industrial action|crackdown|tear[- ]?gas|water cannon|baton|rubber bullet|riot police|hartal|bandh|gherao|shutter[- ]down|wheel[- ]jam|chakka jam|long march|million march|sit[- ]?in|opposition (rally|march|protest)|pti|imran khan|tehreek[- ]?e[- ]?insaf|student union|campus protest|teachers? (protest|march|strike)|nurses? (protest|march|strike)|doctors? (protest|march|strike)|chemists? (protest|march|strike|walkout|shutdown)|pharmacists? (protest|march|strike|walkout|shutdown)|lawyers? (protest|march|strike|walkout|boycott)|traders? (protest|march|strike|shutdown)|transporters? (protest|march|strike|stoppage))\b/;

// Student-specific extra guard. A record whose only flashpoint hook
// is the word "student(s)" must also describe mobilisation or public-
// order action against students — not crime stories about a student,
// not education-policy notes, not a military strike on a school.
const STUDENT_MOBILISATION_RE =
  /\b(student (protest|protests|union|unions|movement|march|rally|sit[- ]?in|walkout|strike|boycott|mobilisation|mobilization)|students? (protest|protests|protested|protesting|march|marched|marching|rally|rallied|gather|gathered|stage(d)? (a )?(sit[- ]?in|walkout|protest|march|demonstration|boycott)|clash(ed)? with police|arrest(ed)?|detained|tear[- ]?gassed|baton[- ]?charged|launched (a )?(campaign|movement|drive)|occupy|occupied)|campus (protest|unrest|crackdown|sit[- ]?in)|students? (and|along with) (teachers|workers|farmers|activists))\b/;

// Non-mobilisation student stories (school attacks, education policy,
// crime stories involving students, military strikes on schools).
// These are NOT student protests and must be excluded even if the
// public-order cue regex happens to match incidentally.
const STUDENT_NON_MOBILISATION_RE =
  /\b((attack|attacked|attacks|bomb|bombed|bombing|shooting|stabbing|shot dead|killed|raped|abducted|kidnapped|missing) .{0,40}(student|students|pupil|pupils|schoolchildren|schoolgirl|schoolboy|college|university|campus)|(student|pupil|schoolchildren|schoolgirl|schoolboy) .{0,30}(raped|killed|abducted|kidnapped|stabbed|shot dead|missing|murdered)|education (policy|reform|budget|act|bill|board exam|board examination|results)|(strike|airstrike|missile|drone) (on|hits|kills|killed|destroyed) .{0,30}(college|school|university|campus|hostel)|exam (scandal|leak|cheating|fraud|controversy|results)|admission (deadline|policy|quota))\b/;

function haystack(i: RelevanceInput): string {
  return [
    i.title ?? "",
    i.summary ?? "",
    i.source ?? "",
    (i.sourceUrl ?? "").replace(/[-_/]/g, " "),
    i.location ?? "",
  ].join(" ").toLowerCase();
}

/**
 * Return true when the record is genuinely about the report's topic.
 * Returns true (allows the record through) for topics with no rule, so
 * unknown report families do not silently empty their tables.
 */
export function isTopicRelevant(topic: string, i: RelevanceInput): boolean {
  const text = haystack(i);
  for (const re of EXCLUDE_PHRASES) {
    if (re.test(text)) return false;
  }
  if (topic === "shipping") {
    for (const re of SHIPPING_EXCLUDE) {
      if (re.test(text)) return false;
    }
  }
  if (topic === "fuel") {
    for (const re of FUEL_EXCLUDE) {
      if (re.test(text)) return false;
    }
  }
  if (topic === "cargo_watch") {
    for (const re of CARGO_EXCLUDE) {
      if (re.test(text)) return false;
    }
  }
  if (topic === "flashpoint" || topic === "protests") {
    // 1. Hard exclusions first — sports/finance/weather/military/
    //    entertainment homonyms of "rally" / "strike" / "student".
    for (const re of FLASHPOINT_EXCLUDE) {
      if (re.test(text)) return false;
    }
    // 2. Non-mobilisation student stories (school attacks, crime
    //    stories, education policy) are never flashpoint, even if
    //    the public-order cue regex incidentally matches.
    if (STUDENT_NON_MOBILISATION_RE.test(text)) return false;
    // 3. Unambiguous-tier match: any REQUIRED.flashpoint phrase
    //    qualifies on its own.
    const unambiguous = REQUIRED[topic] ?? [];
    for (const re of unambiguous) {
      if (re.test(text)) return true;
    }
    // 4. Ambiguous-tier match: bare "rally" / "strike" needs a
    //    public-order companion; bare "student(s)" needs a student-
    //    mobilisation phrase.
    if (FLASHPOINT_AMBIGUOUS_RE.test(text)) {
      const mentionsStudent = /\bstudents?\b/.test(text);
      if (mentionsStudent && !STUDENT_MOBILISATION_RE.test(text)) {
        // Has "student" but no mobilisation — needs another non-
        // student ambiguous trigger plus a public-order cue.
        const otherAmbiguous = /\b(rally|rallies|rallied|strike|strikes|striking|struck)\b/.test(text);
        if (!otherAmbiguous) return false;
      }
      if (FLASHPOINT_PUBLIC_ORDER_CUE_RE.test(text)) return true;
    }
    return false;
  }
  const required = REQUIRED[topic];
  if (!required || required.length === 0) return true;
  for (const re of required) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Country reports allow any operational record that mentions the country
 * context but still strip the noisy general-news exclusions above.
 */
export function isCountryRelevant(i: RelevanceInput): boolean {
  const text = haystack(i);
  for (const re of EXCLUDE_PHRASES) {
    if (re.test(text)) return false;
  }
  return true;
}

/**
 * Sanitize fallback labels emitted by the classifier or country counts
 * so the Fast Facts cards never read "Unknown" or "Other fuel incident".
 */
export function sanitizeFactValue(topic: string, raw: string): string {
  const v = (raw ?? "").trim();
  if (!v || v === "-" || v === "--") return "Coverage gap";
  if (/^unknown$/i.test(v)) return "Country not identified";
  if (/^other .* incident$/i.test(v)) {
    // Banned wording removed. Use a neutral signal-quality label so the
    // card reads honestly when the leader is a residual "Other …" bucket.
    if (topic === "fuel") return "Multiple fuel incident types";
    if (topic === "fertiliser") return "Multiple fertiliser incident types";
    if (topic === "energy") return "Multiple energy incident types";
    if (topic === "shipping") return "Multiple maritime incident types";
    if (topic === "cargo_watch") return "Multiple cargo incident types";
    if (topic === "protests" || topic === "flashpoint") return "Multiple public order incident types";
    return "Multiple incident types";
  }
  return v;
}
