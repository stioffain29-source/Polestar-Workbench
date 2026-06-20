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
  // Scraped page markup leaked into the record body (CMS template CSS / inline
  // style blocks) — a malformed scrape dump, never a clean news incident.
  /\{[^}]{0,40}(object-fit|max-height:\s*calc|width:\s*100%)/,
  /\bviewport-wrapper\b/,
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
  /\b(stock|stocks|share|shares|equity|equities|market|markets|index|nifty|sensex|nikkei|kospi|hang seng|shanghai composite|kse[- ]?100|psx|bursa|jci|ftse|s&p|nasdaq|dow|asx|set index|pse(i)?|vn[- ]index|wall street|wall[- ]?st|main street) .{0,60}rally\b/,
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

  // Natural-disaster headlines. An earthquake / tsunami / volcanic
  // eruption / landslide / flood story is a hazard report, not civil
  // unrest, even when it shares the ambiguous "strike(s)" token
  // ("Magnitude 6.6 quake strikes Mindanao", "7.8 earthquake feared
  // dead"). Genuine POST-disaster protests keep a protest/demonstration
  // word in the headline and are rescued by FLASHPOINT_TITLE_RESCUE_RE,
  // which runs BEFORE this list, so they are unaffected.
  /\b(magnitude|m\d(\.\d)?|richter)\b.{0,25}\b(earthquake|quake|tremor|aftershock)/,
  /\b(earthquake|quake|tremor|aftershock)s?\b.{0,40}\b(magnitude|richter|epicent|feared dead|death toll|destruction|jolt(s|ed)?|trapped|rescue|collapsed?|tsunami|injured|killed|damage)\b/,
  /\b(tsunami warning|tsunami waves?|volcanic eruption|volcano (erupts?|erupted|spew)|landslide(s)? (kill|killed|buries|buried|swept|hit)|flash flood(s|ing)?|floodwaters?|mudslide)\b/,

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
  // Finance / markets, third pass. The instrument-adjacent patterns above
  // miss a few real shapes: a bare "currency/assets/bond rally", a
  // "rally for the peso/ringgit/…" (instrument AFTER "for"), a possessive
  // crypto move ("Bitcoin's Iran rally"), and the named market-mood
  // rallies ("broad market rally", "relief rally", "post-Eid rally").
  // These would otherwise fall through to the generic ambiguous-token
  // drop and — worse — could be re-admitted by the political-rally cue
  // below ("rally for the peso") if not killed here first.
  /\b(currency|currencies|\bfx\b|assets?|bonds?|treasur(y|ies)|commodit(y|ies)) rally\b/,
  /\brally (for|to) (the )?(peso|ringgit|rupee|rupiah|baht|yuan|renminbi|dong|kyat|taka|kip|won|yen|dollar|euro|pound|sterling|riyal|dirham|lira|stocks?|shares?|equit)/,
  /\b(bitcoin|ethereum|crypto|xrp|btc|eth|dogecoin|solana|altcoin)('s|s')?\b.{0,25}rally\b/,
  /\b(broad|relief|santa[- ]?claus|year[- ]end|post[- ]?eid) (market )?rally\b/,

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
  // Trade / tariff economics metaphor — "Trump's forced-labor tariffs strike
  // Sri Lanka's fragile export recovery". "strike/hit/batter" here is the
  // metaphor "tariffs hit the economy", not industrial action. Requires the
  // tariff/trade noun + an impact verb + an economic-outcome object, so a
  // genuine labour strike sparked by tariffs ("tariffs spark workers' strike")
  // is untouched and a real anti-tariff protest title-rescues above this list.
  // The leading lookahead bails out if an explicit industrial-action phrase
  // ("workers strike", "union walkout") is present, so a real labour stoppage
  // phrased "tariffs hit factories as workers strike" is never swallowed by the
  // metaphor. ("forced-labor" never trips it — the guard needs the worker noun
  // immediately followed by the stoppage verb.)
  /^(?!.*\b(?:workers?|trade ?unions?|unions?|staff|employees?|drivers?|pilots?|nurses?|teachers?|miners?|dockers?|seafarers?) (?:strike|strikes|striking|walkout|walk out|stoppage|down tools|downed tools|industrial action)\b).*\b(tariffs?|trade war|customs dut(?:y|ies)|import dut(?:y|ies))\b[^.!?]{0,30}\b(strike|strikes|struck|hit|hits|hammer|hammers|batter|batters|threaten|threatens|dent|dents|derail|derails|cripple|cripples|squeeze|squeezes|slam|slams)\b[^.!?]{0,45}\b(econom|export|import|recover|growth|gdp|trade|industr|sector|revenue|earnings|market|business|manufactur|factor(?:y|ies)|exporters?|importers?|supply chain)\b/,
  // Sports betting / gambling commercial stories. "ArenaPlus, NBA strike
  // sports betting deal in Philippines" leaked because the "strike … deal"
  // pattern above needs "deal" to follow "strike" immediately. A gambling
  // commercial story is never industrial action regardless of word order.
  /\b(sports? betting|betting (deal|firm|operator|platform|app|site|partner|sponsor|licen[sc]e|market|odds)|arenaplus|bookmaker|sportsbook|wagering|i?gaming|online casino|pagcor)\b/,

  // Fact-check / debunk pieces that explicitly say the footage is NOT a
  // protest, plus generic misinformation framing.
  /\bnot (a |an )?(protest|rally|riot|demonstration|march)\b/,
  /\b(fact[- ]check|misleading|false(ly)? (claim|shared)|debunk(ed|s)?|no evidence|misrepresent|old (video|clip|footage)|unrelated (video|clip|footage|event))\b/,

  // Metaphorical "instant protest" — a politician describing his own conduct
  // ("returning from Delhi was an 'instant protest'") is a quoted figure of
  // speech, not a public-order event. It was syndicated ~10× as near-duplicate
  // wires and flooded the feed. The phrase is distinctive and never names a
  // real demonstration, so the exclude is safe (verified against live rows).
  /\binstant protest\b/,

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
  // Metaphorical "instant protest" headline — runs BEFORE the title-rescue so
  // the bare word "protest" can no longer rescue the quoted figure of speech.
  /\binstant protest\b/,
  // Retrospective administrative / compensation aftermath — "September protest
  // damage claims settled after nine months", "riot compensation claims paid
  // out". These are insurance / payout / settlement FOLLOW-UPS, not a protest
  // EVENT, yet the bare word "protest" in the headline would otherwise
  // title-rescue them. Drops before the rescue. Gated on a damage/compensation
  // claims NOUN *and* an administrative-RESOLUTION verb in proximity, so a live
  // grievance rally ("protesters demand compensation claims", "rally over
  // unpaid injury claims") is untouched — only a settled/paid-out aftermath is
  // dropped. "protest claims lives/responsibility" is never matched (no claims
  // noun). Ambiguous grievance verbs (unpaid/rejected/pending) are deliberately
  // excluded so an active claims protest is never swallowed.
  /\b(damage|compensation|insurance|property|injury|loss|payout) claims?\b[^.!?]{0,40}\b(settled|paid out|processed|approved|disbursed|reimburs)\w*\b/,
  // Sports mega-event fan colour — "Hundreds protest Iran's 'regime team'
  // ahead of World Cup opener", "Some wave protest flags as Iran plays World
  // Cup opener". A fan demonstration at a football fixture is sports colour,
  // not the security-relevant civil unrest this APAC/Gulf monitor tracks.
  // Title-only + before the rescue so the bare word "protest" cannot keep it.
  /\b(world cup|fifa|uefa|olympics?|olympic games|copa am[eé]rica|champions league)\b/,
  // Sports progression — a team "marches into the semis/final", "marched into
  // the last 8". The ambiguous cue "march" would otherwise rescue these; a
  // sporting run is never civil unrest. The optional middle word lets the sport
  // name sit between ("march into hockey semis"). Genuine protest marches go
  // "to parliament / the streets", never "into the semis", so this is safe.
  /\bmarch(es|ed|ing)? (in)?to (the )?(\w+ )?(final|finals|semi|semis|semi-?finals?|quarter-?finals?|last \d+|knockout|play-?offs?|title|trophy|round of \d+)\b/,
  // "play football / cricket / …" is unambiguous sports colour. "'We're here to
  // play football', Iran downplays protest ahead New Zealand opener" is a World
  // Cup fixture, not the security-relevant unrest this monitor tracks.
  /\b(play|playing|plays|played) (football|soccer|cricket|rugby|hockey|netball|basketball|volleyball|handball|futsal)\b/,
  // Explainer / symbolism think-piece — "What does pink symbolize at the
  // Women's Alliance protest?" is a colour-symbolism explainer, not a report
  // of an event.
  /\bwhat (do|does)\b[^.!?]{0,40}\bsymboli[sz](e|es|ed|ing|m)\b/,
  // Retrospective disciplinary / inquiry aftermath of a PAST (dated) protest —
  // "university punishes staff over 2024 protest crackdown" is a delayed
  // sanction, not a live demonstration. Gated on a disciplinary/inquiry verb
  // + an explicit year + protest/crackdown, so a current live protest
  // ("2026 protest erupts in Dhaka") is untouched.
  /\b(punish\w*|disciplin\w*|sack\w*|suspend\w*|sentenc\w*|convict\w*|jail\w*|verdict|tribunal|probe|inquiry|commission|anniversary|aftermath)\b[^.!?]{0,45}\b(19|20)\d{2}\b[^.!?]{0,25}\b(protest|crackdown|riot|unrest|uprising|movement)\b/,
];

// Editorial suppression — specific genuine-protest headlines an operator has
// manually removed from the Protests & Civil Unrest feed. These ARE real
// public-order events (so they are NOT homonyms/noise and the categorical
// excludes above correctly leave them in); they are dropped only because an
// operator made a per-item editorial call. Each pattern is bound tightly to
// its one headline so it can never swallow a different live protest. Matched
// against the normalised title (source suffix stripped, lower-cased).
const FLASHPOINT_EDITORIAL_SUPPRESS: RegExp[] = [
  // "3 Demands Raised by Indonesian Women's Alliance in Jakarta Protest"
  /\bdemands raised by\b[^.!?]{0,40}\bwomen'?s alliance\b/,
  // "Bandung Students Protest for Third Time; Here Are the Demands"
  /\bbandung students? protest\b[^.!?]{0,40}\bhere are the demands\b/,
  // "Bangladesh halts construction of largest Lord Ram statue after ... protest"
  /\blord ram statue\b/,
];

// Off-topic news DIGESTS — a single article bundling several unrelated stories
// ("X's first protest, Y ties, and Z accident"). The protest is just one list
// item, not the article's subject, so the protest-verdict wrongly keeps it.
// Bound tightly to the one digest headline so it can never swallow a live event.
const FLASHPOINT_OFFTOPIC_DIGEST: RegExp[] = [
  // "CJP's first protest, India-Nepal ties, and Vizag steel plant accident"
  /\bfirst protest\b[^.]{0,60}\bvizag steel plant accident\b/,
];

// Figurative "roadblock" = an OBSTACLE METAPHOR ("the program faced
// roadblocks", "funding roadblocks to the deal"), NOT a protest road-block.
// REQUIRED treats bare "roadblock" as an unambiguous protest tactic, so these
// leak in. Drop only when no genuine-unrest companion is present, so a real
// "protesters set up roadblocks" or a "Barracks Roadblock" mutiny still keeps.
const FP_FIGURATIVE_ROADBLOCK_RE =
  /\b(faces?|faced|facing|hit|hits|hitting|met|meets?|meeting|encounter(s|ed|ing)?|overcome|overcame|major|biggest|key|main|serious|significant|another|further|political|legal|legislative|regulatory|bureaucratic|financial|funding|budget|procedural|economic|diplomatic|technical|administrative|logistical|practical)\s+(\w+\s+){0,2}road ?blocks?\b|\broad ?blocks?\s+(to|for|ahead|remain|persist|that|include|including|over|on the (path|road|way))\b/i;

