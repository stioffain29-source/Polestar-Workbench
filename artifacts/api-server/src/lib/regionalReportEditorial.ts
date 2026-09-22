import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildApacGlanceMetrics,
  buildApacWeeklyWatchlist,
  buildCanonicalRegionalMapPoints,
  regionalCanonicalEditorialFindings,
  validateRegionalCanonicalIntegrity,
  type RegionalCanonicalReport,
  type RegionalCoverageManifest,
  type RegionalDomainBrief,
  type RegionalFutureEventInput,
  type RegionalIncident,
  type RegionalVerifiedDevelopment,
  type RegionalWeeklyTopic,
} from "../../../workbench/src/lib/regionalWeekly";
import {
  REGIONAL_EDITORIAL_VERSION,
  REGIONAL_WORD_LIMITS,
  regionalNumericClaims,
  regionalWordCount,
  type RegionalEventFact,
} from "../../../workbench/src/lib/regionalEditorial";
import {
  REGIONAL_MAX_MAP_POINTS,
  REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES,
  REGIONAL_MAX_SINGLE_COUNTRY_SENTENCES,
  REGIONAL_OUTLOOK_MAX_WORDS,
  REGIONAL_OUTLOOK_MIN_WORDS,
  REGIONAL_SUMMARY_MAX_WORDS,
  REGIONAL_SUMMARY_MIN_WORDS,
  regionalOutlookNamedCountries,
  regionalPipelineVoicePhrases,
  regionalSingleCountrySentences,
  validateRegionalForwardWatch,
} from "../../../workbench/src/lib/regionalContentPolicy";
import {
  extractRegionalReportFacts,
  prepareRegionalFactPackets,
  selectGroundedRegionalEvents,
  type GroundedRegionalEvent,
  type RegionalFactPacket,
} from "./regionalReportFacts";
import { regionalJson } from "./regionalAi";
import { reassessRegionalSeverity } from "./regionalReportSeverity";

const Section = z.object({
  text: z.string(),
  evidenceKeys: z.array(z.string()),
}).strict();
const BusinessImplication = z.object({
  heading: z.enum(["People & Travel", "Operations & Assets", "Supply Chain & Logistics", "Regulatory & Market Access", "Business Continuity"]),
  body: z.string(),
  evidenceKeys: z.array(z.string()),
}).strict();
/** A narrative-only repair keeps the fixed developments and their checked numbers out of the rewrite. */
const RegionalNarrativeSchema = z.object({
  regionalOutlook: Section,
  riskPicture: Section,
  polestarOutlook: Section,
  businessImplications: z.array(BusinessImplication),
}).strict();
export const RegionalAnalysisSchema = z.object({
  regionalOutlook: Section,
  riskPicture: Section,
  polestarOutlook: Section,
  businessImplications: z.array(BusinessImplication),
  developments: z.array(z.object({
    eventKey: z.string(),
    operationalImpact: z.string(),
    polestarView: z.string(),
    outlook7Days: z.string(),
  }).strict()),
}).strict();
export type RegionalAnalysis = z.infer<typeof RegionalAnalysisSchema>;

/** Stated as a countable limit because "synthesise, do not list" was not being met. */
export const POLESTAR_SENTENCE_RULE =
  `At most ${REGIONAL_MAX_SINGLE_COUNTRY_SENTENCES} sentences may name exactly one of the selected countries. Every other sentence must name two or more of them together, or none at all, so related exposures are compared inside the sentence instead of each country receiving its own update.`;

