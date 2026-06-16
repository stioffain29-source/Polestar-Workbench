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
  // Non-APAC (US-jurisdiction) cargo stories syndicated in CJK languages
  // are out of scope for the APAC Cargo Watch. Each is gated TIGHTLY on
  // US/lobbying context so a genuine APAC record can never be hard-dropped
  // — note a bare "米" must NEVER be excluded (it also means "rice", a real
  // APAC cargo commodity), so we gate on 司法省 (US DOJ) instead:
  //  - JP lobbying of the US justice ministry (司法省) to strengthen the
  //    cargo-theft RESPONSE (対応/対策/取締 + 強化) by formal request (要請/
  //    要望) — the CJK twin of the English "association urges government to
  //    act" line above. Gated on the full response-strengthening-lobby frame
  //    (not bare 司法省 + a request verb) so a genuine APAC cargo incident
  //    that merely references the justice ministry can never be hard-dropped.
  /司法省.{0,24}(対応|対策|取締|取り締まり).{0,8}(強化|要請|要望)|(対応|対策|取締|取り締まり).{0,8}(強化|要請|要望).{0,24}司法省/,
  //  - KR "in LA … (stolen|seized|arrested) cargo" stories (LA서 = "in LA").
  /la서.{0,24}(화물|도난|압수|체포)|(화물|도난|압수|체포).{0,24}la서/i,
  // Petty school-canteen burglary mislabelled as a depot break-in
  // (Indonesian "kantin sekolah" = school canteen). Not a logistics-node
  // cargo crime even though a "gudang"/warehouse is mentioned.
  /kantin sekolah/i,
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
  // Consumer travel-advisory / SEO comma-spam aggregator junk. These
  // content-mill headlines ("Travelers Warned: Visa & Mastercard Banned …
  // — Sunwing & WestJet Suspend Flights, Jet Fuel Crisis … Emergency
  // Travel Tips Inside") chain several unrelated claims around a tourism/
  // payments lead. A genuine fuel-supply incident never reads "travelers
  // warned" / "emergency travel tips" / "visa & mastercard banned"; these
  // markers are unambiguous consumer-travel-advisory signal, so dropping
  // them never suppresses a real operational fuel story.
  /\b(travell?ers? warned|travel (tips|advisory|warning)|emergency travel|things to know before you (travel|go)|what travell?ers? (need to|should) know|beach resorts?|visa (&|and) mastercard banned)\b/,
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
  // Motorsport rally-raid / cross-country events the country list above
  // misses. "Taklimakan Rally 2026: GWM TANK Dominates the Unforgiving
  // Desert" leaked in because the event name was not enumerated. Match
  // named rally-raids plus rally co-occurring with motorsport-raid
  // vocabulary (desert/dunes/co-driver/special stage/works-team marques).
  /\b(taklimakan|silk way|gobi|kunlun|baja|china grand|rally raid|rally[- ]raid|cross[- ]country) rally\b/,
  /\brally\b.{0,60}\b(desert|dunes|dakar|baja|cross[- ]country|rally[- ]raid|co[- ]driver|navigator|bivouac|special stage|stage win|overall (lead|win|victory|standings)|shakedown|gwm|gazoo|hilux|land cruiser|4x4|off[- ]road|unforgiving)\b/,
  /\b(desert|dunes|dakar|baja|cross[- ]country|rally[- ]raid|co[- ]driver|bivouac|special stage|gwm tank|gazoo|hilux|unforgiving)\b.{0,60}\brally\b/,
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

  // Ceremonial / military parades. "Soldiers march in annual Independence
  // parade", "troops parade", "Republic Day parade". A ceremonial march is
  // not civil unrest. Targeted at military/ceremonial context only so that
  // genuine "march in <city>" protests and labour marches are untouched.
  /\b(military|army|armed forces|troops|soldiers|naval|navy|air force|veterans?|honou?r guard|guard of honou?r|cadets?|regiment|battalion|ceremonial|independence day|national day|republic day|victory day|founding|coronation) .{0,40}parade\b/,
  /\bparade .{0,40}(soldiers|troops|military|tanks|missiles?|regiment|battalion|cadets?|veterans?|marching band)\b/,

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
  /\b(awarded|wins?|won|clinch(es|ed)?|bags?|title|trophy|medal|gold|silver|bronze|championship)\b.{0,40}\b(referee|umpire|umpiring)\b/,
  /\b(protest|protests|protested|protesting) .{0,20}(referee|umpire|umpiring|the call|the decision|the result|the score|penalty|red card|offside|\bvar\b|disqualif)/,
  /\breferee.?s? (call|decision|ruling)\b/,

  // Photo galleries / photo-essay sections. A "| Photos |" or "(Photos)"
  // section marker (GMA, Inquirer, Rappler galleries) is a picture set, not
  // an incident report, and recurs as a near-duplicate of the real article
  // ("Protest held vs tree cutting in Manila | Photos | GMA News Online").
  /\|\s*photos?\s*\|/,
  /\(\s*photos?\s*\)/,
  /\b(in|look)\s+photos:\s/,

  // Business "strike a deal" — commercial agreement, not industrial action.
  /\bstrik(e|es|ing) (a |the |an |new |fresh |landmark |historic )?(deal|agreement|accord|pact|partnership|bargain|alliance|truce)\b/,
  // Sports betting / gambling commercial stories. "ArenaPlus, NBA strike
  // sports betting deal in Philippines" leaked because the "strike … deal"
  // pattern above needs "deal" to follow "strike" immediately. A gambling
  // commercial story is never industrial action regardless of word order.
  /\b(sports? betting|betting (deal|firm|operator|platform|app|site|partner|sponsor|licen[sc]e|market|odds)|arenaplus|bookmaker|sportsbook|wagering|i?gaming|online casino|pagcor)\b/,

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