// Cancelled / suspended industrial action = a NON-EVENT (the strike was called
// off or never happened). Title-bound; spared when the headline shows the
// action actually continues or turned to unrest.
const FP_CANCELLED_ACTION_RE =
  /\b(call(s|ed)?\s+off|called[- ]off|suspend(s|ed|ing)?|postpon(e|es|ed|ing)|defer(s|red|ring)?|scrap(s|ped|ping)?|cancel(s|led|ling)?|avert(s|ed|ing)?)\b[^.]{0,18}\b(strike|strikes|walkout|walkouts|stoppage|industrial action)\b/i;
const FP_CANCELLED_KEEP_RE =
  /\b(continu\w*|resum\w*|protest|clash\w*|charge[sd]?|defy|defian\w*|escalat\w*|riot\w*|violen\w*|killed?|injured)\b/i;

// Shared "is there genuine unrest here?" companion — spares a figurative match
// that sits alongside a real public-order signal.
const FP_REAL_UNREST_COMPANION_RE =
  /\b(protest|demonstrat|rally|rallies|rallied|march(es|ers?|ing|ed)|picket|walkout|strike|riot|clash|tear ?gas|water cannon|barricad|sit-?in|curfew|hartal|bandh|gherao|crowd|mob|looting|arson|stormed?|unrest|blockad)\b/i;

// Travel/safety ADVISORY telling nationals/tourists to AVOID protest or
// demonstration AREAS — operational safety guidance, not a civil-unrest event.
// Gated on all three signals (an "avoid" instruction + an advisory issuer + a
// protest/area target) so a genuine demonstration headline that merely shares
// one of these tokens is never dropped.
const FP_ADVISORY_AVOID_RE = /\bavoid\b/i;
const FP_ADVISORY_ISSUER_RE =
  /\b(advis|warn|caution|alert|travel|national|tourist|embass|consulat|foreign ministr|urged|expats?)/i;
const FP_ADVISORY_TARGET_RE =
  /\b(protest|demonstration|rally|unrest|area|district|downtown|gathering|zone)/i;

// Editorial LABEL leading the headline (opinion / analysis / commentary /
// explainer). A think-piece about unrest, not a report of a discrete event.
const FP_EDITORIAL_LABEL_RE =
  /^\s*\[?\s*(analysis|commentary|opinion|editorial|perspective|viewpoint|column|explainer|backgrounder|factbox|q&a)\s*[:\]\-–—|]/i;

// Editorial FORMATS — listicles ("5 things to know"), digests ("Today's Top 3
// News"), photo galleries ("in pictures"), yearenders, "explained" /
// "what's next for" think-pieces, "lessons from" / "why X matters". A bundle
// or retrospective, not a single civil-unrest event.
const FP_EDITORIAL_FORMAT_RE =
  /\btoday'?s top\s+\d+\b|\btop\s+\d+\s+(news|stories|issues|things|headlines|moments)\b|\b\d+\s+things\s+to\s+know\b|\bthings\s+to\s+know\b|\byearender\b|\bin\s+(pictures|photos|charts|maps|graphics)\b|\bphoto\s+(gallery|essay)\b|\bwhat'?s\s+next\s+for\b|\b(protests?|unrest|crisis|demonstrations?)\s+explained\b|\bexplained\s*[:|]|\blessons?\s+(from|of|for)\b|\bthe\s+lesson\b|\bwhy\s+.{2,40}\bmatters?\b/i;

// Protest AFTERMATH / clean-up (street cleaning after a demo, a "protests
// aftermath" retrospective) — a non-event, unless an ongoing-unrest signal
// shows the situation is still live.
const FP_AFTERMATH_RE =
  /\b(clean\s?up|cleaning\s?up|clean-up|street cleaning|sweep(ing)? the streets|mop\s?up|clearing (the )?(debris|rubble))\b[^.!?]{0,30}\b(after|following|post)\b[^.!?]{0,24}\b(protest|demonstration|rally|riot|unrest)\b|\b(protests?|demonstration|rally|riot|unrest)\s+aftermath\b/i;
const FP_AFTERMATH_LIVE_RE =
  /\b(clash|resume|continu|escalat|erupt|storm|riot|tear ?gas|water cannon|killed|injured|dead|death toll|wounded|arrest|detain|set (on )?fire|arson|loot)\b/i;

// Diplomatic / interstate "protest" = a formal complaint note between states,
// not a street demonstration ("Thailand lodges official protest against …").
const FP_DIPLOMATIC_PROTEST_RE =
  /\b(diplomatic|formal|official|written|strong|stern)\s+protests?\b(?!\w)|\blodge[sd]?\s+(an?\s+)?(official|formal|diplomatic|strong|stern|written)\s+\w*\s*protests?\b|\bprotests?\s+(note|d[eé]marche)\b/i;

// Sports-governance protest (cricket board, tennis prize money, fans outside a
// stadium) — a sporting grievance, not security-relevant civil unrest.
const FP_SPORTS_GOV_RE =
  /\b(cricket board|cricket head\s?quarters?|sports mafia|french open|wimbledon|grand slam|prize money|olympic committee|football federation|formula 1|premier league|la liga|test match|odi series)\b/i;

// Appeal for calm / restraint by authorities — a preventive statement, not a
// civil-unrest event ("PNP calls for calm as Congress convenes"). Dropped only
// when the headline is purely the appeal (no event word in the title) AND the
// full text carries no LIVE unrest, so "Police call for calm after deadly
// clashes" and "After deadly protests, PM urges calm" are still kept. The
// keep-guards use leading-\b stems so inflections (protests / killed) match.
const FP_CALM_APPEAL_RE =
  /\b(calls?|appeals?|urges?|appeal|plea|pleads?|urge|urged|urging|calling|appealing)\s+(?:on\s+\w+\s+|the\s+public\s+|to\s+\w+\s+)?(?:for\s+)?(calm|restraint|sobriety|public calm|maximum restraint)\b|\bnot to escalate\b|\b(remain|stay|keep)\s+calm\b/i;
const FP_CALM_TITLE_EVENT_RE =
  /\b(clash|riot|protest|rall(y|ies)|demonstrat|march|unrest|strike|blockade|sit[- ]?in|kill|injur|dead|deadly|wound|tear ?gas|water cannon|arrest|detain|storm|torch|burn|arson|loot|violen|ston(e|ing)|baton|rubber bullet|stampede|curfew|crackdown|shot|fire)/i;
const FP_CALM_LIVE_RE =
  /\b(clash|riot|kill|injur|dead|deadly|wound|tear ?gas|water cannon|arrest|detain|storm|torch|burn|arson|loot|violen|stampede|curfew|shot|opened fire)/i;

// Overseas / diaspora demonstration at an unmistakably non-APAC Western venue
// (a London / Washington solidarity protest the geocoder mis-tagged to a
// South-Asian country). Not an in-region civil-unrest incident.
const FP_OVERSEAS_VENUE_RE =
  /\b(oxford union|cambridge union|the white house|capitol hill|downing street|westminster hall|trafalgar square)\b/i;
const FP_OVERSEAS_PROTEST_RE = /\b(protest|demonstrat|rally|clash|picket|vigil|gather)/i;

// APAC regional-scope anchor — the union of every country / demonym / city /
// Pacific marker the ingest country resolver can attribute (COUNTRY_ALIASES +
// PNG_MARKERS + WEST_PAPUA_MARKERS in @workspace/ingest), plus a few unambiguous
// APAC political markers (org names) for recall. It does NOT gate on its own:
// a genuine APAC protest often names only a LOCAL entity the gazetteer does not
// know (Manibela, Mendiola, Camp Crame, the MACC chief, Nepal's Oli/Lekhak Gen-Z
// crackdown) with the country only in the stripped masthead, so REQUIRING an
// anchor would wrongly bury real events. Instead it is the PROTECTIVE override
// for the out-of-region gate below: a record that names BOTH a foreign theatre
// AND an in-region place ("Thai protesters target Malaysian, US embassies",
// "anti-Israel rally in Jakarta") is kept. Mirror COUNTRY_ALIASES: any token
// added there should be added here too. "chinese" is deliberately OMITTED (an
// actor, not a venue — "Chinese embassy" protests happen across the region).
const FP_APAC_ANCHOR_RE =
  /\b(?:australia|australian|australians|sydney|melbourne|brisbane|canberra|perth|adelaide|new zealand|new zealander|new zealanders|auckland|wellington|christchurch|dunedin|bangladesh|bangladeshi|bangladeshis|dhaka|chittagong|chattogram|comilla|cumilla|rangpur|sylhet|khulna|rajshahi|barisal|barishal|mymensingh|gazipur|narayanganj|china|beijing|shanghai|guangzhou|shenzhen|hong kong|wuhan|chengdu|xinjiang|india|indian|indians|delhi|mumbai|chennai|bengaluru|kolkata|hyderabad|imphal|guwahati|lucknow|patna|manipur|indonesia|indonesian|indonesians|jakarta|java|sumatra|bali|sulawesi|surabaya|bandung|medan|makassar|yogyakarta|semarang|aceh|japan|japanese|tokyo|osaka|kyoto|yokohama|nagoya|fukuoka|malaysia|malaysian|malaysians|kuala lumpur|penang|johor|sabah|sarawak|putrajaya|myanmar|burma|burmese|yangon|mandalay|naypyidaw|nepal|nepali|nepalis|nepalese|kathmandu|pokhara|biratnagar|pakistan|pakistani|pakistanis|karachi|lahore|islamabad|rawalpindi|peshawar|quetta|multan|faisalabad|philippines|philippine|filipino|filipina|filipinos|filipinas|manila|cebu|davao|quezon|mindanao|iloilo|baguio|zamboanga|pnp|south korea|south korean|south koreans|seoul|busan|incheon|daegu|sri lanka|sri lankan|sri lankans|colombo|kandy|jaffna|galle|negombo|thailand|thai|thais|bangkok|chiang mai|phuket|vietnam|viet nam|vietnamese|hanoi|ho chi minh|haiphong|jamaat|shibir|awami|rohingya|naxal|maoist|hartal|tehreek|imran khan|papua|papuan|papua new guinea|png|port moresby|lae|taraka|mount hagen|mt hagen|bougainville|enga|hela|highlands highway|madang|morobe|kokopo|goroka|wewak|kimbe|tari|pngdf|rpngc|marape|bismarck archipelago|west papua|papua barat|jayapura|wamena|manokwari|sorong|merauke|nabire|timika|mimika|biak|fakfak|jayawijaya|free west papua|opm|tpnpb|intan jaya|nduga|puncak jaya|paniai|ilaga|sugapa|yahukimo|dekai|maybrat|beoga|lanny jaya|tolikara|dogiyai|deiyai|keerom|sarmi|waropen|supiori|boven digoel)\b/i;

