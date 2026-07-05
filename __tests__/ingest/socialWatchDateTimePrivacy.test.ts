// Two more social-watch DERIVATION-PIPELINE extractors under test (see lib/ingest
// socialWatch.ts + routes/socialWatch.ts deriveWatchFields), siblings of the ones
// covered in socialWatchExtractors.test.ts:
//   - extractEventDateTime parses an Indonesian date + time from a pasted caption,
//     rolls a year-less date forward when it is well in the past, and converts a
//     WIB/WITA/WIT wall-clock time to UTC. A silent regression would put a WRONG
//     event time into a promoted, published incident.
//   - sanitiseCaption is a HARD privacy guardrail: it must strip phone numbers,
//     WhatsApp links and emails BEFORE a caption is persisted or shipped in a
//     promoted incident summary, while preserving public hashtags and @org
//     mentions. A regression here leaks personal data into stored/published
//     intelligence.

import { extractEventDateTime, sanitiseCaption } from "@workspace/ingest";

describe("extractEventDateTime", () => {
  // Fixed reference "now" so year roll-forward is deterministic.
  const now = new Date(Date.UTC(2026, 5, 1, 0, 0, 0)); // 2026-06-01

  it("parses a Bahasa date with an explicit year", () => {
    const { eventDate } = extractEventDateTime("Aksi 22 Agustus 2026 di DPR", now);
    expect(eventDate).not.toBeNull();
    expect(eventDate!.getUTCFullYear()).toBe(2026);
    expect(eventDate!.getUTCMonth()).toBe(7); // Agustus = August (0-indexed)
    expect(eventDate!.getUTCDate()).toBe(22);
    // No time in the text → default ~12:00 WIB stored as 05:00 UTC.
    expect(eventDate!.getUTCHours()).toBe(5);
  });

  it("parses a date + time and converts WIB (+7) wall time to UTC", () => {
    const { eventDate, eventTimeText } = extractEventDateTime(
      "Aksi 22 Juni 2026 pukul 14.00 WIB di Monas",
      now,
    );
    expect(eventTimeText).toBe("14.00 WIB");
    expect(eventDate).not.toBeNull();
    expect(eventDate!.getUTCMonth()).toBe(5); // Juni = June
    expect(eventDate!.getUTCDate()).toBe(22);
    // 14:00 WIB (+7) → 07:00 UTC.
    expect(eventDate!.getUTCHours()).toBe(7);
    expect(eventDate!.getUTCMinutes()).toBe(0);
  });

  it("converts WITA (+8) to UTC", () => {
    const { eventDate, eventTimeText } = extractEventDateTime(
      "Aksi 10 Juli 2026 jam 15.30 WITA",
      now,
    );
    expect(eventTimeText).toBe("15.30 WITA");
    // 15:30 WITA (+8) → 07:30 UTC.
    expect(eventDate!.getUTCHours()).toBe(7);
    expect(eventDate!.getUTCMinutes()).toBe(30);
  });

  it("converts WIT (+9) to UTC", () => {
    const { eventDate, eventTimeText } = extractEventDateTime(
      "Aksi 10 Juli 2026 pukul 16:45 WIT",
      now,
    );
    expect(eventTimeText).toBe("16.45 WIT");
    // 16:45 WIT (+9) → 07:45 UTC.
    expect(eventDate!.getUTCHours()).toBe(7);
    expect(eventDate!.getUTCMinutes()).toBe(45);
  });

  it("defaults an unmarked time to WIB (+7)", () => {
    const { eventTimeText } = extractEventDateTime(
      "Aksi 10 Juli 2026 pukul 09.00",
      now,
    );
    expect(eventTimeText).toBe("09.00 WIB");
  });

  it("keeps a year-less date in the current year when it is not well in the past", () => {
    // now = 2026-06-01; an event on 22 Juni is in the future → stays 2026.
    const { eventDate } = extractEventDateTime("Aksi 22 Juni pukul 10.00 WIB", now);
    expect(eventDate!.getUTCFullYear()).toBe(2026);
    expect(eventDate!.getUTCMonth()).toBe(5);
    expect(eventDate!.getUTCDate()).toBe(22);
  });

  it("rolls a year-less date forward when it is well in the past (>45 days)", () => {
    // now = 2026-06-01; "10 Januari" without a year is ~5 months back → roll to 2027.
    const { eventDate } = extractEventDateTime("Aksi 10 Januari pukul 08.00 WIB", now);
    expect(eventDate!.getUTCFullYear()).toBe(2027);
    expect(eventDate!.getUTCMonth()).toBe(0); // Januari
    expect(eventDate!.getUTCDate()).toBe(10);
  });

  it("returns nulls when there is no date or time", () => {
    expect(extractEventDateTime("Massa berkumpul di depan gedung", now)).toEqual({
      eventDate: null,
      eventTimeText: null,
    });
  });

  it("extracts a bare time even without a date", () => {
    const { eventDate, eventTimeText } = extractEventDateTime(
      "Kumpul pukul 13.00 WIB",
      now,
    );
    expect(eventTimeText).toBe("13.00 WIB");
    // No date → no offset conversion can anchor a date.
    expect(eventDate).toBeNull();
  });
});

describe("sanitiseCaption", () => {
  it("strips an Indonesian +62 phone number", () => {
    const out = sanitiseCaption("Hubungi panitia +62 812 3456 7890 untuk info");
    expect(out).not.toMatch(/\+?62/);
    expect(out).not.toMatch(/\d{4}/);
    expect(out).toContain("[removed]");
  });

  it("strips a local 08… phone number", () => {
    const out = sanitiseCaption("Kontak 0812 3456 7890 ya");
    expect(out).not.toMatch(/0812/);
    expect(out).toContain("[removed]");
  });

  it("strips a wa.me WhatsApp link", () => {
    const out = sanitiseCaption("Gabung grup https://wa.me/6281234567890 sekarang");
    expect(out).not.toMatch(/wa\.me/);
    expect(out).toContain("[removed]");
  });

  it("strips a chat.whatsapp.com invite link", () => {
    const out = sanitiseCaption(
      "Join https://chat.whatsapp.com/AbCdEf123456 untuk koordinasi",
    );
    expect(out).not.toMatch(/whatsapp\.com/);
    expect(out).toContain("[removed]");
  });

  it("strips a 'WhatsApp: <number>' form", () => {
    const out = sanitiseCaption("WhatsApp: +62 813 9999 0000");
    expect(out).not.toMatch(/\d{4}/);
    expect(out).toContain("[removed]");
  });

  it("strips an email address", () => {
    const out = sanitiseCaption("Info: panitia.aksi@example.org saja");
    expect(out).not.toMatch(/@example\.org/);
    expect(out).toContain("[removed]");
  });

  it("preserves public hashtags and @org mentions", () => {
    const out = sanitiseCaption(
      "Aksi damai #IndonesiaDarurat bersama @kammipusat hari ini",
    );
    expect(out).toContain("#IndonesiaDarurat");
    expect(out).toContain("@kammipusat");
    expect(out).not.toContain("[removed]");
  });

  it("strips personal data while keeping the surrounding public text", () => {
    const out = sanitiseCaption(
      "Aksi #TolakBBM @bemui, daftar 0812 3456 7890 atau email ke daftar@bem.ac.id",
    );
    expect(out).toContain("#TolakBBM");
    expect(out).toContain("@bemui");
    expect(out).not.toMatch(/0812/);
    expect(out).not.toMatch(/@bem\.ac\.id/);
    expect(out).toContain("[removed]");
  });
});
