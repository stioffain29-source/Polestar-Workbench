// Event-vs-article classification (owner brief §3-4, §7, §10).
//
// §3: an article is NOT automatically an incident. §4: permanent exclusion
// rules (conferences, ceremonies, appointments, policy/development
// announcements, commentary, background explainers, fact-checks, foreign-venue,
// routine successful rescues, response-only follow-ups). §7: every possible
// event gets a 0-100 classification confidence. §10: one primary IssueCategory
// from the controlled taxonomy.
//
// Precision-first: exclusion cues are matched against the ENGLISH text
// (displayTitle||title + summary). Pure — no runtime dependencies.

import type {
  CountryEngineConfig,
  EventStatus,
  ExclusionReason,
  IssueCategory,
} from "./types";

export interface ClassificationResult {
  isEvent: boolean;
  eventStatus: EventStatus;
  exclusionReason: ExclusionReason | null;
  issueCategory: IssueCategory;
  issueSubcategory: string | null;
  classificationConfidence: number; // 0-100
}

// One exclusion rule: a reason + the status it maps to + a cue regex. Ordered by
// precision (most specific / highest precedence first).
interface ExclusionRule {
  reason: ExclusionReason;
  status: EventStatus;
  re: RegExp;
}

const EXCLUSION_RULES: ExclusionRule[] = [
  {
    reason: "misinformation_or_factcheck",
    status: "Not an incident",
    re: /\b(fact[- ]?check|debunk\w*|false claim|misinformation|disinformation|hoax|misleading|no truth to|not true|denies? report\w*|clarif\w* (?:that|the)|sets? the record straight)\b/i,
  },
  {
    reason: "commentary_or_opinion",
    status: "Commentary",
    re: /\b(opinion|editorial|op[- ]?ed|commentary|analysis:|column|columnist|viewpoint|explainer:|perspective|guest essay|letter to the editor|my view|we must|it is time to)\b/i,
  },
  {
    reason: "conference_or_forum",
    status: "Not an incident",
    re: /\b(conference|forum|summit|symposium|seminar|workshop|convention|expo|dialogue|training (?:event|session|programme|program)|capacity[- ]building|round[- ]?table|plenary|delegat\w+ (?:attend|to attend|at the))\b/i,
  },
  {
    reason: "ceremony_or_praise",
    status: "Not an incident",
    re: /\b(ceremony|ceremonial|commemorat\w*|inaugurat\w*|graduation|award\w*|honour\w*|honor\w*|praise\w*|commend\w*|appreciat\w*|lauded|thanked|congratulat\w*|ribbon[- ]cutting|unveil\w* (?:a )?(?:plaque|statue|memorial)|wreath|tribute|celebrat\w*|anniversary gala)\b/i,
  },
  {
    reason: "appointment_or_leadership",
    status: "Not an incident",
    re: /\b(appoint\w*|sworn in|swearing[- ]in|new (?:minister|commissioner|chief|governor|director|ceo|head|commander)|named as|takes? (?:over|charge|office)|resign\w*|steps? down|reshuffle|cabinet (?:change|reshuffle)|elected (?:chair|president|leader) of)\b/i,
  },
  {
    reason: "policy_or_development_announcement",
    status: "Not an incident",
    re: /\b(announc\w* (?:funding|investment|a project|plans?|the launch)|memorandum of understanding|\bmou\b|signs? (?:a )?(?:deal|agreement|pact|mou)|groundbreaking|launch\w* (?:a )?(?:project|programme|program|scheme|initiative)|pledge\w*|grant of|development (?:project|programme|program|plan)|to build a|new policy|policy (?:announcement|launch)|budget allocation|earmark\w*)\b/i,
  },
  {
    reason: "background_or_explainer",
    status: "Background",
    re: /\b(background|explainer|retrospective|a year after|years after|anniversary of|history of|looking back|what you need to know|timeline of|profile:|feature:|human[- ]interest)\b/i,
  },
  {
    reason: "successful_routine_response",
    status: "Not an incident",
    re: /\b(safely rescued|all (?:passengers|crew) (?:were )?rescued|rescued unharmed|successful\w* (?:rescue|evacuation|drill|exercise)|routine drill|training (?:drill|exercise)|mock drill|safely evacuated|no (?:injuries|casualties) reported)\b/i,
  },
  {
    // §7 gate tuning: judicial / prosecutorial PROCESS reporting (trials,
    // corruption probes, pretrial rulings, sentencing) describes legal
    // machinery, not a physical occurrence. Cues are phrase-bound (never bare
    // "trial"/"court") so crime-scene reporting is untouched; a hard security
    // cue in the same text (e.g. a fresh killing that is also before a court)
    // overrides this rule (soft exclusion).
    reason: "legal_process",
    status: "Not an incident",
    re: /\b(corruption (?:case|cases|investigation|probe|charges?|scandal|trial|suspects?|defendants?)|graft (?:case|trial|probe)|pretrial (?:petition|motion|hearing|ruling)|granting .{0,40}pretrial|court (?:sentences?|acquits?|convicts?|hears|rules? (?:on|that))|district court sentences?|sentenced to (?:\d+|life|community service|prison|jail|death)|stands? trial|to be tried|goes? on trial|verdict (?:read|due|expected|in the)|prosecutor'?s? office|high prosecutor|attorney[- ]general'?s? office|indicted|indictment|sting operation|anti[- ]?corruption (?:commission|agency|court)|\bkpk\b|bribery (?:case|trial|charges?)|embezzlement (?:case|charges?)|money[- ]?laundering (?:case|charges?|trial))\b/i,
  },
  {
    // §7 gate tuning: preparedness / awareness / risk-warning activity
    // (alert postures, prevention drives, mitigation meetings, "vulnerable
    // to" warnings) is anticipatory — nothing has happened. Cues require the
    // preparedness verb to bind to a hazard/prevention object so genuine
    // hazard events ("flood hits", "wildfire destroys") never match; a hard
    // security cue overrides (soft exclusion).
    reason: "preparedness_or_awareness",
    status: "Not an incident",
    re: /\b(on (?:high )?alert for|preparedness|(?:fire|flood|disaster|landslide) prevention|prevention of (?:forest|land|fires?|floods?|disasters?)|prevent(?:ing)? (?:forest|land) (?:and land )?fires?|prepares? for (?:possible |potential )?(?:floods?|drought|fires?|disasters?|the )|anticipat\w* (?:floods?|drought|fires?|disasters?)|vulnerable to (?:floods?|drought|wildfires?|landslides?|fires?)|mitigation (?:meeting|plan|efforts?|measures?)|rais\w* awareness|awareness (?:campaign|drive|programme|program)|socializ(?:ation|es?|ing)|coordination to (?:handle|address|prepare)|urges? (?:residents|farmers|the public|communit\w+|people) to (?:prevent|prepare|be (?:alert|vigilant|careful)|monitor|stay)|fire[- ]prone areas?)/i,
  },
  {
    reason: "response_only_followup",
    status: "Not an incident",
    re: /\b(condemn\w*|expresses? (?:concern|condolences)|offers? condolences|calls? for (?:calm|peace|restraint|an investigation|unity|education|counselling)|vows? to|urges? (?:calm|restraint)|investigation (?:opened|launched|into|underway)|probe (?:ordered|launched)|suspect\w* (?:arrested|detained|charged) (?:days later|weeks later|over the|following the)|visits? (?:the )?(?:site|families|victims)|pays? tribute|holds? talks|meets? with|to visit)\b/i,
  },
];