// Out-of-region theatre — countries / capitals / leaders OUTSIDE the 15-country
// APAC scope (Latin America, the Middle East, Africa, non-APAC Europe/Eurasia,
// the Americas, G7/G20 summits). A flashpoint/protests record that names one of
// these in its MASTHEAD-STRIPPED body and carries NO APAC anchor is foreign
// syndication an APAC publisher merely re-ran — "G7 protest turns from carnival
// to violent stand-off", "Bolivia protest sees looting in La Paz", "post-Maduro
// Venezuela", "Iran foreign-ministry protest". At ingest these resolve to no
// APAC country and are already dropped as "no-apac-country"; this hides the rows
// already stored. Deliberately keyed off a POSITIVE foreign place (not a missing
// APAC anchor) so a real APAC event whose only geo cue is a local entity is
// untouched. Tokens are chosen to avoid in-region / namesake collisions (no bare
// "us"/"america"; no "guinea" -> Papua New Guinea; no "georgia" -> US state).
// Country names AND demonyms (singular + plural): a Google-News headline names
// the people as often as the place ("Nigerian teachers protest", "Peruvians
// protest", "Hundreds of Israelis protest"), and a bare \bnigeria\b never matches
// "Nigerian", so the demonym forms must be listed explicitly.
const FP_OFFSHORE_THEATRE_RE =
  /\b(?:bolivia|bolivian|bolivians|la paz|venezuela|venezuelan|venezuelans|caracas|maduro|peru|peruvian|peruvians|lima|brazil|brasil|brazilian|brazilians|brasilia|argentina|argentine|argentinian|argentinians|buenos aires|mexico|mexican|mexicans|chile|chilean|chileans|santiago|colombia|colombian|colombians|bogota|ecuador|ecuadorian|ecuadorians|quito|nicaragua|nicaraguan|nicaraguans|honduras|honduran|hondurans|guatemala|guatemalan|guatemalans|panama|panamanian|panamanians|uruguay|paraguay|haiti|haitian|haitians|iran|iranian|iranians|tehran|iraq|iraqi|iraqis|baghdad|israel|israeli|israelis|gaza|palestine|palestinian|palestinians|lebanon|lebanese|beirut|syria|syrian|syrians|damascus|yemen|yemeni|yemenis|houthi|houthis|saudi|saudis|riyadh|jordan|jordanian|jordanians|amman|qatar|qatari|doha|bahrain|bahraini|kuwait|kuwaiti|oman|omani|dubai|abu dhabi|egypt|egyptian|egyptians|cairo|kenya|kenyan|kenyans|nairobi|nigeria|nigerian|nigerians|niger|lagos|abuja|ethiopia|ethiopian|ethiopians|addis ababa|sudan|sudanese|khartoum|somalia|somali|somalis|mogadishu|south africa|south african|johannesburg|pretoria|congo|congolese|kinshasa|ghana|ghanaian|ghanaians|accra|uganda|ugandan|ugandans|kampala|zimbabwe|zimbabwean|zimbabweans|harare|tanzania|tanzanian|tanzanians|morocco|moroccan|moroccans|algeria|algerian|algerians|tunisia|tunisian|tunisians|libya|libyan|libyans|tripoli|senegal|senegalese|cameroon|cameroonian|cameroonians|zambia|zambian|zambians|malawi|malawian|malawians|mozambique|mozambican|mozambicans|rwanda|rwandan|rwandans|ivory coast|turkey|turkish|ankara|istanbul|albania|albanian|albanians|tirana|greece|greek|athens|serbia|serbian|serbians|belgrade|ukraine|ukrainian|ukrainians|kyiv|kiev|russia|russian|russians|moscow|belarus|belarusian|belarusians|minsk|poland|warsaw|hungary|hungarian|hungarians|budapest|romania|romanian|romanians|bucharest|bulgaria|bulgarian|bulgarians|czech|slovakia|slovak|croatia|croatian|croatians|bosnia|bosnian|bosnians|kosovo|kosovar|moldova|moldovan|moldovans|armenia|armenian|armenians|yerevan|azerbaijan|azerbaijani|azerbaijanis|baku|trump|maga|washington|g7|g-7|g20|g-20|davos)\b/i;

// Masthead-stripped GEO text — mirrors geoHaystack() in @workspace/ingest so the
// APAC-anchor gate sees exactly the text the country resolver saw. Google News
// appends the publisher to BOTH the title (after a trailing " - " / " | ") and,
// verbatim, the summary; a publisher CITY ("The Manila Times" -> Manila) would
// otherwise fake an APAC anchor for an out-of-region story that names no real
// place. Strip the title's trailing source AND the persisted source name from
// both fields, then lower-case for the anchor regex.
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function mastheadStrippedGeoText(i: RelevanceInput): string {
  const title = i.title ?? "";
  const summary = i.summary ?? "";
  const dash = Math.max(title.lastIndexOf(" - "), title.lastIndexOf(" | "));
  const dashSource = dash > 0 ? title.slice(dash + 3).trim() : "";
  const cleanTitle = dash > 0 ? title.slice(0, dash) : title;
  let geo = `${cleanTitle}\n${summary}`.toLowerCase();
  // Strip the wire masthead. Google News appends the source after " - "/" | "
  // in the title, but SOME feeds append it to the SUMMARY ONLY with no dash, so
  // a source like "India Today" leaks "india" as a false APAC anchor. Remove
  // both the title-suffix source AND the persisted source name (i.source),
  // matched as whole phrases — never bare substrings, so a short source like
  // "ANI"/"AP" cannot gut "animal"/"capture".
  const feedSource = (i.source ?? "").replace(/\([^)]*\)/g, " ").trim();
  for (const s of [dashSource, feedSource]) {
    const t = s.toLowerCase().trim();
    if (t) geo = geo.replace(new RegExp(`\\b${reEscape(t)}\\b`, "g"), " ");
  }
  return geo;
}

// Recruitment / manpower industry objecting to an administrative REQUIREMENT
// (a foreign skills test, certification rule, quota) — a commercial-lobby
// grievance, not street civil unrest. Dropped only when NO public-order signal
// (a held rally / sit-in / blockade / arrests / "outside the ministry") is
// present anywhere in the text, so a real agency street action survives.
const FP_INDUSTRY_ACTOR_RE =
  /\b(recruit(er|ers|ment|ing)|manpower|placement agenc\w*|overseas employ\w*|staffing agenc\w*|labou?r recruit\w*)\b/i;
const FP_INDUSTRY_OBJECT_RE =
  /\b(test|requirement|rule|regulation|criteria|circular|directive|notification|quota|accreditation|certif\w*|exam|policy|levy|fee|guideline|norm)\b/i;
const FP_INDUSTRY_STREET_RE =
  /\b(rally|rallies|march|clash|riot|strike|blockade|road|highway|sit[- ]?in|picket|bandh|shutdown|gherao|hartal|stage[ds]?|staged|hold|held|gather|crowd|thousands|hundreds|burn|torch|effigy|arrest|detain|tear ?gas|injured|killed|outside)\b/i;

// Security forces pre-positioned to SECURE / police an upcoming protest — a
// deployment & logistics statement, not an unrest event ("Police deploy 4,131
// personnel to secure Jakarta protests"). A genuine post-clash deployment is
// kept via the live-violence override (FP_CALM_LIVE_RE).
const FP_SECURITY_DEPLOY_VERB_RE =
  /\b(deploys?|deployed|deploying|deployment|mobilis\w*|mobiliz\w*|station(s|ed|ing)?|beef(s|ed)? up|step(s|ped)? up|ramp(s|ed)? up|tighten(s|ed|ing)?|reinforc\w*|put on standby|on (high )?alert|placed on alert)\b/i;
const FP_SECURITY_FORCE_RE =
  /\b(police|personnel|security (forces|personnel)|officers|troops|cops|constab\w*|paramilitar\w*|riot police|law enforcement|security)\b/i;
const FP_SECURITY_PURPOSE_RE =
  /\b(secure|securing|to secure|guard|safeguard|monitor|maintain (order|peace)|keep the peace|ahead of|in anticipation of|police the|oversee)\b/i;

// Labour / industrial tribunal ADJUDICATING whether industrial action is
// lawful — a legal-process story ("Fair Work rejects gas giant's claim strikes
// would harm the economy"), not a stoppage. Kept when a real strike is
// actually under way or has been cleared to proceed.
const FP_LABOUR_TRIBUNAL_RE =
  /\b(fair work commission|fair work|industrial relations commission|industrial tribunal|labou?r court|labor relations commission|national labor relations commission|nlrc|arbitration (commission|tribunal|panel)|industrial court)\b/i;
const FP_TRIBUNAL_PROCESS_RE =
  /\b(reject\w*|uphold\w*|dismiss\w*|rul\w*|order\w*|grant\w*|approv\w*|deni\w*|hear\w*|bid|claim\w*|application|appeal\w*|lawful|unlawful|protected action|ballot|injunction|verdict|ruling)\b/i;
const FP_TRIBUNAL_ACTIVE_STRIKE_RE =
  /\b(strike|walkout|stoppage)s?\b[^.]{0,24}\b(begin|begins|began|start|starts|started|proceed\w*|go ahead|commenc\w*|under ?way|loom\w*|planned|set (for|to)|to (begin|start|hit|go ahead)|enters?|continue\w*|escalat\w*)\b|\b(walk(ed|s)? off|downed tools|on strike|staged? (a )?(strike|walkout)|picket(ing|ed|s|ers)?|took to the picket)\b/i;

// Press-freedom / coverage-suppression story — the unrest is the REPORTING
// SUBJECT being censored, not an event ("Pakistan accused of silencing PoJK
// unrest coverage as journalist faces detention"). A journalist actually
// killed / shot / hurt in violence is kept.
const FP_PRESS_SUPPRESS_RE =
  /\b(silenc\w*|censor\w*|gag\w*|muzzl\w*|suppress\w*|black\s?out|throttl\w*|clamp\w* down on|stifl\w*)\b[^.]{0,40}\b(coverage|report\w*|press|media|journalis\w*|news|footage|broadcast)\b|\b(unrest|protest|conflict)\s+coverage\b|\b(coverage|reporting) of (the )?(unrest|protest)\b|\b(press freedom|media freedom|freedom of the press)\b/i;
const FP_PRESS_ACTOR_RE =
  /\b(journalis\w*|reporter\w*|correspondent|news ?paper|press|media outlet|broadcaster|editor|photojournalis\w*|blogger|news channel)\b/i;
const FP_PRESS_REAL_VIOLENCE_RE =
  /\b(kill\w*|shot|gunned|injur\w*|wounded|beaten|assault\w*|stab\w*|fired? (on|at)|tear ?gas\w*|clash\w*|riot\w*|storm\w*)\b/i;

// School-admission / enrolment grievance — an administrative complaint over a
// student-intake system (SPMB / PPDB / zonasi / "not accepted"), not security-
// relevant civil unrest. A real escalated street action keeps.
const FP_SCHOOL_ADMISSION_RE =
  /\b(spmb|ppdb|zonasi|school admission\w*|student admission\w*|school enrol\w*|admission (system|process|quota|policy|selection)|not accepted (to|into|at|—|,)|tidak diterima|school placement|school registration|new (pupil|student) (intake|admission|enrol\w*))\b/i;

// Court / judicial PROCESS story — a sentencing, verdict, conviction, jail term
// or trial is a legal outcome, not a civil-unrest EVENT ("Court sentences
// ex-President Yoon to 30-year jail term"). It must NOT count toward a country's
// severity on the protest monitor. Kept only when real unrest accompanies it
// (verdict that sparks protests / clashes / a rally), via the companion guard.
const FP_COURT_PROCESS_RE =
  /\b(court|tribunal|judge|judiciary|prosecutor\w*|prosecution|the bench)\b[^.]{0,45}\b(sentenc\w*|jail\w*|imprison\w*|convict\w*|acquit\w*|verdict|ruling|rules?|ruled|indict\w*|on trial|found guilty|guilty)\b|\bsentenc\w*\b[^.]{0,30}\b(to|jail|prison|year|years|life)\b|\b(jail|prison) term\b|\bjailed (for|over)\b|\b\d+[- ]year (jail|prison)\b/i;
