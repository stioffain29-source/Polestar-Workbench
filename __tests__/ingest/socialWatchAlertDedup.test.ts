// Two more social-watch PROMOTION-PIPELINE invariants under test (companion to
// socialWatchExtractors.test.ts). When a KAMMI/BEM social-watch post is promoted
// into a flashpoint/Indonesia incident, two derivations here shape the result:
//   - detectAlertReasons: the watch-alert reasons stamped on the incident
//     (march route, wider mobilisation, cordon, arrest, dispersal, crowd images,
//     movement from a key staging venue) plus diffs against the prior post for
//     the same campaign (location changed / start time changed). A silent
//     regression would drop a real alert reason or fabricate one that never
//     happened.
//   - makeDedupKey: the caption+image fingerprint that collapses reposts and
//     cross-platform re-shares to a single incident. A regression would let one
//     protest appear as multiple incidents, or wrongly merge two distinct ones.
// Both feed published intelligence, so they are unit-tested directly here.

import { detectAlertReasons, makeDedupKey } from "@workspace/ingest";

type Loc = { location: string | null; city: string; province: string | null };

const JAKARTA: Loc = {
  location: null,
  city: "Jakarta",
  province: "DKI Jakarta",
};

describe("detectAlertReasons", () => {
  it("flags a march route from long march / route / convoy / pawai cues", () => {
    expect(
      detectAlertReasons("Long march dari Monas", false, JAKARTA, null, "active"),
    ).toContain("March route announced");
    expect(
      detectAlertReasons("Massa bergerak menuju DPR", false, JAKARTA, null, "active"),
    ).toContain("March route announced");
    expect(
      detectAlertReasons("Konvoi motor menuju istana", false, JAKARTA, null, "active"),
    ).toContain("March route announced");
  });

  it("flags a call for wider mobilisation from ajakan / serentak / nationwide cues", () => {
    expect(
      detectAlertReasons("Ajakan aksi serentak seluruh Indonesia", false, JAKARTA, null, "planned"),
    ).toContain("Call for wider mobilisation");
    expect(
      detectAlertReasons("Mari turun ke jalan", false, JAKARTA, null, "planned"),
    ).toContain("Call for wider mobilisation");
    // Narrow guard: the bare "ajakan" cue alone (no serentak/nationwide/mari)
    // must still flag mobilisation, so a regression in that token path is caught.
    expect(
      detectAlertReasons("Ajakan untuk hadir", false, JAKARTA, null, "planned"),
    ).toContain("Call for wider mobilisation");
  });

  it("flags a police cordon / road closure from barikade / blokade / tutup jalan cues", () => {
    expect(
      detectAlertReasons("Polisi pasang barikade", false, JAKARTA, null, "active"),
    ).toContain("Police cordon / road closure");
    expect(
      detectAlertReasons("Jalan ditutup dengan kawat berduri", false, JAKARTA, null, "active"),
    ).toContain("Police cordon / road closure");
  });

  it("flags an arrest from ditangkap / penangkapan / diamankan cues", () => {
    expect(
      detectAlertReasons("Sejumlah mahasiswa ditangkap", false, JAKARTA, null, "active"),
    ).toContain("Arrest reported");
    expect(
      detectAlertReasons("Beberapa orang diamankan aparat", false, JAKARTA, null, "active"),
    ).toContain("Arrest reported");
  });

  it("flags dispersal / clash from dibubarkan / gas air mata / bentrok cues", () => {
    expect(
      detectAlertReasons("Massa dibubarkan dengan gas air mata", false, JAKARTA, null, "dispersed"),
    ).toContain("Dispersal / clash reported");
    expect(
      detectAlertReasons("Bentrok dengan aparat, water cannon", false, JAKARTA, null, "dispersed"),
    ).toContain("Dispersal / clash reported");
  });

  it("flags an active crowd image only when images accompany an active status", () => {
    expect(
      detectAlertReasons("Massa memadati jalan", true, JAKARTA, null, "active"),
    ).toContain("Crowd images: active gathering");
    // Same active text, but no images → no crowd-image reason.
    expect(
      detectAlertReasons("Massa memadati jalan", false, JAKARTA, null, "active"),
    ).not.toContain("Crowd images: active gathering");
    // Images present but the status is not active → no crowd-image reason.
    expect(
      detectAlertReasons("Rencana aksi besok", true, JAKARTA, null, "planned"),
    ).not.toContain("Crowd images: active gathering");
  });

  it("flags movement from a key staging venue only when a movement verb co-occurs", () => {
    // A key venue (DPR/MPR) plus a movement verb → named movement reason.
    expect(
      detectAlertReasons("Massa bergerak menuju Gedung DPR/MPR RI", false, JAKARTA, null, "active"),
    ).toContain("Movement from Gedung DPR/MPR RI");
    // The same key venue WITHOUT a movement verb → no movement reason.
    expect(
      detectAlertReasons("Aksi di Gedung DPR/MPR RI", false, JAKARTA, null, "active"),
    ).not.toContain("Movement from Gedung DPR/MPR RI");
  });

  it("names the specific key venue in the movement reason (Monas, Surabaya)", () => {
    expect(
      detectAlertReasons("Long march dari Monas menuju istana", false, JAKARTA, null, "active"),
    ).toContain("Movement from Monas / Medan Merdeka");
    expect(
      detectAlertReasons("Massa bergerak menuju Grahadi Surabaya", false, JAKARTA, null, "active"),
    ).toContain("Movement from Surabaya");
  });

  it("reports no reasons for a plain caption with no alert cues", () => {
    expect(
      detectAlertReasons("Selamat pagi semua", false, JAKARTA, null, "unclear"),
    ).toEqual([]);
  });

  it("de-duplicates reasons and can report several at once", () => {
    const reasons = detectAlertReasons(
      "Long march menuju DPR, massa dibubarkan gas air mata, mahasiswa ditangkap",
      true,
      JAKARTA,
      null,
      "dispersed",
    );
    expect(reasons).toContain("March route announced");
    expect(reasons).toContain("Dispersal / clash reported");
    expect(reasons).toContain("Arrest reported");
    // Set semantics: no duplicate entries.
    expect(reasons.length).toBe(new Set(reasons).size);
  });

  describe("prior-post diffs", () => {
    const withVenue: Loc = {
      location: "Gedung DPR/MPR RI",
      city: "Jakarta",
      province: "DKI Jakarta",
    };

    it("flags a location change against the prior post for the same campaign", () => {
      const reasons = detectAlertReasons(
        "Aksi di Gedung DPR/MPR RI",
        false,
        withVenue,
        null,
        "active",
        { location: "Monas / Medan Merdeka", eventTimeText: null },
      );
      expect(reasons).toContain("Location changed");
    });

    it("does NOT flag a location change when the venue is unchanged (case-insensitive)", () => {
      const reasons = detectAlertReasons(
        "Aksi di Gedung DPR/MPR RI",
        false,
        withVenue,
        null,
        "active",
        { location: "gedung dpr/mpr ri", eventTimeText: null },
      );
      expect(reasons).not.toContain("Location changed");
    });

    it("does NOT flag a location change when either side is missing a location", () => {
      // Current location null.
      expect(
        detectAlertReasons("Aksi damai", false, JAKARTA, null, "active", {
          location: "Monas / Medan Merdeka",
          eventTimeText: null,
        }),
      ).not.toContain("Location changed");
      // Prior location null.
      expect(
        detectAlertReasons("Aksi di Gedung DPR/MPR RI", false, withVenue, null, "active", {
          location: null,
          eventTimeText: null,
        }),
      ).not.toContain("Location changed");
    });

    it("flags a start-time change against the prior post", () => {
      const reasons = detectAlertReasons(
        "Aksi mulai 09.00 WIB",
        false,
        JAKARTA,
        "09.00 WIB",
        "planned",
        { location: null, eventTimeText: "13.00 WIB" },
      );
      expect(reasons).toContain("Start time changed");
    });

    it("does NOT flag a start-time change when the time is unchanged", () => {
      const reasons = detectAlertReasons(
        "Aksi mulai 09.00 WIB",
        false,
        JAKARTA,
        "09.00 WIB",
        "planned",
        { location: null, eventTimeText: "09.00 WIB" },
      );
      expect(reasons).not.toContain("Start time changed");
    });

    it("produces no diff reasons when there is no prior post", () => {
      const reasons = detectAlertReasons(
        "Aksi di Gedung DPR/MPR RI mulai 09.00 WIB",
        false,
        withVenue,
        "09.00 WIB",
        "active",
      );
      expect(reasons).not.toContain("Location changed");
      expect(reasons).not.toContain("Start time changed");
    });
  });
});