const ANALYSIS_INSTRUCTION = `Write a concise Regional Weekly business-risk assessment using ONLY the supplied structured event facts. You are not given articles or headlines: do not introduce external information.
The event set, factual sentences, jurisdiction, dates, event identity, severity and map selection are FIXED; the map plots at most ${REGIONAL_MAX_MAP_POINTS} of the selected developments, so do not describe the map as showing all of them. Do not change them or infer unreported consequences. A reported date is not an occurrence date. Source counts are not evidence of impact.
Each section has a DIFFERENT purpose:
regionalOutlook: ${REGIONAL_SUMMARY_MIN_WORDS}-${REGIONAL_SUMMARY_MAX_WORDS} words inclusive (${REGIONAL_SUMMARY_MAX_WORDS} is a hard ceiling; count the words before returning), at most two paragraphs. State the single most consequential change of the week, then where business exposure actually sits and what is NOT affected. Contrast it with one other distinct operating issue. Name at most three markets or places; this is not a roundup of every country/development. Do NOT repeat casualties or write travel advice.
riskPicture: 100-160 words (hard maximum 180), at most three short paragraphs. Explain how the actual disruptions transmit into business activity, distinguishing direct impact from a plausible contingent exposure. Connect the developments where the evidence supports it: aviation or airspace disruption with energy and military activity, chokepoint pressure with energy logistics and shipping cost, cyber intrusion with operational continuity, regulatory change with workforce or market access. At most ${REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES} sentences may name exactly one selected country: do not produce a country-by-country list or a general essay about types of risk.
businessImplications: 2-3 short paragraphs, TOTAL 110-135 words across ALL paragraphs combined (hard maximum 180). Organise by relevant business function, not countries; at most ${REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES} sentences across all paragraphs may name exactly one selected country. Each paragraph must identify the exposed function, a concrete decision and its trigger grounded in the facts. Do not repeat per-event impact paragraphs, invent service restoration times, evacuation needs or pricing changes. No paragraph for a function without evidence.
polestarOutlook: ${REGIONAL_OUTLOOK_MIN_WORDS}-${REGIONAL_OUTLOOK_MAX_WORDS} words inclusive, aim 135-150 and count the words before returning; ${REGIONAL_OUTLOOK_MAX_WORDS} words is a hard ceiling. One or two connected paragraphs. A genuine REGIONAL forward assessment considering ALL selected developments; name at least three of their countries or locations. ${POLESTAR_SENTENCE_RULE} Cover four things: the most important forward driver for the region, the secondary risks that could become operationally significant, what would materially worsen the assessment, and what would indicate stabilisation. Connect the risks across business functions. Do not default to Japan alone or Saudi energy infrastructure alone, and do not let energy infrastructure dominate the section when non-energy developments were selected. Do NOT write separate mini country updates, repeat Key Developments or repeat the opening. Link every selected eventKey in the section metadata, while synthesising their implications rather than listing them.
For EACH development supply: operationalImpact<=35 words (which function is exposed, and how, not a repeat of the fact); polestarView<=30 words (a distinct, defensible judgement separating what is known from conditional consequences); outlook7Days<=25 words (one specific observable next signal). Do not add titles or whatChanged: those already come from verified facts.
Keep current loss of service separate from possible consequences. For cyber, distinguish data exposure from service downtime; a hotel breach does not prove bookings halted, and a government platform outage does not prove all transport stopped. For LPG, do not invent prices, rationing, import causes or nationwide closure. A police-site bombing does not prove commercial road closure. Do not forecast escalation simply because an attack occurred.
Historical source status must remain historical: "fighting was ongoing when the toll was reported" does NOT establish that fighting continues on the issue date. Do not turn an attack into confirmed business-access disruption, or say business activity "continues" to be impeded when that impact was never established. State those exposures conditionally. Do not use "Known:" or "Conditional:" scaffolding; write the distinction as ordinary sentences.
Cite each analytical section's supporting eventKeys in its metadata, never inline. Every factual name, number, cause or asserted impact must derive from the relevant supplied confirmedFacts; recommendations must be conditional where their trigger is not observed.
Do not use source/outlet names, domains, URLs, raw headlines, sentence fragments, rhetorical filler, or count-based prose. No quotes or citation markers in rendered text.
Write as an analyst addressing the client, never as a writer describing your own inputs. NEVER write "the supplied facts", "on the supplied facts", "the packet", "the source material", "confirmed facts", "the evidence set" or any similar reference to what you were given. Where something is unproven, say so in the client's terms: "There is currently no evidence of wider disruption."; "The extent of damage remains unclear."; "No operational outage has been confirmed."; "The duration of the disruption remains uncertain."; "Current reporting indicates limited effect beyond the affected site."
BANNED phrases: "The development is relevant to"; "Their regional importance comes from what could follow"; "the specific indicators are"; "the significance is confined to the named market"; "reporting placed the casualties at"; "selected evidence"; "the principal changes this week were".
Write in direct, precise, sentence-cased analytical English. No template padding, no claim of uniform regional deterioration, no statement that a domain is empty, and no verbatim sentence repeated across sections. Return complete sentences without truncation.`;

/**
 * A rejected draft is re-asked against measurements, not against the same prose
 * instruction that already failed. Nothing here rewrites or truncates the text.
 */
