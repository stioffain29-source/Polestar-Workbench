import {
  resolveKammiTheatre,
  kammiItemInReportTheatre,
  type KammiGeoItem,
} from "@workspace/ingest/kammiGeography";

describe("resolveKammiTheatre", () => {
  it("routes a West-Papua post (by province) to the westPapua theatre", () => {
    const item: KammiGeoItem = {
      city: "Jakarta", // schema default — must NOT swallow a real West-Papua post
      province: "Papua",
      location: "Jayapura",
      caption: "Aksi mahasiswa di Jayapura menolak kebijakan.",
    };
    const geo = resolveKammiTheatre(item);
    expect(geo.theatre).toBe("westPapua");
    expect(geo.countryTag).toBe("West Papua");
  });

  it("routes a West-Papua post named only in the caption", () => {
    const item: KammiGeoItem = {
      city: "Jakarta",
      province: null,
      location: null,
      caption: "Solidaritas untuk Wamena, West Papua.",
    };
    expect(resolveKammiTheatre(item).theatre).toBe("westPapua");
  });

  it("does NOT route a Papua New Guinea mention to West Papua", () => {
    const item: KammiGeoItem = {
      city: "Jakarta",
      province: null,
      location: null,
      caption: "Statement on Papua New Guinea unrest in Port Moresby.",
    };
    expect(resolveKammiTheatre(item).theatre).not.toBe("westPapua");
  });

  it("routes a Jakarta post by content, not the defaulted city", () => {
    const item: KammiGeoItem = {
      city: "Jakarta",
      province: null,
      location: "Monas, Jakarta Pusat",
      caption: "Longmarch menuju Istana di Jakarta Pusat.",
    };
    const geo = resolveKammiTheatre(item);
    expect(geo.theatre).toBe("jakarta");
    expect(geo.countryTag).toBe("Indonesia");
  });

  it("routes a post with no Jakarta / West-Papua signal to national Indonesia", () => {
    const item: KammiGeoItem = {
      city: "Jakarta", // defaulted only — no real geography signal
      province: "Jawa Timur",
      location: "Surabaya",
      caption: "Aksi di Surabaya menuntut transparansi anggaran.",
    };
    const geo = resolveKammiTheatre(item);
    expect(geo.theatre).toBe("indonesia");
    expect(geo.countryTag).toBe("Indonesia");
  });
});

describe("kammiItemInReportTheatre", () => {
  const westPapua: KammiGeoItem = { province: "Papua", location: "Wamena", caption: "" };
  const jakarta: KammiGeoItem = { location: "Jakarta Pusat", caption: "Aksi di Jakarta Pusat" };
  const national: KammiGeoItem = { province: "Jawa Barat", location: "Bandung", caption: "Aksi di Bandung" };

  it("shows West-Papua posts only in the papua report", () => {
    expect(kammiItemInReportTheatre(westPapua, "westPapua")).toBe(true);
    expect(kammiItemInReportTheatre(westPapua, "jakarta")).toBe(false);
    expect(kammiItemInReportTheatre(westPapua, "indonesia")).toBe(false);
  });

  it("shows Jakarta posts in the Jakarta brief AND the national report", () => {
    expect(kammiItemInReportTheatre(jakarta, "jakarta")).toBe(true);
    expect(kammiItemInReportTheatre(jakarta, "indonesia")).toBe(true);
    expect(kammiItemInReportTheatre(jakarta, "westPapua")).toBe(false);
  });

  it("shows national posts in the national report but not Jakarta / West Papua", () => {
    expect(kammiItemInReportTheatre(national, "indonesia")).toBe(true);
    expect(kammiItemInReportTheatre(national, "jakarta")).toBe(false);
    expect(kammiItemInReportTheatre(national, "westPapua")).toBe(false);
  });

  it("never shows KAMMI on PNG, generic, or null reports", () => {
    expect(kammiItemInReportTheatre(westPapua, "png")).toBe(false);
    expect(kammiItemInReportTheatre(jakarta, null)).toBe(false);
    expect(kammiItemInReportTheatre(national, "png")).toBe(false);
  });
});
