import {
  buildFlashpointReportDataset,
  selectFlashpointUsable,
  resolveFlashpointRenderedModel,
  validateFlashpointReportDataset,
  validateFlashpointRenderedModel,
  type FlashpointReportIncident,
} from "../../artifacts/workbench/src/lib/flashpointReportDataset";
import { FLASHPOINT_VALIDITY_VERSION } from "@workspace/relevance";

const ISSUE = "2026-08-12";
let id = 1000;
const row = (
  title: string,
  overrides: Partial<FlashpointReportIncident> = {},
): FlashpointReportIncident => ({
  id: id++,
  title,
  summary: "Residents gathered and marched through the city centre.",
  topic: "flashpoint",
  severity: "moderate",
  occurredAt: "2026-08-10T08:00:00Z",
  country: "India",
  location: "Delhi",
  source: "Example News",
  validityStatus: "valid",
  validityVersion: FLASHPOINT_VALIDITY_VERSION,
  validityGates: {
    verdict: "valid",
    eventOccurred: true,
    actor: "Residents",
    activity: "march",
    physicalLocation: "Delhi",
    country: "India",
    eventType: "protest",
    eventDate: "2026-08-10",
    currentness: "current",
    assignedCountrySupported: true,
    confidence: { event: 1, classification: 1, geography: 1, date: 1 },
    contradictions: [],
    version: FLASHPOINT_VALIDITY_VERSION,
  },
  ...overrides,
});

