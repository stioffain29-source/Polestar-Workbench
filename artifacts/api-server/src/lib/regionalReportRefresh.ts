import { z } from "zod";
import { regionalJson } from "./regionalAi";
import {
  assembleRegionalEditorialReport,
  POLESTAR_SENTENCE_RULE,
  regionalAnalyticalInput,
  regionalOutlookDiagnostics,
  reassessRegionalEvents,
  type RegionalAnalysis,
  type finishRegionalEditorialReport,
} from "./regionalReportEditorial";
import {
  regionalCanonicalReportFromHardNumbers,
  type RegionalCanonicalReport,
} from "../../../workbench/src/lib/regionalWeekly";
import { REGIONAL_EDITORIAL_VERSION } from "../../../workbench/src/lib/regionalEditorial";
import {
  REGIONAL_MAX_MAP_POINTS,
  validateRegionalContentPolicy,
} from "../../../workbench/src/lib/regionalContentPolicy";

type EditorialResult = Awaited<ReturnType<typeof finishRegionalEditorialReport>>;
type EvidenceSnapshot = EditorialResult["evidenceSnapshot"];
const Outlook = z.object({ text: z.string(), evidenceKeys: z.array(z.string()) }).strict();

const OUTLOOK_INSTRUCTION = `Rewrite ONLY the closing Polestar Outlook for the supplied regional business-risk report. Use ONLY its checked event facts and fixed, consequence-based severity ratings.
Write 120-160 words inclusive, aiming for 135-150, in one or two connected paragraphs. Consider all selected developments and include all their eventKeys in evidenceKeys. Name at least three of the supplied countries or locations. Do not introduce an unselected country or development.
This is a regional FORWARD judgement, not six mini country updates or a repeat of Key Developments. Cover the most important forward driver, the secondary risks that could become operationally significant, what would materially worsen the assessment and what would indicate stabilisation. Connect security, supply, mobility, regulatory implementation and digital recovery where evidenced, and name the concrete indicators that would change the judgement.
Organise the paragraphs around shared operating questions. ${POLESTAR_SENTENCE_RULE} Do not disguise a country list as one paragraph. Do not imply existing business-access disruption through words such as "further" when no such interruption is established. An internal state boundary is not an international border.
An APAC outlook must not concentrate on Japan alone; a Middle East outlook must not concentrate on Saudi energy infrastructure alone. Address only the actual supplied risks, without adding empty domains or speculative filler.
Keep historical reported conditions historical. Do not turn a potential business consequence into confirmed interruption, infer business curtailment from supply stress, infer all transport has stopped from one administrative platform outage, or presume damage just because an attack occurred.
Write as an analyst addressing the client, never as a writer describing your own inputs. NEVER write "the supplied facts", "on the supplied facts", "the packet", "the source material", "confirmed facts" or "the evidence set". Where something is unproven, say it in the client's terms: "There is currently no evidence of wider disruption."; "The extent of damage remains unclear."; "No operational outage has been confirmed."
Do not repeat the opening assessment, casualties, counts of incidents or generic monitoring advice. Do not quote articles or mention sources, publishers, provenance, evidence, templates, or "Known:"/"Conditional:" labels in the text. Complete sentences, no truncation. Return only text and evidenceKeys.`;

export function savedRegionalEditorial(hardNumbers: unknown): {
  canonical: RegionalCanonicalReport;
  evidence: EvidenceSnapshot;
} | null {
  if (!hardNumbers || typeof hardNumbers !== "object") return null;
  const saved = hardNumbers as Record<string, unknown>;
  const report = saved.regionalCanonicalReport as RegionalCanonicalReport | undefined;
  if (!report || !["apac_weekly", "middle_east_weekly"].includes(report.topic)) return null;
  const canonical = regionalCanonicalReportFromHardNumbers(hardNumbers, report.topic, report.issueDate);
  const evidence = saved.regionalEvidenceSnapshot as EvidenceSnapshot | undefined;
  if (!canonical || !evidence?.selectedEventKeys?.length || !evidence.extractedEvents?.length ||
    !evidence.analysisEvidence || !Array.isArray(evidence.forwardEvents)) return null;
  return { canonical, evidence };
}

