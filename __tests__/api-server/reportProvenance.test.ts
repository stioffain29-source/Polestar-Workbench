import {
  mergeReportProvenance,
  normaliseReportProvenance,
} from "../../artifacts/api-server/src/lib/reportProvenance";

const baseReport = (extra: Record<string, unknown> = {}) =>
  ({
    id: 7,
    topic: "fuel",
    proseBasisFingerprint: "basis-current",
    proseProvenance: null,
    executiveSummary: "saved text",
    situation: null,
    ...extra,
  }) as never;

const cache = (extra: Record<string, unknown> = {}) =>
  ({
    fingerprint: "cache-current",
    generationBasisFingerprint: "basis-current",
    sections: { executiveSummary: "AI text" },
    edited: null,
    editedFingerprint: null,
    editedGenerationBasisFingerprint: null,
    ...extra,
  }) as never;

describe("report prose provenance", () => {
  it("never infers analyst authorship from a populated legacy field", () => {
    const provenance = mergeReportProvenance(
      baseReport(),
      { executiveSummary: "saved text" },
      undefined,
    );
    expect(provenance.executiveSummary.kind).toBe("GENERATED_UNKNOWN");
  });

  it("recognises an exact edited-cache value only with matching fingerprints", () => {
    const provenance = mergeReportProvenance(
      baseReport({ executiveSummary: "edited text" }),
      { executiveSummary: "edited text" },
      cache({
        edited: { executiveSummary: "edited text" },
        editedFingerprint: "cache-old",
        editedGenerationBasisFingerprint: "basis-current",
      }),
    );
    expect(provenance.executiveSummary).toEqual({
      kind: "ANALYST_EDITED",
      fingerprint: "cache-old",
      generationBasisFingerprint: "basis-current",
    });

    const noProof = mergeReportProvenance(
      baseReport({ executiveSummary: "edited text" }),
      { executiveSummary: "edited text" },
      cache({
        edited: { executiveSummary: "edited text" },
        editedFingerprint: "cache-old",
        editedGenerationBasisFingerprint: "basis-other",
      }),
    );
    expect(noProof.executiveSummary.kind).not.toBe("ANALYST_EDITED");
  });

  it("marks only explicitly dirty sections as analyst edited", () => {
    const provenance = mergeReportProvenance(
      baseReport(),
      { executiveSummary: "user text", situation: "generated text" },
      cache({ sections: { situation: "AI situation" } }),
      ["executiveSummary"],
    );
    expect(provenance.executiveSummary.kind).toBe("ANALYST_EDITED");
    expect(provenance.situation.kind).toBe("GENERATED");
  });

  it("merges untouched section metadata instead of replacing it", () => {
    const provenance = mergeReportProvenance(
      baseReport({
        proseProvenance: {
          situation: {
            kind: "ANALYST_EDITED",
            fingerprint: "old",
            generationBasisFingerprint: "basis-old",
          },
        },
      }),
      { executiveSummary: "new generated" },
      undefined,
    );
    expect(provenance.situation.kind).toBe("ANALYST_EDITED");
    expect(provenance.executiveSummary.kind).toBe("GENERATED");
  });

  it("normalises null and compact legacy provenance conservatively", () => {
    expect(normaliseReportProvenance(null)).toEqual({});
    expect(normaliseReportProvenance({ situation: "ANALYST_EDITED" })).toEqual({
      situation: { kind: "ANALYST_EDITED" },
    });
  });
});