// Hard security-event cues that OVERRIDE a soft exclusion: if the text clearly
// describes a violent occurrence, an otherwise-excludable framing word (e.g. a
// "condemnation" that also reports a fresh attack) should not silently drop it.
// Companion overrides for the two §7 gate-tuning rules (legal_process /
// preparedness_or_awareness): a story that ALSO reports live unrest (a rally
// over a graft case, a demonstration at a prosecutor's office) or a physical
// policing operation (a raid in a corruption probe) is a real occurrence and
// must not be dropped as process/preparedness coverage.
const UNREST_COMPANION_RE =
  /\b(protest\w*|demonstrat\w*|rally|rallies|rallied|riot\w*|marchers|march(?:es|ed)? (?:on|to|through)|strike\b|walkout|picket\w*|blockad\w*|road ?block)\b/i;
const POLICING_COMPANION_RE = /\b(raid\w*|searched|swoop|manhunt|cordon)\b/i;

const HARD_EVENT_RE =
  /\b(killed|shot dead|gunned down|stabbed|murder\w*|dead|fatalit\w*|bodies|explosion|bombing|blast|open(?:ed)? fire|gun ?(?:fight|battle|men)|ambush\w*|riot\w*|clash\w*|torched|set (?:on )?fire|derail\w*|capsiz\w*|hijack\w*|kidnap\w*|abduct\w*|hostage|looted|ransack\w*)\b/i;