export function regionalOutlookDiagnostics(
  outlook: { text: string; evidenceKeys: string[] },
  events: Array<Pick<GroundedRegionalEvent, "eventKey" | "country" | "location">>,
) {
  const offending = regionalSingleCountrySentences(outlook.text, events.map((event) => event.country));
  return {
    measuredWords: regionalWordCount(outlook.text),
    requiredWords: `${REGIONAL_OUTLOOK_MIN_WORDS}-${REGIONAL_OUTLOOK_MAX_WORDS} inclusive, target 135-150`,
    sentencesNamingExactlyOneSelectedCountry: offending,
    countOfThoseSentences: offending.length,
    maximumAllowed: REGIONAL_MAX_SINGLE_COUNTRY_SENTENCES,
    selectedCountries: [...new Set(events.map((event) => event.country))],
    countriesCurrentlyNamed: regionalOutlookNamedCountries(outlook.text, events),
    requiredEvidenceKeys: events.map((event) => event.eventKey),
    suppliedEvidenceKeys: outlook.evidenceKeys,
    phrasesDescribingYourOwnInputs: regionalPipelineVoicePhrases(outlook.text),
  };
}

function regionalNarrativeDiagnostics(analysis: RegionalAnalysis, events: GroundedRegionalEvent[]) {
  const sections = {
    regionalOutlook: analysis.regionalOutlook.text,
    riskPicture: analysis.riskPicture.text,
    businessImplicationsNarrative: analysis.businessImplications.map((block) => block.body).join("\n\n"),
    polestarOutlook: analysis.polestarOutlook.text,
  } as const;
  const countries = events.map((event) => event.country);
  return {
    measuredSectionWords: Object.fromEntries(Object.entries(sections).map(([key, text]) => [key, {
      words: regionalWordCount(text),
      hardMaximum: REGIONAL_WORD_LIMITS[key as keyof typeof sections],
      ...(key === "regionalOutlook"
        ? { requiredWords: `${REGIONAL_SUMMARY_MIN_WORDS}-${REGIONAL_SUMMARY_MAX_WORDS} inclusive` }
        : {}),
      phrasesDescribingYourOwnInputs: regionalPipelineVoicePhrases(text),
      ...(key === "riskPicture" || key === "businessImplicationsNarrative" ? {
        sentencesNamingExactlyOneSelectedCountry: regionalSingleCountrySentences(text, countries),
        maximumAllowed: REGIONAL_MAX_RISK_SINGLE_COUNTRY_SENTENCES,
      } : {}),
    }])),
    polestarOutlook: regionalOutlookDiagnostics(analysis.polestarOutlook, events),
  };
}

// Only the analytical prose can be repaired by rewriting it. A fixed-fact,
// evidence, severity, map or selection failure must regenerate the whole object.
const DEVELOPMENT_LEVEL_FAILURE =
  /analytical development set|Missing analysis for|Unsupported analytical number|invalid (?:title|whatChanged|operationalImpact|polestarView|outlook7Days) length|source text or generic prose in|source-material voice in|Missing factual evidence for|map point|map item|The map must plot|Developments must represent|selection must contain|Severity has not been reassessed|same source evidence|7 Day Watch|collection is incomplete|coverage|APAC (?:must retain|requires)|Middle East requires|dominates/i;

// The validators name the failing section, so only that section is replaced.
// A rewrite must never quietly alter prose that already passed.
const NARRATIVE_SECTION_FAILURE = {
  regionalOutlook: /\bregionalOutlook\b/i,
  riskPicture: /\briskPicture\b/i,
  businessImplications: /\bbusinessImplicationsNarrative\b/i,
  polestarOutlook: /\bpolestarOutlook\b|Polestar Outlook/i,
} as const;
type NarrativeSection = keyof typeof NARRATIVE_SECTION_FAILURE;

function failedNarrativeSections(validationProblem: string): NarrativeSection[] {
  return (Object.keys(NARRATIVE_SECTION_FAILURE) as NarrativeSection[])
    .filter((section) => NARRATIVE_SECTION_FAILURE[section].test(validationProblem));
}

const REPAIR_INSTRUCTION =
  `Correct the supplied validation problem. The measurements in diagnostics were taken from your previous draft: treat them as facts about it, count your words before returning, and leave a margin inside every limit. The previous draft is not evidence; use only the fixed event facts.`;

export const REGIONAL_EDITORIAL_REPAIR_ATTEMPTS = 2;