describe("makeDedupKey", () => {
  it("collapses an exact repost (identical caption and image) to one key", () => {
    const a = makeDedupKey("Aksi mahasiswa di DPR hari ini", ["https://cdn.example.com/a/photo1.jpg"]);
    const b = makeDedupKey("Aksi mahasiswa di DPR hari ini", ["https://cdn.example.com/a/photo1.jpg"]);
    expect(a).toBe(b);
  });

  it("collapses a CDN-rehosted repost (same image basename, different host/path/query)", () => {
    // Same caption; the image was re-hosted on a different CDN with a different
    // path and tracking query, but the basename is identical → same event.
    const original = makeDedupKey("Massa memadati jalan menuju istana", [
      "https://cdn1.instagram.com/photos/xyz789.jpg?ig_cache_key=abc",
    ]);
    const reshared = makeDedupKey("Massa memadati jalan menuju istana", [
      "https://scontent.cdninstagram.com/v/media/xyz789.jpg?token=deadbeef&w=1080",
    ]);
    expect(reshared).toBe(original);
  });

  it("ignores caption casing, punctuation and embedded URLs when fingerprinting", () => {
    const plain = makeDedupKey("Aksi mahasiswa di DPR hari ini", ["https://cdn.example.com/a/p.jpg"]);
    const noisy = makeDedupKey(
      "AKSI, MAHASISWA! di DPR hari ini https://t.co/shorturl",
      ["https://cdn.example.com/a/p.jpg"],
    );
    expect(noisy).toBe(plain);
  });

  it("distinguishes genuinely different captions with the same image", () => {
    const a = makeDedupKey("Aksi mahasiswa di DPR menolak RUU", ["https://cdn.example.com/a/p.jpg"]);
    const b = makeDedupKey("Konsolidasi buruh di Monas soal upah", ["https://cdn.example.com/a/p.jpg"]);
    expect(a).not.toBe(b);
  });

  it("distinguishes the same caption carrying a different image", () => {
    const a = makeDedupKey("Aksi mahasiswa di DPR hari ini", ["https://cdn.example.com/a/photo1.jpg"]);
    const b = makeDedupKey("Aksi mahasiswa di DPR hari ini", ["https://cdn.example.com/a/photo2.jpg"]);
    expect(a).not.toBe(b);
  });

  it("handles a caption-only post (no images) deterministically", () => {
    const a = makeDedupKey("Aksi damai tanpa foto", []);
    const b = makeDedupKey("Aksi damai tanpa foto", []);
    expect(a).toBe(b);
    // A later post that adds an image is a distinct fingerprint.
    const withImg = makeDedupKey("Aksi damai tanpa foto", ["https://cdn.example.com/a/p.jpg"]);
    expect(withImg).not.toBe(a);
  });

  it("always produces a stable sw_-prefixed key", () => {
    expect(makeDedupKey("apa saja", [])).toMatch(/^sw_[a-z0-9]+$/);
  });
});