// ---------------------------------------------------------------------------
// Issue-category keyword rules (§10). Precision-ordered; first match wins.
// ---------------------------------------------------------------------------
const CATEGORY_RULES: Array<[IssueCategory, RegExp]> = [
  ["Terrorism", /\b(terror\w*|suicide bomb\w*|ied|improvised explosive|jihad\w*|extremist attack|bomb\w* (?:attack|blast))\b/i],
  ["Insurgency", /\b(insurgen\w*|separatist\w*|rebel\w*|militant\w*|guerrilla|armed group|opm|tpnpb|liberation army|npa|new people'?s army)\b/i],
  ["Communal or tribal violence", /\b(tribal (?:clash|fight|violence|war)|communal (?:clash|violence|riot)|ethnic (?:clash|violence)|inter[- ]?tribal|clan (?:fight|clash)|sectarian)\b/i],
  ["Political violence", /\b(political violence|election(?:[- ]related)? violence|assassinat\w*|politically motivated|candidate (?:shot|killed|attacked))\b/i],
  ["Terrorism", /\b()\b/i], // placeholder never matches (kept for ordering safety)
  ["Strike or labour action", /\b(strike|walkout|work stoppage|industrial action|picket\w*|union (?:protest|action)|downed tools|go[- ]?slow)\b/i],
  ["Civil unrest", /\b(protest\w*|demonstrat\w*|riot\w*|unrest|rally|march|road ?block|barricade|looting|civil disorder|mob\b|clash\w* with police)\b/i],
  ["Theft and robbery", /\b(robbery|robbed|burglar\w*|theft|stole|stolen|looted|holdup|hold[- ]up|snatch\w*|carjack\w*|pickpocket|break[- ]?in|ram[- ]?raid)\b/i],
  ["Organised crime", /\b(drug (?:bust|trafficking|syndicate|haul|seizure)|smuggl\w*|cartel|syndicate|human trafficking|money laundering|gang (?:war|network))\b/i],
  ["Violent crime", /\b(murder\w*|killed|shot dead|gunned down|stabb\w*|homicide|assault\w*|rape\w*|gang[- ]?rape|shooting|gunmen|fatal\w* (?:attack|shooting|stabbing)|beaten to death|hacked to death)\b/i],
  ["Policing operation", /\b(police (?:operation|raid|swoop|crackdown)|cordon[- ]and[- ]search|manhunt|arrest\w* (?:of|in a raid)|security (?:operation|sweep)|raid\w* (?:a|the))\b/i],
  ["Aviation", /\b(aircraft|aeroplane|airplane|\bplane\b|airline|flight|airport|helicopter|air traffic|runway|aviation)\b/i],
  ["Maritime", /\b(ferry|vessel|\bship\b|boat|maritime|capsiz\w*|shipwreck|port (?:closure|suspended)|coast ?guard|sank|drown\w*|jetty|wharf)\b/i],
  ["Road and rail", /\b(road (?:accident|crash)|traffic accident|bus (?:crash|accident)|train (?:crash|derail\w*)|derail\w*|highway (?:closed|blocked)|collision|pile[- ]up|rail\w*)\b/i],
  // Fire and accident (§10 taxonomy extension). Precision-first: every alternate
  // binds "fire"/"blaze" to an occurrence verb, a burned structure, or an
  // accident noun — never a bare token — so metaphors ("under fire", "drawing
  // fire", "fire sale"), dismissals ("fired"), gunfire ("open fire", excluded
  // via lookbehind) and prevention/awareness PR (already excluded upstream by
  // preparedness_or_awareness) cannot classify here. Ordered AFTER Violent
  // crime / Civil unrest / transport rules so shootings, riots and crashes
  // keep their primary category.
  ["Fire and accident", /(?:\bfire (?:breaks? out|broke out|guts?|gutted|destroy\w*|engulf\w*|raz\w*|rips? through|ripped through|sweeps? through|swept through|kills?|killed|injur\w*|burns? down|burn(?:ed|t) (?:down|through))|\b(?:catch(?:es)?|caught) fire\b|\bburn(?:s|ed|t)? down\b|\bburned to the ground\b|\bgutted by (?:a )?(?:fire|blaze)\b|\b(?:house|home|residential|school|market|factory|plant|warehouse|shop|store|mall|building|hotel|apartment|kitchen|hospital|mosque|church|slum|depot|mill)s? (?:fire|blaze)\b|\bblaze (?:destroy\w*|guts?|gutted|engulf\w*|kills?|injur\w*|rips? through|ripped through)\b|\bmassive (?:fire|blaze)\b|(?<!open(?:s|ed)? )\bfire (?:at|in|hits?) (?:a|an|the)\b|\b(?:electrical|gas[- ]cylinder|lpg) (?:fire|explosion)\b|\bgas leak\b|\b(?:workplace|industrial|work) accident\b|\belectrocut\w*\b)/i],
  ["Utilities", /\b(power (?:cut|outage|failure)|blackout|electricity (?:cut|outage)|water (?:supply|shortage|cut)|load[- ]shedding|utility|grid failure|gas supply)\b/i],
  ["Telecommunications", /\b(internet (?:outage|shutdown|blackout)|network (?:outage|down)|telecom\w*|mobile network|connectivity (?:loss|outage)|fibre cut|undersea cable)\b/i],
  ["Natural hazard", /\b(earthquake|quake|tsunami|volcan\w*|eruption|flood\w*|landslide|cyclone|typhoon|storm|drought|wildfire|bushfire|tremor|mudslide|heavy rain)\b/i],
  ["Health", /\b(outbreak|epidemic|pandemic|disease|cholera|measles|dengue|malaria|polio|covid|virus|contamin\w*|poisoning|health (?:emergency|crisis))\b/i],
  ["Supply chain", /\b(supply chain|shortage of (?:fuel|food|goods)|fuel shortage|logistics (?:disruption|delay)|shipping (?:delay|disruption)|freight)\b/i],
  ["Infrastructure", /\b(bridge (?:collapse|damage)|building collapse|infrastructure (?:damage|failure)|structural (?:collapse|failure)|dam (?:burst|failure))\b/i],
  ["Governance and regulatory", /\b(regulat\w*|permit (?:revoked|suspended|denied)|licence (?:revoked|suspended)|ban(?:ned|s)? (?:on|the)|court (?:orders?|rules?)|sanction\w*|compliance (?:order|breach)|shutdown order|import (?:ban|restriction))\b/i],
];

function englishText(input: {
  title: string;
  displayTitle?: string | null;
  summary?: string | null;
}): string {
  const title = (input.displayTitle && input.displayTitle.trim()) || input.title || "";
  return `${title} ${input.summary ?? ""}`;
}

// Map the primary issue category from keyword rules incl. config.localTerms.
function mapCategory(
  text: string,
  config: CountryEngineConfig | null,
): { category: IssueCategory; matched: boolean } {
  // Country-specific local terms win first (advisory keywords for local
  // categories, §1/§10).
  if (config?.localTerms) {
    for (const [term, cat] of Object.entries(config.localTerms)) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(text)) return { category: cat, matched: true };
    }
  }
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.source === "\\b()\\b") continue; // skip placeholder
    if (re.test(text)) return { category: cat, matched: true };
  }
  return { category: "Other operational disruption", matched: false };
}

