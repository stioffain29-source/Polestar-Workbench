// Cargo Watch report validation gate (spec pt7).
//
// A HARD, deterministic gate that runs over the SAME built CargoPatternModel and
// the SAME resolved (editor-or-auto) section text that the on-screen preview and
// the PDF exporter render, so preview == PDF and neither can ship a report that
// fails a check. The PDF exporter THROWS CargoReportValidationError (blocking the
// download); the preview renders a blocking panel listing the failures.
//
// Every check is written to pass BY CONSTRUCTION on a correctly built model, so a
// clean report never trips the gate — the checks are regression tripwires plus a
// guard against unsafe editor edits. Empty reports (no operational incidents)
// render their explicit no-data state and are not validated.
import { addDays, isValid, parseISO } from "date-fns";
import type { CargoAppendixRow, CargoPatternModel } from "./cargoPatternModel";

export interface CargoReportOverrides {
  situation?: string | null;
  whatMatters?: string | null;
  implications?: string | null;
  watchNext?: string | null;
  polestarView?: string | null;
}

export interface CargoResolvedSection {
  text: string;
  ownerEdited: boolean;
}

export interface CargoResolvedText {
  situation: CargoResolvedSection;
  whatMatters: CargoResolvedSection;
  implications: CargoResolvedSection;
  watchNext: CargoResolvedSection;
  polestarView: CargoResolvedSection;
}

export interface CargoReportValidationIssue {
  code: string;
  label: string; // spec-worded failure name
  message: string; // specific detail (counts / offending text)
}

export const CARGO_REPORT_VALIDATION_CODE = "CARGO_REPORT_VALIDATION_FAILED";

/** Thrown by exportTopicReportPdf for cargo_watch when the report fails one or
 *  more validation checks and the caller did not pass allowValidationFailures.
 *  The editor catches this code to surface the blocking panel. */
export class CargoReportValidationError extends Error {
  readonly code = CARGO_REPORT_VALIDATION_CODE;
  readonly issues: CargoReportValidationIssue[];
  constructor(issues: CargoReportValidationIssue[]) {
    super(
      `Cargo Watch report failed ${issues.length} validation check(s): ${issues
        .map((i) => i.label)
        .join("; ")}.`,
    );
    this.name = "CargoReportValidationError";
    this.issues = issues;
  }
}

// --- text helpers ----------------------------------------------------------

function resolveSection(
  override: string | null | undefined,
  auto: string,
): CargoResolvedSection {
  const t = (override ?? "").trim();
  return t ? { text: t, ownerEdited: true } : { text: auto ?? "", ownerEdited: false };
}

/** Resolve the five editable assessment sections exactly as the preview and PDF
 *  do (editor override wins when non-blank, otherwise the deterministic model
 *  assessment). ONE authority so the gate can never disagree with what renders. */
export function resolveCargoReportText(
  model: CargoPatternModel,
  overrides: CargoReportOverrides,
): CargoResolvedText {
  const a = model.assessment;
  return {
    situation: resolveSection(overrides.situation, a.situation),
    whatMatters: resolveSection(overrides.whatMatters, a.whatMatters.join("\n")),
    implications: resolveSection(overrides.implications, a.implications.join("\n")),
    watchNext: resolveSection(overrides.watchNext, a.watchNext.join("\n")),
    polestarView: resolveSection(overrides.polestarView, a.polestarView),
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

function bullets(s: string): string[] {
  return s
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*\u2022\d.)\s]+/, "").trim())
    .filter(Boolean);
}

// --- detection vocabularies ------------------------------------------------

// Strong inland-waterway cues (barge/ferry/jetty movement, e.g. Mithamoin) — a
// bare "river"/"boat" mention is deliberately excluded to avoid flagging a road
// incident that merely crosses a river (spec pt2/pt7).
const WATERWAY_STRONG_RE =
  /\b(barge|ferry|ferries|jetty|wharf|riverine|inland waterway|canal boat|river vessel)\b/i;
const ROAD_TRANSPORT_RE =
  /\b(road transport|highway|motorway|trucking|truck route|convoy)\b/i;

// Sensational tabloid vocabulary that neutralised headlines must never retain
// (spec pt3 example: "Fearless thieves terrorize Karnal"). Kept tight and
// spec-anchored so cleaned professional titles do not false-trip.
const SENSATIONAL_RE =
  /\b(terroriz\w*|terroris\w*|fearless|rampag\w*|bloodbath|carnage|maraud\w*|brazen|reign of terror|daring raid)\b/i;

