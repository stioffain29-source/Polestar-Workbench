import {
  decideTapaSeverity,
  decideTapaPromotion,
  normaliseTapaCountry,
  parseTapaEur,
  eurToUsd,
  parseTapaDate,
  tapaMarker,
  tapaRowHash,
  isTapaMarker,
  markTapaRows,
  tapaInputFromRecord,
  parseTapaHtml,
  tapaRowToRecord,
  TAPA_COLUMNS,
  TAPA_PROMOTE_MARKER_PREFIX,
  DEFAULT_EUR_USD_RATE,
  type TapaPromoteInput,
} from "@workspace/ingest";
import { RELEVANCE_RULE_VERSION } from "@workspace/relevance";

// A minimal, fully-populated TAPA promote input. Callers override the fields the
// test cares about.
function input(over: Partial<TapaPromoteInput> = {}): TapaPromoteInput {
  return {
    dateOfIncident: "05.07.2026",
    incidentCategory: "Theft from Vehicle",
    modusOperandi: "Deceptive Stopping / Diversion",
    productCategory: "Electronics",
    locationType: "En Route",
    highValue: "No",
    valueEur: "50000",
    city: "Singapore",
    country: "Singapore",
    eurUsdRate: 1.09,
    marker: `${TAPA_PROMOTE_MARKER_PREFIX}abc:0`,
    ...over,
  };
}

describe("parseTapaEur", () => {
  it("parses thousands-separated integers", () => {
    expect(parseTapaEur("1,234,567")).toBe(1234567);
    expect(parseTapaEur("15557005")).toBe(15557005);
  });
  it("returns null for N/A and blank", () => {
    expect(parseTapaEur("N/A")).toBeNull();
    expect(parseTapaEur("")).toBeNull();
    expect(parseTapaEur("  ")).toBeNull();
  });
});

describe("eurToUsd", () => {
  it("converts at the given rate, rounded", () => {
    expect(eurToUsd(1000, 1.09)).toBe(1090);
    expect(eurToUsd(12345, 1.1)).toBe(13580);
  });
});