/** Content-only APAC refresh: preserve its selected facts, cards, map order and other prose. */
export async function refreshRegionalEditorialOutlook(
  saved: NonNullable<ReturnType<typeof savedRegionalEditorial>>,
): Promise<EditorialResult> {
  const prior = saved.canonical;
  const evidence = saved.evidence;
  const allEvents = reassessRegionalEvents(evidence.extractedEvents);
  const selected = evidence.selectedEventKeys.map((key) => {
    const event = allEvents.find((candidate) => candidate.eventKey === key);
    if (!event) throw new Error("The saved report is missing its selected factual evidence. No report was changed.");
    return event;
  });
  if (prior.topic === "apac_weekly" && selected.length !== 6) {
    throw new Error("APAC content refresh must retain its six selected developments.");
  }
  const refs = evidence.analysisEvidence;
  const analysis: RegionalAnalysis = {
    regionalOutlook: { text: prior.regionalOutlook, evidenceKeys: refs.regionalOutlook },
    riskPicture: { text: prior.riskPicture, evidenceKeys: refs.riskPicture },
    polestarOutlook: { text: prior.polestarOutlook, evidenceKeys: refs.polestarOutlook },
    businessImplications: prior.businessImplications.map((block, index) => ({
      ...block, evidenceKeys: refs.businessImplications[index].evidenceKeys,
    })),
    developments: prior.developments.map((event) => ({
      eventKey: event.eventKey!,
      operationalImpact: event.operationalImpact || event.operationalSignificance,
      polestarView: event.polestarView!,
      outlook7Days: event.outlook7Days || event.whatToWatch,
    })),
  };
  // Rebuilding stamps the current editorial version, so the current content
  // rules apply to prose this path deliberately preserves. An edition saved
  // under an earlier standard has to be regenerated: say that plainly rather
  // than re-stamping it, half-correcting it, or failing on an unfixable gate
  // after paying for the rewrite. The map and the Outlook are rebuilt here, so
  // their problems are not the saved edition's to answer for.
  const retained = validateRegionalContentPolicy({
    ...prior,
    editorialVersion: REGIONAL_EDITORIAL_VERSION,
    mapPoints: prior.mapPoints.slice(0, REGIONAL_MAX_MAP_POINTS),
  }).filter((problem) => !/polestar outlook/i.test(problem));
  if (retained.length) {
    throw new Error(`This saved edition predates the current content standard, and refreshing the Outlook alone cannot correct it: ${retained.join(" ")} Regenerate the report to apply the current standard. No report was changed.`);
  }
  const facts = regionalAnalyticalInput(selected, prior.topic, prior.issueDate);
  let outlook = await regionalJson(Outlook, OUTLOOK_INSTRUCTION, {
    ...facts, openingToAvoidRepeating: prior.regionalOutlook,
  });
  let canonical: RegionalCanonicalReport | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      canonical = assembleRegionalEditorialReport(
        selected, { ...analysis, polestarOutlook: outlook }, prior.topic, prior.issueDate,
        evidence.forwardEvents, prior.coverageManifest,
      );
      break;
    } catch (error) {
      if (attempt === 1) throw error;
      outlook = await regionalJson(
        Outlook,
        `${OUTLOOK_INSTRUCTION}\nCorrect the supplied validation failure. Revise ONLY the closing Outlook. The diagnostics were measured from your previous draft: count the words before returning and leave a margin inside the limit.`,
        {
          ...facts, previousDraft: outlook,
          validationProblem: error instanceof Error ? error.message : "The outlook failed verification.",
          diagnostics: regionalOutlookDiagnostics(outlook, selected),
        },
      );
    }
  }
  if (!canonical) throw new Error("The refreshed Outlook could not be verified.");
  return {
    canonical,
    evidenceSnapshot: {
      ...evidence,
      version: REGIONAL_EDITORIAL_VERSION,
      fingerprint: canonical.evidenceFingerprint,
      extractedEvents: allEvents,
      analysisEvidence: { ...refs, polestarOutlook: outlook.evidenceKeys },
    },
  };
}