// Evidence-gated claims (spec pt2/pt7): each must be backed by the incident
// record, not asserted as a default recommendation. Checked on OWNER-EDITED
// sections only — the deterministic builder already gates these by construction.
const EVIDENCE_CLAIMS: { re: RegExp; ev: RegExp; what: string }[] = [
  {
    re: /\bdriver (vetting|integrity|screening|complicit\w*|collusion|colluded|involve\w*|negligen\w*)\b/i,
    ev: /\bdriver/i,
    what: "driver involvement",
  },
  {
    re: /\binsider (threat|involve\w*|activity|collusion|complicit\w*)\b/i,
    ev: /\b(insider|employee|staff|warehouse worker)\b/i,
    what: "insider activity",
  },
  {
    re: /\bseal (compromise\w*|tamper\w*|broken|breach\w*)\b/i,
    ev: /\bseal/i,
    what: "seal compromise",
  },
  {
    re: /\broute (predictab\w*|planning|pattern\w*)\b/i,
    ev: /\b(route|corridor|highway)\b/i,
    what: "route predictability",
  },
  {
    re: /\btracking (failure|gap|lapse|disabled|jamm\w*)\b/i,
    ev: /\b(track\w*|gps|telematics)\b/i,
    what: "tracking failure",
  },
  { re: /\bconvoy\b/i, ev: /\bconvoy/i, what: "convoy protocols" },
];

// --- gate ------------------------------------------------------------------

/** Run the ten spec-pt7 checks. Returns [] when the report is clean; a non-empty
 *  list blocks both the PDF export and the preview. */