// Homonyms that can NEVER be part of a genuine civil-unrest headline even
// when the headline literally contains the word "protest" — sports-result
// vocabulary, photo galleries, betting commerce, and fact-check debunks.
// This subset is the ONLY exclude list applied to the TITLE *before* the
// title-rescue, so it drops the takraw/referee + photo-gallery leaks
// without endangering genuine protests whose headline shares an *ambiguous*
// token (anti-war "protest against air strike", "protest after cyclone
// strikes", "protesters extend rally") — those ambiguous classes stay in
// FLASHPOINT_EXCLUDE, which runs only AFTER the rescue, so the rescue still
// protects them.
const FLASHPOINT_TITLE_HARD_EXCLUDE: RegExp[] = [
  /\brally (past|to (beat|defeat|win|tie|overcome)|caps|seals|secures|stuns|sinks|past the|from \d+)/,
  /\b(wins?|won|beats?|beat|stuns?|stunned|tops|topped|edges?|edged) .{0,40}(after|with|on) .{0,20}rally\b/,
  /\b(sepak )?takraw\b|\b(kabaddi|badminton|volleyball|netball|handball|futsal|sepaktakraw)\b/,
  /\b(awarded|wins?|won|clinch(es|ed)?|bags?|title|trophy|medal|gold|silver|bronze|championship)\b.{0,40}\b(referee|umpire|umpiring)\b/,
  /\b(protest|protests|protested|protesting) .{0,20}(referee|umpire|umpiring|the call|the decision|the result|the score|penalty|red card|offside|\bvar\b|disqualif)/,
  /\breferee.?s? (call|decision|ruling)\b/,
  /\|\s*photos?\s*\|/,
  /\(\s*photos?\s*\)/,
  /\b(in|look)\s+photos:\s/,
  /\b(sports? betting|betting (deal|firm|operator|platform|app|site|partner|sponsor|licen[sc]e|market|odds)|arenaplus|bookmaker|sportsbook|wagering|i?gaming|online casino|pagcor)\b/,
  /\bnot (a |an )?(protest|rally|riot|demonstration|march)\b/,
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

// Energy is a Middle East / South+East Asia / Oceania grid-stress monitor.
// The US Google-News edition used to inject US-local distribution faults
// ("downed tree", county feeders, investor-owned utilities) and African
// load-shedding (Eskom/NERSA) into the country feeds. These run BEFORE the
// REQUIRED gate, so an out-of-region utility story is dropped even when it
// carries a "power outage" token. Deliberately omits the country names of
// in-scope theatres and bare "u.s." (which appears in legit Gulf
// energy-infrastructure strike stories).
const ENERGY_EXCLUDE: RegExp[] = [
  // US / Canadian investor-owned utilities and grid operators.
  /\b(duke energy|dominion energy|consumers energy|nv energy|pg&e|pacific gas|con ?ed(ison)?|comed|exelon|xcel energy|georgia power|florida power|entergy|first ?energy|ameren|dte energy|eversource|hydro[- ]?quebec|bc hydro|hydro one|pseg|appalachian power|oncor|centerpoint)\b/,
  // US-local distribution vocabulary + "outage tracker" SEO pages.
  /\b(downed (tree|power line|line)|fallen tree|tree crew|outage (tracker|map)|in your area)\b/,
  // US TV-station call signs that syndicate local storm/outage wires
  // (e.g. WBAL-TV Baltimore bylined the Annapolis MD storm). CURATED
  // LITERALS only (like wfaa/king5): a broad /\b[wk]..-tv\b/ pattern would
  // hard-drop in-scope national broadcasters that share the W/K prefix —
  // KBS (South Korea), WIN (regional Australia), WION (India).
  /\b(abc\d{1,2}|wfaa|fox\d{1,2}|nbc\d{1,2}|cbs\d{1,2}|king ?5|wbal|wjz|wmar|wusa|wtop|wbz|wcvb|wsb|wgn|ktla|ktvu)\b/,
  // US / Canadian geography markers (none collide with in-scope theatres).
  // "georgia" is deliberately omitted (collides with the country); bare
  // "washington" stays scoped to "washington state" (D.C. / surname noise).
  /\b(county|township|ohio|texas|california|nevada|michigan|virginia|florida|illinois|oregon|washington state|maryland|new york|new jersey|pennsylvania|massachusetts|connecticut|north carolina|south carolina|tennessee|kentucky|indiana|wisconsin|minnesota|missouri|arizona|colorado|oklahoma|kansas|ontario|quebec|alberta|british columbia)\b/,
  // US city names — country-edition feeds mis-attribute US storm/outage stories
  // (esp. Texas/ERCOT, and East-Coast storms like Annapolis MD) to an in-scope
  // byline. Curated to clearly-US cities with no in-scope APAC/ME/AU collision.
  /\b(annapolis|austin|houston|dallas|fort worth|san antonio|el paso|denver|atlanta|seattle|sacramento|baltimore|memphis|nashville|tulsa|cleveland|milwaukee|minneapolis|detroit)\b/,
  // Out-of-region countries that recur in the energy feed.
  /\b(canada|canadian|kenya|kenyan|nersa|ferrochrome|nigeria|south africa|eskom|ghana|zimbabwe|zambia)\b/,
  // Out-of-region grid stories the country-edition feeds mis-attribute to
  // in-scope countries (Iberia/Cuba/Ukraine/US blackouts). These run BEFORE
  // required, so broadening the grid-collapse rule above cannot leak a Cuba or
  // Spain blackout in under a Bangladesh / Indonesia byline. Deliberately
  // omits bare turkey/russia/europe — those collide with legitimate in-scope
  // grid stories (e.g. an Iraq–Turkey power-line attack, a Gulf outage tied to
  // Russian/European supply); the Russia–Ukraine war noise is already caught
  // by the "ukraine" token.
  /\b(spain|spanish|portugal|portuguese|iberia|iberian|cuba|cuban|ukraine|ukrainian|virgin islands|zaporizhzhia)\b/,
  // Planned / scheduled maintenance outages are routine, not grid stress.
  /\b(planned|scheduled) (power )?(outage|maintenance)\b/,
  /\brestored after\b.{0,30}(outage|disruption|fault)/,
  // Recovery / improvement framing — outages easing is the OPPOSITE of an
  // incident (deliberately omits "ease", which appears in ongoing-crisis prose).
  /\b(power )?outages?\b[^.]{0,20}\b(drop|fall|decline|recede|subside)\b/,
  // Negations — the OPPOSITE of an incident.
  /\bno (power|electricity) (shortage|crisis|cut|outage)/,
  /\bno (scope for|need for) (load[- ]?shedding|power cut|outage)/,
  /\bno load[- ]?shedding\b/,
];

const REQUIRED: Record<string, RegExp[]> = {
  fuel: [
    /\bfuel (shortage|crisis|emergency|price|prices|protest|protests|supply|stockout|rationing|tanker|truck)/,
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
    /\b(power|grid|electricity) (outage|cut|blackout|brownout|disruption|failure|shortage|crisis|tariff|rationing|price|prices)/,
    /\bpower grid\b/,
    /\bgrid (collapse|collapses|collapsed|attack|attacked|sabotage|overload|overloaded)/,
    /\bbrownout/,
    /\brolling (blackout|outage|power cut)/,
    /\bload[ -]shedd/,
    /\bsubstation (fire|attack|failure|outage|sabotage)/,
    /\b(generation|capacity|supply) shortfall/,
    /\b(transmission|pipeline) (attack|sabotage|disruption|outage|failure)/,
    /\b(gas|diesel|coal) .{0,20}power\b/,
    /\b(electricity|power|energy) (price|prices|tariff|tariffs) (hike|hiked|rise|rises|increase|increases|surge|jump|jumps)/,
    /\b(tariff|price) (hike|hiked|increase|surge) .{0,25}(electricity|power|energy)/,
    /\benergy (crisis|shortage|tariff|emergency|rationing)/,
    /\b(peak|record) (power |electricity )?demand/,
    /\bgas shortage/,
  ],
  shipping: [
    /\b(vessel|tanker|ship|cargo ship|container ship|bulk carrier) (attack|attacked|seizure|seized|boarding|missile|drone|fire|sinking|collision|adrift)/,
    /\battack (on|against) (a |an |the )?(vessel|tanker|ship|cargo ship|container ship|bulk carrier|crew)/,
    // Piracy / sea robbery against vessels (mirrors the ingest ALLOW list).
    // Maritime-qualified phrases plus a proximity match so a ReCAAP-style
    // "armed robbery against a ship in the Singapore Strait" passes the gate,
    // while bare political/historical "piracy" stays out.
    /\b(sea robbery|armed robbery|piracy attack|piracy attempt|attempted piracy|suspected piracy|piracy incident|piracy bid|pirate attack)\b/,
    /\b(piracy|pirate|pirates|robbery|robbed) .{0,40}(vessel|tanker|ship|cargo ship|container ship|bulk carrier|crew|boat|tug|barge|anchorage|strait|at sea|off (the )?coast)\b/,
    /\b(vessel|tanker|ship|cargo ship|container ship|bulk carrier|crew|boat|tug|barge|anchorage) .{0,40}(piracy|pirate|pirates|sea robbery|armed robbery|robbed|robbery)\b/,
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
  // War / armed conflict / insurgency / armed crime. DELIBERATELY excludes the
  // protest/demonstration/strike/civil-disorder vocabulary — that is the
  // `flashpoint` topic's job and must not be duplicated here. These rules keep
  // KINETIC and armed events: organised armed groups, firefights, bombings,
  // ambushes, named insurgencies, and serious armed crime (armed robbery,
  // kidnapping). The global EXCLUDE_PHRASES already strip sports/finance/
  // entertainment noise before this gate runs.
  conflict: [
    /\b(armed (clash|clashes|conflict|attack|assault|group|gang|men|robbery|robbers|raid|raiders|fighters?|militants?))\b/,
    /\b(gun ?battle|gun ?fight|firefight|shoot[- ]?out|cross[- ]?fire|exchange of fire|opened fire|hail of (gunfire|bullets))\b/,
    /\b(insurgen(t|ts|cy)|militan(t|ts|cy)|rebel(s|lion)?|separatis(t|ts|m)|guerrilla|paramilitar(y|ies)|militia(s|men)?|warlord|junta (forces|troops|airstrike|soldiers))\b/,
    /\b(ambush(ed|es)?|incursion|firefights?|skirmish(es)?)\b/,
    /\b(ied|improvised explosive|roadside bomb|land ?mine|car bomb|truck bomb|grenade attack|bomb blast|suicide bomb(er|ing)?|drone strike|air ?strike (kill|hit|target|hits|kills|on))\b/,
    /\b(abduct(ed|ion|ions)?|kidnap(ped|ping|pings|pers)?|hostage(s)?|held hostage)\b/,
    /\b(gunm[ae]n|armed assailant|shot dead|gunned down|mass shooting|gun rampage|massacre)\b/,
    /\b(tpnpb|opm|free papua|west papua (rebel|fighter|insurgen|liberation|armed)|npa|new people'?s army|abu sayyaf|biff|bifm|bangsamoro|moro (rebel|fighter|front)|ttp|tehrik[- ]?i[- ]?taliban|baloch(istan)? (liberation|insurgen|army|militant)|naxal(ite)?|maoist (rebel|insurgent|attack|guerrilla)|arakan army|ethnic armed (group|organisation|organization))\b/,
    /\b(troops|soldiers|security forces|police|army|navy|marines) .{0,30}(killed|kill|ambush(ed)?|attack(ed)?|clash(ed)?|wounded|gunned down|firefight)\b/,
    /\b(killed|wounded|injured|dead|casualt) .{0,30}(clash|fighting|gun ?battle|firefight|ambush|insurgen|militan|rebel|raid|shoot[- ]?out|armed attack)\b/,
    /\b(armed robbery|armed heist|armed hold[- ]?up|at gunpoint|extortion racket|kidnap[- ]for[- ]ransom)\b/,
  ],
  // Protests / Flashpoint use a two-tier match: an UNAMBIGUOUS phrase
  // alone is sufficient, but the ambiguous tokens "rally", "strike"
  // and "student(s)" must additionally co-occur with a public-order
  // cue (see FLASHPOINT_AMBIGUOUS_RE + FLASHPOINT_PUBLIC_ORDER_CUE_RE
  // below). The REQUIRED entries here represent only the unambiguous
  // tier; the ambiguous tier is enforced separately in
  // `isTopicRelevant` for `protests` and `flashpoint`.
  protests: [
    /\b(protest|demonstration|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|crackdown|industrial action|strike notice|hartal|bandh|gherao)(e?s|ers?|ing|ed)?\b/,
    // "march" alone is a calendar month ("flat from 50.4 in March"). Only the
    // inflected protest forms (marches/marchers/marching/marched) or an
    // explicit protest-march phrase count; bare "march" needs a companion
    // (handled by the FARMERS/WORKERS line below and the ambiguous tier).
    /\bmarch(es|ers?|ing|ed)\b/,
    /\b(protest|peace|long|million|freedom|solidarity|hunger|silent|torch(?:light)?|candle ?light) march(es)?\b/,
    /\bmarch(es)? (on|onto|into|through|past|towards?|against)\b/,
    /\bmarch(es)? in (?!(parade|formation|step|uniform|honou?r|memory|lockstep)\b)/,
    /\bmarch(es)? to (?!(the )?(final|finals|semi|semis|semifinals?|quarterfinals?|title|trophy|cup|playoffs?|championships?|crown|glory|victory|knockout|top|promotion)\b)/,
    /\b(farmers|workers|union|opposition|civil society|activists) .{0,30}(protest|march|gather|demonstrate|mobilis(e|ed)|mobiliz(e|ed))/,
    /\b(police|security forces?) .{0,30}(clash|crackdown|tear gas|baton|rubber bullet|water cannon) .{0,30}(protest|demonstration|march|crowd|mob|sit[- ]?in)/,
    /\b(curfew|state of emergency|martial law|lockdown imposed|section\s*144|assembly ban)\b/,
  ],
  flashpoint: [
    /\b(protest|demonstration|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|crackdown|industrial action|strike notice|hartal|bandh|gherao)(e?s|ers?|ing|ed)?\b/,
    // "march" alone is a calendar month ("flat from 50.4 in March"). Only the
    // inflected protest forms (marches/marchers/marching/marched) or an
    // explicit protest-march phrase count; bare "march" needs a companion
    // (handled by the FARMERS/WORKERS line below and the ambiguous tier).
    /\bmarch(es|ers?|ing|ed)\b/,
    /\b(protest|peace|long|million|freedom|solidarity|hunger|silent|torch(?:light)?|candle ?light) march(es)?\b/,
    /\bmarch(es)? (on|onto|into|through|past|towards?|against)\b/,
    /\bmarch(es)? in (?!(parade|formation|step|uniform|honou?r|memory|lockstep)\b)/,
    /\bmarch(es)? to (?!(the )?(final|finals|semi|semis|semifinals?|quarterfinals?|title|trophy|cup|playoffs?|championships?|crown|glory|victory|knockout|top|promotion)\b)/,
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

// Title-rescue set: phrases so unmistakably about public order that their
// presence in the HEADLINE overrides the body-scanning context excludes
// (military-strike homonym, student-crime). Deliberately EXCLUDES the
// ambiguous sports/finance homonyms ("rally", "march", bare "strike") so a
// motorsport rally or stock-market strike headline can never be rescued —
// those still fall through to the homonym/ambiguous gates.
const FLASHPOINT_TITLE_RESCUE_RE =
  /\b(protest(s|ers?|ing|ed)?|demonstration(s)?|demonstrators?|sit[- ]?in|picket(s|ing|ed)?|walkout|stoppage|hartal|bandh|gherao|chakka jam|wheel[- ]?jam|shutter[- ]?down|industrial action|strike notice|civil unrest|public disorder|crackdown|gen[- ]?z protest)\b/i;

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
  // Strip the Google News feed-category label from the source. Feed names
  // are "Google News — <Country> (Civil Unrest)" / "(Protests)" / "(Fuel)"
  // etc. — the parenthetical is the TOPIC the feed was queried under, not
  // evidence the record is on-topic. Leaving it in injected the topic
  // keyword (e.g. "civil unrest") into EVERY record's haystack, which
  // satisfied the unambiguous public-order tier for free and defeated the
  // ambiguous-token gate (a motorsport "rally" or market "strike" from the
  // Civil-Unrest feed was kept purely because its source said "civil
  // unrest"). Relevance must be judged on the record's own title/summary.
  const cleanSource = (i.source ?? "").replace(/\([^)]*\)/g, " ");
  return [
    i.title ?? "",
    i.summary ?? "",
    cleanSource,
    (i.sourceUrl ?? "").replace(/[-_/]/g, " "),
    i.location ?? "",
  ].join(" ").toLowerCase();
}

// Headline-only text for the title-rescue check. Strips a trailing
// " - <Source>" wire-attribution suffix so a source name never injects a
// rescue keyword, then lowercases. (No source-paren handling needed — the
// suffix here is the editorial attribution, not the feed category.)
function titleHaystack(i: RelevanceInput): string {
  let t = i.title ?? "";
  const idx = t.lastIndexOf(" - ");
  if (idx > 0) {
    const suffix = t.slice(idx + 3);
    if (suffix.length <= 80 && !/[,.]/.test(suffix)) t = t.slice(0, idx);
  }
  return t.toLowerCase();
}

export interface RelevanceResult {
  relevant: boolean;
  reason: string;
}

function firstMatch(text: string, patterns: RegExp[]): RegExp | null {
  for (const re of patterns) if (re.test(text)) return re;
  return null;
}

/**
 * Decide AND explain whether a record is genuinely about the report's
 * topic. Returns the keep/drop verdict plus a human-readable reason that
 * names the rule (and pattern) that fired. This is the single source of
 * truth for relevance; `isTopicRelevant` is a thin boolean wrapper. The
 * reason string powers the pre-export consistency audit and the
 * rejected-records list shown in the proof pack.
 */
export function explainRelevance(topic: string, i: RelevanceInput): RelevanceResult {
  const text = haystack(i);

  const general = firstMatch(text, EXCLUDE_PHRASES);
  if (general) return { relevant: false, reason: `excluded: general-news noise (/${general.source}/)` };

  if (topic === "shipping") {
    const m = firstMatch(text, SHIPPING_EXCLUDE);
    if (m) return { relevant: false, reason: `excluded: shipping off-topic (/${m.source}/)` };
  }
  if (topic === "fuel") {
    const m = firstMatch(text, FUEL_EXCLUDE);
    if (m) return { relevant: false, reason: `excluded: fuel off-topic (/${m.source}/)` };
  }
  if (topic === "cargo_watch") {
    const m = firstMatch(text, CARGO_EXCLUDE);
    if (m) return { relevant: false, reason: `excluded: cargo off-topic (/${m.source}/)` };
  }
  if (topic === "energy") {
    const m = firstMatch(text, ENERGY_EXCLUDE);
    if (m) return { relevant: false, reason: `excluded: energy off-topic (/${m.source}/)` };
  }

  if (topic === "flashpoint" || topic === "protests") {
    // 0. Title-rescue: an UNMISTAKABLE public-order phrase in the headline
    //    itself (protest / demonstration / picket / walkout / strike notice
    //    / hartal / crackdown ...) is decisive. The two context excludes
    //    below scan the whole body, so a genuine "PTI workers stage
    //    protests" or "Teachers protest abduction" headline was being
    //    dropped because the SUMMARY happened to mention an "air strike"
    //    (military homonym) or because the record read as a student/crime
    //    story. The rescue set deliberately omits sports/finance homonyms
    //    ("rally" / "march" / bare "strike"), so noise headlines never
    //    qualify; pure-kinetic or court-only items are still stripped by
    //    the dataset layer downstream.
    // 0a. A hard homonym IN THE HEADLINE always wins: a sports / finance /
    //     betting / photo-gallery headline is noise even when it contains the
    //     word "protest" ("Malaysia awarded takraw title after Thailand
    //     protest referee's call", "Protest held vs tree cutting | Photos |").
    //     This MUST run before the title-rescue, otherwise the bare word
    //     "protest" in the title rescues the record before the homonym can
    //     drop it. Use only the UNAMBIGUOUS-noise subset (sports/photo/
    //     betting/fact-check) so a real protest headline that shares an
    //     ambiguous token (air strike / cyclone strike / extend rally) is
    //     still rescued below; those ambiguous classes stay in the full
    //     FLASHPOINT_EXCLUDE which runs only AFTER the rescue.
    const titleHom = firstMatch(titleHaystack(i), FLASHPOINT_TITLE_HARD_EXCLUDE);
    if (titleHom) return { relevant: false, reason: `excluded: flashpoint homonym in headline (/${titleHom.source}/)` };
    if (FLASHPOINT_TITLE_RESCUE_RE.test(titleHaystack(i))) {
      // The headline itself is an unmistakable public-order event. The
      // absolute general-news exclude already ran above, so keep it here —
      // this both rescues genuine protests from the body-scanning context
      // excludes below AND covers plural/inflected forms ("protests",
      // "demonstrations") that the \b-anchored REQUIRED patterns miss.
      return { relevant: true, reason: "kept: unmistakable public-order phrase in headline (title-rescue)" };
    }
    // 1. Hard exclusions first — sports/finance/weather/military/
    //    entertainment/betting homonyms of "rally" / "strike" / "student".
    const hom = firstMatch(text, FLASHPOINT_EXCLUDE);
    if (hom) return { relevant: false, reason: `excluded: flashpoint homonym (/${hom.source}/)` };
    // 2. Non-mobilisation student stories (school attacks, crime
    //    stories, education policy) are never flashpoint, even if
    //    the public-order cue regex incidentally matches.
    if (STUDENT_NON_MOBILISATION_RE.test(text)) {
      return { relevant: false, reason: "excluded: student non-mobilisation (attack/crime/policy, not protest)" };
    }
    // 3. Unambiguous-tier match: any REQUIRED.flashpoint phrase
    //    qualifies on its own.
    const unambiguous = REQUIRED[topic] ?? [];
    const u = firstMatch(text, unambiguous);
    if (u) return { relevant: true, reason: `kept: unambiguous public-order phrase (/${u.source}/)` };
    // 4. Ambiguous-tier match: bare "rally" / "strike" needs a
    //    public-order companion; bare "student(s)" needs a student-
    //    mobilisation phrase.
    if (FLASHPOINT_AMBIGUOUS_RE.test(text)) {
      const mentionsStudent = /\bstudents?\b/.test(text);
      if (mentionsStudent && !STUDENT_MOBILISATION_RE.test(text)) {
        const otherAmbiguous = /\b(rally|rallies|rallied|strike|strikes|striking|struck)\b/.test(text);
        if (!otherAmbiguous) return { relevant: false, reason: "dropped: 'student' token without mobilisation signal" };
      }
      if (FLASHPOINT_PUBLIC_ORDER_CUE_RE.test(text)) {
        return { relevant: true, reason: "kept: ambiguous token (rally/strike) + public-order cue" };
      }
      return { relevant: false, reason: "dropped: ambiguous token (rally/strike) without public-order cue" };
    }
    return { relevant: false, reason: "dropped: no flashpoint public-order signal" };
  }

  const required = REQUIRED[topic];
  if (!required || required.length === 0) return { relevant: true, reason: "kept: no relevance rule for topic (default allow)" };
  const r = firstMatch(text, required);
  if (r) return { relevant: true, reason: `kept: required topic phrase (/${r.source}/)` };
  return { relevant: false, reason: "dropped: no required topic phrase matched" };
}

/**
 * Return true when the record is genuinely about the report's topic.
 * Returns true (allows the record through) for topics with no rule, so
 * unknown report families do not silently empty their tables.
 */
export function isTopicRelevant(topic: string, i: RelevanceInput): boolean {
  return explainRelevance(topic, i).relevant;
}

// A country report is a SECURITY product, not a wire feed. The signals below
// mark a record as carrying a genuine safety/security event — violence, armed
// action, crime, unrest, disruption. Any record with one of these is kept even
// if it also mentions an economic or sporting word (e.g. a fuel-subsidy protest
// that turned violent, or a riot at a stadium).
// NOTE on "march": the protest verb forms "marchers / marching / marched" are
// kept unconditionally, but the NOUN "march" is only counted in a protest
// context — "protest/subsidy/wage/... march" or "march on/against/...". Bare
// "march" is excluded because it matches the calendar month ("late March"),
// the homonym that leaked non-events (e.g. a corporate-IT story) into the gate.
const COUNTRY_SECURITY_SIGNAL_RE =
  /\b(attack|attacked|armed|gunm[ae]n|robber|robbery|robbed|hold[- ]?up|hijack|kidnap|abduct|shoot|shot|shooting|gunfire|gunshot|killed|dead|fatal|wounded|injur|casualt|clash|fighting|firefight|gun battle|riot|unrest|protest|demonstration|rally|marchers?|march(?:ing|ed)|(?:protest|street|mass|peaceful|wage|subsidy|fuel|workers'?|hunger|silent) march|march (?:on|against|over|through|to|for)|picket|walkout|strike action|blockade|roadblock|ambush|raid|arson|loot|explosion|blast|bomb|ied|grenade|militant|insurgent|rebel|separatist|tpnpb|opm|displaced|evacuat|curfew|crackdown|violence|violent|assault|stab|machete|bush knife|rascal|raskol|theft|stolen|burglary|break[- ]?in|seiz|piracy|pirate|extort|arrest|detain|sabotage)\b/i;

// Non-security record classes that must never DRIVE a country security report
// when the same record carries no security signal: fiscal/economic policy,
// market and corporate-finance commentary, public-relations boosterism, and
// sports coverage. These were leaking in because the country gate previously
// stripped only general-news noise (e.g. a "fuel subsidy" policy story or a
// football scoreline appeared as the country's lead security incident).
const COUNTRY_ECONOMIC_NOISE_RE =
  /\b(subsid(y|ies|ise|ize)|levy|levies|excise|tariff|price (freeze|cap|control|shock)|industry dialogue|share price|stock price|equity|earnings|dividend|buyback|quarterly (result|results|report)|annual report|market cap|applauds?|lauds?|praises?|hails?|welcomes?|commends?|congratulates?|completes? (the )?migration|migrat(ion|es|ed|ing) (of|to) (its )?[a-z]+ (system|platform)|system (migration|upgrade)|prepaid metering|go[- ]live|new (it|billing|payment|digital) platform)\b/i;

const COUNTRY_SPORTS_NOISE_RE =
  /\b(\d+[- ]\d+ (win|victory|defeat|loss|draw)|football club|\bfc\b|\bpsl\b|premier league|premier soccer league|super league|rugby|netball|cricket|grand final|test match|cross[- ]code coup|maple leafs|\bleafs\b|\bnhl\b|\bnba\b|\bnfl\b|\bmlb\b|playoffs?)\b/i;

// Non-event editorial classes: explainers, op-eds, "what you need to know"
// guides and fact-checks. A country SECURITY aggregate lists concrete
// EVENTS, not background pieces about laws or institutions. These are
// dropped unless the record also carries a hard security signal (so a real
// "police explain the armed robbery investigation" still survives).
const COUNTRY_EXPLAINER_NOISE_RE =
  /\b(explains?|explained|explainer|breaks? down|what (you )?need to know|here'?s what|fact[- ]?check|backgrounder|op[- ]?ed|opinion piece)\b.{0,40}\b(law|laws|history|culture|tradition|custom|system|policy|act|bill)\b|\b(law|laws|history|culture|tradition|custom|system|policy|act|bill)\b.{0,40}\b(explained|explainer)\b/i;

// Scraped-aggregator junk: a YouTube-style video-id signature "(vFetqxZnwf)"
// left in a syndicated headline — a 9–14 char token from [A-Za-z0-9_-] with
// an internal lower→UPPER transition inside parentheses. The length floor
// (9) avoids false-dropping ordinary short parenthesised camelCase tokens
// like "(iPhone)"/"(eBay)"/"(macOS)", while still catching the 10–11 char
// random ids these aggregators leave behind. Tested against the RAW title
// because the case transition is the discriminator and the haystack is
// lower-cased. Mirrors FLASHPOINT_DENY in the scraper so the country gate
// drops rows already in the DB that ingest now blocks at insert.
const YOUTUBE_VIDEO_ID_RE = /\((?=[A-Za-z0-9_-]{9,14}\))[A-Za-z0-9_-]*[a-z][A-Z][A-Za-z0-9_-]*\)/;

// HARD (unambiguous) security signals. Deliberately a STRICT subset of
// COUNTRY_SECURITY_SIGNAL_RE: it omits every word that routinely appears in a
// SPORTING / match-report sense, so a football article can never rescue itself
// from the sports-noise drop by carrying one. Omitted on purpose:
//   - "clash" (a "Round 1 clash"), "raid", "fighting", "march", "rally",
//     "victory" — generic match vocabulary;
//   - "attack" / "attacked" — matches "counter-attack" and "attacking play"
//     (\battack\b hits "counter-attack" because the hyphen is a word boundary);
//   - "shoot" / "shot" / "shooting" — "shot on goal", "shooting boots";
//   - "killed" / "dead" — "killed off the game", "dead-ball", "dead rubber";
//   - "injur" — "injury time", "injured player";
//   - "assault" — "assault on goal", "aerial assault";
//   - "seiz" — "seized possession / the initiative";
//   - "armed" / "violent" / "violence" — "armed with a shot", "violent strike".
// Only unambiguous violent-crime / terror / unrest words that essentially never
// appear in a routine match report remain in the base set; the DISAMBIGUATED
// patterns that follow it recover genuine violence at a sporting venue
// ("armed attack at football club leaves two dead") while still rejecting the
// match idioms that abuse the same words ("counter-attack", "killed off the
// game", "dead-ball"). The economic branch still uses the full (soft) lexicon
// so a genuine "fuel-subsidy protest/march" is still kept.
const COUNTRY_HARD_SECURITY_RE = new RegExp(
  [
    // Unambiguous violent-crime / terror / unrest — never match-report idioms.
    String.raw`\b(?:gunm[ae]n|gunfire|gunshot|robber|robbery|robbed|hold[- ]?up|hijack|kidnap|abduct|wounded|fatal|casualt|firefight|gun battle|ambush|arson|explosion|bomb|bombing|ied|grenade|militant|insurgent|rebel|separatist|tpnpb|opm|displaced|evacuat|curfew|crackdown|stab|stabbed|stabbing|machete|bush knife|rascal|raskol|theft|burglary|loot|piracy|pirate|extort|sabotage|riot|unrest|tear gas|stampede)\b`,
    // Weapon/actor-prefixed "attack" — recovers real venue violence while still
    // excluding "counter-attack" and "attacking play".
    String.raw`\b(?:armed|gun|knife|bomb|grenade|machete|terror|terrorist|militant|rebel|insurgent|deadly|fatal|violent) attack`,
    // Deaths with violent framing, excluding sports idioms.
    String.raw`\bkilled(?! off| the (?:game|match|contest|tie|fixture))`,
    String.raw`\bdead(?![- ](?:ball|rubber|heat|lock))`,
    String.raw`\b(?:shot dead|shot and (?:killed|wounded)|opened fire|gunned down)\b`,
  ].join("|"),
  "i",
);

/**
 * Country reports allow any operational SECURITY record that mentions the
 * country context. They strip the shared general-news exclusions above and,
 * because a country report is a security product, also drop economic / market /
 * PR / sports records that carry no security signal of their own.
 */
export function isCountryRelevant(i: RelevanceInput): boolean {
  const text = haystack(i);
  for (const re of EXCLUDE_PHRASES) {
    if (re.test(text)) return false;
  }
  // Scraped-aggregator junk: a leftover YouTube video-id in the headline
  // ("...Papua New Guinea (vFetqxZnwf) - Mshale") is never a real incident.
  // Test the RAW title — the lower→UPPER case transition is the signature
  // and `haystack` has already lower-cased everything.
  if (YOUTUBE_VIDEO_ID_RE.test(i.title ?? "")) return false;
  // Drop non-security economic / market / PR noise UNLESS the record carries
  // any (soft-inclusive) security signal — a fuel-subsidy protest/march stays.
  if (COUNTRY_ECONOMIC_NOISE_RE.test(text) && !COUNTRY_SECURITY_SIGNAL_RE.test(text)) {
    return false;
  }
  // Drop explainer / op-ed / "what you need to know" editorial UNLESS the
  // record carries a hard security signal — a security aggregate lists
  // EVENTS, not background pieces about laws or institutions.
  if (COUNTRY_EXPLAINER_NOISE_RE.test(text) && !COUNTRY_HARD_SECURITY_RE.test(text)) {
    return false;
  }
  // Drop SPORTS noise unless the record carries a HARD security signal. A match
  // report routinely calls itself a "Round 1 clash"; "clash" (and "raid",
  // "fighting", "victory") must NOT rescue a football story — only an
  // unambiguous violence/crime word does.
  if (COUNTRY_SPORTS_NOISE_RE.test(text) && !COUNTRY_HARD_SECURITY_RE.test(text)) {
    return false;
  }
  return true;
}

/**
 * True when a country label carries no usable attribution and must not be
 * counted as a real country anywhere (Fast Facts cards or prose). The
 * classifier writes "Unknown" for unattributed records; this is the single
 * source of truth so cards and prose can never disagree on what counts.
 */
export function isUnattributedCountry(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  if (!v || v === "-" || v === "--") return true;
  if (/^unknown$/i.test(v)) return true;
  if (/^country not identified$/i.test(v)) return true;
  if (/^(n\/?a|unattributed|unspecified|other)$/i.test(v)) return true;
  return false;
}

/**
 * Split a country label into its individual attributed countries. Compound
 * strings ("Indonesia; West Papua", "China, Iran") are split so each country
 * scores on its own and a compound label never appears as if it were a single
 * country, and unattributed placeholders are dropped. This is the single source
 * of truth for country tokenisation so the Fast Facts cards, the report prose
 * and the editor seed normalise countries the same way and can never disagree.
 */
export function splitAttributedCountries(raw: string | null | undefined): string[] {
  const v = (raw ?? "").trim();
  if (!v) return [];
  return v
    .split(/[;,/]+/)
    .map((s) => s.trim())
    .filter((s) => s && !isUnattributedCountry(s));
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