describe("parseTapaDate", () => {
  it("parses dd.mm.yyyy to a UTC-midnight date", () => {
    const d = parseTapaDate("05.07.2026");
    expect(d?.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });
  it("rejects impossible and malformed dates", () => {
    expect(parseTapaDate("31.02.2026")).toBeNull();
    expect(parseTapaDate("2026-07-05")).toBeNull();
    expect(parseTapaDate("")).toBeNull();
  });
});

describe("normaliseTapaCountry", () => {
  it("files Hong Kong under China with a geo hint", () => {
    expect(normaliseTapaCountry("Hong Kong")).toEqual({
      country: "China",
      geoHint: "Hong Kong",
    });
  });
  it("canonicalises Vietnam, South Korea and Taiwan spellings", () => {
    expect(normaliseTapaCountry("Viet Nam").country).toBe("Vietnam");
    expect(normaliseTapaCountry("Korea, Republic of").country).toBe("South Korea");
    expect(normaliseTapaCountry("Taiwan, Province of China").country).toBe("Taiwan");
  });
  it("passes through an unmapped country verbatim", () => {
    expect(normaliseTapaCountry("Singapore")).toEqual({ country: "Singapore" });
  });
});

describe("decideTapaSeverity", () => {
  it("is HIGH when High Value = Yes regardless of USD", () => {
    expect(decideTapaSeverity("Yes", null, "", "")).toBe("high");
    expect(decideTapaSeverity("yes", 10, "", "")).toBe("high");
  });
  it("is HIGH when USD >= 100000", () => {
    expect(decideTapaSeverity("No", 100000, "", "")).toBe("high");
  });
  it("is MODERATE for USD in [10000, 100000)", () => {
    expect(decideTapaSeverity("No", 10000, "", "")).toBe("moderate");
    expect(decideTapaSeverity("No", 99999, "", "")).toBe("moderate");
  });
  it("is MODERATE for the violent modus operandi", () => {
    expect(
      decideTapaSeverity("No", null, "Violent & Threat with Violence", ""),
    ).toBe("moderate");
  });
  it("is MODERATE for a moderate incident category", () => {
    expect(decideTapaSeverity("No", null, "", "Robbery")).toBe("moderate");
    expect(decideTapaSeverity("No", 500, "", "Theft of Vehicle")).toBe("moderate");
  });
  it("is LOW otherwise, including N/A value", () => {
    expect(decideTapaSeverity("No", null, "", "")).toBe("low");
    expect(decideTapaSeverity("No", 9999, "", "")).toBe("low");
  });
  it("never assigns extreme or insignificant", () => {
    const all = [
      decideTapaSeverity("Yes", 5_000_000, "", ""),
      decideTapaSeverity("No", null, "", ""),
    ];
    expect(all).not.toContain("extreme");
    expect(all).not.toContain("insignificant");
  });
});

describe("tapa markers", () => {
  it("builds a prefixed marker and recognises it", () => {
    const m = tapaMarker("deadbeef", 2);
    expect(m).toBe(`${TAPA_PROMOTE_MARKER_PREFIX}deadbeef:2`);
    expect(isTapaMarker(m)).toBe(true);
    expect(isTapaMarker("gdelt_cloud:x")).toBe(false);
    expect(isTapaMarker(null)).toBe(false);
  });
  it("hashes the nine fields deterministically", () => {
    const row = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    expect(tapaRowHash(row)).toBe(tapaRowHash([...row]));
    expect(tapaRowHash(row)).not.toBe(tapaRowHash(["z", ...row.slice(1)]));
  });
  it("collapses byte-identical rows to a single occurrence-0 marker", () => {
    const row = ["05.07.2026", "Robbery", "", "", "", "No", "N/A", "X", "Singapore"];
    const marked = markTapaRows([row, [...row], ["09.09.2026", ...row.slice(1)]]);
    // the two byte-identical rows collapse to one; the differing-date row stays
    expect(marked).toHaveLength(2);
    expect(marked[0].marker.endsWith(":0")).toBe(true);
    expect(marked[1].marker.endsWith(":0")).toBe(true);
    // the two survivors carry different hashes
    expect(marked[0].marker).not.toBe(marked[1].marker);
  });
});

describe("decideTapaPromotion", () => {
  it("skips rows with no parseable date", () => {
    const d = decideTapaPromotion(input({ dateOfIncident: "not a date" }));
    expect(d).toEqual({ promote: false, reason: "no-date" });
  });
  it("skips rows with no country", () => {
    const d = decideTapaPromotion(input({ country: "   " }));
    expect(d).toEqual({ promote: false, reason: "no-country" });
  });
  it("promotes an in-scope row as a cargo_watch incident", () => {
    const d = decideTapaPromotion(input());
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.topic).toBe("cargo_watch");
    expect(d.row.country).toBe("Singapore");
    expect(d.row.analystInScope).toBe(true);
    expect(d.row.severity).toBe("moderate"); // USD 50000*1.09 = 54500
    expect(d.row.relevanceStatus).toBe("relevant");
    expect(d.row.relevanceVersion).toBe(RELEVANCE_RULE_VERSION);
    expect(d.row.source).toContain("TAPA");
    expect(d.row.analystNotes).toBe(input().marker);
    expect(d.row.occurredAt?.toISOString()).toBe("2026-07-05T00:00:00.000Z");
  });
  it("embeds a USD figure the Cargo Watch loss parser can read", () => {
    const d = decideTapaPromotion(input({ valueEur: "100000", eurUsdRate: 1.09 }));
    if (!d.promote) throw new Error("expected promote");
    // 100000 * 1.09 = 109000 → "US$109,000"
    expect(d.row.summary).toContain("US$109,000");
    // Mirror the frontend parseUsdLoss first-match regex + context gate.
    const text = `${d.row.title} ${d.row.summary ?? ""}`;
    const m = text.match(/(?:US\$|USD\s*\$?|\$)\s?([\d][\d,]*(?:\.\d+)?)/i);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1].replace(/,/g, ""))).toBe(109000);
  });
  it("promotes an out-of-scope country but marks it not in-scope", () => {
    const d = decideTapaPromotion(input({ country: "France", city: "Paris" }));
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.country).toBe("France");
    expect(d.row.analystInScope).toBe(false);
  });
  it("omits the USD sentence entirely when value is N/A", () => {
    const d = decideTapaPromotion(input({ valueEur: "N/A" }));
    if (!d.promote) throw new Error("expected promote");
    expect(d.row.summary).not.toContain("US$");
  });
});

describe("parseTapaHtml", () => {
  const html = `
    <html><body>
    <table>
      <thead><tr>
        <th>Date of incident</th><th>Incident Category</th><th>Modus Operandi</th>
        <th>Product Category</th><th>Location Type</th><th>High Value</th>
        <th>Value EUR</th><th>City</th><th>Country</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>05.07.2026</td><td>Theft from Vehicle</td>
          <td>Violent &amp; Threat with Violence</td><td>Electronics</td>
          <td>En Route</td><td>Yes</td><td>1,234,567</td>
          <td>Singapore</td><td>Singapore</td>
        </tr>
      </tbody>
    </table>
    </body></html>`;

  it("extracts rows aligned to TAPA_COLUMNS with entities decoded", () => {
    const parsed = parseTapaHtml(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.missingColumns).toEqual([]);
    expect(parsed!.rows).toHaveLength(1);
    const rec = tapaRowToRecord(parsed!.rows[0]);
    expect(rec["Date of incident"]).toBe("05.07.2026");
    expect(rec["Modus Operandi"]).toBe("Violent & Threat with Violence");
    expect(rec["Value EUR"]).toBe("1,234,567");
    expect(rec["Country"]).toBe("Singapore");
  });

  it("round-trips through the promote decision", () => {
    const parsed = parseTapaHtml(html)!;
    const rec = tapaRowToRecord(parsed.rows[0]);
    const d = decideTapaPromotion(
      tapaInputFromRecord(rec, DEFAULT_EUR_USD_RATE, `${TAPA_PROMOTE_MARKER_PREFIX}x:0`),
    );
    expect(d.promote).toBe(true);
    if (!d.promote) return;
    expect(d.row.severity).toBe("high"); // High Value = Yes
    expect(TAPA_COLUMNS).toHaveLength(9);
  });

  it("returns null when no incident table is present", () => {
    expect(parseTapaHtml("<html><body><p>nothing</p></body></html>")).toBeNull();
  });
});