export function validateCargoReport(
  model: CargoPatternModel,
  overrides: CargoReportOverrides,
  issueDate: string,
): CargoReportValidationIssue[] {
  const issues: CargoReportValidationIssue[] = [];
  // An empty report renders its explicit no-data state; nothing to validate.
  if (model.isEmpty || model.totalUnique === 0) return issues;

  const text = resolveCargoReportText(model, overrides);
  const total = model.totalUnique;

  // 1. Totals reconcile — the register, supply-chain exposure, weekly table and
  //    weekly cells must equal the operational total exactly; the map and trend
  //    must never exceed it (they legitimately drop undated / country-unknown
  //    rows, so equality is not required, only no inflation).
  const stageSum = model.stages.reduce((s, st) => s + st.count, 0);
  const weeklySum =
    model.activity.weeklyTotals.reduce((s, n) => s + n, 0) +
    model.activity.unconfirmedTotal;
  const intensitySum = [...model.intensity.values()].reduce(
    (s, v) => s + v.count,
    0,
  );
  const trendSum = model.extras.trend.reduce((s, p) => s + p.count, 0);
  const recon: string[] = [];
  if (model.appendix.length !== total)
    recon.push(`register ${model.appendix.length} ≠ total ${total}`);
  if (stageSum !== total)
    recon.push(`supply-chain exposure ${stageSum} ≠ total ${total}`);
  if (model.activity.total !== total)
    recon.push(`weekly table total ${model.activity.total} ≠ total ${total}`);
  if (weeklySum !== total)
    recon.push(`weekly cells ${weeklySum} ≠ total ${total}`);
  if (intensitySum > total)
    recon.push(`map counts ${intensitySum} exceed total ${total}`);
  if (trendSum > total)
    recon.push(`trend counts ${trendSum} exceed total ${total}`);
  if (recon.length)
    issues.push({
      code: "TOTALS_RECONCILE",
      label: "Totals do not reconcile",
      message: recon.join("; "),
    });

  // 2. Enforcement records excluded from theft totals — the enforcement set must
  //    be disjoint from the operational register and the Key Incidents.
  const opIds = new Set(model.appendix.map((r) => r.id));
  const selIds = new Set(model.selected.map((r) => r.id));
  const leaked = model.enforcement.rows.filter(
    (r) => opIds.has(r.id) || selIds.has(r.id),
  );
  const enf: string[] = [];
  if (model.enforcement.total !== model.enforcement.rows.length)
    enf.push(
      `enforcement count ${model.enforcement.total} ≠ rows ${model.enforcement.rows.length}`,
    );
  if (leaked.length)
    enf.push(`${leaked.length} enforcement record(s) present in operational totals`);
  if (enf.length)
    issues.push({
      code: "ENFORCEMENT_IN_TOTALS",
      label: "Enforcement records included in theft totals",
      message: enf.join("; "),
    });

  // 3. Reporting period aligns with chart periods — no weekly bucket may fall
  //    after the report's issue date (a stale / misaligned chart window).
  const issue = parseISO(issueDate);
  if (isValid(issue)) {
    const horizon = addDays(issue, 7);
    const future = model.activity.weeks.filter((w) => {
      const d = parseISO(w.key);
      return isValid(d) && d.getTime() > horizon.getTime();
    });
    if (future.length)
      issues.push({
        code: "PERIOD_ALIGNMENT",
        label: "Reporting and chart periods do not align",
        message: `${future.length} chart week(s) fall after the reporting period ending ${issueDate}`,
      });
  }

  // 4. Waterway incident not described as road transport — a barge/ferry/jetty
  //    incident must not carry road-transport operational relevance (spec pt2).
  const waterwayAsRoad = [...model.selected, ...model.appendix].filter(
    (r) =>
      WATERWAY_STRONG_RE.test(r.summary) &&
      ROAD_TRANSPORT_RE.test(r.operationalRelevance ?? ""),
  );
  if (waterwayAsRoad.length)
    issues.push({
      code: "WATERWAY_AS_ROAD",
      label: "Waterway incident described as road transport",
      message: `${waterwayAsRoad.length} waterway incident(s) carry road-transport relevance`,
    });

  // 5. Driver integrity / insider / seal / route / tracking / convoy claims must
  //    be evidenced. Owner-edited sections only — the builder gates these itself.
  const evidenceCorpus = [
    ...model.appendix.map((r) => r.summary),
    ...model.selected.map((r) => r.summary),
    ...model.appendix.map((r) => r.clientStatus ?? ""),
    ...model.selected.map((r) => r.clientStatus ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  const ownerSections: [string, CargoResolvedSection][] = [
    ["Situation", text.situation],
    ["What Matters", text.whatMatters],
    ["Implications", text.implications],
    ["Watch Next", text.watchNext],
    ["Polestar View", text.polestarView],
  ];
  const unevidenced: string[] = [];
  for (const [name, sec] of ownerSections) {
    if (!sec.ownerEdited) continue;
    for (const claim of EVIDENCE_CLAIMS) {
      if (claim.re.test(sec.text) && !claim.ev.test(evidenceCorpus))
        unevidenced.push(`${claim.what} claimed in ${name} without incident evidence`);
    }
  }
  if (unevidenced.length)
    issues.push({
      code: "DRIVER_NO_EVIDENCE",
      label: "Driver integrity stated without supporting evidence",
      message: [...new Set(unevidenced)].join("; "),
    });

  // 6. Identical analytical text must not appear in multiple sections. Compare
  //    normalised prose blocks / bullet lines (>= 6 words) across the five
  //    sections; a repeat across two different sections fails.
  const unitSections = new Map<string, Set<string>>();
  const addUnits = (
    name: string,
    sec: CargoResolvedSection,
    asBullets: boolean,
  ) => {
    const units = asBullets ? bullets(sec.text) : [sec.text];
    for (const u of units) {
      const n = norm(u);
      if (n.split(" ").filter(Boolean).length < 6) continue;
      const set = unitSections.get(n) ?? new Set<string>();
      set.add(name);
      unitSections.set(n, set);
    }
  };
  addUnits("Situation", text.situation, false);
  addUnits("What Matters", text.whatMatters, true);
  addUnits("Implications", text.implications, true);
  addUnits("Watch Next", text.watchNext, true);
  addUnits("Polestar View", text.polestarView, false);
  const dups = [...unitSections.values()].filter((set) => set.size >= 2);
  if (dups.length)
    issues.push({
      code: "DUPLICATE_TEXT",
      label: "Identical analytical text appears in multiple sections",
      message: dups
        .slice(0, 3)
        .map((set) => `text repeated across ${[...set].join(" & ")}`)
        .join("; "),
    });

  // 7. No sensational source headline remains (spec pt3) — in a Key Incident /
  //    register summary or in any rendered assessment prose.
  const sensational: string[] = [];
  for (const r of [...model.selected, ...model.appendix])
    if (SENSATIONAL_RE.test(r.summary)) sensational.push(r.summary);
  for (const [name, sec] of ownerSections)
    if (SENSATIONAL_RE.test(sec.text)) sensational.push(`${name} prose`);
  if (sensational.length)
    issues.push({
      code: "SENSATIONAL_HEADLINE",
      label: "Sensational source headline remains",
      message: `${sensational.length} sensational phrase(s) not neutralised`,
    });

  // 8. Every Key Incident has a source (spec pt5).
  const noSource = model.selected.filter((r) => (r.source ?? "").trim() === "");
  if (noSource.length)
    issues.push({
      code: "KEY_INCIDENT_NO_SOURCE",
      label: "A Key Incident has no source",
      message: `${noSource.length} Key Incident(s) missing a source`,
    });

  // 9. Polestar View >= 120 words when present (spec pt4/pt7).
  const pv = text.polestarView.text.trim();
  if (pv && wordCount(pv) < 120)
    issues.push({
      code: "POLESTAR_TOO_SHORT",
      label: "Polestar View is fewer than 120 words",
      message: `Polestar View has ${wordCount(pv)} words (minimum 120)`,
    });

  // 10. Every (auto-generated) implication must trace to an incident (spec pt7).
  //     Owner-edited implications are the author's responsibility and are gated
  //     by check 5 instead.
  if (!text.implications.ownerEdited && text.implications.text.trim()) {
    const implCount = model.assessment.implications.length;
    const idCount = model.assessment.implicationIncidentIds.length;
    if (implCount > 0 && idCount === 0)
      issues.push({
        code: "IMPLICATION_NOT_TRACEABLE",
        label: "A recommendation cannot be traced to incident evidence",
        message: `${implCount} implication(s) have no linked incident`,
      });
  }

  return issues;
}

/** Convenience helper mirroring FuelRequiredDataMissingError usage — validate
 *  and throw when blocking issues exist and the caller did not opt out. */
export function assertCargoReportValid(
  model: CargoPatternModel,
  overrides: CargoReportOverrides,
  issueDate: string,
): void {
  const issues = validateCargoReport(model, overrides, issueDate);
  if (issues.length) throw new CargoReportValidationError(issues);
}