describe("canonical Flashpoint incident set", () => {
  test("present non-valid semantic verdicts fail closed across noise categories", () => {
    const rejected = [
      row("Strike keyword appears in a non-event glossary", {
        summary: "A business glossary explains technology strike terminology.",
        validityStatus: "invalid",
      }),
      row("Column: what last year's demonstrations mean now", {
        validityStatus: "needs_review",
      }),
      row("Technology company launches protest monitoring product", {
        validityStatus: "invalid",
      }),
      row("Court hears petition concerning an earlier rally", {
        validityStatus: "needs_review",
      }),
      row("Police arrest suspect in ordinary shop theft", {
        validityStatus: "invalid",
      }),
      row("Museum recalls a historical march from 1975", {
        validityStatus: "invalid",
      }),
      row("Demonstration reported at an ambiguous foreign venue", {
        country: "Australia",
        location: "Paris",
        validityStatus: "needs_review",
      }),
    ];
    const positive = row("Bus drivers block central avenue during wage protest", {
      summary: "Hundreds of drivers blocked traffic while police diverted vehicles.",
      validityStatus: "valid",
    });
    const selection = selectFlashpointUsable([...rejected, positive], "flashpoint", ISSUE);
    expect(selection.enriched.map((r) => r.id)).toEqual([positive.id]);
    expect(selection.semanticValidityDropped).toBe(rejected.length);
    expect(selection.rejected.filter((r) => r.stage === "semantic-validity")).toHaveLength(rejected.length);
  });

  test("NULL verdicts fail closed at the semantic gate", () => {
    const real = row("Teachers march outside ministry over unpaid wages", {
      validityStatus: null,
    });
    const courtOnly = row("Court rules on petition filed after protest", {
      validityStatus: null,
    });
    const selection = selectFlashpointUsable([real, courtOnly], "flashpoint", ISSUE);
    expect(selection.enriched).toHaveLength(0);
    expect(selection.rejected.filter((r) => r.stage === "semantic-validity")).toHaveLength(2);
  });

  test.each([
    ["zero confidence", { validityGates: { ...row("seed").validityGates!, confidence: { event: 0, classification: 1, geography: 1, date: 1 } } }],
    ["missing actor", { validityGates: { ...row("seed").validityGates!, actor: null } }],
    ["missing activity", { validityGates: { ...row("seed").validityGates!, activity: null } }],
    ["null date", { validityGates: { ...row("seed").validityGates!, eventDate: null } }],
    ["unknown type", { validityGates: { ...row("seed").validityGates!, eventType: "unknown" } }],
    ["provider needs_review", { validityGates: { ...row("seed").validityGates!, verdict: "needs_review" } }],
    ["stale version", { validityVersion: "2025.semantic.1" }],
    ["sparse trusted gates", {
      validityStatus: "trusted_structured",
      validityGates: { policy: "trusted_structured", verdict: "valid", version: FLASHPOINT_VALIDITY_VERSION },
    }],
  ])("shared semantic contract rejects %s", (_label, overrides) => {
    const candidate = row("Residents protest in Delhi", overrides as Partial<FlashpointReportIncident>);
    const selection = selectFlashpointUsable([candidate], "flashpoint", ISSUE);
    expect(selection.enriched).toHaveLength(0);
    expect(selection.rejected[0]).toEqual(
      expect.objectContaining({ id: candidate.id, stage: "semantic-validity" }),
    );
  });

  test("validation precedes dedupe so a weak high-severity copy cannot erase a valid duplicate", () => {
    const weak = row("Workers rally at central depot over delayed pay", {
      summary: "Founder responds to a viral post about the rally.",
      severity: "high",
      occurredAt: "2026-08-11T10:00:00Z",
      validityStatus: "needs_review",
    });
    const valid = row("Workers rally at central depot over delayed pay", {
      summary: "Workers blocked the depot gate during a live wage protest.",
      severity: "low",
      occurredAt: "2026-08-10T10:00:00Z",
      validityStatus: "valid",
    });
    const selection = selectFlashpointUsable([weak, valid], "flashpoint", ISSUE);
    expect(selection.enriched.map((r) => r.id)).toEqual([valid.id]);
    expect(selection.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: weak.id, stage: "semantic-validity" }),
      ]),
    );
  });

  test("syndicated valid copies collapse inside the validated universe", () => {
    const first = row("Port workers stage wage protest at harbour gate", {
      validityStatus: "valid",
      severity: "low",
    });
    const second = row("Port workers stage wage protest at harbour gate - Example News", {
      validityStatus: "valid",
      severity: "high",
      occurredAt: "2026-08-11T08:00:00Z",
    });
    const selection = selectFlashpointUsable([first, second], "flashpoint", ISSUE);
    expect(selection.enriched).toHaveLength(1);
    expect(selection.enriched[0]?.id).toBe(second.id);
    expect(selection.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, stage: "duplicate" }),
      ]),
    );
  });

  test("same inputs and issue date have stable canonical IDs, fingerprint and core facts", () => {
    const rows = [
      row("Police use tear gas during student protest in Delhi", {
        validityStatus: "valid",
        severity: "high",
      }),
      row("Transport union announces strike set for 16 August", {
        validityStatus: "valid",
        country: "Nepal",
        location: "Kathmandu",
      }),
    ];
    const early = buildFlashpointReportDataset(rows, "flashpoint", ISSUE, {
      generatedAt: "2026-08-12T09:00:00Z",
    });
    const later = buildFlashpointReportDataset(rows, "flashpoint", ISSUE, {
      generatedAt: "2026-08-15T09:00:00Z",
    });
    expect(later.canonical.acceptedIds).toEqual(early.canonical.acceptedIds);
    expect(later.canonical.fingerprint).toBe(early.canonical.fingerprint);
    expect(later.canonical.periodRows.map((r) => r.id)).toEqual(
      early.canonical.periodRows.map((r) => r.id),
    );
    expect(later.fastFacts).toEqual(early.fastFacts);
    expect(later.countryRows).toEqual(early.countryRows);
    expect(later.forecastFuture).toEqual(early.forecastFuture);
    expect(later.forecastRead).toBe(early.forecastRead);
  });

  test.each([
    ["raw title", { title: "Residents stage a different protest in Delhi" }],
    ["source URL", { sourceUrl: "https://example.test/changed-source" }],
    ["occurrence timestamp", { occurredAt: "2026-08-10T09:30:00Z" }],
    ["semantic evidence", {
      validityGates: {
        ...row("basis").validityGates!,
        evidence: { sourceSpan: "different persisted evidence" },
      },
    }],
  ])("fingerprint changes when %s changes", (_label, change) => {
    const original = row("Residents protest in Delhi", {
      sourceUrl: "https://example.test/original",
    });
    const changed = {
      ...original,
      ...change,
      id: original.id,
    } as FlashpointReportIncident;
    const first = buildFlashpointReportDataset([original], "flashpoint", ISSUE);
    const second = buildFlashpointReportDataset([changed], "flashpoint", ISSUE);
    expect(second.canonical.fingerprint).not.toBe(first.canonical.fingerprint);
  });

  test("fail-closed validator detects a rendered row outside canonical set", () => {
    const accepted = row("Nurses march through capital over staffing dispute", {
      validityStatus: "valid",
    });
    const ds = buildFlashpointReportDataset([accepted], "flashpoint", ISSUE);
    const rogue = row("Rogue protest row", { id: "rogue" });
    (ds.activismRows as FlashpointReportIncident[]).push(rogue);
    expect(validateFlashpointReportDataset(ds)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/outside canonical period set/),
      ]),
    );
  });

  test("persisted semantic geography, classification and date override lexical fields", () => {
    const semantic = row("Sydney workers hold peaceful technology rally", {
      country: "Australia",
      location: "Sydney",
      occurredAt: "2026-08-11T08:00:00Z",
      validityGates: {
        verdict: "valid",
        eventOccurred: true,
        actor: "Residents",
        activity: "riot",
        physicalLocation: "Kathmandu",
        country: "Nepal",
        eventType: "riot_public_disorder",
        eventDate: "2026-08-09",
        currentness: "current",
        assignedCountrySupported: true,
        confidence: { event: 1, classification: 1, geography: 1, date: 1 },
        contradictions: [],
        version: FLASHPOINT_VALIDITY_VERSION,
        evidence: { sourceSpan: "Residents rioted in Kathmandu on 9 August" },
      },
    });
    const ds = buildFlashpointReportDataset([semantic], "flashpoint", ISSUE);
    expect(ds.canonical.periodRows[0]).toEqual(
      expect.objectContaining({
        country: "Nepal",
        location: "Kathmandu",
        issue: "Riot / public disorder",
        semanticEventDate: "2026-08-09",
      }),
    );
    expect(ds.canonical.periodRows[0]?.date.toISOString().slice(0, 10)).toBe("2026-08-09");
  });

  test("final resolver ignores Fast Fact painting and safely recovers contradictory prose", () => {
    const accepted = row("Drivers block central road during wage protest");
    const rejected = row("Rejected commentary headline that must never leak", {
      validityStatus: "invalid",
    });
    const ds = buildFlashpointReportDataset([accepted, rejected], "flashpoint", ISSUE);
    const model = resolveFlashpointRenderedModel({ dataset: ds });
    expect(model.fastFacts.find((f) => f.label === "Distinct Incidents")?.value).toBe("1");
    const recovered = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: {
        datasetFingerprint: ds.canonical.fingerprint,
        executiveSummary: "India recorded nine incidents this week. Rejected commentary headline that must never leak.",
      },
    });
    expect(recovered.prose.executiveSummary).toBe(ds.autoExecutiveSummary);
  });

  test("missing AI generation basis is stale and cannot be relabelled current", () => {
    const ds = buildFlashpointReportDataset(
      [row("Workers protest in Delhi over wages")],
      "flashpoint",
      ISSUE,
    );
    const model = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: { executiveSummary: "India recorded nine incidents this week." },
    });
    expect(model.prose.executiveSummary).toBe(ds.autoExecutiveSummary);
  });

  test("legacy and stale saved report prose is ignored while explicitly current form prose is eligible", () => {
    const ds = buildFlashpointReportDataset(
      [row("Workers protest in Delhi over wages")],
      "flashpoint",
      ISSUE,
    );
    const analyst =
      "Analyst assessment: the accepted protest requires route monitoring and a review of site access plans. Teams should verify transport conditions before movement and retain flexible alternatives while the confirmed incident develops through the reporting window.";
    for (const datasetFingerprint of [undefined, "fp1-old"]) {
      const stale = resolveFlashpointRenderedModel({
        dataset: ds,
        report: { datasetFingerprint, whatMatters: analyst },
      });
      expect(stale.prose.whatMatters).toBe(ds.autoWhatMatters);
    }
    const current = resolveFlashpointRenderedModel({
      dataset: ds,
      report: {
        datasetFingerprint: ds.canonical.fingerprint,
        whatMatters: analyst,
      },
    });
    expect(current.prose.whatMatters).toContain("Analyst assessment");
  });

  test.each([
    "India recorded twenty-one incidents this week",
    "India recorded 21 separate incidents this week",
    "India recorded 2000 incidents this week",
    "The total number of incidents in India was twenty-one",
    "India recorded one hundred and four incidents this week",
    "India recorded two thousand three hundred and forty-five incidents this week",
  ])("compound English count claim safely falls back: %s", (claim) => {
    const ds = buildFlashpointReportDataset(
      [row("Workers protest in Delhi over wages")],
      "flashpoint",
      ISSUE,
    );
    const model = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: {
        datasetFingerprint: ds.canonical.fingerprint,
        executiveSummary:
          `${claim}. This deliberately long generated paragraph provides operational context for corporate security teams while making a count claim that must be checked against the single canonical row rather than trusted from prose.`,
      },
    });
    expect(model.prose.executiveSummary).toBe(ds.autoExecutiveSummary);
    expect(() => validateFlashpointRenderedModel(model)).not.toThrow();
  });

  test("legitimate event-date numerals are not treated as count claims", () => {
    const ds = buildFlashpointReportDataset(
      [row("Workers protest in Delhi over wages")],
      "flashpoint",
      ISSUE,
    );
    const model = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: {
        datasetFingerprint: ds.canonical.fingerprint,
        executiveSummary:
          "One incident occurred in India on 10 August. Workers gathered in Delhi over wages, and operational teams should monitor route access while this confirmed protest develops during the reporting period.",
      },
    });
    expect(model.prose.executiveSummary).toContain("10 August");
    expect(validateFlashpointRenderedModel(model)).toEqual([]);
  });

  test("canonical five-days-ago prose is not mistaken for an incident count", () => {
    const ds = buildFlashpointReportDataset(
      [row("Workers protest in Delhi over wages")],
      "flashpoint",
      "2026-08-15",
    );
    const model = resolveFlashpointRenderedModel({ dataset: ds });
    expect(Object.values(model.prose).join(" ")).toContain("5 days ago");
    expect(validateFlashpointRenderedModel(model)).toEqual([]);
  });

  test("country-scoped category claims do not reuse cardinals across nouns", () => {
    const india = row("Workers protest in Delhi over wages");
    const nepalBase = row("Residents protest in Kathmandu over services", {
      country: "Nepal",
      location: "Kathmandu",
    });
    const nepal = {
      ...nepalBase,
      validityGates: {
        ...nepalBase.validityGates!,
        country: "Nepal",
        physicalLocation: "Kathmandu",
      },
    };
    const ds = buildFlashpointReportDataset([india, nepal], "flashpoint", ISSUE);
    const model = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: {
        datasetFingerprint: ds.canonical.fingerprint,
        executiveSummary:
          "One protest occurred in India and one protest occurred in Nepal. Both accepted records warrant proportionate route monitoring, source verification and practical access planning during the reporting period.",
      },
    });
    expect(model.prose.executiveSummary).toContain("one protest occurred in Nepal");
    expect(validateFlashpointRenderedModel(model)).toEqual([]);
  });

  test("post-noun 21 August date is not a count", () => {
    const incident = row("Workers protest in Delhi on 21 August", {
      occurredAt: "2026-08-21T08:00:00Z",
      validityGates: {
        ...row("basis").validityGates!,
        eventDate: "2026-08-21",
      },
    });
    const ds = buildFlashpointReportDataset(
      [incident],
      "flashpoint",
      "2026-08-22",
    );
    const model = resolveFlashpointRenderedModel({
      dataset: ds,
      ai: {
        datasetFingerprint: ds.canonical.fingerprint,
        executiveSummary:
          "The accepted incident on 21 August involved workers protesting in Delhi. Operational teams should monitor access conditions and verify any change against confirmed reporting.",
      },
    });
    expect(model.prose.executiveSummary).toContain("21 August");
    expect(validateFlashpointRenderedModel(model)).toEqual([]);
  });

  test("stale fingerprint prose falls back and shared resolver is snapshot-identical", () => {
    const accepted = row("Students march through Delhi over tuition fees");
    const ds = buildFlashpointReportDataset([accepted], "flashpoint", ISSUE);
    const input = {
      dataset: ds,
      ai: {
        datasetFingerprint: "fp1-stale",
        executiveSummary: "Japan recorded 999 incidents.",
      },
    };
    const previewModel = resolveFlashpointRenderedModel(input);
    const pdfModel = resolveFlashpointRenderedModel(input);
    expect(previewModel.prose.executiveSummary).toBe(ds.autoExecutiveSummary);
    expect(pdfModel).toEqual(previewModel);
  });
});