// Classify an article per §3-4, §7, §10.
export function classifyArticle(
  input: {
    title: string;
    displayTitle?: string | null;
    summary?: string | null;
    category?: string | null;
  },
  config: CountryEngineConfig | null,
): ClassificationResult {
  const text = englishText(input);
  const hardEvent = HARD_EVENT_RE.test(text);
  const { category, matched } = mapCategory(text, config);

  // Permanent exclusion rules (precision-first). A hard security-event cue
  // overrides a SOFT exclusion (commentary / background / response), but NOT a
  // structural one (conference / ceremony / appointment / policy / factcheck),
  // which describe non-occurrences even when they mention violence.
  for (const rule of EXCLUSION_RULES) {
    if (!rule.re.test(text)) continue;
    // Companion overrides for the §7 gate-tuning rules: live unrest or a
    // physical policing operation in the same text is a real occurrence.
    if (
      (rule.reason === "legal_process" || rule.reason === "preparedness_or_awareness") &&
      UNREST_COMPANION_RE.test(text)
    ) {
      continue;
    }
    if (rule.reason === "legal_process" && POLICING_COMPANION_RE.test(text)) continue;
    const overridable =
      rule.reason === "commentary_or_opinion" ||
      rule.reason === "background_or_explainer" ||
      rule.reason === "response_only_followup" ||
      rule.reason === "successful_routine_response" ||
      rule.reason === "legal_process" ||
      rule.reason === "preparedness_or_awareness";
    if (overridable && hardEvent) continue;
    return {
      isEvent: false,
      eventStatus: rule.status,
      exclusionReason: rule.reason,
      issueCategory: category,
      issueSubcategory: null,
      // Hard exclusion cues -> high confidence in the NON-event decision (§7).
      classificationConfidence: 90,
    };
  }

  // A genuine event. Confidence derives from cue strength (§7): a clear hard
  // security cue OR a matched controlled category yields high confidence; a
  // record with neither is ambiguous (50-84 band).
  let confidence: number;
  if (hardEvent && matched) confidence = 92;
  else if (hardEvent) confidence = 86;
  else if (matched) confidence = 78;
  else confidence = 55;

  return {
    isEvent: true,
    eventStatus: "Confirmed",
    exclusionReason: null,
    issueCategory: category,
    issueSubcategory: null,
    classificationConfidence: confidence,
  };
}