async function repairRegionalAnalysis(
  analysis: RegionalAnalysis,
  events: GroundedRegionalEvent[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
  failure: unknown,
): Promise<RegionalAnalysis> {
  const validationProblem = failure instanceof Error
    ? failure.message
    : "The analytical draft failed verification.";
  const input = {
    ...regionalAnalyticalInput(events, topic, issueDate),
    validationProblem,
    diagnostics: regionalNarrativeDiagnostics(analysis, events),
  };
  const sections = DEVELOPMENT_LEVEL_FAILURE.test(validationProblem)
    ? [] : failedNarrativeSections(validationProblem);
  if (sections.length === 0) {
    return regionalJson(
      RegionalAnalysisSchema,
      `${ANALYSIS_INSTRUCTION}\n${REPAIR_INSTRUCTION} Return the complete revised analytical object with all selected eventKeys, not a partial patch.`,
      { ...input, previousDraft: analysis },
    );
  }
  const narrative = await regionalJson(
    RegionalNarrativeSchema,
    `${ANALYSIS_INSTRUCTION}\n${REPAIR_INSTRUCTION} Rewrite ONLY the analytical narrative sections listed in sectionsToRewrite; only those sections are kept, every other section of the report is retained from the previous draft and must not be reworded. Do not return the per-development analysis.`,
    {
      ...input,
      sectionsToRewrite: sections,
      previousNarrative: {
        regionalOutlook: analysis.regionalOutlook,
        riskPicture: analysis.riskPicture,
        polestarOutlook: analysis.polestarOutlook,
        businessImplications: analysis.businessImplications,
      },
    },
  );
  const repaired: RegionalAnalysis = { ...analysis };
  for (const section of sections) {
    if (section === "businessImplications") repaired.businessImplications = narrative.businessImplications;
    else if (section === "regionalOutlook") repaired.regionalOutlook = narrative.regionalOutlook;
    else if (section === "riskPicture") repaired.riskPicture = narrative.riskPicture;
    else repaired.polestarOutlook = narrative.polestarOutlook;
  }
  return repaired;
}

export function reassessRegionalEvents(events: GroundedRegionalEvent[]): GroundedRegionalEvent[] {
  return events.map((event) => {
    const assessment = reassessRegionalSeverity(event);
    return {
      ...event,
      severity: assessment.severity,
      severityRationale: assessment.rationale,
      severityEvidence: assessment.evidence,
    };
  });
}

/** The analytical model sees only checked facts, never source rows or headline fields. */
export function regionalAnalyticalInput(
  events: GroundedRegionalEvent[],
  topic: RegionalWeeklyTopic,
  issueDate: string,
): { topic: RegionalWeeklyTopic; issueDate: string; events: RegionalEventFact[] } {
  return {
    topic, issueDate,
    events: reassessRegionalEvents(events).map((event) => ({
      eventKey: event.eventKey,
      country: event.country,
      location: event.location,
      eventDate: event.eventDate,
      dateBasis: event.dateBasis,
      category: event.category,
      severity: event.severity,
      title: event.title,
      confirmedFacts: event.confirmedFacts,
      evidenceIds: event.evidenceIds,
      uncertainties: event.uncertainties,
    })),
  };
}

function assertEvidenceReferences(keys: string[], events: GroundedRegionalEvent[]): void {
  if (keys.length === 0 || keys.some((key) => !events.some((event) => event.eventKey === key))) {
    throw new Error("An analytical section is not linked to its selected factual evidence.");
  }
}

/** Remove drafting labels, not facts or qualifications, before persistence. */
function editedAnalysis(value: string): string {
  return value.trim().replace(
    /(^|[.!?]\s+)(?:known|conditional):\s*([a-z])/gi,
    (_match, preceding: string, first: string) => preceding + first.toUpperCase(),
  );
}

export function assembleRegionalEditorialReport(
  events: GroundedRegionalEvent[],
  analysis: RegionalAnalysis,
  topic: RegionalWeeklyTopic,
  issueDate: string,
  futureEvents: RegionalFutureEventInput[],
  coverageManifest: RegionalCoverageManifest,
): RegionalCanonicalReport {
  events = reassessRegionalEvents(events);
  const byKey = new Map(analysis.developments.map((row) => [row.eventKey, row]));
  if (byKey.size !== events.length || analysis.developments.length !== events.length) {
    throw new Error("The analytical development set differs from the verified event set.");
  }
  for (const section of [analysis.regionalOutlook, analysis.riskPicture, analysis.polestarOutlook]) {
    assertEvidenceReferences(section.evidenceKeys, events);
  }
  for (const block of analysis.businessImplications) assertEvidenceReferences(block.evidenceKeys, events);
  const developments: RegionalVerifiedDevelopment[] = events.map((event) => {
    const prose = byKey.get(event.eventKey);
    if (!prose) throw new Error(`Missing analysis for ${event.title}.`);
    // No new quantitative claims can be introduced by the analytical writer.
    const allowedNumbers = new Set([...regionalNumericClaims(event.confirmedFacts.join(" ")), "7"]);
    const numericCopy = `${prose.operationalImpact} ${prose.polestarView} ${prose.outlook7Days}`;
    if (regionalNumericClaims(numericCopy).some((number) => !allowedNumbers.has(number))) {
      throw new Error(`Unsupported analytical number for ${event.title}.`);
    }
    return {
      eventKey: event.eventKey,
      country: event.country,
      location: event.location,
      eventDate: event.eventDate,
      dateBasis: event.dateBasis,
      dateVerified: true,
      title: event.title,
      severity: event.severity,
      severityRationale: event.severityRationale,
      severityEvidence: event.severityEvidence,
      category: event.category,
      confirmedFacts: event.confirmedFacts,
      whatChanged: event.confirmedFacts.join(" "),
      operationalSignificance: editedAnalysis(prose.operationalImpact),
      operationalImpact: editedAnalysis(prose.operationalImpact),
      polestarView: editedAnalysis(prose.polestarView),
      whatToWatch: editedAnalysis(prose.outlook7Days),
      outlook7Days: editedAnalysis(prose.outlook7Days),
      watchDate: null,
      sourceCount: event.evidenceIds.length,
      evidenceIds: event.evidenceIds,
      sourceEvidence: event.sourceEvidence,
    };
  });
  const watchItems = buildApacWeeklyWatchlist(developments, futureEvents, issueDate);
  const byCategory = new Map<RegionalVerifiedDevelopment["category"], number>();
  const byCountry = new Map<string, number>();
  const domainBriefs = new Map<RegionalDomainBrief["domain"], RegionalDomainBrief>();
  for (const development of developments) {
    byCategory.set(development.category, (byCategory.get(development.category) ?? 0) + 1);
    byCountry.set(development.country, (byCountry.get(development.country) ?? 0) + 1);
    const domain = /Security|Conflict|Terrorism/.test(development.category) ? "Security"
      : development.category === "Energy" ? "Operational Disruption" : development.category;
    if (!domainBriefs.has(domain)) domainBriefs.set(domain, {
      domain, heading: domain, assessment: development.operationalSignificance,
    });
  }
  const sourceRows = events.flatMap((event) => event.sourceRows.map((row) => ({
    ...row,
    country: event.country,
    // A corrected jurisdiction must never inherit the old country's coordinates.
    latitude: row.country === event.country ? row.latitude : null,
    longitude: row.country === event.country ? row.longitude : null,
  })));
  const report: RegionalCanonicalReport = {
    schemaVersion: "regional-weekly-canonical-v1",
    editorialVersion: REGIONAL_EDITORIAL_VERSION,
    evidenceFingerprint: createHash("sha256").update(JSON.stringify(regionalAnalyticalInput(events, topic, issueDate))).digest("hex"),
    topic, issueDate, developments,
    regionalOutlook: editedAnalysis(analysis.regionalOutlook.text),
    riskPicture: editedAnalysis(analysis.riskPicture.text),
    polestarOutlook: editedAnalysis(analysis.polestarOutlook.text),
    polestarOutlookEvidenceKeys: analysis.polestarOutlook.evidenceKeys,
    businessImplications: analysis.businessImplications.map(({ heading, body }) => ({ heading, body: editedAnalysis(body) })),
    businessImplicationsNarrative: analysis.businessImplications.map((block) => editedAnalysis(block.body)).join("\n\n"),
    domainBriefs: [...domainBriefs.values()],
    glanceMetrics: buildApacGlanceMetrics(developments, watchItems),
    watchItems,
    mapPoints: buildCanonicalRegionalMapPoints(sourceRows, developments),
    visualSummary: {
      byCategory: [...byCategory].map(([label, count]) => ({ label, count })),
      byCountry: [...byCountry].map(([label, count]) => ({ label, count })),
    },
    coverageManifest,
  };
  // Only a technically unusable report is rejected here. Editorial findings are
  // returned to the caller as warnings.
  const errors = validateRegionalCanonicalIntegrity(report);
  if (errors.length) throw new Error(`Regional report structure is invalid: ${errors.join(" ")}`);
  return report;
}

export async function buildRegionalEditorialReport(
  incidents: RegionalIncident[],
  issueDate: string,
  topic: RegionalWeeklyTopic,
  futureEvents: RegionalFutureEventInput[],
  coverageManifest: RegionalCoverageManifest,
) {
  const packets = prepareRegionalFactPackets(incidents, topic, issueDate);
  if (packets.length < 5) throw new Error("Fewer than five distinct material candidates remain after source and jurisdiction checks.");
  const extracted = await extractRegionalReportFacts(packets, topic, issueDate);
  return finishRegionalEditorialReport(packets, extracted, topic, issueDate, futureEvents, coverageManifest);
}

/** Separate completion stage also allows read-only audits to reuse their checked facts. */
export async function finishRegionalEditorialReport(
  packets: RegionalFactPacket[],
  extracted: Awaited<ReturnType<typeof extractRegionalReportFacts>>,
  topic: RegionalWeeklyTopic,
  issueDate: string,
  futureEvents: RegionalFutureEventInput[],
  coverageManifest: RegionalCoverageManifest,
) {
  const selected = selectGroundedRegionalEvents(reassessRegionalEvents(extracted.events), topic);
  if (selected.length < 5) {
    throw new Error(`Only ${selected.length} distinct events have adequate factual support. No thin or padded report was saved.`);
  }
  // Forward items come from collection, not from writing. A thin or holiday-led
  // week is published with the calendar it actually has and says so; it is
  // recorded as an editorial warning rather than cancelling the report.
  const editorialWarnings = validateRegionalForwardWatch(
    topic, buildApacWeeklyWatchlist([], futureEvents, issueDate));
  let analysis = await regionalJson(
    RegionalAnalysisSchema, ANALYSIS_INSTRUCTION,
    regionalAnalyticalInput(selected, topic, issueDate),
  );
  // Bounded editorial correction, never truncation or a raw-headline fallback.
  // Each retry keeps the same fixed facts, selection and evidence references.
  // A bounded rewrite is still attempted for editorial findings, but the last
  // draft is kept and published with its warnings instead of being cancelled.
  let canonical: RegionalCanonicalReport | undefined;
  let findings: string[] = [];
  let failure: unknown;
  for (let attempt = 0; attempt <= REGIONAL_EDITORIAL_REPAIR_ATTEMPTS; attempt++) {
    try {
      const draft = assembleRegionalEditorialReport(selected, analysis, topic, issueDate, futureEvents, coverageManifest);
      const draftFindings = regionalCanonicalEditorialFindings(draft);
      if (draftFindings.length === 0) {
        canonical = draft;
        findings = [];
        break;
      }
      if (!canonical || draftFindings.length < findings.length) {
        canonical = draft;
        findings = draftFindings;
      }
      if (attempt === REGIONAL_EDITORIAL_REPAIR_ATTEMPTS) break;
      analysis = await repairRegionalAnalysis(
        analysis, selected, topic, issueDate, new Error(draftFindings.join(" ")));
    } catch (error) {
      // Structural or data failures remain fatal, and are still worth one
      // bounded regeneration before the build stops.
      failure = error;
      if (attempt === REGIONAL_EDITORIAL_REPAIR_ATTEMPTS) break;
      analysis = await repairRegionalAnalysis(analysis, selected, topic, issueDate, error);
    }
  }
  if (!canonical) {
    throw new Error(
      failure instanceof Error ? failure.message : "The analysis could not be assembled into a valid report.",
      { cause: { analysis } },
    );
  }
  return {
    canonical,
    editorialWarnings: [...new Set([...editorialWarnings, ...findings])],
    // Raw source text is audit evidence OUTSIDE the report object. All rendered
    // sections, metrics and maps use the canonical object above, including reload/PDF.
    evidenceSnapshot: {
      version: REGIONAL_EDITORIAL_VERSION,
      fingerprint: canonical.evidenceFingerprint,
      sourcePackets: packets,
      extractedEvents: extracted.events,
      rejectedCandidates: extracted.rejected,
      selectedEventKeys: selected.map((event) => event.eventKey),
      forwardEvents: futureEvents,
      analysisEvidence: {
        regionalOutlook: analysis.regionalOutlook.evidenceKeys,
        riskPicture: analysis.riskPicture.evidenceKeys,
        businessImplications: analysis.businessImplications.map((block) => ({ heading: block.heading, evidenceKeys: block.evidenceKeys })),
        polestarOutlook: analysis.polestarOutlook.evidenceKeys,
      },
    },
  };
}