// Keep-guard for the court drop: only a LIVE unrest reaction TO THE OUTCOME
// rescues a court/legal-process record — not the bare appearance of a protest
// word describing the PAST event the case concerns ("union rally death",
// "protest death", "during a 2024 rally"). The earlier version rescued on any
// bare "rally"/"protest"/"riot", which let retrospective verdicts about a past
// rally lead the severity ranking. Three rescue paths, all LEADING-\b STEMS
// ONLY (never a trailing \b) so plurals/inflections still match:
//   (a) strong active-response tokens that essentially never appear merely
//       recounting a past rally (tear gas / water cannon / baton charge /
//       barricades / curfew / looting / arson / torched / hartal / bandh);
//   (b) the verdict/ruling/sentence SPARKS or TRIGGERS fresh unrest;
//   (c) protests/clashes break out AFTER / OVER / AGAINST the ruling.
// "march" stays omitted to avoid colliding with the month.
const FP_COURT_UNREST_KEEP_RE = new RegExp(
  [
    // (a) active-response tokens (an outcome being met with force / disorder)
    /\b(tear ?gas|water cannon|baton charg|lathi charg|barricad|curfew|looting|arson|torched|set (ablaze|on fire|alight)|ransack|hartal|bandh|gherao|stormed|storming)/.source,
    // (b) the ruling/verdict/sentence sparks/triggers a fresh unrest reaction.
    //     The outcome can be a bare outcome NOUN ("verdict sparks protests") OR
    //     an institution governing an outcome VERB ("Court jails leader,
    //     sparking protests") — mirrors FP_COURT_PROCESS_RE's outcome family so
    //     every phrasing the drop catches can also be rescued.
    /\b(?:(?:verdict|ruling|sentenc\w*|conviction|acquitt\w*|judg(?:e)?ment|court (?:decision|order|ruling|verdict))|(?:court|tribunal|judge|judiciary)\b[^.]{0,30}\b(?:jail\w*|imprison\w*|convict\w*|sentenc\w*|verdict|ruled|rules?|found guilty|guilty))\b[^.]{0,40}\b(spark\w*|trigger\w*|ignit\w*|prompt\w*|sets? off|setting off|unleash\w*|provok\w*|touch\w* off|led to|lead\w* to|fuel\w*|erupt\w*|flar\w*)\b[^.]{0,45}\b(protest|demonstrat|rall(?:y|ies|ied)|riot|clash|unrest|uprising|walkout|strike)/.source,
    // (c) protests/clashes break out AFTER / OVER / AGAINST the outcome
    /\b(protest|demonstrat|rall(?:y|ies|ied)|riot|clash|unrest|uprising|sit-?in|picket|walkout|strike)\w*\b[^.]{0,45}\b(after|over|against|following|amid|amidst|in response to|in reaction to|denounc\w*|reject\w*|condemn\w*|outrag\w*)\b[^.]{0,30}\b(verdict|ruling|sentenc\w*|conviction|acquitt\w*|court|judg(?:e)?ment|decision)/.source,
    // (d) an unrest verb directly governing the COURT outcome — "Hundreds
    //     protest court ruling", "demonstrators storm court over verdict".
    //     Requires the institutional "court" word AS THE OBJECT (not a bare
    //     "protest verdict", which is the verdict OF a past protest case), so
    //     a retrospective "court convicts protest activists" — where the
    //     court word PRECEDES the unrest word — never re-qualifies. "march" is
    //     omitted here too (month collision: "March court ruling...").
    /\b(protest|demonstrat|rall(?:y|ies|ied)|riot|clash|storm)\w*\b[^.]{0,20}\bcourt\b[^.]{0,20}\b(ruling|rules?|ruled|verdict|order|decision|judg(?:e)?ment|sentenc\w*|acquitt\w*|conviction|convict\w*)/.source,
  ].join("|"),
  "i",
);

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
  // The Baltic Dry Index / Baltic Exchange is a commercial freight-rate
  // benchmark, not a maritime-security or disruption incident. Its daily
  // "index rises/falls" wires flooded the Confirmed Maritime Incidents board.
  /\bbaltic (dry|exchange|capesize|panamax|supramax) index\b/,
  /\bbaltic dry\b/,
  // UK Royal-Navy mine-countermeasures KIT / procurement stories (e.g.
  // "Defender-Viper: Royal Navy's new minehunting drone", "Royal Navy readies
  // minesweeper drones for ...") are capability announcements, not chokepoint
  // incidents — dropped even when a tracked theatre is name-dropped as the
  // intended area of use (this list, unlike the off-region gate, is NOT
  // theatre-suppressed). Gated on PROCUREMENT/CAPABILITY framing only — an
  // operational minehunter actually clearing mines in a tracked strait, or an
  // attack ON a minesweeper, must stay in-scope, so this no longer fires on the
  // bare word "drone"/"vessel".
  /\b(readies|readying|unveil\w*|procur\w*|acquir\w*|fleet of)\b[^.]{0,40}\b(minehunt\w*|minesweep\w*|mine[- ]hunting|mine[- ]sweeping)\b/,
  /\b(minehunt\w*|minesweep\w*|mine[- ]hunting|mine[- ]sweeping)\b[^.]{0,40}\b(programme|program|procurement|on order|under contract|sea trials?|capabilit\w*)\b/,
  /\bdefender[- ]viper\b/,
];

// Tracked chokepoint theatres — the board follows the Gulf + Asia straits
// (BOARD_CHOKEPOINTS). When a story names any of these it is in-scope even if it
// also references an off-theatre sea (e.g. a comparative "from the Baltic to
// Hormuz" piece), so the off-region gate below is SUPPRESSED whenever this hits.
const SHIPPING_THEATRE_RE =
  /\b(strait of hormuz|hormuz|bab[- ]?el[- ]?mandeb|bab al[- ]?mandab|red sea|gulf of aden|gulf of oman|persian gulf|arabian (sea|gulf)|suez|malacca|singapore strait|south china sea|taiwan strait|lombok|sunda)\b/;

