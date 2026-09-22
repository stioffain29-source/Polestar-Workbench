import { createHash } from "node:crypto";
import { z } from "zod";
import {
  buildApacGlanceMetrics,
  buildApacWeeklyWatchlist,
  buildCanonicalRegionalMapPoints,
  validateRegionalCanonicalStructure,
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
  regionalNumericClaims,
  type RegionalEventFact,
} from "../../../workbench/src/lib/regionalEditorial";
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
export const RegionalAnalysisSchema = z.object({
  regionalOutlook: Section,
  riskPicture: Section,
  polestarOutlook: Section,
  businessImplications: z.array(z.object({
    heading: z.enum(["People & Travel", "Operations & Assets", "Supply Chain & Logistics", "Regulatory & Market Access", "Business Continuity"]),
    body: z.string(),
    evidenceKeys: z.array(z.string()),
  }).strict()),
  developments: z.array(z.object({
    eventKey: z.string(),
    operationalImpact: z.string(),
    polestarView: z.string(),
    outlook7Days: z.string(),
  }).strict()),
}).strict();
export type RegionalAnalysis = z.infer<typeof RegionalAnalysisSchema>;

const ANALYSIS_INSTRUCTION = `Write a concise Regional Weekly business-risk assessment using ONLY the supplied structured event facts. You are not given articles or headlines: do not introduce external information.
The event set, factual sentences, jurisdiction, dates, event identity, severity and map selection are FIXED. Do not change them or infer unreported consequences. A reported date is not an occurrence date. Source counts are not evidence of impact.
Each section has a DIFFERENT purpose:
regionalOutlook: 90-125 words (hard maximum 140), at most two paragraphs. Rank the week's most consequential exposure and contrast it with another distinct operating issue. Name at most three markets or places; this is not a roundup of every country/development. Do NOT repeat casualties or write travel advice.
riskPicture: 100-160 words (hard maximum 180), at most three short paragraphs. Explain the transmission of the actual disruptions into business activity, distinguishing direct impact from a plausible contingent exposure. Compare the named risks; do not produce a country-by-country list or general essays about types of risk.
businessImplications: 2-3 short paragraphs, TOTAL 110-135 words across ALL paragraphs combined (hard maximum 180). Organise by relevant business function, not countries. Each paragraph must identify the exposed function, a concrete decision and its trigger grounded in the facts. Do not repeat per-event impact paragraphs, invent service restoration times, evacuation needs or pricing changes. No paragraph for a function without evidence.
polestarOutlook: 120-160 words inclusive (aim 135-150), one or two connected paragraphs. A genuine REGIONAL forward assessment considering ALL selected developments; name at least three of their countries or locations. Organise around shared operating questions and compare related exposures across countries within sentences, rather than giving each country its own sentence in succession. Rank what matters most next, connect the risks across business functions, distinguish plausible deterioration from stabilisation and identify specific changes that would materially alter the assessment. Do not default to Japan alone or Saudi energy infrastructure alone. Do NOT write separate mini country updates, repeat Key Developments or repeat the opening. Link every selected eventKey in the section metadata, while synthesising their implications rather than listing them.
For EACH development supply: operationalImpact<=35 words (which function is exposed, and how, not a repeat of the fact); polestarView<=30 words (a distinct, defensible judgement separating what is known from conditional consequences); outlook7Days<=25 words (one specific observable next signal). Do not add titles or whatChanged: those already come from verified facts.
Keep current loss of service separate from possible consequences. For cyber, distinguish data exposure from service downtime; a hotel breach does not prove bookings halted, and a government platform outage does not prove all transport stopped. For LPG, do not invent prices, rationing, import causes or nationwide closure. A police-site bombing does not prove commercial road closure. Do not forecast escalation simply because an attack occurred.
Historical source status must remain historical: "fighting was ongoing when the toll was reported" does NOT establish that fighting continues on the issue date. Do not turn an attack into confirmed business-access disruption, or say business activity "continues" to be impeded when that impact was never established. State those exposures conditionally. Do not use "Known:" or "Conditional:" scaffolding; write the distinction as ordinary sentences.
Cite each analytical section's supporting eventKeys in its metadata, never inline. Every factual name, number, cause or asserted impact must derive from the relevant supplied confirmedFacts; recommendations must be conditional where their trigger is not observed.
Do not use source/outlet names, domains, URLs, raw headlines, sentence fragments, rhetorical filler, or count-based prose. No quotes or citation markers in rendered text.
BANNED phrases: "The development is relevant to"; "Their regional importance comes from what could follow"; "the specific indicators are"; "the significance is confined to the named market"; "reporting placed the casualties at"; "selected evidence"; "the principal changes this week were".
Write in direct, precise, sentence-cased analytical English. No template padding, no claim of uniform regional deterioration, no statement that a domain is empty, and no verbatim sentence repeated across sections. Return complete sentences without truncation.`;

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
  const errors = validateRegionalCanonicalStructure(report);
  if (errors.length) throw new Error(`Regional editorial checks failed: ${errors.join(" ")}`);
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
  let analysis = await regionalJson(
    RegionalAnalysisSchema, ANALYSIS_INSTRUCTION,
    regionalAnalyticalInput(selected, topic, issueDate),
  );
  let canonical: RegionalCanonicalReport;
  try {
    canonical = assembleRegionalEditorialReport(selected, analysis, topic, issueDate, futureEvents, coverageManifest);
  } catch (error) {
    // A bounded editorial correction, never truncation or a raw-headline
    // fallback. Keep the same fixed facts, selection and evidence references.
    analysis = await regionalJson(
      RegionalAnalysisSchema,
      `${ANALYSIS_INSTRUCTION}\nCopy-edit the previous draft to correct the supplied validation problem. The draft is not evidence; use only fixed event facts. Leave a margin below every word limit. Return the complete revised analytical object with all selected eventKeys, not a partial patch.`,
      {
        ...regionalAnalyticalInput(selected, topic, issueDate),
        previousDraft: analysis,
        validationProblem: error instanceof Error ? error.message : "The analytical draft failed verification.",
      },
    );
    try {
      canonical = assembleRegionalEditorialReport(selected, analysis, topic, issueDate, futureEvents, coverageManifest);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "The corrected analysis failed verification.",
        { cause: { analysis } },
      );
    }
  }
  return {
    canonical,
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