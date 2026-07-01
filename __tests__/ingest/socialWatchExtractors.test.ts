// Social-watch DERIVATION-PIPELINE invariant under test (see lib/ingest
// socialWatch.ts + routes/socialWatch.ts deriveWatchFields): promoting a
// KAMMI/BEM social-watch post derives the incident's status, location, issue and
// promotion-eligibility from the pasted caption via these ingest extractors,
// which then FEED buildIncidentTitle / buildIncidentSummary. Those builders have
// their own coverage (buildIncidentTitleSummary.test.ts), but a silent
// regression UPSTREAM here — a mis-classified "active" vs "dispersed" status, a
// dropped venue/city fallback, a missed issue label, or a planned/cancelled post
// wrongly becoming promotable — would flow straight into published intelligence
// even while the builders stay correct. This unit-tests the extractors directly
// across representative Bahasa/English captions.

import {
  classifyStatus,
  extractLocation,
  extractIssue,
  isPromotable,
  type SocialWatchStatus,
} from "@workspace/ingest";

describe("classifyStatus", () => {
  it("cancelled cues win over everything (a called-off protest is not active)", () => {
    expect(classifyStatus("Aksi besok DIBATALKAN", false)).toBe("cancelled");
    expect(classifyStatus("Aksi ditunda sampai waktu ditentukan", false)).toBe(
      "cancelled",
    );
    // Even alongside an active-sounding word, cancelled takes precedence.
    expect(classifyStatus("Massa berkumpul tapi aksi batal", false)).toBe(
      "cancelled",
    );
  });

  it("dispersal / clash cues → dispersed", () => {
    expect(classifyStatus("Massa dibubarkan polisi", false)).toBe("dispersed");
    expect(classifyStatus("Polisi tembakkan gas air mata", false)).toBe(
      "dispersed",
    );
    expect(classifyStatus("Bentrok dengan aparat, water cannon", false)).toBe(
      "dispersed",
    );
  });

  it("an arrest confirms an active protest", () => {
    expect(classifyStatus("Sejumlah mahasiswa ditangkap", false)).toBe("active");
    expect(classifyStatus("Penangkapan terjadi di lokasi", false)).toBe(
      "active",
    );
  });

  it("present-tense gathering / march cues → active", () => {
    expect(classifyStatus("Massa sedang bergerak menuju DPR", false)).toBe(
      "active",
    );
    expect(classifyStatus("Long march dimulai dari Monas", false)).toBe(
      "active",
    );
    expect(classifyStatus("Massa memadati jalan", false)).toBe("active");
  });

  it("a crowd image plus a gathering noun reads as active", () => {
    expect(classifyStatus("Massa di depan gedung", true)).toBe("active");
    // Same text without an image is not enough to call it active.
    expect(classifyStatus("Massa di depan gedung", false)).toBe("unclear");
  });

  it("mobilisation / future-tense cues → planned", () => {
    expect(classifyStatus("Ajakan aksi serentak besok", false)).toBe("planned");
    expect(classifyStatus("Mari bergabung, catat tanggal", false)).toBe(
      "planned",
    );
    expect(classifyStatus("Save the date, aksi akan digelar", false)).toBe(
      "planned",
    );
  });

  it("dispersed cues outrank planned cues when both appear", () => {
    // "akan" (planned) present, but a dispersal happened → dispersed.
    expect(classifyStatus("Aksi yang akan digelar tadi dibubarkan", false)).toBe(
      "dispersed",
    );
  });

  it("no recognised cue → unclear", () => {
    expect(classifyStatus("Selamat pagi semua", false)).toBe("unclear");
    expect(classifyStatus("", false)).toBe("unclear");
  });
});

describe("extractLocation", () => {
  it("known venue → location + city + province", () => {
    expect(extractLocation("Aksi di Gedung DPR/MPR RI")).toEqual({
      location: "Gedung DPR/MPR RI",
      city: "Jakarta",
      province: "DKI Jakarta",
    });
    expect(extractLocation("Berkumpul di Monas")).toEqual({
      location: "Monas / Medan Merdeka",
      city: "Jakarta",
      province: "DKI Jakarta",
    });
  });

  it("a non-Jakarta city overrides the Jakarta default (location null)", () => {
    expect(extractLocation("Aksi mahasiswa di Bandung")).toEqual({
      location: null,
      city: "Bandung",
      province: "Jawa Barat",
    });
    expect(extractLocation("Long march di Yogyakarta")).toEqual({
      location: null,
      city: "Yogyakarta",
      province: "DI Yogyakarta",
    });
  });

  it("a matched venue wins over a bare city name in the same text", () => {
    // Surabaya is both a venue rule and a city rule; the venue branch runs first.
    expect(extractLocation("Aksi di Grahadi Surabaya")).toEqual({
      location: "Surabaya",
      city: "Surabaya",
      province: "Jawa Timur",
    });
  });

  it("no venue and no city → defaults to Jakarta (KAMMI Pusat's base)", () => {
    expect(extractLocation("Aksi damai hari ini")).toEqual({
      location: null,
      city: "Jakarta",
      province: "DKI Jakarta",
    });
  });
});

describe("extractIssue", () => {
  it("matches a known campaign label", () => {
    expect(extractIssue("Kawal Indonesia Darurat")).toBe("Indonesia Darurat");
    expect(extractIssue("Reformasi Indonesia sekarang")).toBe(
      "Reformasi Indonesia",
    );
    expect(extractIssue("Tolak program MBG")).toBe("MBG");
    expect(extractIssue("Aksi 22 Juni di DPR")).toBe("Aksi 22 Juni");
  });

  it("falls back to the first substantial hashtag when no label matches", () => {
    expect(extractIssue("Turun ke jalan #TolakKenaikanBBM")).toBe(
      "#TolakKenaikanBBM",
    );
    // A too-short hashtag (< 3 chars) is not treated as an issue.
    expect(extractIssue("Ayo #go sekarang")).toBeNull();
  });

  it("returns null when there is neither a label nor a hashtag", () => {
    expect(extractIssue("Massa berkumpul di depan gedung")).toBeNull();
  });
});

describe("isPromotable", () => {
  it("active and dispersed statuses are promotable", () => {
    expect(isPromotable("active", "Massa bergerak menuju DPR")).toBe(true);
    expect(isPromotable("dispersed", "Massa dibubarkan aparat")).toBe(true);
  });

  it("an arrest in the text makes an otherwise-unclear item promotable", () => {
    expect(isPromotable("unclear", "Mahasiswa ditangkap saat aksi")).toBe(true);
  });

  it("planned, cancelled and unclear items are NOT promotable", () => {
    const notPromotable: SocialWatchStatus[] = [
      "planned",
      "cancelled",
      "unclear",
    ];
    for (const status of notPromotable) {
      expect(isPromotable(status, "Ajakan aksi serentak besok")).toBe(false);
    }
  });

  it("a planned mobilisation post can never be promoted (no active/arrest cue)", () => {
    expect(isPromotable("planned", "Mari bergabung, catat tanggal 22 Juni")).toBe(
      false,
    );
  });
});