// Off-theatre maritime geography — European / Atlantic / Black-Baltic waters
// that are NOT tracked by the board. A vessel incident anchored to one of these
// (a Black Sea tanker drone strike, a UK/Baltic "shadow fleet" interdiction, an
// English Channel or Scottish-waters seizure) is dropped UNLESS the same story
// also names a tracked theatre above. Gated this way (off-region present AND no
// tracked theatre) so precision stays high and a Gulf/Asia story is never lost.
const SHIPPING_OFF_REGION: RegExp[] = [
  /\bblack sea\b/,
  /\bbaltic sea\b/,
  /\bgulf of (finland|bothnia|riga)\b/,
  /\benglish channel\b/,
  /\bnorth sea\b/,
  /\bscottish (waters|coast|isles|islands)\b/,
  /\bscotland\b/,
  // Russian navy / "Putin's tanker" Channel & Atlantic harassment stories — a
  // European naval-news beat, not a Gulf/Asia chokepoint incident. Bound tightly
  // (an explicit Russian/Putin vessel, or warship/yacht near "channel") and
  // still theatre-suppressed, so a Russian warship incident IN a tracked strait
  // is kept.
  /\brussian warship\b/,
  /\bputin'?s?\b[^.]{0,25}\b(tanker|fleet|warship|ship|navy)\b/,
  /\bchannel\b[^.]{0,30}\b(yacht|warship|crossing|migrant\w*)\b/,
  /\b(yacht|warship|migrant\w*)\b[^.]{0,30}\bchannel\b/,
  // Russian "shadow fleet" interdiction by the UK / Baltic states — a European
  // sanctions-enforcement story, not a Gulf/Asia chokepoint incident. Bound to
  // the European actor so a shadow-fleet tanker transiting Hormuz still keeps.
  /\b(uk|u\.k\.|britain|british|royal navy|starmer|estonia|estonian|finland|finnish|denmark|danish|sweden|swedish)\b.{0,40}\bshadow (fleet|tanker|tankers|ship|ships)\b/,
  /\bshadow (fleet|tanker|tankers|ship|ships)\b.{0,40}\b(uk|u\.k\.|britain|british|royal navy|starmer|estonia|estonian|finland|finnish|denmark|danish|sweden|swedish|tate modern)\b/,
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

// Conflict topic off-topic noise. The conflict REQUIRED gate keys off actor
// words (rebel/insurgent/militia/...) and kinetic verbs, so a PEACE/RELIEF
// story that merely NAMES former combatants slips through ("Ex rebels help in
// relief operations for quake victims"). These excludes run BEFORE the conflict
// required gate to drop humanitarian / reintegration / peace-process / natural-
// disaster-relief items that carry no live armed-violence signal. Kept narrow:
// each pattern binds the conflict actor word (or a disaster) to an explicitly
// NON-violent frame, so a genuine ambush/firefight/bombing is never dropped.
const CONFLICT_EXCLUDE: RegExp[] = [
  // Former/ex combatants in a peaceful role: relief, aid, reintegration,
  // livelihood, farming, rebuilding, surrender/disarmament, amnesty, peace.
  /\b(ex|former)[- ]?(rebel|combatant|insurgent|militant|militia|guerrilla|fighter|separatist)s?\b[^.]{0,80}\b(relief|aid|humanitarian|rehabilitat|reintegrat|reintegration|livelihood|farm|farming|plant(ing|ed)?|crop|harvest|develop|rebuild|reconstruct|donat|volunteer|charity|community|peace|amnesty|surrender|laid down|lay(ing)? down|disarm|decommission)/,
  /\b(relief|aid|humanitarian|rehabilitat|reintegrat|reintegration|livelihood|rebuild|reconstruct|donat|volunteer|charity|amnesty|peace deal|peace accord|peace process|disarm|decommission)\b[^.]{0,80}\b(ex|former)[- ]?(rebel|combatant|insurgent|militant|militia|guerrilla|fighter|separatist)s?\b/,
  // Natural-disaster relief framing (quake/flood/typhoon victims + aid/relief/
  // rescue/recovery) — humanitarian, not armed conflict.
  /\b(earthquake|quake|flood(s|ing)?|typhoon|cyclone|landslide|tsunami|drought|volcan(o|ic)|eruption|mudslide) [^.]{0,40}\b(victim|survivor|relief|aid|evacuee|rescue|recovery|rehabilitat|displaced)/,
  /\b(relief|aid|rescue|recovery|humanitarian) (operation|effort|work|mission|team|convoy|drive)s?\b[^.]{0,60}\b(earthquake|quake|flood|typhoon|cyclone|landslide|tsunami|drought|disaster|victim|survivor)/,
  // Economic / investment / development stories that merely reference a past or
  // "post-" insurgency as background ("In first post-Naxal investment push,
  // Chhattisgarh receives proposals worth Rs 9,580 crore"). These are business
  // news, not armed-violence incidents. Bound to an explicit money/investment
  // frame so a Maoist BOUNTY ("reward of Rs 8 lakh") or a real attack that cites
  // economic damage is NOT dropped (the violence override also protects kinetic
  // events).
  /\b(post[- ]?naxal|post[- ]?insurgen|post[- ]?conflict|ex[- ]?naxal|former (naxal|maoist|insurgent|rebel|militant))\b[^.]{0,90}\b(investment|investor|invest|proposal|economic|industrial|business summit|development push|development project|fdi|gdp|tourism)\b/,
  /\b(naxal(ite)?|maoist|insurgen(t|ts|cy)|militan(t|ts|cy)|rebel|separatis(t|ts|m))\b[^.]{0,80}\b(investment push|investor(s)?(['’]| )?(meet|summit)|woo(s|ing)? investors|proposals? worth|investment summit|economic (zone|corridor|package|revival)|industrial (park|corridor))\b/,
  // Diplomacy / prevention analysis whose only conflict tie is a hypothetical
  // "spillover" ("Pakistan's U.S.-Iran Diplomacy Sought to Prevent a Militant
  // Spillover"). Gated TIGHTLY on a diplomacy/prevention verb adjacent to the
  // word "spillover" so genuine reports of militant violence around talks
  // ("militant violence falls after China-mediated talks") are NOT dropped.
  /\b(diploma(cy|tic|t)|prevent(s|ed|ing)?|avert(s|ed|ing)?|forestall|contain(s|ed|ing)?|stave off|avoid(s|ed|ing)?)\b[^.]{0,50}\bspillover\b/,
  // PEACE / "cleared" declarations: an area declared free of insurgency or
  // militancy, or a theatre officially normalised. These are the OPPOSITE of a
  // live armed event ("Calabarzon declared insurgency-free on Independence
  // Day") yet name an actor word, so they slip past the conflict REQUIRED gate.
  // The violence override below still re-admits any genuine kinetic event (e.g.
  // "declared insurgency-free after troops kill five rebels").
  /\b(insurgenc(y|ies)|militanc(y|ies)|naxal(ism|ite)?|terror(ism|ist)?|rebel(lion)?)[ -]free\b/,
  /\bfree (of|from) (insurgenc(y|ies)|militanc(y|ies)|naxal(ism)?|terror(ism)?|rebel(lion)?|armed (group|conflict))/,
];

// Hard ARMED-violence signal. When present, the relief/peace excludes above are
// SKIPPED so a genuine kinetic event still reaches the REQUIRED gate — e.g. a
// relief convoy that is AMBUSHED, or a peace process with former rebels that
// COLLAPSES after an ambush. Deliberately ARMED-specific: bare death words
// (killed/dead/wounded) are excluded because they also describe disaster tolls
// ("earthquake kills 30"), which would re-open the relief noise this fix closes.
const CONFLICT_VIOLENCE_OVERRIDE: RegExp =
  /\b(ambush(ed|es)?|firefights?|gun ?battle|gun ?fight|shoot[- ]?out|cross[- ]?fire|opened fire|hail of (gunfire|bullets)|shelling|artillery|air ?strike|airstrike|drone strike|missile strike|bomb(ing|ed)|bomb blast|car bomb|truck bomb|suicide bomb(er|ing)?|roadside bomb|land ?mine|\bied\b|improvised explosive|grenade|mass shooting|massacre|gunned down|shot dead|gunm[ae]n|armed assailant|armed (attack|clash|clashes|raid|group)|militants? (attack(ed|s)?|raid(ed)?|kill(ed|s)?|ambush(ed)?|strike)|insurgents? (attack(ed|s)?|raid(ed)?|kill(ed|s)?|ambush(ed)?)|kidnap(ped|ping)?|abduct(ed|ion)?|hostages?|held captive)\b/;

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
    // Port DISRUPTION as a security/operational event — NOT commercial "port
    // congestion", which is freight-economics commentary, not a maritime
    // security incident (admitting it leaked container-rate / shipping-cost
    // stories into the security monitor).
    /\bport (closure|shutdown|strike|disruption|attack|berth|backlog)/,
    /\bchokepoint\b/,
    /\b(strait of hormuz|bab[- ]el[- ]mandeb|suez|malacca|singapore strait)/,
    /\b(naval|maritime) (advisory|warning|alert|patrol|operation)/,
    /\b(war risk|p&i|insurance premium) .{0,30}(shipping|vessel|tanker|maritime)/,
    /\b(route|routing|reroute|diversion) .{0,30}(vessel|tanker|ship|maritime|red sea|hormuz|suez|cape)/,
    // NOTE: bare "freight rate" / "shipping rate" / "container rate" is
    // commercial freight economics, not a security incident — deliberately NOT
    // admitted here.
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
    /\b(ied|improvised explosive|roadside bomb|land ?mines?|car bomb|truck bomb|grenade attack|bomb blast|suicide bomb(er|ing)?|drone strike|air ?strike (kill|hit|target|hits|kills|on))\b/,
    /\b(abduct(ed|ion|ions)?|kidnap(ped|ping|pings|pers)?|hostage(s)?|held hostage)\b/,
    /\b(gunm[ae]n|armed assailant|shot dead|gunned down|mass shooting|gun rampage|massacre)\b/,
    /\b(tpnpb|opm|free papua|west papua (rebel|fighter|insurgen|liberation|armed)|npa|new people'?s army|abu sayyaf|biff|bifm|bangsamoro|moro (rebel|fighter|front)|ttp|tehrik[- ]?i[- ]?taliban|baloch(istan)? (liberation|insurgen|army|militant)|naxal(ite)?|maoist (rebel|insurgent|attack|guerrilla)|arakan army|ethnic armed (group|organisation|organization))\b/,
    /\b(troops|soldiers|security forces|police|army|navy|marines) .{0,30}(killed|kill|ambush(ed)?|attack(ed)?|clash(ed)?|wounded|gunned down|firefight)\b/,
    /\b(killed|wounded|injured|dead|casualt) .{0,30}(clash|fighting|gun ?battle|firefight|ambush|insurgen|militan|rebel|raid|shoot[- ]?out|armed attack)\b/,
    /\b(armed robbery|armed heist|armed hold[- ]?up|at gunpoint|extortion racket|kidnap[- ]for[- ]ransom)\b/,
    // Myanmar / regional civil-war vocabulary. The patterns above are India/
    // Pakistan-centric (TTP, Naxal, Baloch) and were blind to the Myanmar
    // theatre, dropping genuine fighting ("junta counteroffensive", "fighting
    // rages", "land mines"). Each stays kinetic-bound so diplomacy / state-visit
    // / trade noise (no kinetic word) still fails the gate.
    /\b(shell(ing|ed)|aerial bombard(ment|ed|ing)?|air ?strikes?|airstrikes?|drone ?strikes?)\b(?!\s+out\b)/,
    /\b(artillery|mortar)\b[^.]{0,15}\b(fire|shell|shelling|shelled|barrage|strike|attack|duel|bombard(ment)?|round|rounds|bomb)\b/,
    /\b(junta|military|regime|tatmadaw|army|troops|rebel|resistance|insurgent|ethnic armed|karenni|kachin|tnla|mndaa|brotherhood alliance)\b[^.]{0,20}\b(counter[- ]?)?offensive\b/,
    /\b(people'?s defen[cs]e force|pdf fighters?|resistance (forces?|fighters?|groups?|army)|karenni|kachin independence army|kia (forces?|fighters?|rebels?|troops|battalion)|tnla|mndaa|brotherhood alliance|chin(land)? defen[cs]e force)\b/,
    /\b((heavy|fierce|intense|renewed|fresh|deadly|ongoing|sporadic) fighting|fighting (rage|rages|raged|raging|erupt|erupts|erupted|broke out|continues|intensif(y|ies|ied|ying)))\b/,
    /\bfighting between\b/,
    // An armed actor (or weapon) whose action KILLS/WOUNDS within a short span
    // is unambiguous conflict, e.g. "junta attacks kill three civilians",
    // "air and drone strikes kill four civilians". Casualty-bound, so a bare
    // state-visit/trade headline (no kill/wound word near the actor) still fails.
    /\b(junta|military|regime|tatmadaw|militants?|insurgents?|rebels?|separatists?|paramilitar(y|ies)|army|troops|soldiers|air ?force|warplanes?|fighter jets?|drones?|artillery|mortars?|shelling|airstrikes?|air ?strikes?)\b.{0,40}\b(kill(s|ed|ing)?|wound(s|ed|ing)?|massacre[ds]?|civilians? (killed|dead|wounded|hurt|slain))\b/,
  ],
  // Protests / Flashpoint use a two-tier match: an UNAMBIGUOUS phrase
  // alone is sufficient, but the ambiguous tokens "rally", "strike"
  // and "student(s)" must additionally co-occur with a public-order
  // cue (see FLASHPOINT_AMBIGUOUS_RE + FLASHPOINT_PUBLIC_ORDER_CUE_RE
  // below). The REQUIRED entries here represent only the unambiguous
  // tier; the ambiguous tier is enforced separately in
  // `isTopicRelevant` for `protests` and `flashpoint`.
  protests: [
    // NOTE: the polysemous words "protest" and "crackdown" are deliberately
    // OMITTED here — they are routed through the negative-sense gate
    // (flashpointProtestCrackdownVerdict) so a record is no longer kept merely
    // because its text contains "protest"/"crackdown" in a diplomatic, gesture,
    // interstate or law-enforcement sense. The unambiguous tokens stay.
    /\b(demonstration|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|industrial action|strike notice|hartal|bandh|gherao)(e?s|ers?|ing|ed)?\b/,
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
    // NOTE: the polysemous words "protest" and "crackdown" are deliberately
    // OMITTED here — they are routed through the negative-sense gate
    // (flashpointProtestCrackdownVerdict) so a record is no longer kept merely
    // because its text contains "protest"/"crackdown" in a diplomatic, gesture,
    // interstate or law-enforcement sense. The unambiguous tokens stay.
    /\b(demonstration|sit[- ]?in|picket|walkout|stoppage|riot|public disorder|looting|roadblock|road block|unrest|civil unrest|industrial action|strike notice|hartal|bandh|gherao)(e?s|ers?|ing|ed)?\b/,
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

// Title-rescue set: UNAMBIGUOUS public-order phrases whose presence in the
// HEADLINE overrides the body-scanning context excludes (military-strike
// homonym, student-crime). Deliberately EXCLUDES the ambiguous sports/finance
// homonyms ("rally", "march", bare "strike") AND the two POLYSEMOUS words
// "protest" / "crackdown" — those are routed through the negative-sense gate
// below, so a headline is no longer kept merely because it contains the word
// "protest" (diplomatic "lodged a formal protest", symbolic "resigned in
// protest", interstate "Bangladesh protests India") or "crackdown" ("drug
// crackdown").
const FLASHPOINT_TITLE_RESCUE_UNAMBIG_RE =
  /\b(demonstration(s)?|demonstrators?|sit[- ]?in|picket(s|ing|ed)?|walkout|stoppage|hartal|bandh|gherao|chakka jam|wheel[- ]?jam|shutter[- ]?down|industrial action|strike notice|civil unrest|public disorder|gen[- ]?z protest)\b/i;

// ---- Negative-sense gate for the polysemous words "protest" / "crackdown" ----
// "protest" is kept by default (high recall) UNLESS it is used in a non-civil-
// unrest sense AND no positive demonstration/casualty signal is present:
//   • symbolic individual gesture — "returned the medal in protest"
//   • diplomatic complaint        — "lodged a formal protest", "protest note"
//   • interstate complaint        — "Bangladesh protests India", "protest to China"
// A positive signal (protesters / took to the streets / tear gas / a death or
// arrest AT a protest / "protest turns violent") overrides the gate and keeps.
// "crackdown" is kept UNLESS it is plainly a law-enforcement / financial
// crackdown (drug / graft / tax / investment / Tiananmen …) with no civil-
// unrest companion.
const FP_POS_DEMO =
  /\b(protesters?|demonstrators?|took to the streets?|take to the streets?|staged? (a )?(protest|demonstration|sit[- ]?in|walkout|march|rally)|h(o|e)ld (a )?(protest|demonstration|rally|march)|mass protest|street protest|anti[- ]government protest|pro[- ]democracy|thousands|hundreds|crowd|rall(y|ied|ies)|march(es|ers|ing|ed)|gather(ed|ing)?|tear ?gas|water cannon|baton|rubber bullet|riot police|burn\w* (tyres|tires|effigy)|blockad(e|ed|ing)|roadblock|stormed?|sit[- ]?in|hunger strike)\b/i;
const FP_POS_VIOLENCE =
  /\b(deadly|violent|bloody|fatal)\s+(protest|demonstration|rally|unrest|riot)|\bprotest(s|ers)?\b.{0,40}\b(turn\w* (violent|ugly|deadly)|clash\w*|looting|arson|stormed?|set (on )?fire|torched?)\b|\b(killed?|kill\w*|dead|death\w*|fatal\w*|casualt\w*|injured|wounded|shot|hurt|die[ds]?|missing|arrested|detained)\b.{0,24}\b(in|during|at|amid|after)\s+(the\s+)?(?:\w+\s+){0,2}(protest|demonstration|rally|unrest|riot)|\bprotest (death|deaths|toll|killing|killings|violence)\b|\b(clash\w*|riot\w*)\b.{0,18}\bprotest/i;
const FP_NEG_GESTURE =
  /\b(resign\w*|quit|return\w*|withdraw\w*|step(ped)? down|boycott\w*|refus\w*|declin\w*|skip\w*|hand\w* back|wore? black|donat\w*|exit\w*) .{0,35}\bin protest\b|\bin protest\b.{0,30}(resign\w*|return\w*|withdraw\w*|boycott\w*|quit|step(ped)? down)\b|\b(act|sign|mark|token|gesture|instant act|form|means|way|expression) of protest\b|\bas a (?:silent |symbolic )?protest\b/i;
const FP_NEG_DIPLOMATIC =
  /\b(lodge[sd]?|filing|file[sd]?|issue[sd]?|issuing|register(s|ed|ing)?|submit\w*|deliver\w*|convey\w*|hand(s|ed)? over|raise[sd]?|made? (a|an|its)|sends? (a |an |its )?(formal |strong |diplomatic )?)\s+(a |an |its |strong |formal |official |diplomatic |written |stern |firm )*(protest|d[eé]marche|note verbale)\b|\bprotest (note|letter|d[eé]marche)\b|\b(diplomatic|formal|official|strong|stern|written|firm) protest\b|\bsummon\w*\b[^.]{0,60}\b(ambassador|envoy|diplomat|high commissioner|charg[eé] d|embassy|consul|deputy chief of mission)\b[^.]{0,40}\bprotest\b|\b(dfa|department of foreign affairs|foreign ministry|ministry of foreign affairs|foreign office|state department)\b[^.]{0,25}\bprotest\b|\bprotest\b[^.]{0,25}\b(via|through|with)\b[^.]{0,15}\b(dfa|department of foreign affairs|foreign ministry|ministry of foreign affairs|foreign office|state department)\b|\bbilateral (relations|ties|relationship)\b/i;
const FP_NEG_INTERSTATE_NAT =
  "(india|indian|pakistan|pakistani|bangladesh|bangladeshi|nepal|nepali|nepalese|sri lanka|sri lankan|bhutan|maldives|china|chinese|beijing|taiwan|taiwanese|thailand|thai|cambodia|cambodian|laos|vietnam|vietnamese|myanmar|burma|philippines|philippine|filipino|indonesia|indonesian|malaysia|malaysian|singapore|brunei|japan|japanese|tokyo|seoul|south korea|north korea|korea|korean|afghanistan|iran|russia|russian|canada|canadian|israel|israeli)";
const FP_NEG_INTERSTATE_TERR =
  "(lipulekh|kalapani|limpiyadhura|arunachal|aksai chin|doklam|kashmir|tawang|south china sea|west philippine sea|senkaku|spratly|scarborough|panatag|bajo de masinloc|masinloc|sabah|disputed (border|island|islets|temple|territory|waters|shoal)|border (dispute|area|encroach)|sanctions|missile launch|aircraft incursion|naval activit|maritime law|textbook|floating structure|territorial)";
const FP_NEG_INTERSTATE = new RegExp(
  `\\b${FP_NEG_INTERSTATE_NAT}\\b(?:\\s+\\w+){0,2}\\s+protest(s|ed|ing)?\\b\\s*(to|over|against|with|at)?\\s*(the\\s+)?(${FP_NEG_INTERSTATE_NAT}|${FP_NEG_INTERSTATE_TERR})|\\bprotest(s|ed|ing)?\\s+(to|with)\\s+(the\\s+)?${FP_NEG_INTERSTATE_NAT}\\b|\\b(files?|lodge[sd]?|registers?) (a |another |formal |strong |diplomatic )*protest\\b`,
  "i",
);
const FP_NEG_CRACKDOWN =
  /\bcrackdown\b[^.]{0,30}\b(drug|narcotic|smuggl|traffick|corrupt|graft|tax|illegal|immigration|migrant|overstay|crime|criminal|gang|mafia|cartel|vice|piracy|terror|extremis|cyber|scam|fraud|counterfeit|theft|robbery|poach|wildlife|investment|forex|capital|tariff|trade|forced labou?r|child labou?r|pollution|emission|quarry|sand mining|electricity theft|power theft)\b|\b(drug|narcotic|smuggl\w*|traffick\w*|corrupt\w*|graft|tax|immigration|migrant|crime|criminal|gang|mafia|cartel|vice|cyber|scam|fraud|counterfeit|theft|robbery|poach\w*|wildlife|investment|forex|tariff|trade|forced labou?r|pollution|illegal \w+) crackdown\b|\btiananmen\b/i;
// Financial / markets / regulatory context. A "crackdown" or "clampdown" set in
// this vocabulary (banks, insurers, investment, capital flows, money flows,
// securities, the bourse) is a MARKETS story, not civil unrest — "Beijing's
// investment clampdown clouds outlook for Hong Kong banks and insurers". Used to
// drop such a record UNLESS an FP_UNREST_COMPANION word is also present, so a
// genuine "police crackdown on protesters outside the stock exchange" survives.
const FP_NEG_FINANCIAL =
  /\b(banks?|banking|insurers?|insurance|investors?|investment|bourses?|securities|equit(y|ies)|stock market|stocks|shares?|ipo|listings?|hedge funds?|private equity|bond market|forex|foreign exchange|capital (flight|flow|flows|market|markets|control|controls|outflow|outflows)|money (flow|flows|outflow|outflows)|fund (flow|flows|outflow|outflows)|financial (sector|institution|institutions|firm|firms|regulator|regulators|executives?)|markets? regulator|central bank)\b/i;
const FP_UNREST_COMPANION =
  /\b(protest|demonstrat|dissent|rally|march|sit[- ]?in|civil unrest|unrest|riot|activist|opposition|gen[- ]?z|student|tear ?gas|curfew|uprising)\b/i;

// Title+summary only (NOT source/url) for the negative-sense scan, so a
// source name ("The Diplomat") can never trip the diplomatic gate.
function flashpointNegText(i: RelevanceInput): string {
  return [i.title ?? "", i.summary ?? ""].join(" ").toLowerCase();
}

// Verdict for a record whose flashpoint hook is the polysemous word "protest"
// or "crackdown". true = keep, false = drop, null = neither word present
// (defer to the other rules). `text` is the full haystack (positive scan);
// `negText` is title+summary only (negative-sense scan).
function flashpointProtestCrackdownVerdict(text: string, negText: string): boolean | null {
  if (/\bprotest(s|ers?|ing|ed)?\b/.test(text)) {
    if (FP_POS_DEMO.test(text) || FP_POS_VIOLENCE.test(text)) return true;
    if (FP_NEG_GESTURE.test(negText) || FP_NEG_DIPLOMATIC.test(negText) || FP_NEG_INTERSTATE.test(negText)) {
      return false;
    }
    return true;
  }
  if (/\bcrackdown\b|\bcracks? down\b|\bclampdown\b|\bclamps? down\b/.test(text)) {
    if (
      (FP_NEG_CRACKDOWN.test(text) || FP_NEG_FINANCIAL.test(text)) &&
      !FP_UNREST_COMPANION.test(text)
    ) {
      return false;
    }
    return true;
  }
  return null;
}

// Public-order companion. If a record's only flashpoint signal is an
// ambiguous token (rally/strike/student), one of these cues must also
// be present or the record is dropped. This is the rule the user
// requires for headlines like "Stocks extend rally" or "Lightning
// strike kills three" — both have an ambiguous trigger but no
// public-order companion, so they are not flashpoint material.
const FLASHPOINT_PUBLIC_ORDER_CUE_RE =
  /\b(protest|demonstration|march|sit[- ]?in|picket|union|labour|labor|workers|workers'|trade union|activist|activists|police|arrest|arrested|detained|detention|curfew|assembly ban|section\s*144|roadblock|blockade|public disorder|civil unrest|strike notice|walkout|stoppage|industrial action|crackdown|tear[- ]?gas|water cannon|baton|rubber bullet|riot police|hartal|bandh|gherao|shutter[- ]down|wheel[- ]jam|chakka jam|long march|million march|sit[- ]?in|opposition (rally|march|protest)|pti|imran khan|tehreek[- ]?e[- ]?insaf|student union|campus protest|teachers? (protest|march|strike)|nurses? (protest|march|strike)|doctors? (protest|march|strike)|chemists? (protest|march|strike|walkout|shutdown)|pharmacists? (protest|march|strike|walkout|shutdown)|lawyers? (protest|march|strike|walkout|boycott)|traders? (protest|march|strike|shutdown)|transporters? (protest|march|strike|stoppage))\b/;

// Industrial-action recogniser. This monitor's scope explicitly includes
// industrial action, but real labour-strike headlines often omit the
// union/worker words the public-order cue requires — e.g. "Strike to disrupt
// output at Australian LNG export plant" or "Inpex applies to halt Ichthys
// LNG strike". The signal is a worker STRIKE / WALKOUT / STOPPAGE token (never
// the overloaded "rally") sitting within proximity of an industrial anchor:
// an output/production word or a named facility (LNG plant, mine, port,
// iron-ore export, refinery…) or a workforce/union word. Requiring the
// stoppage token AND a nearby industrial anchor keeps this off the military
// ("strike capacity/threat over Australia"), weather ("lightning strike") and
// sport ("Bangladesh strike early") homonyms — those carry no industrial
// anchor near the token, and the modifier-bound military / "strike a deal" /
// tariff / market-rally homonyms are already killed in FLASHPOINT_EXCLUDE
// (which runs first). It also never fires on a market "iron-ore rally" because
// the trigger here is the stoppage token, not "rally".
const FP_INDUSTRIAL_STOPPAGE =
  "(?:strike|strikes|striking|walkout|walk[- ]?out|stoppage|stop[- ]?work|down(?:ed)? tools|industrial action|protected (?:industrial )?action|work[- ]to[- ]rule|go[- ]slow|picket(?:s|ing|ed| line)?)";
const FP_INDUSTRIAL_ANCHOR =
  "(?:output|production|operations?|exports?|shipments?|loadings?|throughput|supply|lng|gas (?:plant|field|export|hub)|refiner(?:y|ies)|smelter|mine|mines|mining|miners?|iron ore|coal|copper|nickel|alumina|bauxite|ore|port|terminal|wharf|dock|jetty|berth|rail(?:way)?|freight|plant|factor(?:y|ies)|mill|warehouse|depot|offshore|platform|rig|workers?|workforce|staff|employees?|unions?|enterprise agreement|pay (?:deal|dispute|offer|rise)|wages?|bargaining)";
const FLASHPOINT_INDUSTRIAL_ACTION_RE = new RegExp(
  `\\b${FP_INDUSTRIAL_STOPPAGE}\\b[^.!?]{0,70}\\b${FP_INDUSTRIAL_ANCHOR}\\b|\\b${FP_INDUSTRIAL_ANCHOR}\\b[^.!?]{0,70}\\b${FP_INDUSTRIAL_STOPPAGE}\\b`,
  "i",
);

// Political-rally cue. A "rally" is the most overloaded flashpoint token:
// it is a market move, a sports comeback, and a motorsport event as often
// as it is a political demonstration. The finance/sports/motorsport senses
// are killed in FLASHPOINT_EXCLUDE (which runs BEFORE this check), so any
// "rally" that survives to here is a candidate. This set KEEPS the ones
// with explicit POLITICAL-mobilisation context — a rally against a govt /
// policy, a rally for rights / a demand, an anti-(war|regime|…) rally, an
// opposition / grand / mass / election / labour rally, or a rally behind a
// party / leader — so a genuine "Thousands rally against the government" or
// "11-Party Alliance grand rally" is distinguished from a "currency rally".
// Deliberately NARROW: it requires a political object, never a bare
// "rally", so awareness drives ("anti-dengue rally") and civic notices
// ("rally to join search") stay dropped.
const FLASHPOINT_POLITICAL_RALLY_RE: RegExp[] = [
  /\brall(y|ies|ied)\b.{0,30}\b(against|over)\b.{0,50}\b(govt|government|policy|policies|law|laws|bill|amendment|regime|junta|coup|president|prime minister|\bpm\b|minister|chief minister|election|poll|polls|price|prices|inflation|cost of living|living cost|corruption|tax|taxes|fuel|reform|reforms|cuts?|austerity|crackdown|war|occupation|verdict|ruling|arrest|arrests|detention|killing|killings|violence|discrimination|atrocit|abuse|dictatorship|authoritarian|takaichi|sovereignty)\b/,
  /\brall(y|ies|ied)\b.{0,15}\b(for|demands?|demanding|to demand|calling for|seeking)\b.{0,45}\b(rights|justice|democracy|freedom|reform|reforms|release|resignation|independence|sovereignty|minorit|wages?|pay rise|accountability|return of|abductee|land rights|self[- ]determination|autonomy|equality|policy change)\b/,
  /\banti[- ](war|government|govt|regime|coup|junta|china|chinese|india|indian|\bus\b|american|israel|israeli|muslim|hindu|christian|immigrant|migrant|dictatorship|corruption|fascis|colonial|nuclear)\b.{0,15}rall(y|ies)\b/,
  /\b(\d+[- ]party|multi[- ]party|opposition|ruling[- ]party|grand|mass|massive|election|campaign|political|protest|solidarity|may day|labour|labor|workers'?|farmers'?|hunger|sit[- ]?in) rall(y|ies)\b/,
  /\brall(y|ies|ied)\b behind\b.{0,25}\b(party|government|govt|opposition|coalition|alliance|leader|leaders|\bpm\b|president|prime minister|minister|premier|candidate|\bmp\b|chief)\b/,
];

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

// Animal-welfare / wildlife-enforcement stories are not civil unrest. A
// rescue, seizure, smuggling bust or "<animal> meat" trade crackdown is a
// law-enforcement / welfare story, yet it slips through the gate on a
// public-order word like "crackdown" ("Vietnam rescues 400 cats in major meat
// trade crackdown"). Drop it ONLY when no public-gathering signal is present,
// so a genuine animal-rights RALLY or protest ("Animal lovers rally outside
// parliament", "Animal rights groups protest in Dhaka") is still kept — the
// override below carries bare "rally"/"gather"/"demand". Mirrors the conflict
// violence-override pattern. Verified against live rows: drops only the cats
// wire, never a real demonstration.
const ANIMAL_ENFORCEMENT_RE =
  /\b(rescue[sd]?|seiz(e|es|ed|ure)|confiscat\w*|smuggl\w*|traffick\w*|poach\w*|slaughter\w*|butcher\w*|crackdown|cracks? down|bust(s|ed)?)\b[^.]{0,30}\b(cats?|dogs?|pangolins?|turtles?|elephants?|tigers?|wildlife|livestock|poultry|animals?)\b/;
const ANIMAL_MEAT_TRADE_RE = /\b(cat|dog) meat\b/;
const PUBLIC_GATHERING_OVERRIDE_RE =
  /\b(protest(s|ers?|ing|ed)?|demonstrat\w+|picket\w*|sit[- ]?in|rall(y|ies|ied)|march(es|ers?|ing|ed)|gather(s|ed|ing)?|activists?|campaigners?|advocates?|demand(s|ed|ing)?|calling for|hunger strike)\b/;

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
    // Off-theatre geography gate: drop European / Black-Baltic / UK-Channel
    // maritime stories that have nothing to do with the tracked Gulf + Asia
    // chokepoints — UNLESS the same story also names a tracked theatre (then it
    // is in-scope and kept). Runs before the topic exclude/required gates.
    const offRegion = firstMatch(text, SHIPPING_OFF_REGION);
    if (offRegion && !SHIPPING_THEATRE_RE.test(text)) {
      return {
        relevant: false,
        reason: `excluded: shipping off-region (/${offRegion.source}/)`,
      };
    }
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
  if (topic === "conflict") {
    if (!CONFLICT_VIOLENCE_OVERRIDE.test(text)) {
      const m = firstMatch(text, CONFLICT_EXCLUDE);
      if (m) return { relevant: false, reason: `excluded: conflict off-topic relief/peace (/${m.source}/)` };
    }
    // Out-of-region theatre gate — mirrors the flashpoint gate further below. A
    // conflict record that POSITIVELY names a non-APAC theatre ("Niamey airport
    // attack foiled as Niger forces kill 22 gunmen - India Today") in its
    // masthead-stripped body and carries NO in-region APAC anchor is foreign
    // syndication an APAC publisher merely re-ran — and got the feed's default
    // India country/centroid. The armed-violence override deliberately does NOT
    // rescue it: a real West-African clash is still out of scope. Keyed off a
    // POSITIVE foreign place (never a missing anchor), so an in-region clash whose
    // only geo cue is a local entity is left untouched, and a cross-border story
    // that also names an APAC country ("Pakistan-Iran border clash") is kept.
    const geo = mastheadStrippedGeoText(i);
    if (FP_OFFSHORE_THEATRE_RE.test(geo) && !FP_APAC_ANCHOR_RE.test(geo)) {
      return { relevant: false, reason: "excluded: out-of-region theatre (foreign syndication, no APAC anchor)" };
    }
  }

  if (topic === "flashpoint" || topic === "protests") {
    // Editorial suppression FIRST — these are genuine protests the operator
    // manually removed, so they would otherwise be KEPT by the title-rescue /
    // protest-verdict below. Must win over every keep path, hence top of block.
    const suppressed = firstMatch(titleHaystack(i), FLASHPOINT_EDITORIAL_SUPPRESS);
    if (suppressed) return { relevant: false, reason: `excluded: editorially suppressed (operator-removed protest) (/${suppressed.source}/)` };
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
    // Animal-welfare / wildlife-enforcement (rescue, seizure, "<animal> meat"
    // trade crackdown) is a law-enforcement story, not civil unrest — unless a
    // public-gathering signal shows it is a genuine animal-rights protest. Runs
    // before the title-rescue so "crackdown" can no longer rescue it.
    if (
      (ANIMAL_ENFORCEMENT_RE.test(text) || ANIMAL_MEAT_TRADE_RE.test(text)) &&
      !PUBLIC_GATHERING_OVERRIDE_RE.test(text)
    ) {
      return { relevant: false, reason: "excluded: animal welfare / wildlife enforcement (not civil unrest)" };
    }
    // Off-topic news digest — the protest is one of several bundled stories.
    const digest = firstMatch(titleHaystack(i), FLASHPOINT_OFFTOPIC_DIGEST);
    if (digest) return { relevant: false, reason: `excluded: multi-topic news digest (not a single civil-unrest event) (/${digest.source}/)` };
    // Figurative "roadblock" (obstacle metaphor) with no genuine-unrest companion.
    if (FP_FIGURATIVE_ROADBLOCK_RE.test(text) && !FP_REAL_UNREST_COMPANION_RE.test(text)) {
      return { relevant: false, reason: "excluded: figurative 'roadblock' (obstacle metaphor, not a protest road-block)" };
    }
    // Cancelled / suspended industrial action (non-event) — title-bound.
    if (FP_CANCELLED_ACTION_RE.test(titleHaystack(i)) && !FP_CANCELLED_KEEP_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: cancelled/suspended industrial action (non-event)" };
    }
    // Travel/safety advisory telling people to AVOID protest areas — guidance,
    // not an event. All three signals required so a real demo never trips it.
    {
      const th = titleHaystack(i);
      if (FP_ADVISORY_AVOID_RE.test(th) && FP_ADVISORY_ISSUER_RE.test(th) && FP_ADVISORY_TARGET_RE.test(th)) {
        return { relevant: false, reason: "excluded: travel/safety advisory to avoid protest areas (not a civil-unrest event)" };
      }
    }
    // Editorial LABEL leading the headline (opinion/analysis/explainer) — runs on
    // the raw title so the ^ anchor holds.
    if (FP_EDITORIAL_LABEL_RE.test(i.title ?? "")) {
      return { relevant: false, reason: "excluded: editorial label (opinion/analysis/explainer), not a civil-unrest event" };
    }
    // Editorial FORMAT (listicle/digest/gallery/yearender/think-piece).
    if (FP_EDITORIAL_FORMAT_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: editorial format (listicle/digest/gallery/think-piece), not a single event" };
    }
    // Protest aftermath / clean-up — a non-event unless still live.
    if (FP_AFTERMATH_RE.test(titleHaystack(i)) && !FP_AFTERMATH_LIVE_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: protest aftermath / clean-up (non-event)" };
    }
    // Diplomatic / interstate formal protest (a complaint note, not a demo).
    if (FP_DIPLOMATIC_PROTEST_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: diplomatic/interstate formal protest (not civil unrest)" };
    }
    // Sports-governance protest (cricket board / prize money / stadium fans).
    if (FP_SPORTS_GOV_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: sports-governance protest (not security-relevant civil unrest)" };
    }
    // Appeal for calm / restraint by authorities (preventive statement, not an
    // event). Title-bound, with a live-unrest override so a real "calm after
    // deadly clashes" report still survives.
    {
      const th = titleHaystack(i);
      if (FP_CALM_APPEAL_RE.test(th) && !FP_CALM_TITLE_EVENT_RE.test(th) && !FP_CALM_LIVE_RE.test(text)) {
        return { relevant: false, reason: "excluded: appeal for calm/restraint (preventive statement, not a civil-unrest event)" };
      }
    }
    // Overseas / diaspora demonstration at a non-APAC Western venue.
    if (FP_OVERSEAS_VENUE_RE.test(titleHaystack(i)) && FP_OVERSEAS_PROTEST_RE.test(titleHaystack(i))) {
      return { relevant: false, reason: "excluded: overseas/diaspora venue (not APAC civil unrest)" };
    }
    // Out-of-region gate: drop a record that POSITIVELY names a foreign theatre
    // (Bolivia, Venezuela, Iran, Kenya, a G7 summit, ...) in its masthead-stripped
    // body and carries NO in-region APAC anchor — foreign syndication an APAC
    // publisher merely re-ran ("G7 protest turns from carnival to violent stand-
    // off - The Manila Times"). Ingest already drops these as "no-apac-country";
    // this hides the historical rows. Keyed off a POSITIVE foreign place, never a
    // missing anchor, so a genuine APAC protest whose only geo cue is a local
    // entity (Manibela, Mendiola, Camp Crame, Oli/Lekhak) is left untouched.
    //     Skip rows the homonym exclude (step 1, below) would catch anyway: a
    //     finance/sports/weather "rally"/"strike" homonym that merely names a
    //     foreign place ("Ethereum's Iran rally fizzles") is NOT protest
    //     syndication — it is noise, and should drop with the precise "homonym"
    //     reason, not be mislabelled "out-of-region theatre". The row drops
    //     either way; this only preserves the more accurate reason.
    {
      const geo = mastheadStrippedGeoText(i);
      if (
        FP_OFFSHORE_THEATRE_RE.test(geo) &&
        !FP_APAC_ANCHOR_RE.test(geo) &&
        !firstMatch(text, FLASHPOINT_EXCLUDE)
      ) {
        return { relevant: false, reason: "excluded: out-of-region theatre (foreign syndication, no APAC anchor)" };
      }
    }
    // Recruitment / manpower industry objecting to a regulatory requirement.
    if (
      FP_INDUSTRY_ACTOR_RE.test(text) &&
      /\bprotest/i.test(titleHaystack(i)) &&
      FP_INDUSTRY_OBJECT_RE.test(text) &&
      !FP_INDUSTRY_STREET_RE.test(text)
    ) {
      return { relevant: false, reason: "excluded: recruitment-industry complaint over a requirement (not civil unrest)" };
    }
    // Security forces pre-positioned to SECURE an upcoming protest (a
    // deployment/logistics statement, not an unrest event). A real post-clash
    // deployment keeps via the live-violence override.
    {
      const th = titleHaystack(i);
      if (
        FP_SECURITY_DEPLOY_VERB_RE.test(th) &&
        FP_SECURITY_FORCE_RE.test(th) &&
        FP_SECURITY_PURPOSE_RE.test(th) &&
        FP_OVERSEAS_PROTEST_RE.test(th) &&
        !FP_CALM_LIVE_RE.test(text)
      ) {
        return { relevant: false, reason: "excluded: security-deployment preparation (not a civil-unrest event)" };
      }
    }
    // Labour / industrial tribunal ruling on whether industrial action is
    // lawful (legal process, not a stoppage). A real impending/active strike
    // is kept by the active-strike override.
    if (
      FP_LABOUR_TRIBUNAL_RE.test(text) &&
      /\b(strike|strikes|industrial action|walkout|stoppage|lockout)\b/i.test(text) &&
      FP_TRIBUNAL_PROCESS_RE.test(text) &&
      !FP_TRIBUNAL_ACTIVE_STRIKE_RE.test(text)
    ) {
      return { relevant: false, reason: "excluded: labour-tribunal ruling on industrial action (legal process, not unrest)" };
    }
    // Press-freedom / coverage-suppression story (the unrest is the censored
    // reporting subject, not an event). A journalist hurt in violence keeps.
    {
      const th = titleHaystack(i);
      if (FP_PRESS_SUPPRESS_RE.test(th) && FP_PRESS_ACTOR_RE.test(th) && !FP_PRESS_REAL_VIOLENCE_RE.test(th)) {
        return { relevant: false, reason: "excluded: press-freedom/coverage-suppression (reporting subject, not a civil-unrest event)" };
      }
    }
    // School-admission / enrolment grievance (administrative complaint over a
    // student-intake system, not civil unrest). A real escalation keeps.
    {
      const th = titleHaystack(i);
      if (/\bprotest/i.test(th) && FP_SCHOOL_ADMISSION_RE.test(th) && !FP_INDUSTRY_STREET_RE.test(text)) {
        return { relevant: false, reason: "excluded: school-admission grievance (administrative, not civil unrest)" };
      }
    }
    // Court / judicial process (sentencing, verdict, conviction, jail term,
    // trial) — a legal outcome, not a civil-unrest event, so it must not inflate
    // a country's severity on the monitor. Kept when a verdict actually sparks
    // unrest (companion guard: protest / clash / riot / rally in the text).
    if (FP_COURT_PROCESS_RE.test(titleHaystack(i)) && !FP_COURT_UNREST_KEEP_RE.test(text)) {
      return { relevant: false, reason: "excluded: court/judicial process (legal outcome, not a civil-unrest event)" };
    }
    if (FLASHPOINT_TITLE_RESCUE_UNAMBIG_RE.test(titleHaystack(i))) {
      // The headline itself is an unmistakable public-order event. The
      // absolute general-news exclude already ran above, so keep it here —
      // this both rescues genuine protests from the body-scanning context
      // excludes below AND covers plural/inflected forms ("demonstrations")
      // that the \b-anchored REQUIRED patterns miss.
      return { relevant: true, reason: "kept: unmistakable public-order phrase in headline (title-rescue)" };
    }
    // 0b. Polysemous "protest" / "crackdown" IN THE HEADLINE: keep only when it
    //     reads as genuine civil unrest. A diplomatic complaint ("lodged a
    //     formal protest"), a symbolic gesture ("resigned in protest") or an
    //     interstate complaint ("Bangladesh protests India") is dropped; a real
    //     demonstration — or one with casualties / "turns violent" — is kept.
    //     This is the fix for "kept merely because the headline says protest".
    //     A title containing protest/crackdown always returns here (the verdict
    //     is never null), so step 3b only ever sees body-only matches.
    if (/\b(protest(s|ers?|ing|ed)?|crackdown|cracks? down)\b/i.test(titleHaystack(i))) {
      const verdict = flashpointProtestCrackdownVerdict(text, flashpointNegText(i));
      if (verdict === false) {
        return { relevant: false, reason: "excluded: 'protest'/'crackdown' in non-civil-unrest sense (diplomatic/gesture/interstate/enforcement)" };
      }
      if (verdict === true) {
        return { relevant: true, reason: "kept: civil-unrest 'protest'/'crackdown' in headline" };
      }
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
    //    qualifies on its own. (REQUIRED no longer carries the bare words
    //    "protest"/"crackdown" — those go through the negative-sense gate in 3b.)
    const unambiguous = REQUIRED[topic] ?? [];
    const u = firstMatch(text, unambiguous);
    if (u) return { relevant: true, reason: `kept: unambiguous public-order phrase (/${u.source}/)` };
    // 3b. Polysemous "protest" / "crackdown" in the BODY (the headline carried
    //     no rescue token). Same negative-sense gate as step 0b, but it runs
    //     AFTER the homonym and student-non-mobilisation excludes so the
    //     sports/military/finance noise is already stripped.
    const bodyVerdict = flashpointProtestCrackdownVerdict(text, flashpointNegText(i));
    if (bodyVerdict === false) {
      return { relevant: false, reason: "excluded: 'protest'/'crackdown' in non-civil-unrest sense (diplomatic/gesture/interstate/enforcement)" };
    }
    if (bodyVerdict === true) {
      return { relevant: true, reason: "kept: civil-unrest 'protest'/'crackdown' phrase" };
    }
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
      // Genuine industrial action: a worker strike/walkout/stoppage disrupting
      // output at a named industrial facility. In scope for this monitor even
      // when the headline omits the union/worker words the cue above needs.
      if (FLASHPOINT_INDUSTRIAL_ACTION_RE.test(text)) {
        return { relevant: true, reason: "kept: industrial action (worker stoppage at industrial site)" };
      }
      // A "rally" with explicit POLITICAL-mobilisation context (against a
      // govt/policy, for rights/a demand, anti-war/regime, opposition/grand/
      // mass rally, rally behind a party/leader) is a genuine demonstration,
      // distinct from the market/crypto/sports "rally" homonyms already
      // dropped in FLASHPOINT_EXCLUDE above.
      const pol = firstMatch(text, FLASHPOINT_POLITICAL_RALLY_RE);
      if (pol) {
        return { relevant: true, reason: `kept: ambiguous token (political rally) + political context (/${pol.source}/)` };
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
  /\b(subsid(y|ies|ise|ize)|levy|levies|excise|tariff|price (freeze|cap|control|shock)|industry dialogue|share price|stock price|equity|earnings|dividend|buyback|quarterly (result|results|report)|annual report|market cap|applauds?|lauds?|praises?|hails?|welcomes?|commends?|congratulates?|completes? (the )?migration|migrat(ion|es|ed|ing) (of|to) (its )?[a-z]+ (system|platform)|system (migration|upgrade)|prepaid metering|go[- ]live|new (it|billing|payment|digital) platform|boost|grants?|funding|funded|donations?|donat(?:es|ed)|sponsor(?:s|ed|ship)?)\b/i;

const COUNTRY_SPORTS_NOISE_RE =
  /\b(\d+[- ]\d+ (win|victory|defeat|loss|draw)|football club|\bfc\b|\bpsl\b|premier league|premier soccer league|super league|soccer|tournament|championship|basketball|volleyball|athletics|rugby|netball|cricket|grand final|test match|cross[- ]code coup|maple leafs|\bleafs\b|\bnhl\b|\bnba\b|\bnfl\b|\bmlb\b|playoffs?)\b/i;

// Unambiguous sports-SPECTACLE phrases. A country security report never leads on
// the World Cup or the Olympics, and these mega-events routinely carry
// incidental violence vocabulary in the body (e.g. a NEGATED "this isn't a
// crackdown on fans"), so the broad HARD_SECURITY rescue must NOT apply here.
// They are dropped UNLESS the record carries a real SECURITY signal — kinetic
// (bomb / gunfire / stampede / counted fatalities) OR public-order (riot /
// arrest / curfew / tear gas / evacuation / armed robbery / hostage / kidnap).
// This preserves a genuine venue incident ("bomb at the Olympics", "fans riot
// at the World Cup, police arrest 40") while still rejecting a match report
// whose body only carries an incidental or NEGATED term ("this isn't a
// crackdown on fans", "criminal records"). The sports-idiom word "clash"
// ("Round 1 clash") is intentionally NOT a rescue here.
const COUNTRY_SPORTS_SPECTACLE_RE =
  /\b(world cup|olympics?|olympic games|paralympics?|commonwealth games|(?:pacific|university|national|school|png) games|\bfifa\b|\buefa\b)\b/i;

const SPECTACLE_SECURITY_RESCUE_RE =
  /\b(bomb|bombing|ied|grenade|explosion|blast|gunm[ae]n|gunfire|opened fire|shot dead|stabbed|stampede|suicide (?:attack|bomb)|terror attack|\d+ (?:killed|dead|wounded)|killed \d|riot|arrest|curfew|tear gas|evacuat(?:e|ed|ion)|armed robbery|hostage|kidnap|abduct)\b/i;

// Ceremonial / public-relations EVENTS — a breakfast, summit, signing ceremony
// or MoU is a diary item, not a security incident. Dropped UNLESS the record
// carries a security signal of its own (so "gunmen attack the summit" survives
// via the soft lexicon). Deliberately omits event words that double as outlet
// names in a masthead/URL (e.g. "forum") since the haystack includes the source.
const COUNTRY_PR_EVENT_RE =
  /\b(breakfast|gala|fundraiser|summit|conference|workshop|seminar|symposium|trade fair|graduation|signing ceremony|ribbon[- ]?cutting|\bmou\b|memorandum of understanding)\b/i;

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
  // Drop unambiguous sports-SPECTACLE coverage (World Cup, Olympics) unless a
  // real SECURITY signal is present. The broad HARD_SECURITY lexicon (which
  // includes "crackdown") is intentionally NOT the guard here, because a sports
  // story commonly carries those words incidentally or negated; the dedicated
  // spectacle-rescue set keeps genuine kinetic/public-order venue incidents.
  if (COUNTRY_SPORTS_SPECTACLE_RE.test(text) && !SPECTACLE_SECURITY_RESCUE_RE.test(text)) {
    return false;
  }
  // Drop SPORTS noise unless the record carries a HARD security signal. A match
  // report routinely calls itself a "Round 1 clash"; "clash" (and "raid",
  // "fighting", "victory") must NOT rescue a football story — only an
  // unambiguous violence/crime word does.
  if (COUNTRY_SPORTS_NOISE_RE.test(text) && !COUNTRY_HARD_SECURITY_RE.test(text)) {
    return false;
  }
  // Drop ceremonial / PR diary EVENTS (a breakfast, summit, signing ceremony)
  // unless the record carries any security signal — these are not incidents.
  if (COUNTRY_PR_EVENT_RE.test(text) && !COUNTRY_SECURITY_SIGNAL_RE.test(text)) {
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
